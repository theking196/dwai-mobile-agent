// DWAI Mobile Agent — Auto.js v7 (Handles new action types: contains, desc)

var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + TASKS_PATH;

var java = this.java || null;

toast("DWAI v7 starting...");

function sleep(ms) { try { if (java) java.lang.Thread.sleep(ms); else $.sleep(ms); } catch(e) {} }
function log(msg) { console.log("LOG: " + msg); toast(msg); }

function toBase64(str) {
  try { return android.util.Base64.encodeToString(new java.lang.String(str).getBytes("UTF-8"), android.util.Base64.NO_WRAP); }
  catch(e) { return ""; }
}

function httpGet(url, headers) {
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("GET");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    if (headers) { for (var k in headers) conn.setRequestProperty(k, headers[k]); }
    var code = conn.getResponseCode();
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
    var body = ""; while (reader.readLine()) { body += reader.readLine(); }
    reader.close(); conn.disconnect();
    return { statusCode: code, body: body };
  } catch(e) { return { statusCode: -1, body: e.toString() }; }
}

function httpPut(url, data, headers) {
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("PUT");
    conn.setDoOutput(true);
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    if (headers) { for (var k in headers) conn.setRequestProperty(k, headers[k]); }
    var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
    writer.write(data); writer.flush(); writer.close();
    var code = conn.getResponseCode();
    conn.disconnect();
    return { statusCode: code };
  } catch(e) { return { statusCode: -1 }; }
}

function httpDelete(url, sha, headers) {
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("DELETE");
    conn.setDoOutput(true);
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    conn.setRequestProperty("Authorization", headers["Authorization"]);
    conn.setRequestProperty("User-Agent", headers["User-Agent"]);
    conn.setRequestProperty("Content-Type", "application/json");
    var body = JSON.stringify({ sha: sha });
    var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
    writer.write(body); writer.flush(); writer.close();
    var code = conn.getResponseCode();
    conn.disconnect();
    return { statusCode: code };
  } catch(e) { return { statusCode: -1, error: e.toString() }; }
}

// NEW: Smart click with selectors
function smartClick(step) {
  // 1. Try contains (text search)
  if (step.contains) {
    try {
      log("Trying click contains: " + step.contains);
      click(step.contains);  // Auto.js click by text
      log("click(contains) SUCCESS");
      return true;
    } catch(e) { log("contains failed: " + e); }
  }
  
  // 2. Try desc (content description)
  if (step.desc) {
    try {
      log("Trying click desc: " + step.desc);
      click(step.desc);  // Auto.js click by desc
      log("click(desc) SUCCESS");
      return true;
    } catch(e) { log("desc failed: " + e); }
  }
  
  // 3. Try x,y coordinates (fallback)
  if (step.x !== undefined && step.y !== undefined) {
    try {
      log("Trying click coords: " + step.x + "," + step.y);
      click(step.x, step.y);
      log("click(x,y) SUCCESS");
      return true;
    } catch(e) { log("coords failed: " + e); }
  }
  
  return false;
}

function execStep(step) {
  log(step.action + ": " + JSON.stringify(step));
  
  try {
    if (step.action === "launch_app" || step.action === "launch") {
      log("Launching: " + step.value);
      launchApp(step.value);
      log("launchApp OK");
    }
    else if (step.action === "click") {
      var success = smartClick(step);
      if (!success) log("click FAILED - no method worked");
    }
    else if (step.action === "type") {
      setClip(step.text);
      sleep(300);
      paste();
      log("type OK");
    }
    else if (step.action === "press") {
      if (step.key === "enter") press("enter");
      else if (step.key === "home") home();
      else if (step.key === "back") back();
      log("press OK");
    }
    else if (step.action === "wait") {
      log("wait " + step.ms + "ms");
      sleep(step.ms);
    }
    else if (step.action === "toast") {
      log(step.text || "Done");
    }
    else if (step.action === "swipe") {
      // Handle swipe if needed
      log("swipe not implemented");
    }
    else {
      log("Unknown action: " + step.action);
    }
  } catch(e) { 
    log("ERROR: " + e); 
    // Continue anyway - don't fail whole task
  }
}

function pollAndRun() {
  var headers = { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "DWAI-Agent" };

  try {
    var res = httpGet(TASKS_URL, headers);
    if (res.statusCode !== 200) { log("Get fail: " + res.statusCode); return; }
    
    var files = JSON.parse(res.body);
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || file.name === ".gitkeep") continue;
      
      log("Task: " + file.name);
      
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) continue;
      
      var task = JSON.parse(contentRes.body);
      if (task.status !== "pending") { log("Skip: " + task.status); continue; }
      
      log("RUNNING: " + task.task_id);
      
      // Execute all steps
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(800); // Wait between steps
      }
      
      // Get fresh SHA and update
      var fresh = httpGet(file.url, headers);
      var currentSha = file.sha;
      if (fresh.statusCode === 200) currentSha = JSON.parse(fresh.body).sha;
      
      task.status = "completed";
      task.completed_at = new Date().toISOString();
      httpPut(file.url, JSON.stringify({ message: "Done", content: toBase64(JSON.stringify(task)), sha: currentSha }), headers);
      
      // Delete
      var delRes = httpDelete(file.url, currentSha, headers);
      log("Deleted: " + delRes.statusCode);
      
      log("COMPLETE: " + task.task_id);
      break;
    }
  } catch(e) { log("Error: " + e); }
}

toast("v7 running");
setInterval(pollAndRun, POLL_INTERVAL);