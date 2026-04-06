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

function httpGet(url, headers) {
  return new Promise(function(resolve, reject) {
    var request = http.get(url, {
      headers: headers
    }, function(response) {
      var data = "";
      response.on("data", function(chunk) {
        data = data + chunk;
      });
      response.on("end", function() {
        resolve({
          statusCode: response.statusCode,
          body: data
        });
      });
    });
    request.on("error", function(error) {
      reject(error);
    });
  });
}

function httpPut(url, data, headers) {
  return new Promise(function(resolve, reject) {
    var request = http.put(url, {
      headers: headers
    }, function(response) {
      var data = "";
      response.on("data", function(chunk) {
        data = data + chunk;
      });
      response.on("end", function() {
        resolve({
          statusCode: response.statusCode,
          body: data
        });
      });
    });
    request.on("error", function(error) {
      reject(error);
    });
    request.write(data);
    request.end();
  });
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

  httpGet(TASKS_URL, headers).then(function(res) {
    if (res.statusCode !== 200) {
      console.error("List tasks failed: " + res.statusCode);
      return;
    }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) {
      return;
    }
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file.sha || !file.name || file.name === ".gitkeep") {
        continue;
      }
      
      httpGet(file.download_url, {}).then(function(contentRes) {
        if (contentRes.statusCode !== 200) {
          return;
        }
        
        var task = JSON.parse(contentRes.body);
        if (task.status !== "pending") {
          return;
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
        
        httpPut(file.url, updateData, headers).then(function(updateRes) {
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
          
          httpPut(file.url, completeData, headers).then(function(finalRes) {
            console.log("Task completed: " + finalRes.statusCode);
            toast("Done: " + task.task_id);
          }).catch(function(e) {
            console.error("Complete error: " + e);
          });
          
        }).catch(function(e) {
          console.error("Update error: " + e);
        });
        
      }).catch(function(e) {
        console.error("Content error: " + e);
      });
      
      break; // only one task per poll
    }
    
  }).catch(function(e) {
    console.error("Poll error: " + e);
  });
}

toast("DWAI Agent started");
console.log("DWAI Agent running...");

setInterval(function() {
  pollAndRun();
}, POLL_INTERVAL);