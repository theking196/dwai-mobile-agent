// DWAI Mobile Agent — Auto.js (Android)
// Polls GitHub for mobile automation tasks and executes them

// CONFIGURATION
// TODO: Replace YOUR_GITHUB_TOKEN with your actual GitHub token
var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var REPO_PATH = "data/tasks";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + REPO_PATH;

// Ensure java is available
var java = this.java || null;

function sleep(ms) {
  if (java) {
    java.lang.Thread.sleep(ms);
  } else {
    try {
      $.sleep(ms);
    } catch(e) {}
  }
}

function toBase64(str) {
  try {
    var Base64 = android.util.Base64;
    var bytes = new java.lang.String(str).getBytes("UTF-8");
    return Base64.encodeToString(bytes, Base64.NO_WRAP);
  } catch (e) {
    return "";
  }
}

// HTTP functions using java.net
function httpGet(url, headers) {
  try {
    var u = new java.net.URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("GET");
    conn.setConnectTimeout(10000);
    conn.setReadTimeout(10000);
    
    if (headers) {
      for (var key in headers) {
        conn.setRequestProperty(key, headers[key]);
      }
    }
    
    var code = conn.getResponseCode();
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
    var line = "";
    var body = "";
    while ((line = reader.readLine()) != null) {
      body += line;
    }
    reader.close();
    conn.disconnect();
    
    return { statusCode: code, body: body };
  } catch (e) {
    return { statusCode: -1, body: e.toString() };
  }
}

function httpPut(url, data, headers) {
  try {
    var u = new java.net.URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("PUT");
    conn.setDoOutput(true);
    conn.setConnectTimeout(10000);
    conn.setReadTimeout(10000);
    
    if (headers) {
      for (var key in headers) {
        conn.setRequestProperty(key, headers[key]);
      }
    }
    
    var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
    writer.write(data);
    writer.flush();
    writer.close();
    
    var code = conn.getResponseCode();
    var body = "";
    if (code >= 200 && code < 300) {
      var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
      var line = "";
      while ((line = reader.readLine()) != null) { body += line; }
      reader.close();
    }
    conn.disconnect();
    
    return { statusCode: code, body: body };
  } catch (e) {
    return { statusCode: -1, body: e.toString() };
  }
}

// Execute step with CORRECT Auto.js methods
function execStep(step) {
  console.log("Executing: " + step.action + " = " + JSON.stringify(step));
  
  if (step.action === "launch_app") {
    // Try both methods - by name or package
    var appName = step.value;
    
    // Method 1: Launch by app name (like "Chrome")
    try {
      launch(appName);
      toast("Launched: " + appName);
    } catch(e) {
      // Method 2: Try with package
      try {
        launchApp(appName);
        toast("Launched: " + appName);
      } catch(e2) {
        toast("Failed to launch: " + appName);
        console.log("Launch error: " + e2);
      }
    }
  }
  else if (step.action === "click") {
    click(step.x, step.y);
    toast("Clicked: " + step.x + "," + step.y);
  }
  else if (step.action === "type") {
    setClip(step.text);
    sleep(500);
    paste();
    toast("Typed: " + step.text);
  }
  else if (step.action === "press") {
    if (step.key === "enter") press("enter");
    else if (step.key === "home") home();
    else if (step.key === "back") back();
    else if (step.key === "search") press("search");
    toast("Pressed: " + step.key);
  }
  else if (step.action === "wait") {
    toast("Waiting " + step.ms + "ms...");
    sleep(step.ms);
  }
  else if (step.action === "toast") {
    toast(step.text || "Done");
  }
  else {
    toast("Unknown: " + step.action);
  }
}

function pollAndRun() {
  var headers = {
    "Authorization": "token " + GITHUB_TOKEN,
    "User-Agent": "DWAI-Agent"
  };

  try {
    var res = httpGet(TASKS_URL, headers);
    
    if (res.statusCode !== 200) {
      console.log("Failed: " + res.statusCode);
      return;
    }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) return;
    
    console.log("Files: " + files.length);
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || !file.name || file.name === ".gitkeep") continue;
      
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) continue;
      
      var task = JSON.parse(contentRes.body);
      if (task.status !== "pending") continue;
      
      console.log("Found task: " + task.task_id);
      toast("Running: " + task.task_id);
      
      // Mark as executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      
      var updateData = JSON.stringify({
        message: "Executing " + task.task_id,
        content: toBase64(JSON.stringify(task)),
        sha: file.sha
      });
      
      httpPut(file.url, updateData, headers);
      
      // Execute each step
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(500);
      }
      
      // Mark completed
      task.status = "completed";
      task.completed_at = new Date().toISOString();
      
      var completeData = JSON.stringify({
        message: "Completed " + task.task_id,
        content: toBase64(JSON.stringify(task)),
        sha: file.sha
      });
      
      httpPut(file.url, completeData, headers);
      toast("Done: " + task.task_id);
      console.log("Task completed!");
      
      break;
    }
  } catch (e) {
    console.log("Error: " + e);
  }
}

toast("DWAI Agent started");
console.log("DWAI Agent running...");

setInterval(function() {
  pollAndRun();
}, POLL_INTERVAL);