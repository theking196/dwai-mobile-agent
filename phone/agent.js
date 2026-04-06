// DWAI Mobile Agent — Auto.js (Android)
// Polls GitHub for mobile automation tasks and executes them

// CONFIGURATION
const GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
const REPO_OWNER = "theking196";
const REPO_NAME = "dwai-mobile-agent";
const REPO_PATH = "data/tasks";
const POLL_INTERVAL = 5000; // ms

const TASKS_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${REPO_PATH}`;

// Sleep helper (ms)
function sleep(ms) {
  java.lang.Thread.sleep(ms);
}

// Base64 encode (Android)
function toBase64(str) {
  var String = Java.type("java.lang.String");
  var Base64 = Java.type("android.util.Base64");
  var bytes = String(str).getBytes("UTF-8");
  return Base64.encodeToString(bytes, Base64.NO_WRAP);
}

// HTTP helpers (Auto.js) - fixed async
function httpGet(url, headers) {
  return new Promise(function(resolve, reject) {
    try {
      var req = http.get(url, {
        headers: headers
      }, function(res) {
        var data = "";
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          resolve({ statusCode: res.statusCode, body: data });
        });
      });
      req.on('error', function(e) { reject(e); });
    } catch(e) {
      reject(e);
    }
  });
}

function httpPut(url, body, headers) {
  return new Promise(function(resolve, reject) {
    try {
      var req = http.put(url, {
        headers: headers
      }, function(res) {
        var data = "";
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          resolve({ statusCode: res.statusCode, body: data });
        });
      });
      req.on('error', function(e) { reject(e); });
      req.write(body);
      req.end();
    } catch(e) {
      reject(e);
    }
  });
}

// Execute a single step
function execStep(step) {
  console.log("Executing:", step);
  switch (step.action) {
    case "launch_app":
      launchApp(step.value);
      toast("Launched: " + step.value);
      break;
    case "click":
      click(step.x, step.y);
      toast("Click " + step.x + "," + step.y);
      break;
    case "type":
      setClip(step.text);
      paste();
      toast("Typed: " + step.text);
      break;
    case "press":
      if (step.key == "enter") press("enter");
      else if (step.key == "home") home();
      else if (step.key == "back") back();
      else toast("Unknown key: " + step.key);
      break;
    case "wait":
      sleep(step.ms);
      break;
    default:
      toast("Unknown action: " + step.action);
  }
}

// Fetch task list, execute one pending, update status - FIXED ASYNC
async function pollAndRun() {
  try {
    var headers = {
      "Authorization": "token " + GITHUB_TOKEN,
      "User-Agent": "DWAI-Agent"
    };
    
    console.log("Polling tasks from:", TASKS_URL);
    
    var res = await httpGet(TASKS_URL, headers);
    console.log("Response status:", res.statusCode);
    
    if (res.statusCode != 200) {
      console.error("List tasks failed:", res.statusCode, res.body);
      return;
    }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) {
      console.log("Not an array, skipping");
      return;
    }
    
    console.log("Found files:", files.length);

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || !file.name || file.name == '.gitkeep') continue;
      
      console.log("Checking file:", file.name);
      
      // Download content (decoded)
      var contentRes = await httpGet(file.download_url, {});
      if (contentRes.statusCode != 200) {
        console.log("Failed to get content:", contentRes.statusCode);
        continue;
      }
      
      var task;
      try { task = JSON.parse(contentRes.body); } catch (e) { 
        console.log("JSON parse error:", e);
        continue; 
      }
      
      if (task.status !== "pending") {
        console.log("Task not pending:", task.status);
        continue;
      }

      console.log("Found pending task:", task.task_id);

      // Mark as executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      var updateBody = {
        message: "Executing " + task.task_id,
        content: toBase64(JSON.stringify(task, null, 2)),
        sha: file.sha
      };
      
      var updateRes = await httpPut(file.url, JSON.stringify(updateBody), headers);
      if (updateRes.statusCode != 200 && updateRes.statusCode != 201) {
        console.error("Failed to mark executing:", updateRes.statusCode);
        continue;
      }

      // Execute steps
      toast("🚀 Task: " + task.task_id);
      for (var j = 0; j < task.steps.length; j++) {
        task.current_step = j;
        execStep(task.steps[j]);
        sleep(500);
      }

      // Mark completed
      task.status = "completed";
      task.completed_at = new Date().toISOString();
      delete task.current_step;
      
      // Get fresh SHA
      var refetch = await httpGet(file.url, headers);
      var newSha = file.sha;
      if (refetch.statusCode == 200) {
        var meta = JSON.parse(refetch.body);
        newSha = meta.sha;
      }
      
      var completeBody = {
        message: "Completed " + task.task_id,
        content: toBase64(JSON.stringify(task, null, 2)),
        sha: newSha
      };

      var finalRes = await httpPut(file.url, JSON.stringify(completeBody), headers);
      console.log("Task completed, update status:", finalRes.statusCode);
      toast("✅ Done: " + task.task_id);
      break;
    }
  } catch (e) {
    console.error("Poll error:", e);
    toast("❌ " + e);
  }
}

// Main loop - FIXED
toast("🤖 DWAI Mobile Agent started");
console.log("DWAI Agent running...");

while (true) {
  pollAndRun().catch(function(e) {
    console.error("Loop error:", e);
  });
  sleep(POLL_INTERVAL);
}