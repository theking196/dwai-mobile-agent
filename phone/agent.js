// DWAI Mobile Agent — Auto.js v5
// Simplified: Only update status AFTER everything completes

var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + TASKS_PATH;

var java = this.java || null;

function sleep(ms) { try { java.lang.Thread.sleep(ms); } catch(e) {} }

function log(msg) { console.log(msg); toast(msg); }

function toBase64(str) {
  try {
    var Base64 = android.util.Base64;
    return Base64.encodeToString(new java.lang.String(str).getBytes("UTF-8"), Base64.NO_WRAP);
  } catch(e) { return ""; }
}

function httpGet(url, headers) {
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("GET");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    if (headers) { for (var k in headers) conn.setRequestProperty(k, headers[k]); }
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
    var body = ""; while (reader.readLine()) { body += reader.readLine(); }
    reader.close(); conn.disconnect();
    return { statusCode: conn.getResponseCode(), body: body };
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

function httpDelete(url, headers) {
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("DELETE");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    if (headers) { for (var k in headers) conn.setRequestProperty(k, headers[k]); }
    var code = conn.getResponseCode();
    conn.disconnect();
    return { statusCode: code };
  } catch(e) { return { statusCode: -1 }; }
}

function execStep(step) {
  log("Doing: " + step.action);
  
  try {
    if (step.action === "launch_app" || step.action === "launch") {
      // Try package name directly
      launchApp(step.value);
      log("launchApp(" + step.value + ") SUCCESS");
    }
    else if (step.action === "click") {
      click(step.x, step.y);
      log("Clicked " + step.x + "," + step.y);
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
  } catch(e) {
    log("ERROR in " + step.action + ": " + e);
  }
}

function pollAndRun() {
  var headers = { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "DWAI-Agent" };

  try {
    var res = httpGet(TASKS_URL, headers);
    if (res.statusCode !== 200) { log("Get failed: " + res.statusCode); return; }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) return;
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || file.name === ".gitkeep") continue;
      
      log("Found: " + file.name);
      
      // Get task content FIRST
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) continue;
      
      var task = JSON.parse(contentRes.body);
      if (task.status !== "pending") { log("Status: " + task.status + " - skip"); continue; }
      
      log("RUNNING: " + task.task_id);
      
      // Execute steps FIRST (don't update anything yet!)
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(500);
      }
      
      // ONLY NOW - mark as executing, then delete
      task.status = "executing";
      task.started_at = new Date().toISOString();
      httpPut(file.url, JSON.stringify({ message: "Done", content: toBase64(JSON.stringify(task)), sha: file.sha }), headers);
      
      // Delete the file
      var delRes = httpDelete(file.url, headers);
      log("Deleted: " + delRes.statusCode);
      log("COMPLETE: " + task.task_id);
      
      break;
    }
  } catch(e) { log("Error: " + e); }
}

toast("DWAI v5 started");
setInterval(pollAndRun, POLL_INTERVAL);