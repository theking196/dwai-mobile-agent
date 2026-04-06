// DWAI Mobile Agent — Auto.js v5 DEBUG
// Added detailed logging to find the issue

var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + TASKS_PATH;

var java = this.java || null;

toast("DWAI v5 DEBUG starting...");
console.log("=== STARTING v5 DEBUG ===");
console.log("java available: " + (java != null));

function sleep(ms) { 
  try { 
    if (java) java.lang.Thread.sleep(ms); 
    else $.sleep(ms);
  } catch(e) { console.log("sleep error: " + e); } 
}

function log(msg) { 
  console.log(msg); 
  toast(msg); 
}

function toBase64(str) {
  try {
    var Base64 = android.util.Base64;
    return Base64.encodeToString(new java.lang.String(str).getBytes("UTF-8"), Base64.NO_WRAP);
  } catch(e) { 
    console.log("base64 error: " + e);
    return ""; 
  }
}

function httpGet(url, headers) {
  log("HTTP GET: " + url);
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("GET");
    conn.setConnectTimeout(10000);
    conn.setReadTimeout(10000);
    if (headers) { 
      for (var k in headers) { 
        conn.setRequestProperty(k, headers[k]); 
      } 
    }
    var code = conn.getResponseCode();
    log("HTTP GET response: " + code);
    
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
    var line, body = "";
    while ((line = reader.readLine()) != null) { body += line; }
    reader.close(); 
    conn.disconnect();
    return { statusCode: code, body: body };
  } catch(e) { 
    log("HTTP GET error: " + e);
    return { statusCode: -1, body: e.toString() }; 
  }
}

function httpPut(url, data, headers) {
  log("HTTP PUT: " + url);
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("PUT");
    conn.setDoOutput(true);
    conn.setConnectTimeout(10000);
    conn.setReadTimeout(10000);
    if (headers) { 
      for (var k in headers) { conn.setRequestProperty(k, headers[k]); } 
    }
    var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
    writer.write(data); 
    writer.flush(); 
    writer.close();
    var code = conn.getResponseCode();
    conn.disconnect();
    log("HTTP PUT response: " + code);
    return { statusCode: code };
  } catch(e) { 
    log("HTTP PUT error: " + e);
    return { statusCode: -1 }; 
  }
}

function httpDelete(url, headers) {
  log("HTTP DELETE: " + url);
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("DELETE");
    conn.setConnectTimeout(10000);
    conn.setReadTimeout(10000);
    if (headers) { for (var k in headers) conn.setRequestProperty(k, headers[k]); }
    var code = conn.getResponseCode();
    log("HTTP DELETE response: " + code);
    conn.disconnect();
    return { statusCode: code };
  } catch(e) { 
    log("HTTP DELETE error: " + e);
    return { statusCode: -1 }; 
  }
}

function execStep(step) {
  log("STEP: " + step.action + " = " + JSON.stringify(step));
  
  try {
    if (step.action === "launch_app" || step.action === "launch") {
      log("Trying launchApp(" + step.value + ")");
      launchApp(step.value);
      log("launchApp SUCCESS!");
    }
    else if (step.action === "click") {
      click(step.x, step.y);
      log("Clicked");
    }
    else if (step.action === "type") {
      setClip(step.text);
      sleep(300);
      paste();
      log("Typed");
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
  } catch(e) {
    log("STEP ERROR: " + e);
  }
}

function pollAndRun() {
  log("=== POLLING ===");
  var headers = { 
    "Authorization": "token " + GITHUB_TOKEN, 
    "User-Agent": "DWAI-Agent" 
  };

  try {
    // Step 1: Get file list
    log("1. Getting task list...");
    var res = httpGet(TASKS_URL, headers);
    log("Response: " + res.statusCode);
    
    if (res.statusCode !== 200) { 
      log("FAIL: Get tasks failed: " + res.statusCode + " - " + res.body);
      return; 
    }
    
    var files = JSON.parse(res.body);
    log("Files found: " + files.length);
    
    if (!Array.isArray(files)) {
      log("Not an array!");
      return;
    }
    
    // Step 2: Find pending task
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      log("Checking: " + file.name);
      
      if (!file.sha || file.name === ".gitkeep") {
        log("Skipping: " + file.name);
        continue;
      }
      
      log("Getting content for: " + file.name);
      var contentRes = httpGet(file.download_url, {});
      
      if (contentRes.statusCode !== 200) {
        log("Content fail: " + contentRes.statusCode);
        continue;
      }
      
      var task = JSON.parse(contentRes.body);
      log("Task status: " + task.status);
      
      if (task.status !== "pending") {
        log("Skipping - not pending");
        continue;
      }
      
      log("*** FOUND PENDING: " + task.task_id + " ***");
      
      // Execute steps
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(500);
      }
      
      // Mark executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      httpPut(file.url, JSON.stringify({ 
        message: "Done", 
        content: toBase64(JSON.stringify(task)), 
        sha: file.sha 
      }), headers);
      
      // Delete
      var delRes = httpDelete(file.url, headers);
      log("Delete result: " + delRes.statusCode);
      log("=== COMPLETE ===");
      
      break;
    }
  } catch(e) { 
    log("POLL ERROR: " + e); 
  }
}

toast("DWAI v5 DEBUG running!");
setInterval(pollAndRun, POLL_INTERVAL);