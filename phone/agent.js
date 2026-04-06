// DWAI Mobile Agent — Auto.js v6 (FIX delete issue)

var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + TASKS_PATH;

var java = this.java || null;

toast("DWAI v6 starting...");
console.log("v6 starting...");

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
  // GitHub DELETE needs the SHA
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod("DELETE");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(5000);
    conn.setRequestProperty("Authorization", headers["Authorization"]);
    conn.setRequestProperty("User-Agent", headers["User-Agent"]);
    conn.setRequestProperty("Content-Type", "application/json");
    
    var body = JSON.stringify({ sha: sha });
    conn.setDoOutput(true);
    var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
    writer.write(body); writer.flush(); writer.close();
    
    var code = conn.getResponseCode();
    conn.disconnect();
    return { statusCode: code };
  } catch(e) { return { statusCode: -1, error: e.toString() }; }
}

function execStep(step) {
  log(step.action + ": " + step.value);
  try {
    if (step.action === "launch_app" || step.action === "launch") {
      launchApp(step.value);
      log("launchApp OK");
    }
    else if (step.action === "click") { click(step.x, step.y); }
    else if (step.action === "type") { setClip(step.text); sleep(300); paste(); }
    else if (step.action === "press") { if (step.key === "enter") press("enter"); else if (step.key === "home") home(); else if (step.key === "back") back(); }
    else if (step.action === "wait") { sleep(step.ms); }
    else if (step.action === "toast") { log(step.text || "Done"); }
  } catch(e) { log("ERROR: " + e); }
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
      
      // Execute steps FIRST
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(500);
      }
      
      // Get FRESH SHA before any update
      var fresh = httpGet(file.url, headers);
      var currentSha = file.sha;
      if (fresh.statusCode === 200) {
        currentSha = JSON.parse(fresh.body).sha;
      }
      log("Fresh SHA: " + currentSha);
      
      // Mark executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      httpPut(file.url, JSON.stringify({ message: "Done", content: toBase64(JSON.stringify(task)), sha: currentSha }), headers);
      
      // Get FRESH SHA again after PUT
      var fresh2 = httpGet(file.url, headers);
      var finalSha = currentSha;
      if (fresh2.statusCode === 200) {
        finalSha = JSON.parse(fresh2.body).sha;
      }
      log("Final SHA: " + finalSha);
      
      // Delete with SHA
      var delRes = httpDelete(file.url, finalSha, headers);
      log("Delete: " + delRes.statusCode + " " + (delRes.error || ""));
      
      // If delete failed, try without body
      if (delRes.statusCode !== 200 && delRes.statusCode !== 204) {
        log("Delete retry...");
        try {
          var conn = new java.net.URL(file.url).openConnection();
          conn.setRequestMethod("DELETE");
          conn.setRequestProperty("Authorization", "token " + GITHUB_TOKEN);
          conn.setRequestProperty("User-Agent", "DWAI-Agent");
          var code = conn.getResponseCode();
          log("Delete2: " + code);
        } catch(e) { log("Delete2 error: " + e); }
      }
      
      log("DONE: " + task.task_id);
      break;
    }
  } catch(e) { log("Error: " + e); }
}

toast("v6 running");
setInterval(pollAndRun, POLL_INTERVAL);