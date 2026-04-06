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

// Enable Java access
if (typeof Java !== "undefined") {
  Java.asJSModule;
}

// Helper function to get current thread
function runInThread(func) {
  return function() {
    var Nashorn = Java.type("javax.script.ScriptEngineManager").getEngineByName("Nashorn");
    var scriptEngine = context.getGlobal().get("engine");
  };
}

function sleep(ms) {
  if (typeof $ !== "undefined") {
    $.sleep(ms);
  } else if (typeof java !== "undefined") {
    java.lang.Thread.sleep(ms);
  } else {
    var start = java.lang.System.currentTimeMillis();
    while (java.lang.System.currentTimeMillis() - start < ms) {}
  }
}

function toBase64(str) {
  try {
    var Base64 = android.util.Base64;
    var bytes = new java.lang.String(str).getBytes("UTF-8");
    return Base64.encodeToString(bytes, Base64.NO_WRAP);
  } catch (e) {
    // Fallback
    var base64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    var i;
    for (i = 0; i < str.length % 3; i++) {
      result += "=";
    }
    return result;
  }
}

// Use Auto.js built-in HTTP with OkHttp
function httpGet(url, headers) {
  try {
    var request = new okio.OkHttpClient();
    var builder = new okhttp3.Request.Builder().url(url);
    
    if (headers) {
      for (var key in headers) {
        builder.addHeader(key, headers[key]);
      }
    }
    
    var response = request.newCall(builder.build()).execute();
    var body = response.body();
    var bodyStr = body ? body.string() : "";
    
    return {
      statusCode: response.code(),
      body: bodyStr
    };
  } catch (e) {
    // Try using net/http
    try {
      var URL = java.net.URL;
      var u = new URL(url);
      var conn = u.openConnection();
      conn.setRequestMethod("GET");
      conn.setConnectTimeout(10000);
      conn.setReadTimeout(10000);
      
      if (headers) {
        for (var k in headers) {
          conn.setRequestProperty(k, headers[k]);
        }
      }
      
      var code = conn.getResponseCode();
      var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
      var line = "";
      var responseBody = "";
      while ((line = reader.readLine()) != null) {
        responseBody += line;
      }
      reader.close();
      conn.disconnect();
      
      return { statusCode: code, body: responseBody };
    } catch (err) {
      return { statusCode: -1, body: err.toString() };
    }
  }
}

function httpPut(url, data, headers) {
  try {
    var URL = java.net.URL;
    var u = new URL(url);
    var conn = u.openConnection();
    conn.setRequestMethod("PUT");
    conn.setDoOutput(true);
    conn.setDoInput(true);
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
    var responseBody = "";
    
    if (code >= 200 && code < 300) {
      var reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
      var line = "";
      while ((line = reader.readLine()) != null) {
        responseBody += line;
      }
      reader.close();
    }
    
    conn.disconnect();
    return { statusCode: code, body: responseBody };
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
    if (step.key === "enter") press("enter");
    else if (step.key === "home") home();
    else if (step.key === "back") back();
    else toast("Unknown key: " + step.key);
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
    console.log("Response: " + res.statusCode);
    
    if (res.statusCode !== 200) {
      console.error("List tasks failed: " + res.statusCode + " - " + res.body);
      return;
    }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) {
      console.log("Not array, skipping");
      return;
    }
    
    console.log("Files: " + files.length);
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || !file.name || file.name === ".gitkeep") continue;
      
      console.log("Checking: " + file.name);
      
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) continue;
      
      var task = JSON.parse(contentRes.body);
      if (task.status !== "pending") {
        console.log("Status: " + task.status);
        continue;
      }
      
      console.log("Found task: " + task.task_id);
      
      // Mark executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      
      var updateData = JSON.stringify({
        message: "Executing " + task.task_id,
        content: toBase64(JSON.stringify(task)),
        sha: file.sha
      });
      
      var updateRes = httpPut(file.url, updateData, headers);
      if (updateRes.statusCode !== 200 && updateRes.statusCode !== 201) {
        console.error("Update failed: " + updateRes.statusCode);
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
        content: toBase64(JSON.stringify(task)),
        sha: file.sha
      });
      
      var finalRes = httpPut(file.url, completeData, headers);
      console.log("Completed: " + finalRes.statusCode);
      toast("Done: " + task.task_id);
      
      break;
    }
  } catch (e) {
    console.error("Error: " + e);
    toast("Error: " + e);
  }
}

toast("DWAI Agent started");
console.log("DWAI Agent running...");

setInterval(function() {
  pollAndRun();
}, POLL_INTERVAL);