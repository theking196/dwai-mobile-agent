// DWAI Mobile Agent — Auto.js v8 (Complete Rewrite)
// - App Discovery Layer
// - Smart Executor with verification
// - Retry & Fallback logic
// - State management (prevent double-processing)
// - Proper logging

// CONFIGURATION
var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var POLL_INTERVAL = 5000;

var TASKS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + TASKS_PATH;
var LOGS_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + LOGS_PATH;

var java = this.java || null;

// ==================== APP DISCOVERY LAYER ====================
// Real app map - will be populated at startup
var INSTALLED_APPS = {};
var APP_CACHE_BUILT = false;

// Known package names for common apps (verified safe)
var KNOWN_APPS = {
  "youtube": "com.google.android.youtube",
  "chrome": "com.android.chrome",
  "google chrome": "com.android.chrome",
  "browser": "com.android.chrome",
  "whatsapp": "com.whatsapp",
  "calculator": "com.android.calculator2",
  "camera": "com.android.camera2",
  "photos": "com.google.android.apps.photos",
  "gallery": "com.android.gallery3d",
  "settings": "com.android.settings",
  "phone": "com.android.dialer",
  "messages": "com.android.mms",
  "gmail": "com.google.android.gm",
  "maps": "com.google.android.apps.maps",
  "spotify": "com.spotify.music",
  "facebook": "com.facebook.katana",
  "instagram": "com.instagram.android",
  "twitter": "com.twitter.android",
  "telegram": "org.telegram.messenger",
  "signal": "org.thoughtcrime.securesms",
  "discord": "com.discord",
  "slack": "com.Slack",
  "zoom": "us.zoom.videomeetings",
  "whatsapp business": "com.whatsapp.w4b"
};

function buildInstalledAppsMap() {
  if (APP_CACHE_BUILT) return;
  
  try {
    // Try to get package manager
    var pm = context.getPackageManager();
    var packages = pm.getInstalledApplications(android.content.pm.PackageManager.GET_META_DATA);
    
    for (var i = 0; i < packages.size(); i++) {
      var pkg = packages.get(i);
      var label = pkg.loadLabel(pm).toString().toLowerCase();
      var packageName = pkg.packageName;
      
      INSTALLED_APPS[label] = packageName;
      INSTALLED_APPS[packageName] = packageName;
    }
    
    APP_CACHE_BUILT = true;
    log("App cache built: " + Object.keys(INSTALLED_APPS).length + " apps");
  } catch(e) {
    log("App discovery failed: " + e);
    // Fall back to known apps only
    APP_CACHE_BUILT = true;
  }
}

function resolveApp(appName) {
  appName = appName.toLowerCase().trim();
  
  // 1. Check known apps first
  if (KNOWN_APPS[appName]) {
    return KNOWN_APPS[appName];
  }
  
  // 2. Check installed apps
  for (var key in INSTALLED_APPS) {
    if (key.indexOf(appName) !== -1) {
      return INSTALLED_APPS[key];
    }
  }
  
  // 3. Return null - don't guess!
  return null;
}

function getInstalledAppsList() {
  var apps = [];
  for (var key in KNOWN_APPS) {
    apps.push(key + " -> " + KNOWN_APPS[key]);
  }
  return apps.slice(0, 10).join(", ") + "...";
}

// ==================== UTILITIES ====================

function sleep(ms) { 
  try { if (java) java.lang.Thread.sleep(ms); else $.sleep(ms); } catch(e) {} 
}

function log(msg) { 
  console.log("DWAI: " + msg); 
  toast("DWAI: " + msg); 
}

function toBase64(str) {
  try { 
    return android.util.Base64.encodeToString(new java.lang.String(str).getBytes("UTF-8"), android.util.Base64.NO_WRAP); 
  } catch(e) { return ""; }
}

// ==================== HTTP HELPERS ====================

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
    conn.setRequestProperty("User-Agent", "DWAI-Agent");
    conn.setRequestProperty("Content-Type", "application/json");
    var body = JSON.stringify({ sha: sha });
    var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
    writer.write(body); writer.flush(); writer.close();
    var code = conn.getResponseCode();
    conn.disconnect();
    return { statusCode: code };
  } catch(e) { return { statusCode: -1, error: e.toString() }; }
}

// ==================== VERIFICATION LAYER ====================

function verifyAppLaunched(expectedPackage) {
  try {
    var currentApp = context.getPackageManager().getLaunchIntentForPackage(expectedPackage);
    if (currentApp) {
      return true;
    }
  } catch(e) {}
  return false;
}

function verifyScreenContains(text) {
  try {
    var exists = text(text);
    return exists.exists();
  } catch(e) { return false; }
}

function waitForScreen(text, timeoutMs) {
  var startTime = java.lang.System.currentTimeMillis();
  while (java.lang.System.currentTimeMillis() - startTime < timeoutMs) {
    try {
      if (text(text).exists()) return true;
    } catch(e) {}
    sleep(500);
  }
  return false;
}

// ==================== EXECUTOR LAYER ====================

var currentTaskId = null; // Prevent double-processing
var isProcessing = false;

function smartClick(step, retries) {
  retries = retries || 3;
  
  // 1. Try text()
  if (step.contains || step.text) {
    var target = step.contains || step.text;
    for (var attempt = 0; attempt < retries; attempt++) {
      try {
        log("Try click text: " + target);
        click(target);
        sleep(500);
        if (verifyScreenContains(target)) {
          log("✓ Clicked (text): " + target);
          return true;
        }
      } catch(e) { 
        log("Text click failed: " + attempt); 
        sleep(300);
      }
    }
  }
  
  // 2. Try desc()
  if (step.desc) {
    for (var attempt = 0; attempt < retries; attempt++) {
      try {
        log("Try click desc: " + step.desc);
        click(step.desc);
        sleep(500);
        return true;
      } catch(e) {
        log("Desc click failed: " + attempt);
        sleep(300);
      }
    }
  }
  
  // 3. Try coordinates (last resort)
  if (step.x !== undefined && step.y !== undefined) {
    for (var attempt = 0; attempt < retries; attempt++) {
      try {
        log("Try click coords: " + step.x + "," + step.y);
        click(step.x, step.y);
        return true;
      } catch(e) {
        log("Coord click failed: " + attempt);
        sleep(300);
      }
    }
  }
  
  return false;
}

function execStep(step, stepIndex) {
  log("Step " + (stepIndex + 1) + ": " + step.action);
  var success = false;
  var errorMsg = "";
  
  try {
    switch(step.action) {
      case "launch_app":
      case "launch":
        var packageName = step.value;
        var resolved = resolveApp(packageName);
        
        if (!resolved) {
          errorMsg = "App not found: " + packageName + ". Known: " + getInstalledAppsList();
          log("✗ " + errorMsg);
          return { success: false, error: errorMsg };
        }
        
        log("Resolved " + packageName + " -> " + resolved);
        
        // Try launch
        for (var attempt = 0; attempt < 3; attempt++) {
          try {
            launchApp(resolved);
            sleep(2000); // Wait for app to open
            
            // Verify it actually opened
            var current = currentPackage();
            if (current && current.indexOf(resolved) !== -1) {
              success = true;
              log("✓ Launched: " + resolved);
              break;
            }
          } catch(e) {
            log("Launch attempt " + attempt + " failed: " + e);
            sleep(500);
          }
        }
        
        if (!success) {
          errorMsg = "Failed to launch: " + resolved;
        }
        break;
        
      case "click":
        success = smartClick(step, 3);
        if (!success) errorMsg = "Click failed - no method worked";
        break;
        
      case "type":
        try {
          setClip(step.text);
          sleep(300);
          paste();
          success = true;
          log("✓ Typed: " + (step.text.substring(0, 15) + "..."));
        } catch(e) {
          errorMsg = "Type failed: " + e;
        }
        break;
        
      case "press":
        try {
          if (step.key === "enter") press("enter");
          else if (step.key === "home") home();
          else if (step.key === "back") back();
          else { errorMsg = "Unknown key: " + step.key; }
          success = !errorMsg;
          if (success) log("✓ Pressed: " + step.key);
        } catch(e) {
          errorMsg = "Press failed: " + e;
        }
        break;
        
      case "wait":
        log("Wait " + step.ms + "ms...");
        sleep(step.ms);
        success = true;
        break;
        
      case "toast":
        log(step.text || "Done");
        success = true;
        break;
        
      case "swipe":
        // Swipe support - basic
        if (step.x1 && step.y1 && step.x2 && step.y2) {
          swipe(step.x1, step.y1, step.x2, step.y2, 300);
          success = true;
          log("✓ Swiped");
        } else {
          errorMsg = "Swipe needs x1,y1,x2,y2";
        }
        break;
        
      default:
        errorMsg = "Unknown action: " + step.action;
    }
  } catch(e) {
    errorMsg = "Exception: " + e.toString();
    log("✗ Error: " + errorMsg);
  }
  
  return { success: success, error: errorMsg };
}

// ==================== FEEDBACK LAYER ====================

function writeLog(taskId, status, result, error) {
  var headers = { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "DWAI-Agent" };
  
  var logEntry = {
    task_id: taskId,
    status: status,
    result: result,
    error: error,
    timestamp: new Date().toISOString(),
    device_info: {
      apps_discovered: Object.keys(INSTALLED_APPS).length
    }
  };
  
  var logFile = taskId + "_log.json";
  var url = LOGS_URL + "/" + logFile;
  
  try {
    httpPut(url, JSON.stringify({
      message: "Log " + taskId,
      content: toBase64(JSON.stringify(logEntry, null, 2)),
      branch: "main"
    }), headers);
  } catch(e) {
    log("Log write failed: " + e);
  }
}

// ==================== MAIN EXECUTION LOOP ====================

function pollAndRun() {
  // Prevent overlapping execution
  if (isProcessing) {
    log("Already processing, skip poll");
    return;
  }
  
  var headers = { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "DWAI-Agent" };

  try {
    // Get task list
    var res = httpGet(TASKS_URL, headers);
    if (res.statusCode !== 200) { 
      log("Get tasks failed: " + res.statusCode); 
      return; 
    }
    
    var files = JSON.parse(res.body);
    if (!Array.isArray(files)) return;
    
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      
      // Skip non-task files
      if (!file.sha || file.name === ".gitkeep") continue;
      if (file.name.indexOf("_log") !== -1) continue;
      
      // Get task content
      var contentRes = httpGet(file.download_url, {});
      if (contentRes.statusCode !== 200) continue;
      
      var task = JSON.parse(contentRes.body);
      
      // Skip non-pending tasks
      if (task.status !== "pending") {
        // If it's executing but we're the same task, check timeout
        if (task.status === "executing" && task.task_id === currentTaskId) {
          // Check if stuck - if started > 5 min ago, force retry
          if (task.started_at) {
            var started = new Date(task.started_at).getTime();
            var now = new Date().getTime();
            if (now - started > 300000) { // 5 min
              log("Task stuck, will retry: " + task.task_id);
            } else {
              log("Task currently executing, skip: " + task.task_id);
              return;
            }
          }
        }
        continue;
      }
      
      // CLAIM the task - prevent double processing
      isProcessing = true;
      currentTaskId = task.task_id;
      
      log("=== PROCESSING: " + task.task_id + " ===");
      log("Intent: " + (task.intent || "unknown"));
      log("Steps: " + task.steps.length);
      
      // Mark as executing
      task.status = "executing";
      task.started_at = new Date().toISOString();
      
      // Get fresh SHA for update
      var fresh = httpGet(file.url, headers);
      var currentSha = file.sha;
      if (fresh.statusCode === 200) {
        currentSha = JSON.parse(fresh.body).sha;
      }
      
      httpPut(file.url, JSON.stringify({ 
        message: "Executing " + task.task_id, 
        content: toBase64(JSON.stringify(task)), 
        sha: currentSha 
      }), headers);
      
      // Execute steps
      var failedStep = -1;
      var errorMsg = "";
      
      for (var j = 0; j < task.steps.length; j++) {
        var result = execStep(task.steps[j], j);
        
        if (!result.success && failedStep === -1) {
          failedStep = j;
          errorMsg = result.error;
          log("✗ Step " + (j + 1) + " failed: " + errorMsg);
          
          // If step failed critically, stop
          if (task.steps[j].action === "launch_app") {
            log("Launch failed, stopping");
            break;
          }
        }
        
        sleep(800); // Wait between steps
      }
      
      // Get fresh SHA for completion
      fresh = httpGet(file.url, headers);
      currentSha = file.sha;
      if (fresh.statusCode === 200) {
        currentSha = JSON.parse(fresh.body).sha;
      }
      
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
        content: toBase64(JSON.stringify(task, null, 2)), 
        sha: currentSha 
      }), headers);
      
      // Delete task file (cleanup)
      var delRes = httpDelete(file.url, currentSha, headers);
      log("Deleted: " + (delRes.statusCode === 204 || delRes.statusCode === 200 ? "OK" : "FAILED"));
      
      // Reset state
      currentTaskId = null;
      isProcessing = false;
      
      break; // Only one task per poll
    }
  } catch(e) { 
    log("Error: " + e);
    isProcessing = false;
    currentTaskId = null;
  }
}

// ==================== STARTUP ====================

toast("DWAI v8 starting...");
log("DWAI Mobile Agent v8");
log("Building app cache...");

buildInstalledAppsMap();

log("Apps available: " + Object.keys(KNOWN_APPS).length + " known");

setInterval(pollAndRun, POLL_INTERVAL);

log("v8 running - poll every " + POLL_INTERVAL + "ms");