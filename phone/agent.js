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

function sleep(ms) {
  java.lang.Thread.sleep(ms);
}

function toBase64(str) {
  var StringClass = Java.type("java.lang.String");
  var Base64 = Java.type("android.util.Base64");
  var bytes = new StringClass(str).getBytes("UTF-8");
  return Base64.encodeToString(bytes, Base64.NO_WRAP);
}

// Auto.js HTTP using URLConnection
function httpGet(url, headers) {
  try {
    var URL = Java.type("java.net.URL");
    var BufferedReader = Java.type("java.io.BufferedReader");
    var InputStreamReader = Java.type("java.io.InputStreamReader");
    var HttpURLConnection = Java.type("java.net.HttpURLConnection");
    
    var u = new URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("GET");
    
    if (headers) {
      for (var key in headers) {
        conn.setRequestProperty(key, headers[key]);
      }
    }
    
    conn.setConnectTimeout(10000);
    conn.setReadTimeout(10000);
    
    var responseCode = conn.getResponseCode();
    var reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
    var line = "";
    var responseBody = "";
    while ((line = reader.readLine()) != null) {
      responseBody = responseBody + line;
    }
    reader.close();
    conn.disconnect();
    
    return { statusCode: responseCode, body: responseBody };
  } catch (e) {
    return { statusCode: -1, body: e.toString() };
  }
}

function httpPut(url, data, headers) {
  try {
    var URL = Java.type("java.net.URL");
    var OutputStreamWriter = Java.type("java.io.OutputStreamWriter");
    var HttpURLConnection = Java.type("java.net.HttpURLConnection");
    
    var u = new URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("PUT");
    conn.setDoOutput(true);
    conn.setDoInput(true);
    
    if (headers) {
      for (var key in headers) {
        conn.setRequestProperty(key, headers[key]);
      }
    }
    
    conn.setConnectTimeout(10000);
    conn.setReadTimeout(10000);
    
    var writer = new OutputStreamWriter(conn.getOutputStream());
    writer.write(data);
    writer.flush();
    writer.close();
    
    var responseCode = conn.getResponseCode();
    var responseBody = "";
    
    if (responseCode >= 200 && responseCode < 300) {
      var BufferedReader = Java.type("java.io.BufferedReader");
      var InputStreamReader = Java.type("java.io.InputStreamReader");
      var reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
      var line = "";
      while ((line = reader.readLine()) != null) {
        responseBody = responseBody + line;
      }
      reader.close();
    }
    
    conn.disconnect();
    
    return { statusCode: responseCode, body: responseBody };
  } catch (e) {
    return { statusCode: -1, body: e.toString() };
  }
}

function execStep(step) {
  console.log("Executing: " + JSON.stringify(step));
  if (step.action === "launch_app") {
    launchApp(step.value);
    toast("Launched: " + step.value);
  } else if (step.action === "click") {
    click(step.x, step.y);
    toast("Click: " + step.x + "," + step.y);
  } else if (step.action === "type") {
    setClip(step.text);
    paste();
    toast("Typed: " + step.text);
  } else if (step.action === "press") {
    if (step.key === "enter") {
      press("enter");
    } else if (step.key === "home") {
      home();
    } else if (step.key === "back") {
      back();
    } else {
      toast("Unknown key: " + step.key);
    }
  } else if (step.action === "wait") {
    sleep(step.ms);
  } else {
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
      console.error("List tasks failed: " + res.statusCode + " - " + res.body);
      return;
    }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) {
      console.log("Not an array, skipping");
      return;
    }
    
    console.log("Found files: " + files.length);
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || !file.name || file.name === ".gitkeep") {
        continue;
      }
      
      console.log("Checking: " + file.name);
      
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) {
        console.log("Failed to get content: " + contentRes.statusCode);
        continue;
      }
      
      var task;
      try {
        task = JSON.parse(contentRes.body);
      } catch (e) {
        console.log("JSON parse error: " + e);
        continue;
      }
      
      if (task.status !== "pending") {
        console.log("Task status: " + task.status);
        continue;
      }
      
      console.log("Found task: " + task.task_id);
      
      // Mark as executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      
      var updateData = JSON.stringify({
        message: "Executing " + task.task_id,
        content: toBase64(JSON.stringify(task, null, 2)),
        sha: file.sha
      });
      
      var updateRes = httpPut(file.url, updateData, headers);
      console.log("Update status: " + updateRes.statusCode);
      
      if (updateRes.statusCode !== 200 && updateRes.statusCode !== 201) {
        console.error("Failed to mark executing: " + updateRes.statusCode);
        continue;
      }
      
      // Execute steps
      toast("Running: " + task.task_id);
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(500);
      }
      
      // Mark completed
      task.status = "completed";
      task.completed_at = new Date().toISOString();
      
      var completeData = JSON.stringify({
        message: "Completed " + task.task_id,
        content: toBase64(JSON.stringify(task, null, 2)),
        sha: file.sha
      });
      
      var finalRes = httpPut(file.url, completeData, headers);
      console.log("Task completed: " + finalRes.statusCode);
      toast("Done: " + task.task_id);
      
      break;
    }
    
  } catch (e) {
    console.error("Poll error: " + e);
    toast("Error: " + e);
  }
}

toast("DWAI Agent started");
console.log("DWAI Agent running...");

setInterval(function() {
  pollAndRun();
}, POLL_INTERVAL);