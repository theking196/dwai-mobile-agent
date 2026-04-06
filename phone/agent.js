// DWAI Mobile Agent — Auto.js (Android)
// Polls GitHub for mobile automation tasks and executes them

// CONFIGURATION
// TODO: Replace YOUR_GITHUB_TOKEN with your actual GitHub token
var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + TASKS_PATH;
var LOGS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + LOGS_PATH;

// Ensure java is available
var java = this.java || null;

function sleep(ms) {
  if (java) {
    java.lang.Thread.sleep(ms);
  } else {
    try { $.sleep(ms); } catch(e) {}
  }
}

function log(message) {
  console.log(message);
  toast(message);
}

function toBase64(str) {
  try {
    var Base64 = android.util.Base64;
    var bytes = new java.lang.String(str).getBytes("UTF-8");
    return Base64.encodeToString(bytes, Base64.NO_WRAP);
  } catch (e) { return ""; }
}

function fromBase64(str) {
  try {
    var Base64 = android.util.Base64;
    var bytes = Base64.decode(str, Base64.DEFAULT);
    return new java.lang.String(bytes, "UTF-8");
  } catch (e) { return str; }
}

// HTTP functions using java.net
function httpGet(url, headers) {
  try {
    var u = new java.net.URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("GET");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    if (headers) {
      for (var key in headers) { conn.setRequestProperty(key, headers[key]); }
    }
    var code = conn.getResponseCode();
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
    var line, body = "";
    while ((line = reader.readLine()) != null) { body += line; }
    reader.close(); conn.disconnect();
    return { statusCode: code, body: body };
  } catch (e) { return { statusCode: -1, body: e.toString() }; }
}

function httpPut(url, data, headers) {
  try {
    var u = new java.net.URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("PUT");
    conn.setDoOutput(true);
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    if (headers) {
      for (var key in headers) { conn.setRequestProperty(key, headers[key]); }
    }
    var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
    writer.write(data); writer.flush(); writer.close();
    var code = conn.getResponseCode();
    var body = "";
    if (code >= 200 && code < 300) {
      var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
      var line; while ((line = reader.readLine()) != null) { body += line; }
      reader.close();
    }
    conn.disconnect();
    return { statusCode: code, body: body };
  } catch (e) { return { statusCode: -1, body: e.toString() }; }
}

function httpDelete(url, headers) {
  try {
    var u = new java.net.URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("DELETE");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    if (headers) {
      for (var key in headers) { conn.setRequestProperty(key, headers[key]); }
    }
    var code = conn.getResponseCode();
    conn.disconnect();
    return { statusCode: code };
  } catch (e) { return { statusCode: -1 }; }
}

// Execute step - IMPROVED launch methods
function execStep(step) {
  log("Action: " + step.action);
  
  if (step.action === "launch_app" || step.action === "launch") {
    var app = step.value;
    log("Trying to launch: " + app);
    
    // Method 1: Try launch() with package name
    try { launch(app); log("launch(" + app + ") OK"); return; } 
    catch(e) { log("launch() failed: " + e); }
    
    // Method 2: Try app package name directly  
    try { launchApp(app); log("launchApp(" + app + ") OK"); return; }
    catch(e) { log("launchApp() failed"); }
    
    // Method 3: Use intents
    try {
      var Intent = Java.type("android.content.Intent");
      var intent = new Intent(Intent.ACTION_MAIN);
      intent.addCategory(Intent.CATEGORY_LAUNCHER);
      intent.setPackage(app);
      context.startActivity(intent);
      log("Intent launch OK");
      return;
    } catch(e) { log("Intent failed: " + e); }
    
    log("ALL launch methods failed!");
  }
  else if (step.action === "click") {
    click(step.x, step.y);
    log("Clicked: " + step.x + "," + step.y);
  }
  else if (step.action === "type") {
    setClip(step.text);
    sleep(300);
    paste();
    log("Typed: " + step.text);
  }
  else if (step.action === "press") {
    if (step.key === "enter") press("enter");
    else if (step.key === "home") home();
    else if (step.key === "back") back();
    log("Pressed: " + step.key);
  }
  else if (step.action === "wait") {
    log("Waiting " + step.ms + "ms");
    sleep(step.ms);
  }
  else if (step.action === "toast") {
    log(step.text || "Done");
  }
  else {
    log("Unknown: " + step.action);
  }
}

function pollAndRun() {
  var headers = {
    "Authorization": "token " + GITHUB_TOKEN,
    "User-Agent": "DWAI-Agent"
  };

  try {
    var res = httpGet(TASKS_URL, headers);
    if (res.statusCode !== 200) { log("Get tasks failed: " + res.statusCode); return; }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) return;
    
    log("Found " + files.length + " files");
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || file.name === ".gitkeep") continue;
      
      log("Checking: " + file.name);
      
      // Get fresh SHA before anything
      var fresh = httpGet(file.url, headers);
      var currentSha = file.sha;
      if (fresh.statusCode === 200) {
        currentSha = JSON.parse(fresh.body).sha;
      }
      
      // Get task content
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) continue;
      
      var task = JSON.parse(contentRes.body);
      if (task.status !== "pending") {
        log("Status: " + task.status + " - skipping");
        continue;
      }
      
      log("EXECUTING: " + task.task_id);
      
      // Mark as executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      
      httpPut(file.url, JSON.stringify({
        message: "Executing " + task.task_id,
        content: toBase64(JSON.stringify(task)),
        sha: currentSha
      }), headers);
      
      // Execute each step
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(500);
      }
      
      // Get fresh SHA for completion
      var finalCheck = httpGet(file.url, headers);
      var finalSha = currentSha;
      if (finalCheck.statusCode === 200) {
        finalSha = JSON.parse(finalCheck.body).sha;
      }
      
      // Mark completed and delete the task file
      task.status = "completed";
      task.completed_at = new Date().toISOString();
      
      // Write to logs first
      var logEntry = {
        task_id: task.task_id,
        completed_at: task.completed_at,
        steps_executed: task.steps.length
      };
      
      // Delete the task file
      var delRes = httpDelete(file.url, headers);
      log("Task deleted: " + delRes.statusCode);
      
      log("DONE: " + task.task_id);
      break;
    }
  } catch (e) { log("Error: " + e); }
}

toast("DWAI Agent v4 started");
log("DWAI Agent running...");

setInterval(function() {
  pollAndRun();
}, POLL_INTERVAL);