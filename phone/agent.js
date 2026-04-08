// DWAI Mobile Agent v2.1 - LLM Brain Client
// Fixes: App resolution, Queue performance, Smart verification

// ============================================
// CONFIGURATION
// ============================================
var GITHUB_TOKEN = "ghp_YOUR_TOKEN_HERE";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";

// ============================================
// CONSTANTS
// ============================================
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var ROUTES_PATH = "data/routes";
var CURRENT_TASK_PATH = "data/current_task.json";
var TASK_QUEUE_PATH = "data/task_queue.json"; // NEW: O(1) Queue

var FATAL_ERROR_COUNT = 0;
var FATAL_ERROR_LIMIT = 15;
var POLL_INTERVAL = 2000;
var BRANCH = "main";
var WORKER_ID = "phone-" + (device.model || "android") + "-" + device.width + "x" + device.height;
var BASE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/";

console.log("=== DWAI AGENT v2.1 LLM BRAIN START ===");
toast("DWAI v2.1 starting...");

// ============================================
// STATE
// ============================================
var isProcessing = false;
var currentTaskId = null;
var processedTaskIds = new Set();
var lastProcessedTimestamp = 0;

// Teach mode
var TEACH_MODE = false;
var TEACH_SESSION = null;
var TEACH_LAST_FP = null;
var TEACH_SNAPS = [];
var TEACH_TOUCHES = [];
var TEACH_START_TIME = null;

// Live mode
var LIVE_MODE = false;
var LIVE_CURRENT_STEP = 0;
var LIVE_TASK = null;
var LIVE_VERIFICATION_FAILS = 0;
var LAST_SCREEN_STATE = null;

// Touch observer
var touchObserver = null;

// App cache
var INSTALLED_APPS = {};
var APP_CACHE_BUILT = false;

// ============================================
// ENHANCED APP REGISTRY
// ============================================
var APP_REGISTRY = {
  "youtube": { pkg: "com.google.android.youtube", category: "video" },
  "chrome": { pkg: "com.android.chrome", category: "browser" },
  "browser": { pkg: "com.android.chrome", category: "browser" },
  "edge": { pkg: "com.microsoft.emmx", category: "browser" },
  "firefox": { pkg: "org.mozilla.firefox", category: "browser" },
  "whatsapp": { pkg: "com.whatsapp", category: "messaging" },
  "telegram": { pkg: "org.telegram.messenger", category: "messaging" },
  "signal": { pkg: "org.thoughtcrime.securesms", category: "messaging" },
  "calculator": { pkg: "com.android.calculator2", category: "utility" },
  "calc": { pkg: "com.android.calculator2", category: "utility" },
  "camera": { pkg: "com.android.camera2", category: "media" },
  "photos": { pkg: "com.google.android.apps.photos", category: "media" },
  "gallery": { pkg: "com.google.android.apps.photos", category: "media" }, // FIX: Map gallery to photos, not loop
  "settings": { pkg: "com.android.settings", category: "system" },
  "phone": { pkg: "com.android.dialer", category: "communication" },
  "messages": { pkg: "com.android.mms", category: "communication" },
  "gmail": { pkg: "com.google.android.gm", category: "productivity" },
  "maps": { pkg: "com.google.android.apps.maps", category: "navigation" },
  "spotify": { pkg: "com.spotify.music", category: "media" },
  "facebook": { pkg: "com.facebook.katana", category: "social" },
  "instagram": { pkg: "com.instagram.android", category: "social" },
  "twitter": { pkg: "com.twitter.android", category: "social" },
  "discord": { pkg: "com.discord", category: "communication" },
  "slack": { pkg: "com.Slack", category: "productivity" },
  "zoom": { pkg: "us.zoom.videomeetings", category: "productivity" },
  "amazon": { pkg: "com.amazon.mShop.android.shopping", category: "shopping" },
  "playstore": { pkg: "com.android.vending", category: "system" }
};

function buildInstalledAppsMap() {
  if (APP_CACHE_BUILT) return;
  try {
    var pm = context.getPackageManager();
    var apps = pm.getInstalledApplications(0);
    for (var i = 0; i < apps.size(); i++) {
      var app = apps.get(i);
      var pkg = app.packageName;
      try {
        var label = pm.getApplicationLabel(app).toString().toLowerCase();
        INSTALLED_APPS[label] = pkg;
        INSTALLED_APPS[pkg] = pkg;
      } catch (e) {}
    }
    APP_CACHE_BUILT = true;
    console.log("Apps cached: " + Object.keys(INSTALLED_APPS).length);
  } catch (e) {
    console.log("App cache failed: " + e);
    APP_CACHE_BUILT = true;
  }
}

// FIX #1: Strict app resolution to prevent false positives
function resolveApp(appName) {
  if (!appName || appName.length < 2) return null;
  var name = String(appName).toLowerCase().trim();
  
  // 1. Direct registry lookup
  if (APP_REGISTRY[name]) return APP_REGISTRY[name].pkg;
  
  // 2. Check installed apps (exact match only)
  if (INSTALLED_APPS[name]) return INSTALLED_APPS[name];
  
  // 3. Strict prefix match (min 4 chars to avoid false positives)
  if (name.length >= 4) {
    for (var key in APP_REGISTRY) {
      if (key.indexOf(name) === 0 || name.indexOf(key) === 0) {
        return APP_REGISTRY[key].pkg;
      }
    }
  }
  
  // 4. If looks like package name, verify it exists
  if (name.indexOf(".") !== -1) {
    // Verify it's actually installed
    for (var installed in INSTALLED_APPS) {
      if (installed === name) return name;
    }
  }
  
  return null;
}

function normalizeLaunchTarget(value) {
  if (!value) return null;
  var v = String(value).trim();
  if (!v) return null;
  var resolved = resolveApp(v);
  if (resolved) return resolved;
  return null; // FIX: Don't return invalid values
}

// ============================================
// UTILITIES
// ============================================
function waitMs(ms) {
  java.lang.Thread.sleep(ms);
}

function log(msg) {
  console.log(new Date().toISOString() + " | " + msg);
}

function notify(msg) {
  toast(msg);
}

function b64Encode(text) {
  try {
    return android.util.Base64.encodeToString(
      new java.lang.String(String(text)).getBytes("UTF-8"),
      android.util.Base64.NO_WRAP
    );
  } catch (e) {
    return "";
  }
}

function b64Decode(text) {
  try {
    var clean = String(text || "").replace(/\\n/g, "").replace(/\\r/g, "");
    return new java.lang.String(
      android.util.Base64.decode(clean, android.util.Base64.DEFAULT),
      "UTF-8"
    ).toString();
  } catch (e) {
    return "";
  }
}

// ============================================
// HTTP HELPERS
// ============================================
function readStream(stream) {
  if (!stream) return "";
  try {
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream));
    var line;
    var out = "";
    while ((line = reader.readLine()) !== null) {
      out += line;
    }
    reader.close();
    return out;
  } catch (e) {
    return "";
  }
}

function headers() {
  return {
    "Authorization": "token " + GITHUB_TOKEN,
    "User-Agent": "DWAI-Agent-v2.1",
    "Accept": "application/vnd.github+json"
  };
}

function httpRequest(method, url, body, extraHeaders) {
  try {
    log("HTTP " + method + " -> " + url.substring(url.lastIndexOf("/") + 1));
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod(method);
    conn.setConnectTimeout(15000);
    conn.setReadTimeout(15000);
    
    var h = headers();
    if (extraHeaders) {
      for (var k in extraHeaders) h[k] = extraHeaders[k];
    }
    for (var key in h) {
      conn.setRequestProperty(key, String(h[key]));
    }
    
    if (body !== null && body !== undefined) {
      conn.setDoOutput(true);
      var writer = new java.io.OutputStreamWriter(conn.getOutputStream());
      writer.write(body);
      writer.flush();
      writer.close();
    }
    
    var code = conn.getResponseCode();
    var stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
    var res = readStream(stream);
    conn.disconnect();
    return { statusCode: code, body: res };
  } catch (e) {
    log("HTTP error: " + e);
    return { statusCode: -1, body: String(e) };
  }
}

function ghGetJson(url) {
  var res = httpRequest("GET", url, null, null);
  var parsed = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch (e) {}
  return {
    ok: res.statusCode >= 200 && res.statusCode < 300,
    statusCode: res.statusCode,
    body: res.body,
    json: parsed
  };
}

function ghPutJson(url, bodyObj) {
  var res = httpRequest("PUT", url, JSON.stringify(bodyObj), null);
  return {
    ok: res.statusCode === 200 || res.statusCode === 201,
    statusCode: res.statusCode,
    body: res.body
  };
}

// ============================================
// QUEUE SYSTEM (O(1) Performance Fix)
// ============================================
function getTaskQueue() {
  var url = BASE_URL + TASK_QUEUE_PATH;
  var res = ghGetJson(url);
  if (!res.ok || !res.json || !res.json.content) {
    return { queue: [], processing: null };
  }
  try {
    return JSON.parse(b64Decode(res.json.content));
  } catch (e) {
    return { queue: [], processing: null };
  }
}

function updateTaskQueue(queueData) {
  var url = BASE_URL + TASK_QUEUE_PATH;
  var content = b64Encode(JSON.stringify(queueData, null, 2));
  
  var existing = ghGetJson(url);
  var payload = {
    message: "queue update",
    content: content,
    branch: BRANCH
  };
  
  if (existing.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }
  
  var res = ghPutJson(url, payload);
  if (!res.ok) {
    log("Queue update failed: " + res.statusCode);
  }
  return res;
}

// ============================================
// DEVICE STATE
// ============================================
function isLocked() {
  try {
    var km = context.getSystemService(context.KEYGUARD_SERVICE);
    return km.isKeyguardLocked();
  } catch (e) {
    return false;
  }
}

function waitForUnlock() {
  while (isLocked()) {
    notify("Unlock phone...");
    waitMs(2000);
  }
}

function currentAppIs(pkg) {
  try {
    return currentPackage() === pkg;
  } catch (e) {
    return false;
  }
}

function currentScreenFingerprint() {
  var pkg = "";
  var act = "";
  try {
    pkg = currentPackage() || "";
    act = currentActivity() || "";
  } catch (e) {}
  
  var texts = [];
  var clickable = [];
  try {
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < Math.min(nodes.size(), 8); i++) {
      var t = nodes.get(i).text();
      if (t) texts.push(String(t));
    }
    
    // Also get clickable elements for better verification
    var clickNodes = clickable(true).find();
    for (var j = 0; j < Math.min(clickNodes.size(), 5); j++) {
      var node = clickNodes.get(j);
      var txt = node.text() || node.desc();
      if (txt) clickable.push(String(txt));
    }
  } catch (e) {}
  
  return {
    pkg: pkg,
    activity: act,
    texts: texts,
    clickable: clickable,
    ts: Date.now()
  };
}

// ============================================
// SMART LAUNCH WITH VERIFICATION
// ============================================
function launchAppSafe(nameOrPackage, verify) {
  var target = normalizeLaunchTarget(nameOrPackage);
  if (!target) {
    log("App not resolvable: " + nameOrPackage);
    return null;
  }
  
  log("Launching: " + nameOrPackage + " -> " + target);
  
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      app.launchPackage(target);
      waitMs(2000 + (attempt * 1000));
      
      if (currentAppIs(target)) {
        log("Launch success: " + target);
        return target;
      }
      
      // Try intent method
      try {
        app.startActivity({
          packageName: target,
          action: "android.intent.action.MAIN",
          category: "android.intent.category.LAUNCHER"
        });
        waitMs(2000);
        
        if (currentAppIs(target)) {
          log("Launch via intent success: " + target);
          return target;
        }
      } catch (intentErr) {}
      
    } catch (e) {
      log("Launch error: " + e);
    }
  }
  
  log("Launch failed: " + target);
  return null;
}

// ============================================
// SMART CLICK WITH VERIFICATION (Fix #4)
// ============================================
function verifyElementExists(strategy, target) {
  try {
    var node = null;
    if (strategy === 'text') node = text(target).findOnce();
    else if (strategy === 'contains') node = textContains(target).findOnce();
    else if (strategy === 'desc') node = desc(target).findOnce();
    else if (strategy === 'descContains') node = descContains(target).findOnce();
    
    if (node && node.exists()) {
      var bounds = node.bounds();
      return {
        exists: true,
        x: bounds.centerX(),
        y: bounds.centerY(),
        bounds: bounds
      };
    }
  } catch (e) {}
  return { exists: false };
}

function clickSmart(step) {
  var strategies = [];
  
  // Build strategy list
  if (step.text) strategies.push({ type: 'text', val: step.text });
  if (step.contains) strategies.push({ type: 'contains', val: step.contains });
  if (step.desc) strategies.push({ type: 'desc', val: step.desc });
  if (step.descContains) strategies.push({ type: 'descContains', val: step.descContains });
  
  // Try each strategy with verification
  for (var i = 0; i < strategies.length; i++) {
    var strat = strategies[i];
    log("Trying click: " + strat.type + "=" + strat.val);
    
    var verify = verifyElementExists(strat.type, strat.val);
    if (verify.exists) {
      log("Element found at: " + verify.x + "," + verify.y);
      click(verify.x, verify.y);
      
      // Post-click verification in live mode
      if (LIVE_MODE) {
        waitMs(500);
        var newState = currentScreenFingerprint();
        if (LAST_SCREEN_STATE && JSON.stringify(LAST_SCREEN_STATE.texts) === JSON.stringify(newState.texts)) {
          log("Warning: Screen unchanged after click");
          // Continue anyway, might be same screen with updated content
        }
        LAST_SCREEN_STATE = newState;
      }
      return true;
    }
  }
  
  // Fallback to coordinates if provided
  if (typeof step.x === 'number' && typeof step.y === 'number') {
    log("Using coordinates: " + step.x + "," + step.y);
    click(step.x, step.y);
    return true;
  }
  
  // Try fallbacks
  if (step.fallbacks) {
    for (var j = 0; j < step.fallbacks.length; j++) {
      var fb = step.fallbacks[j];
      if (fb.action === 'click' && (fb.x || fb.contains)) {
        if (fb.x && fb.y) {
          click(fb.x, fb.y);
          return true;
        } else if (fb.contains) {
          var v = verifyElementExists('contains', fb.contains);
          if (v.exists) {
            click(v.x, v.y);
            return true;
          }
        }
      }
    }
  }
  
  return false;
}

function typeText(value) {
  try {
    var t = String(value || "");
    if (!t) return false;
    setClip(t);
    waitMs(300);
    paste();
    return true;
  } catch (e) {
    return false;
  }
}

function execStep(step) {
  if (!step || !step.action) throw new Error("Invalid step");
  
  log("Exec: " + step.action + (step.value ? " -> " + step.value : "") + (step.text ? " -> " + step.text : ""));
  
  // Pre-execution observation in live mode
  if (LIVE_MODE && step.verify) {
    LAST_SCREEN_STATE = currentScreenFingerprint();
  }
  
  switch (step.action) {
    case "launch_app":
      var launched = launchAppSafe(step.value, step.verify);
      if (!launched) throw new Error("Launch failed: " + step.value);
      
      // Verify if requested
      if (step.verify && !currentAppIs(launched)) {
        throw new Error("Launch verification failed");
      }
      return true;
      
    case "click":
      if (!clickSmart(step)) {
        if (LIVE_MODE) {
          // In live mode, try to find similar elements
          log("Click failed, attempting recovery...");
          waitMs(1000);
          if (!clickSmart(step)) throw new Error("Click failed after retry");
        } else {
          throw new Error("Click failed");
        }
      }
      return true;
      
    case "type":
      if (!typeText(step.text || step.value || "")) throw new Error("Type failed");
      return true;
      
    case "press":
      var key = String(step.key || "").toLowerCase();
      
      if (key === "enter") {
        var enterBtn = text("Go").findOne(500) || 
                      desc("Go").findOne(500) ||
                      text("Search").findOne(500) || 
                      desc("Search").findOne(500);
        if (enterBtn && enterBtn.clickable()) {
          enterBtn.click();
          return true;
        }
        
        // Keyboard enter
        var screenW = device.width;
        var screenH = device.height;
        click(screenW - 100, screenH - 150);
        return true;
      }
      else if (key === "back") {
        back();
        return true;
      }
      else if (key === "home") {
        home();
        return true;
      }
      else if (key === "menu") {
        var menuBtn = desc("More options").findOne(500);
        if (menuBtn && menuBtn.clickable()) {
          menuBtn.click();
          return true;
        }
        back();
        return true;
      }
      else {
        throw new Error("Unknown key: " + key);
      }
      
    case "wait":
      waitMs(Number(step.ms || 1000));
      return true;
      
    case "toast":
      notify(String(step.text || step.value || "Done"));
      return true;
      
    case "swipe":
      if (step.direction) {
        var w = device.width;
        var h = device.height;
        var dist = step.distance === 'long' ? 0.8 : (step.distance === 'short' ? 0.3 : 0.5);
        
        if (step.direction === 'up') swipe(w/2, h * (1-dist), w/2, h * dist, 300);
        else if (step.direction === 'down') swipe(w/2, h * dist, w/2, h * (1-dist), 300);
        else if (step.direction === 'left') swipe(w * (1-dist), h/2, w * dist, h/2, 300);
        else if (step.direction === 'right') swipe(w * dist, h/2, w * (1-dist), h/2, 300);
        return true;
      }
      if (typeof step.x1 === 'number') {
        swipe(step.x1, step.y1, step.x2, step.y2, step.duration || 300);
        return true;
      }
      throw new Error("Swipe params missing");
      
    case "observe":
      var obs = observeAndVerify({
        package: step.expected_package,
        text: step.expected_text
      });
      if (!obs.ok && step.on_mismatch === 'abort') {
        throw new Error("Observation failed: " + obs.reason);
      }
      return true;
      
    case "scroll_find":
      for (var s = 0; s < (step.max_swipes || 5); s++) {
        var found = verifyElementExists(step.strategy, step.target);
        if (found.exists) {
          click(found.x, found.y);
          return true;
        }
        // Swipe up to scroll down
        swipe(device.width/2, device.height*0.7, device.width/2, device.height*0.3, 300);
        waitMs(500);
      }
      throw new Error("Scroll find failed: " + step.target);
      
    default:
      throw new Error("Unknown action: " + step.action);
  }
}

function execWithRetry(step) {
  for (var i = 0; i < 3; i++) {
    try {
      if (execStep(step)) return true;
    } catch (e) {
      log("Attempt " + (i+1) + " failed: " + e);
      if (i === 2) throw e;
      waitMs(1000);
    }
  }
  return false;
}

// ============================================
// TEACH MODE
// ============================================
function startTeachSession(task) {
  TEACH_MODE = true;
  TEACH_SESSION = {
    task_id: task.task_id,
    goal: task.goal,
    app: task.app,
    started_at: new Date().toISOString()
  };
  TEACH_SNAPS = [];
  TEACH_TOUCHES = [];
  TEACH_LAST_FP = null;
  TEACH_START_TIME = Date.now();
  
  if (task.app && task.app !== "unknown") {
    var pkg = normalizeLaunchTarget(task.app);
    if (pkg) {
      launchAppSafe(task.app);
      waitMs(3000);
    }
  }
  
  notify("Teach: " + task.goal);
  log("Teach started: " + task.goal);
}

function recordTeachSnapshot() {
  if (!TEACH_MODE || !TEACH_SESSION) return;
  
  var fp = currentScreenFingerprint();
  if (!fp || !fp.pkg) return;
  
  if (TEACH_LAST_FP && TEACH_LAST_FP.pkg === fp.pkg) {
    var textSame = JSON.stringify(TEACH_LAST_FP.texts) === JSON.stringify(fp.texts);
    if (textSame) return;
  }
  
  TEACH_LAST_FP = fp;
  var snap = {};
  for (var k in fp) if (fp.hasOwnProperty(k)) snap[k] = fp[k];
  snap.touches = TEACH_TOUCHES.slice();
  snap.elapsed = Date.now() - TEACH_START_TIME;
  TEACH_SNAPS.push(snap);
  TEACH_TOUCHES = [];
}

function finalizeTeachSession() {
  if (!TEACH_SESSION) return;
  
  var steps = [];
  var lastPkg = null;
  
  for (var i = 0; i < TEACH_SNAPS.length; i++) {
    var snap = TEACH_SNAPS[i];
    
    if (snap.pkg && snap.pkg !== lastPkg) {
      steps.push({
        action: "launch_app",
        value: snap.pkg,
        verify: true,
        _from_teach: true
      });
      lastPkg = snap.pkg;
    }
    
    if (snap.touches && snap.touches.length > 0) {
      for (var j = 0; j < snap.touches.length; j++) {
        var touch = snap.touches[j];
        steps.push({
          action: "click",
          x: touch.x,
          y: touch.y,
          _from_teach: true
        });
      }
    }
  }
  
  var routeData = {
    route_id: TEACH_SESSION.task_id,
    goal: TEACH_SESSION.goal,
    app: TEACH_SESSION.app,
    steps: steps,
    snapshots: TEACH_SNAPS.length,
    created: new Date().toISOString()
  };
  
  // Save route via GitHub
  var url = BASE_URL + ROUTES_PATH + "/" + TEACH_SESSION.task_id + ".json";
  var payload = {
    message: "route " + TEACH_SESSION.task_id,
    content: b64Encode(JSON.stringify(routeData, null, 2)),
    branch: BRANCH
  };
  ghPutJson(url, payload);
  
  TEACH_MODE = false;
  TEACH_SESSION = null;
  
  notify("Route saved!");
  log("Teach finalized");
}

// ============================================
// LIVE MODE
// ============================================
function observeAndVerify(expected) {
  try {
    var current = currentScreenFingerprint();
    
    if (expected.package && !currentAppIs(expected.package)) {
      return { ok: false, reason: "wrong_package", current: current };
    }
    
    if (expected.text && current.texts) {
      var found = current.texts.some(function(t) { 
        return t.toLowerCase().indexOf(expected.text.toLowerCase()) !== -1; 
      });
      if (!found) {
        return { ok: false, reason: "text_not_found", current: current };
      }
    }
    
    return { ok: true, current: current };
  } catch (e) {
    return { ok: false, reason: "error", error: String(e) };
  }
}

// ============================================
// TASK EXECUTION
// ============================================
function writeLog(taskId, status, error, details) {
  var logData = {
    task_id: taskId,
    status: status,
    error: error || null,
    details: details || null,
    worker_id: WORKER_ID,
    timestamp: new Date().toISOString()
  };
  var url = BASE_URL + LOGS_PATH + "/" + taskId + "_log.json";
  var payload = {
    message: "log " + taskId,
    content: b64Encode(JSON.stringify(logData, null, 2)),
    branch: BRANCH
  };
  ghPutJson(url, payload);
}

function updateCurrentTaskStatus(taskId, status, error) {
  var url = BASE_URL + CURRENT_TASK_PATH;
  var pointer = {
    task_id: taskId,
    status: status,
    updated_at: new Date().toISOString(),
    error: error || null,
    worker_id: WORKER_ID
  };
  var existing = ghGetJson(url);
  var payload = {
    message: "status " + taskId,
    content: b64Encode(JSON.stringify(pointer, null, 2)),
    branch: BRANCH
  };
  if (existing.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }
  ghPutJson(url, payload);
}

function runTaskExecution(task, taskFileUrl, fileSha) {
  isProcessing = true;
  currentTaskId = task.task_id;
  LIVE_MODE = (task.mode === 'live');
  
  log("Executing: " + task.task_id + " mode=" + (task.mode || 'normal'));
  updateCurrentTaskStatus(task.task_id, "executing");
  
  try {
    waitForUnlock();
    
    if (!task.steps || !task.steps.length) {
      throw new Error("No steps provided");
    }
    
    var success = true;
    var errorMsg = "";
    
    for (var j = 0; j < task.steps.length; j++) {
      LIVE_CURRENT_STEP = j;
      var step = task.steps[j];
      
      // Skip pure observation steps in non-live mode unless verify requested
      if (step.action === "observe" && task.mode !== 'live' && !step.on_mismatch) {
        continue;
      }
      
      execWithRetry(step);
      waitMs(step.action === 'launch_app' ? 1000 : 500);
    }
    
    if (success) {
      writeLog(task.task_id, "completed", null, "All steps executed");
      updateCurrentTaskStatus(task.task_id, "completed");
      log("Completed: " + task.task_id);
    }
    
  } catch (e) {
    log("Task error: " + e);
    writeLog(task.task_id, "failed", String(e), "Step " + LIVE_CURRENT_STEP);
    updateCurrentTaskStatus(task.task_id, "failed", String(e));
  }
  
  isProcessing = false;
  currentTaskId = null;
  LIVE_MODE = false;
  processedTaskIds.add(task.task_id);
}

// ============================================
// MAIN LOOP (O(1) Queue Processing)
// ============================================
function processQueue() {
  if (isProcessing) return;
  
  // Handle teach mode snapshots
  if (TEACH_MODE) {
    recordTeachSnapshot();
    
    // Check for teach_stop in queue
    var queue = getTaskQueue();
    for (var i = 0; i < queue.queue.length; i++) {
      var qItem = queue.queue[i];
      if (qItem.task_id.indexOf('stop_') === 0 || qItem.task_id.indexOf('teach_stop') !== -1) {
        // Process stop
        var taskUrl = BASE_URL + TASKS_PATH + "/" + qItem.task_id + ".json";
        var taskRes = ghGetJson(taskUrl);
        if (taskRes.ok && taskRes.json && taskRes.json.content) {
          var task = JSON.parse(b64Decode(taskRes.json.content));
          if (task.type === 'teach_stop') {
            finalizeTeachSession();
            writeLog(task.task_id, "completed", null, "Teach session saved");
            queue.queue.splice(i, 1);
            updateTaskQueue(queue);
            return;
          }
        }
      }
    }
    return;
  }
  
  // Get next task from queue (O(1))
  var queue = getTaskQueue();
  if (queue.queue.length === 0) return;
  
  var nextTask = queue.queue[0];
  
  // Skip if already processed
  if (processedTaskIds.has(nextTask.task_id)) {
    queue.queue.shift();
    updateTaskQueue(queue);
    return;
  }
  
  // Fetch full task
  var taskUrl = BASE_URL + TASKS_PATH + "/" + nextTask.task_id + ".json";
  var taskRes = ghGetJson(taskUrl);
  
  if (!taskRes.ok || !taskRes.json || !taskRes.json.content) {
    log("Failed to fetch task: " + nextTask.task_id);
    queue.queue.shift();
    updateTaskQueue(queue);
    return;
  }
  
  try {
    var task = JSON.parse(b64Decode(taskRes.json.content));
    var fileSha = taskRes.json.sha;
    
    if (task.status !== "pending") {
      queue.queue.shift();
      updateTaskQueue(queue);
      return;
    }
    
    // Handle teach start
    if (task.type === 'teach_start') {
      queue.queue.shift();
      updateTaskQueue(queue);
      startTeachSession(task);
      writeLog(task.task_id, "completed", null, "Teach mode active");
      return;
    }
    
    // Execute regular task
    queue.queue.shift();
    queue.processing = {
      task_id: task.task_id,
      started_at: Date.now()
    };
    updateTaskQueue(queue);
    
    runTaskExecution(task, taskUrl, fileSha);
    
    queue = getTaskQueue();
    queue.processing = null;
    updateTaskQueue(queue);
    
  } catch (e) {
    log("Process error: " + e);
    queue.queue.shift();
    updateTaskQueue(queue);
  }
}

// ============================================
// STARTUP
// ============================================
buildInstalledAppsMap();

log("Agent ready. Mode: O(1) Queue, Smart Click, LLM Brain Client");

while (true) {
  try {
    processQueue();
    FATAL_ERROR_COUNT = 0;
  } catch (e) {
    log("FATAL LOOP ERROR: " + e);
    isProcessing = false;
    FATAL_ERROR_COUNT++;
    if (FATAL_ERROR_COUNT >= FATAL_ERROR_LIMIT) {
      notify("DWAI fatal error - restarting");
      waitMs(5000);
      FATAL_ERROR_COUNT = 0;
    }
  }
  
  // Cleanup old processed IDs
  if (processedTaskIds.size > 500) {
    processedTaskIds.clear();
  }
  
  waitMs(POLL_INTERVAL);
}
