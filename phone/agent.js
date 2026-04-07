// DWAI Mobile Agent — Auto.js v7.1 (With feedback loop)

var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + TASKS_PATH;
var LOGS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + LOGS_PATH;

var java = this.java || null;

toast("DWAI v7.1 starting...");
console.log("=== DWAI v7.1 ===");

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
  } catch(e) { return { statusCode: -1 }; }
}

// Smart click with fallback
function smartClick(step) {
  // 1. Try contains (text search)
  if (step.contains) {
    try {
      log("Click: " + step.contains);
      click(step.contains);
      return true;
    } catch(e) {}
  }
  
  // 2. Try desc (content description)
  if (step.desc) {
    try {
      log("Click desc: " + step.desc);
      click(step.desc);
      return true;
    } catch(e) {}
  }
  
  // 3. Try x,y coordinates (fallback)
  if (step.x !== undefined && step.y !== undefined) {
    try {
      log("Click: " + step.x + "," + step.y);
      click(step.x, step.y);
      return true;
    } catch(e) {}
  }
  
  return false;
}

// Write to logs (feedback loop)
function writeLog(taskId, status, result, error) {
  var headers = { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "DWAI-Agent" };
  var logEntry = {
    task_id: taskId,
    status: status,
    result: result,
    error: error,
    timestamp: new Date().toISOString()
  };
  
  var logFile = taskId + "_log.json";
  var url = LOGS_URL + "/" + logFile;
  
  try {
    httpPut(url, JSON.stringify({
      message: "Log " + taskId,
      content: toBase64(JSON.stringify(logEntry)),
      branch: "main"
    }), headers);
  } catch(e) {
    console.log("Log write failed: " + e);
  }
}

function execStep(step, stepIndex) {
  log("Step " + (stepIndex + 1) + ": " + step.action);
  var success = false;
  var errorMsg = "";
  
  try {
    if (step.action === "launch_app" || step.action === "launch") {
      launchApp(step.value);
      success = true;
      log("✓ Launched: " + step.value);
    }
    else if (step.action === "click") {
      success = smartClick(step);
      if (success) log("✓ Clicked");
      else errorMsg = "click failed";
    }
    else if (step.action === "type") {
      setClip(step.text);
      sleep(300);
      paste();
      success = true;
      log("✓ Typed: " + step.text.substring(0, 20));
    }
    else if (step.action === "press") {
      if (step.key === "enter") press("enter");
      else if (step.key === "home") home();
      else if (step.key === "back") back();
      success = true;
      log("✓ Pressed: " + step.key);
    }
    else if (step.action === "wait") {
      log("Wait " + step.ms + "ms...");
      sleep(step.ms);
      success = true;
    }
    else if (step.action === "toast") {
      log(step.text || "Done");
      success = true;
    }
    else if (step.action === "swipe") {
      log("Swipe not implemented");
    }
  } catch(e) {
    errorMsg = e.toString();
    log("✗ Error: " + errorMsg);
  }
  
  return { success: success, error: errorMsg };
}

function pollAndRun() {
  var headers = { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "DWAI-Agent" };

  try {
    var res = httpGet(TASKS_URL, headers);
    if (res.statusCode !== 200) return;
    
    var files = JSON.parse(res.body);
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || file.name === ".gitkeep") continue;
      
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) continue;
      
      var task = JSON.parse(contentRes.body);
      if (task.status !== "pending") continue;
      
      log("=== RUNNING: " + task.task_id + " ===");
      log("Intent: " + (task.intent || "unknown"));
      
      var failedStep = -1;
      var errorMsg = "";
      
      // Execute all steps
      for (var j = 0; j < task.steps.length; j++) {
        var result = execStep(task.steps[j], j);
        if (!result.success && failedStep === -1) {
          failedStep = j;
          errorMsg = result.error;
        }
        sleep(800);
      }
      
      // Get fresh SHA
      var fresh = httpGet(file.url, headers);
      var currentSha = file.sha;
      if (fresh.statusCode === 200) currentSha = JSON.parse(fresh.body).sha;
      
      // Mark completed or failed
      if (failedStep === -1) {
        task.status = "completed";
        task.completed_at = new Date().toISOString();
        log("=== COMPLETE ===");
        writeLog(task.task_id, "completed", "All steps executed", null);
      } else {
        task.status = "failed";
        task.failed_at = new Date().toISOString();
        task.error = "Step " + (failedStep + 1) + " failed: " + errorMsg;
        log("=== FAILED at step " + (failedStep + 1) + " ===");
        writeLog(task.task_id, "failed", null, task.error);
      }
      
      // Update task
      httpPut(file.url, JSON.stringify({ 
        message: task.status, 
        content: toBase64(JSON.stringify(task)), 
        sha: currentSha 
      }), headers);
      
      // Delete task file
      var delRes = httpDelete(file.url, currentSha, headers);
      log("Cleaned up: " + delRes.statusCode);
      
      break;
    }
  } catch(e) { log("Error: " + e); }
}

toast("v7.1 running");
setInterval(pollAndRun, POLL_INTERVAL);