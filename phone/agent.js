// DWAI Mobile Agent — Auto.js (Android)
// Polls GitHub for mobile automation tasks and executes them

// CONFIGURATION
// TODO: Replace YOUR_GITHUB_TOKEN with your actual GitHub token
const GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
const REPO_OWNER = "theking196";
const REPO_NAME = "dwai-mobile-agent";
const REPO_PATH = "data/tasks";
const POLL_INTERVAL = 5000;

const TASKS_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${REPO_PATH}`;

function sleep(ms) { java.lang.Thread.sleep(ms); }

function toBase64(str) {
  var String = Java.type("java.lang.String");
  var Base64 = Java.type("android.util.Base64");
  var bytes = String(str).getBytes("UTF-8");
  return Base64.encodeToString(bytes, Base64.NO_WRAP);
}

function httpGet(url, headers) {
  return new Promise(function(resolve, reject) {
    try {
      var req = http.get(url, { headers: headers }, function(res) {
        var data = "";
        res.on('data', function(c) { data += c; });
        res.on('end', function() { resolve({ statusCode: res.statusCode, body: data }); });
      });
      req.on('error', function(e) { reject(e); });
    } catch(e) { reject(e); }
  });
}

function httpPut(url, body, headers) {
  return new Promise(function(resolve, reject) {
    try {
      var req = http.put(url, { headers: headers }, function(res) {
        var data = "";
        res.on('data', function(c) { data += c; });
        res.on('end', function() { resolve({ statusCode: res.statusCode, body: data }); });
      });
      req.on('error', function(e) { reject(e); });
      req.write(body);
      req.end();
    } catch(e) { reject(e); }
  });
}

function execStep(step) {
  console.log("Executing:", step);
  switch (step.action) {
    case "launch_app": launchApp(step.value); toast("Launched: " + step.value); break;
    case "click": click(step.x, step.y); toast("Click " + step.x + "," + step.y); break;
    case "type": setClip(step.text); paste(); toast("Typed: " + step.text); break;
    case "press": 
      if (step.key == "enter") press("enter");
      else if (step.key == "home") home();
      else if (step.key == "back") back();
      else toast("Unknown key: " + step.key);
      break;
    case "wait": sleep(step.ms); break;
    default: toast("Unknown: " + step.action);
  }
}

// FIXED: async function with await
async function pollAndRun() {
  try {
    var headers = { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "DWAI-Agent" };
    
    var res = await httpGet(TASKS_URL, headers);
    if (res.statusCode != 200) { console.error("List tasks failed:", res.statusCode); return; }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) return;
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || !file.name || file.name == '.gitkeep') continue;
      
      var contentRes = await httpGet(file.download_url, {});
      if (contentRes.statusCode != 200) continue;
      
      var task = JSON.parse(contentRes.body);
      if (task.status !== "pending") continue;
      
      console.log("Found task:", task.task_id);
      
      // Mark executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      await httpPut(file.url, JSON.stringify({
        message: "Executing " + task.task_id,
        content: toBase64(JSON.stringify(task, null, 2)),
        sha: file.sha
      }), headers);
      
      // Execute steps
      toast("🚀 Task: " + task.task_id);
      for (var j = 0; j < task.steps.length; j++) {
        execStep(task.steps[j]);
        sleep(500);
      }
      
      // Mark completed - FIXED with await and SHA refetch
      task.status = "completed";
      task.completed_at = new Date().toISOString();
      delete task.current_step;
      
      // Get fresh SHA before updating
      var refetch = await httpGet(file.url, headers);
      var newSha = file.sha;
      if (refetch.statusCode == 200) {
        newSha = JSON.parse(refetch.body).sha;
      }
      
      var completeBody = {
        message: "Completed " + task.task_id,
        content: toBase64(JSON.stringify(task, null, 2)),
        sha: newSha
      };
      
      var finalRes = await httpPut(file.url, JSON.stringify(completeBody), headers);
      console.log("Task completed:", finalRes.statusCode);
      toast("✅ Done: " + task.task_id);
      break;
    }
  } catch (e) {
    console.error("Poll error:", e);
    toast("❌ " + e);
  }
}

toast("🤖 DWAI Mobile Agent started");
console.log("DWAI Agent running...");

while (true) {
  pollAndRun();
  sleep(POLL_INTERVAL);
}