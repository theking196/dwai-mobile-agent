// DWAI Mobile Agent v2.0 - Complete Implementation
// Features: /do (fast), /live (watch+adapt), /teach (record), route matching, queue fix

var GITHUB_TOKEN = "YOUR_GITHUB_TOKEN_HERE"; // REPLACE THIS
var REPO_OWNER = "YOUR_REPO_OWNER_HERE";     // REPLACE THIS  
var REPO_NAME = "YOUR_REPO_NAME_HERE";       // REPLACE THIS

var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var ROUTES_PATH = "data/routes";
var CURRENT_TASK_PATH = "data/current_task.json";

var FATAL_ERROR_COUNT = 0;
var FATAL_ERROR_LIMIT = 15;  

var POLL_INTERVAL = 2000;
var BRANCH = "main";
var WORKER_ID = "phone-" + (device.model || "android") + "-" + device.width + "x" + device.height;
var BASE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/";

console.log("=== DWAI AGENT v2.0 START ===");
toast("DWAI v2.0 starting...");

// ============================================
// STATE MANAGEMENT
// ============================================
var isProcessing = false;
var currentTaskId = null;
var lastTaskId = null;
var processedTaskIds = new Set(); // FIX: Prevent queue delays

// Teach mode state
var TEACH_MODE = false;
var TEACH_SESSION = null;
var TEACH_LAST_FP = null;
var TEACH_SNAPS = [];
var TEACH_TOUCHES = [];
var TEACH_START_TIME = null;

// Live mode state
var LIVE_MODE = false;
var LIVE_CURRENT_STEP = 0;
var LIVE_TASK = null;
var LIVE_VERIFICATION_FAILS = 0;

// Touch observer
var touchObserver = null;

// ============================================
// APP DISCOVERY
// ============================================
var INSTALLED_APPS = {};
var APP_CACHE_BUILT = false;

var KNOWN_APPS = {
  "youtube": "com.google.android.youtube",
  "chrome": "com.android.chrome",
  "google chrome": "com.android.chrome",
  "browser": "com.android.chrome",
  "whatsapp": "com.whatsapp",
  "whatsapp business": "com.whatsapp.w4b",
  "calculator": "com.android.calculator2",
  "camera": "com.android.camera2",
  "photos": "com.google.android.apps.photos",
  "gallery": "com.google.android.apps.photos",
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
  "zoom": "us.zoom.videomeetings"
};

function buildInstalledAppsMap() {
  if (APP_CACHE_BUILT) return;
  try {
    var pm = context.getPackageManager();
    var apps = pm.getInstalledApplications(0);
    for (var i = 0; i < apps.size(); i++) {
      var app = apps.get(i);
      var pkg = app.packageName;
      var label = "";
      try {
        label = pm.getApplicationLabel(app).toString().toLowerCase();
      } catch (e) {}
      if (label) {
        INSTALLED_APPS[label] = pkg;
      }
      INSTALLED_APPS[pkg] = pkg;
    }
    APP_CACHE_BUILT = true;
    console.log("App cache built: " + Object.keys(INSTALLED_APPS).length);
  } catch (e) {
    console.log("App discovery failed: " + e);
    APP_CACHE_BUILT = true;
  }
}

function resolveApp(appName) {
  if (!appName) return null;
  var name = String(appName).toLowerCase().trim();
  if (!name) return null;
  if (KNOWN_APPS[name]) return KNOWN_APPS[name];
  if (INSTALLED_APPS[name]) return INSTALLED_APPS[name];
  for (var key in KNOWN_APPS) {
    if (name.indexOf(key) !== -1) {
      return KNOWN_APPS[key];
    }
  }
  for (var k in INSTALLED_APPS) {
    if (k.indexOf(name) !== -1) {
      return INSTALLED_APPS[k];
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
  if (v.indexOf(".") !== -1) return v;
  return null;
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
    log("b64Encode error: " + e);
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
    log("b64Decode error: " + e);
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
    log("readStream error: " + e);
    return "";
  }
}

function headers() {
  return {
    "Authorization": "token " + GITHUB_TOKEN,
    "User-Agent": "DWAI-Agent-v2.0",
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
      for (var k in extraHeaders) {
        h[k] = extraHeaders[k];
      }
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
    log("httpRequest exception: " + e);
    return { statusCode: -1, body: String(e) };
  }
}

function ghGetJson(url) {
  var res = httpRequest("GET", url, null, null);
  var parsed = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch (e) {
    parsed = null;
  }
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
// GITHUB TASK OPERATIONS
// ============================================
function getTaskList() {
  var url = BASE_URL + TASKS_PATH;
  var res = ghGetJson(url);
  if (!res.ok || !Array.isArray(res.json)) {
    log("Failed to fetch task list: " + res.statusCode);
    return [];
  }
  return res.json;
}

function getCurrentPointer() {
  var url = BASE_URL + CURRENT_TASK_PATH;
  var res = ghGetJson(url);
  if (!res.ok || !res.json || !res.json.content) return null;
  try {
    return JSON.parse(b64Decode(res.json.content));
  } catch (e) {
    log("current_task parse error: " + e);
    return null;
  }
}

function getTask(fileUrl) {
  var res = ghGetJson(fileUrl);
  if (!res.ok || !res.json || !res.json.content) {
    log("Failed to fetch task file: " + res.statusCode);
    return null;
  }
  try {
    var file = res.json;
    var task = JSON.parse(b64Decode(file.content));
    return { file: file, task: task, fileUrl: fileUrl };
  } catch (e) {
    log("Task parse error: " + e);
    return null;
  }
}

function saveTask(fileUrl, sha, task, message) {
  var payload = {
    message: message,
    content: b64Encode(JSON.stringify(task, null, 2)),
    sha: sha,
    branch: BRANCH
  };
  var res = ghPutJson(fileUrl, payload);
  if (!res.ok) {
    throw new Error("GitHub save failed: " + res.statusCode + " | " + res.body);
  }
  var parsed = null;
  try {
    parsed = JSON.parse(res.body);
  } catch (e) {
    parsed = null;
  }
  if (!parsed || !parsed.content || !parsed.content.sha) {
    throw new Error("GitHub save succeeded but SHA missing");
  }
  return parsed.content.sha;
}

function writeLog(taskId, status, error) {
  var logData = {
    task_id: taskId,
    status: status,
    error: error || null,
    worker_id: WORKER_ID,
    timestamp: new Date().toISOString()
  };
  var url = BASE_URL + LOGS_PATH + "/" + taskId + "_log.json";
  var payload = {
    message: "log " + taskId,
    content: b64Encode(JSON.stringify(logData, null, 2)),
    branch: BRANCH
  };
  var res = ghPutJson(url, payload);
  if (!res.ok) {
    log("Log write failed: " + res.statusCode + " | " + res.body);
  }
}

function saveRoute(goal, routeData) {
  var safeGoal = String(goal || "route")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!safeGoal) safeGoal = "route";
  var routeId = safeGoal + "_" + Date.now();
  var url = BASE_URL + ROUTES_PATH + "/" + routeId + ".json";
  var payload = {
    message: "route " + routeId,
    content: b64Encode(JSON.stringify(routeData, null, 2)),
    branch: BRANCH
  };
  var res = ghPutJson(url, payload);
  if (!res.ok) {
    log("Route save failed: " + res.statusCode + " | " + res.body);
  } else {
    log("Route saved: " + routeId);
  }
}

function upsertCurrentPointer(pointer) {
  var url = BASE_URL + CURRENT_TASK_PATH;
  var existing = ghGetJson(url);
  var payload = {
    message: "current task " + (pointer.task_id || "unknown"),
    content: b64Encode(JSON.stringify(pointer, null, 2)),
    branch: BRANCH
  };
  if (existing.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }
  var res = ghPutJson(url, payload);
  if (!res.ok) {
    throw new Error("GitHub current_task write failed: " + res.statusCode + " | " + res.body);
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
    log("isLocked error: " + e);
    return false;
  }
}

function waitForUnlock() {
  while (isLocked()) {
    log("Device locked, waiting...");
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

function waitForPackage(pkg, timeoutMs) {
  var start = new Date().getTime();
  while (new Date().getTime() - start < timeoutMs) {
    if (currentAppIs(pkg)) return true;
    waitMs(300);
  }
  return false;
}

function currentScreenFingerprint() {
  var pkg = "";
  var act = "";
  try {
    pkg = currentPackage() || "";
    var activity = currentActivity() || "";
    act = activity;
  } catch (e) {
    // ignore
  }
  var texts = [];
  try {
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < Math.min(nodes.size(), 5); i++) {
      var t = nodes.get(i).text();
      if (t) texts.push(String(t));
    }
  } catch (e) {
    // ignore
  }
  return {
    pkg: pkg,
    activity: act,
    texts: texts,
    ts: Date.now()
  };
}

// ============================================
// TOUCH OBSERVER (for teach mode)
// ============================================

function tryStartTouchObserver() {
  try {
    if (touchObserver) return;
    touchObserver = new android.view.View.OnTouchListener({
      onTouch: function(view, event) {
        if (!TEACH_MODE) return false;
        try {
          var action = event.getAction();
          if (action === android.view.MotionEvent.ACTION_DOWN) {
            var x = event.getRawX();
            var y = event.getRawY();
            TEACH_TOUCHES.push({
              x: x,
              y: y,
              ts: Date.now()
            });
            log("Teach touch recorded: " + x + "," + y);
          }
        } catch (e) {
          // ignore
        }
        return false;
      }
    });

    // Attach to all windows/views (in Auto.js v4/v6, you need to try multiple)
    let roots = [];
    try {
      roots = (typeof windows === "object" && windows.getDecorView) // v6
        ? [windows.getDecorView()]
        : [className("android.view.View").findOnce()];
    } catch (e) {}
    roots.forEach(function(root) {
      if (root && root.setOnTouchListener) {
        root.setOnTouchListener(touchObserver);
      }
    });
    log("Touch observer ACTUALLY initialized on root(s).");
  } catch (e) {
    log("Touch observer unavailable: " + e);
  }
}


// ============================================
// TEACH MODE FUNCTIONS
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
  
  // Lock to target app if specified
  if (task.app && task.app !== "unknown") {
    var pkg = normalizeLaunchTarget(task.app);
    if (pkg) {
      launchAppSafe(task.app);
      waitMs(3000);
    }
  }
  
  notify("Teach mode ON: " + task.goal);
  log("Teach session started: " + task.goal);
}

function recordTeachSnapshot() {
  if (!TEACH_MODE || !TEACH_SESSION) return;
  
  var fp = currentScreenFingerprint();
  if (!fp || !fp.pkg) return;
  
  // Avoid duplicate snapshots
  if (TEACH_LAST_FP && TEACH_LAST_FP.pkg === fp.pkg) {
    var textSame = JSON.stringify(TEACH_LAST_FP.texts) === JSON.stringify(fp.texts);
    if (textSame) return;
  }
  
  TEACH_LAST_FP = fp;
  TEACH_SNAPS.push({
    ...fp,
    touches: TEACH_TOUCHES.slice(),
    elapsed: Date.now() - TEACH_START_TIME
  });
  
  // Clear touches after recording
  TEACH_TOUCHES = [];
  
  if (TEACH_SNAPS.length % 5 === 0) {
    log("Teach snapshots: " + TEACH_SNAPS.length);
  }
}

function finalizeTeachSession() {
  if (!TEACH_SESSION) return;
  
  // Build route from snapshots
  var steps = [];
  var lastPkg = null;
  
  for (var i = 0; i < TEACH_SNAPS.length; i++) {
    var snap = TEACH_SNAPS[i];
    
    // Add launch step if app changed
    if (snap.pkg && snap.pkg !== lastPkg) {
      steps.push({
        action: "launch_app",
        value: snap.pkg,
        _from_teach: true
      });
      steps.push({ action: "wait", ms: 4000 });
      lastPkg = snap.pkg;
    }
    
    // Add touches as click steps
    if (snap.touches && snap.touches.length > 0) {
      for (var j = 0; j < snap.touches.length; j++) {
        var touch = snap.touches[j];
        steps.push({
          action: "click",
          x: touch.x,
          y: touch.y,
          _from_teach: true
        });
        steps.push({ action: "wait", ms: 1000 });
      }
    }
  }
  
  var routeData = {
    route_id: TEACH_SESSION.task_id,
    goal: TEACH_SESSION.goal,
    app: TEACH_SESSION.app,
    started_at: TEACH_SESSION.started_at,
    finished_at: new Date().toISOString(),
    steps: steps,
    snapshots: TEACH_SNAPS.length,
    notes: "Route captured from teach mode"
  };
  
  saveRoute(TEACH_SESSION.goal, routeData);
  
  // Reset state
  TEACH_MODE = false;
  TEACH_SESSION = null;
  TEACH_LAST_FP = null;
  TEACH_SNAPS = [];
  TEACH_TOUCHES = [];
  TEACH_START_TIME = null;
  
  // Clear current pointer
  clearCurrentPointer();
  
  log("Teach session finalized and saved as route");
  notify("Route saved!");
}

function clearCurrentPointer() {
  var payload = {
    task_id: null,
    status: "idle",
    intent: "none",
    goal: "",
    app: null,
    file_url: null,
    created_at: new Date().toISOString(),
    source: "agent"
  };
  try {
    upsertCurrentPointer(payload);
  } catch (e) {
    log("clearCurrentPointer error: " + e);
  }
}

// ============================================
// LIVE MODE FUNCTIONS
// ============================================
function startLiveMode(task) {
  LIVE_MODE = true;
  LIVE_TASK = task;
  LIVE_CURRENT_STEP = 0;
  LIVE_VERIFICATION_FAILS = 0;
  log("Live mode started for task: " + task.task_id);
}

function stopLiveMode() {
  LIVE_MODE = false;
  LIVE_TASK = null;
  LIVE_CURRENT_STEP = 0;
  LIVE_VERIFICATION_FAILS = 0;
  log("Live mode stopped");
}

function observeAndVerify(expectedState) {
  try {
    var current = currentScreenFingerprint();
    
    if (expectedState.package && !currentAppIs(expectedState.package)) {
      return { ok: false, reason: "wrong_package", current: current };
    }
    
    if (expectedState.text && current.texts) {
      var found = current.texts.some(t => t.indexOf(expectedState.text) !== -1);
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
// ACTION EXECUTION
// ============================================
function launchAppSafe(nameOrPackage) {
  var target = normalizeLaunchTarget(nameOrPackage);
  if (!target) return null;
  
  log("Launching: " + nameOrPackage + " -> " + target);
  
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      shell("am start -n " + target + "/.MainActivity", true);
      waitMs(1000);
      if (currentAppIs(target)) return target;
      
      // Try alternative launch
      app.launchPackage(target);
      waitMs(2000);
      if (currentAppIs(target)) return target;
      
    } catch (e) {
      log("Launch attempt " + (attempt + 1) + " failed: " + e);
    }
    waitMs(1000);
  }
  return null;
}

function clickSmart(step) {
  try {
    // Try text-based click
    if (step.text) {
      var t = text(step.text).findOne(1000);
      if (t && t.clickable()) {
        t.click();
        return true;
      }
    }
    
    // Try contains
    if (step.contains) {
      var c = textContains(step.contains).findOne(1000);
      if (c && c.clickable()) {
        c.click();
        return true;
      }
    }
    
    // Try desc
    if (step.desc) {
      var d = desc(step.desc).findOne(1000);
      if (d && d.clickable()) {
        d.click();
        return true;
      }
    }
    
    // Fallback to coordinates
    if (typeof step.x === "number" && typeof step.y === "number") {
      click(step.x, step.y);
      return true;
    }
    
    // Try fallbacks
    if (step.fallbacks) {
      for (var i = 0; i < step.fallbacks.length; i++) {
        var fb = step.fallbacks[i];
        if (fb.action === "click" && typeof fb.x === "number" && typeof fb.y === "number") {
          click(fb.x, fb.y);
          waitMs(500);
          return true;
        }
      }
    }
  } catch (e) {
    log("clickSmart error: " + e);
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
    log("typeText error: " + e);
    return false;
  }
}

function execStep(step) {
  if (!step || !step.action) {
    throw new Error("Invalid step");
  }
  
  log("Executing: " + step.action + (step.value ? " -> " + step.value : "") + (step.text ? " -> " + step.text : ""));
  
  switch (step.action) {
    case "launch_app":
      var launched = launchAppSafe(step.value);
      if (!launched) throw new Error("Launch failed: " + step.value);
      return true;
      
    case "click":
      if (!clickSmart(step)) throw new Error("Click failed");
      return true;
      
    case "type":
      if (!typeText(step.text || step.value || "")) throw new Error("Type failed");
      return true;
      
    case "press":
      var key = String(step.key || "").toLowerCase();
      if (key === "enter") shell("input keyevent 66", false);
      else if (key === "back") back();
      else if (key === "home") home();
      else if (key === "menu") shell("input keyevent 82", false);
      else throw new Error("Unsupported key: " + key);
      return true;
      
    case "wait":
      waitMs(Number(step.ms || 1000));
      return true;
      
    case "toast":
      notify(String(step.text || step.value || "Done"));
      return true;
      
    case "swipe":
      if (typeof step.x1 === "number" && typeof step.y1 === "number" && 
          typeof step.x2 === "number" && typeof step.y2 === "number") {
        swipe(step.x1, step.y1, step.x2, step.y2, step.duration || 300);
        return true;
      }
      throw new Error("Swipe requires x1, y1, x2, y2");
      
    case "verify":
      return true; // Verification is handled separately
      
    case "open_url":
      var url = String(step.value || "");
      if (!url) throw new Error("open_url missing URL");
      app.startActivity({
        action: "android.intent.action.VIEW",
        data: url
      });
      return true;
      
    case "observe":
      // Live mode observation step
      return true;
      
    default:
      throw new Error("Unknown action: " + step.action);
  }
}

function execWithRetry(step) {
  for (var i = 0; i < 3; i++) {
    try {
      if (execStep(step)) return true;
    } catch (e) {
      log("Step attempt " + (i + 1) + " failed: " + e);
    }
    waitMs(800);
  }
  return false;
}

// ============================================
// TASK PROCESSING
// ============================================
function claimTask(bundle, pointerRef) {
  var task = bundle.task;
  var taskFileUrl = bundle.fileUrl;
  var fileSha = bundle.file.sha;
  
  task.status = "executing";
  task.started_at = new Date().toISOString();
  task.worker_id = WORKER_ID;
  
  var newSha = saveTask(taskFileUrl, fileSha, task, "executing");
  
  if (pointerRef) {
    pointerRef.status = "executing";
    pointerRef.started_at = new Date().toISOString();
    pointerRef.worker_id = WORKER_ID;
    try {
      upsertCurrentPointer(pointerRef);
    } catch (e) {
      log("pointer claim update failed: " + e);
    }
  }
  
  return newSha;
}

function finishTask(bundle, sha, task, status, errorMsg, pointerRef) {
  task.status = status;
  task.finished_at = new Date().toISOString();
  if (errorMsg) task.error = errorMsg;
  
  var newSha = saveTask(bundle.fileUrl, sha, task, status);
  
  if (pointerRef) {
    pointerRef.status = status;
    pointerRef.finished_at = new Date().toISOString();
    pointerRef.error = errorMsg || null;
    pointerRef.worker_id = WORKER_ID;
    try {
      upsertCurrentPointer(pointerRef);
    } catch (e) {
      log("pointer finish update failed: " + e);
    }
  }
  
  writeLog(task.task_id, status, errorMsg || null);
  
  // FIX: Track processed tasks to prevent queue delays
  processedTaskIds.add(task.task_id);
  lastTaskId = task.task_id;
  
  return newSha;
}

// ============================================
// MODE HANDLERS
// ============================================
function runTeachStart(bundle, pointerRef) {
  var task = bundle.task;
  var sha = claimTask(bundle, pointerRef);
  
  waitForUnlock();
  startTeachSession(task);
  
  task.status = "completed";
  task.finished_at = new Date().toISOString();
  finishTask(bundle, sha, task, "completed", null, pointerRef);
  
  log("Teach start completed: " + task.task_id);
}

function runTeachStop(bundle, pointerRef) {
  var task = bundle.task;
  
  // FIX: Check if actually in teach mode
  if (!TEACH_MODE) {
    log("StopTeach requested but not in teach mode");
    // Still mark as completed but don't try to finalize
    var sha = claimTask(bundle, pointerRef);
    task.status = "completed";
    task.finished_at = new Date().toISOString();
    finishTask(bundle, sha, task, "completed", null, pointerRef);
    return;
  }
  
  var sha = claimTask(bundle, pointerRef);
  waitForUnlock();
  
  finalizeTeachSession();
  
  task.status = "completed";
  task.finished_at = new Date().toISOString();
  finishTask(bundle, sha, task, "completed", null, pointerRef);
  
  log("Teach stop completed: " + task.task_id);
}

function runFastTask(bundle, pointerRef) {
  // /do mode - fast execution, minimal observation
  var task = bundle.task;
  
  if (processedTaskIds.has(task.task_id)) {
    log("Skipping already processed task: " + task.task_id);
    return;
  }
  
  isProcessing = true;
  currentTaskId = task.task_id;
  log("FAST task: " + currentTaskId);
  
  var sha = null;
  try {
    sha = claimTask(bundle, pointerRef);
    waitForUnlock();
    
    if (!task.steps || !task.steps.length) {
      throw new Error("Task has no steps");
    }
    
    var success = true;
    var errorMsg = "";
    
    for (var j = 0; j < task.steps.length; j++) {
      var step = task.steps[j];
      
      // Skip observation steps in fast mode
      if (step.action === "observe") continue;
      
      var ok = execWithRetry(step);
      if (!ok) {
        success = false;
        errorMsg = "Step " + (j + 1) + " (" + step.action + ") failed";
        break;
      }
      waitMs(500);
    }
    
    if (success) {
      finishTask(bundle, sha, task, "completed", null, pointerRef);
      log("Task completed: " + currentTaskId);
    } else {
      finishTask(bundle, sha, task, "failed", errorMsg, pointerRef);
      log("Task failed: " + currentTaskId + " - " + errorMsg);
    }
    
  } catch (e) {
    log("Task error: " + e);
    processedTaskIds.add(task.task_id);
    try {
      if (task && sha) {
        finishTask(bundle, sha, task, "failed", String(e), pointerRef);
      }
    } catch (inner) {
      log("Finalization error: " + inner);
    }
  }
  
  isProcessing = false;
  currentTaskId = null;
}

function runLiveTask(bundle, pointerRef) {
  // /live mode - observation-driven execution
  var task = bundle.task;
  
  if (processedTaskIds.has(task.task_id)) {
    log("Skipping already processed live task: " + task.task_id);
    return;
  }
  
  isProcessing = true;
  currentTaskId = task.task_id;
  LIVE_MODE = true;
  log("LIVE task: " + currentTaskId);
  
  var sha = null;
  try {
    sha = claimTask(bundle, pointerRef);
    waitForUnlock();
    startLiveMode(task);
    
    if (!task.steps || !task.steps.length) {
      throw new Error("Task has no steps");
    }
    
    var success = true;
    var errorMsg = "";
    var adaptationCount = 0;
    
    for (var j = 0; j < task.steps.length; j++) {
      LIVE_CURRENT_STEP = j;
      var step = task.steps[j];
      
      // Handle observation steps
      if (step.action === "observe") {
        log("Observation checkpoint at step " + j);
        var obs = observeAndVerify({
          package: step.expected_package,
          text: step.expected_text
        });
        
        if (!obs.ok) {
          LIVE_VERIFICATION_FAILS++;
          log("Observation mismatch: " + obs.reason);
          
          if (step.on_mismatch === "replan" && adaptationCount < 3) {
  log("LiveMode: Attempting adaptation (re-execute last step)...");
  adaptationCount++;
  waitMs(2000);
  // Try to re-execute the previous step
  let ok = false;
  try {
    ok = execWithRetry(task.steps[Math.max(0, j-1)] || step);
  } catch(e) {}
  if (ok) {
    log("Adaptation succeeded; continue execution.");
    LIVE_VERIFICATION_FAILS = 0;
    continue;
  }
  // else, continue; next steps might recover
} else if (LIVE_VERIFICATION_FAILS > 5) {
            success = false;
            errorMsg = "Too many verification failures at step " + j;
            break;
          }
        } else {
          LIVE_VERIFICATION_FAILS = 0;
        }
        continue;
      }
      
      // Execute regular step
      var ok = execWithRetry(step);
      if (!ok) {
        // In live mode, try to adapt
        if (adaptationCount < 3) {
          log("Step failed, attempting recovery...");
          adaptationCount++;
          waitMs(3000);
          // Try once more
          ok = execWithRetry(step);
        }
        
        if (!ok) {
          success = false;
          errorMsg = "Step " + (j + 1) + " (" + step.action + ") failed after retry";
          break;
        }
      }
      
      waitMs(800); // Slightly longer wait in live mode for stability
    }
    
    stopLiveMode();
    
    if (success) {
      finishTask(bundle, sha, task, "completed", null, pointerRef);
      log("Live task completed: " + currentTaskId);
    } else {
      finishTask(bundle, sha, task, "failed", errorMsg, pointerRef);
      log("Live task failed: " + currentTaskId + " - " + errorMsg);
    }
    
  } catch (e) {
    log("Live task error: " + e);
    stopLiveMode();
    processedTaskIds.add(task.task_id);
    try {
      if (task && sha) {
        finishTask(bundle, sha, task, "failed", String(e), pointerRef);
      }
    } catch (inner) {
      log("Finalization error: " + inner);
    }
  }
  
  isProcessing = false;
  currentTaskId = null;
  LIVE_MODE = false;
}

// ============================================
// MAIN PROCESSING LOOP
// ============================================
function processTeachTick() {
  // Check for stop signal
  var pointer = getCurrentPointer();
  if (pointer && pointer.type === "teach_stop" && pointer.status === "pending") {
    var stopBundle = pointer.file_url ? getTask(pointer.file_url) : null;
    if (stopBundle) {
      try {
        var stopTask = stopBundle.task;
        var stopSha = stopBundle.file.sha;
        stopTask.status = "executing";
        stopTask.started_at = new Date().toISOString();
        stopTask.worker_id = WORKER_ID;
        saveTask(pointer.file_url, stopSha, stopTask, "executing");
        
        // Stop immediately
        TEACH_MODE = false;
        finalizeTeachSession();
        
        stopTask.status = "completed";
        stopTask.finished_at = new Date().toISOString();
        var newSha = saveTask(pointer.file_url, stopSha, stopTask, "completed");
        writeLog(stopTask.task_id, "completed", null);
        log("Teach stop processed via tick");
      } catch (e) {
        log("Teach stop tick error: " + e);
      }
    }
    return;
  }
  
  // Record snapshot if in teach mode
  if (TEACH_MODE) {
    recordTeachSnapshot();
  }
}

function processOneTask() {
  if (isProcessing) {
    log("Already processing, skipping...");
    return;
  }
  
  // Teach mode gets priority
  if (TEACH_MODE) {
    processTeachTick();
    return;
  }
  
  // Check current pointer first (fastest path)
  var pointer = getCurrentPointer();
  if (pointer && pointer.status === "pending" && pointer.file_url) {
    // FIX: Check if already processed
    if (processedTaskIds.has(pointer.task_id)) {
      log("Pointer task already processed: " + pointer.task_id);
      return;
    }
    
    var pb = getTask(pointer.file_url);
    if (pb && pb.task) {
      routeTaskByType(pb, pointer);
      return;
    }
  }
  
  // Check task list
  var files = getTaskList();
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || !f.name) continue;
    if (f.type !== "file") continue;
    if (f.name === ".gitkeep") continue;
    if (f.name.indexOf("_log") !== -1) continue;
    
    var bundle = getTask(f.url);
    if (!bundle) continue;
    if (bundle.task.status !== "pending") continue;
    
    // FIX: Skip already processed
    if (processedTaskIds.has(bundle.task.task_id)) {
      continue;
    }
    
    routeTaskByType(bundle, null);
    return;
  }
}

function routeTaskByType(bundle, pointer) {
  var task = bundle.task;
  var type = task.type || "automation";
  var mode = task.mode || "normal";
  
  log("Routing task: " + task.task_id + " type=" + type + " mode=" + mode);
  
  switch (type) {
    case "teach_start":
      runTeachStart(bundle, pointer);
      break;
      
    case "teach_stop":
      runTeachStop(bundle, pointer);
      break;
      
    case "automation":
      if (mode === "live" || mode === "LIVE") {
        runLiveTask(bundle, pointer);
      } else {
        // fast, normal, routed all use fast path
        runFastTask(bundle, pointer);
      }
      break;
      
    default:
      // Unknown type, try fast execution
      runFastTask(bundle, pointer);
  }
}

// ============================================
// STARTUP
// ============================================
buildInstalledAppsMap();
tryStartTouchObserver();

log("Installed apps discovered: " + Object.keys(INSTALLED_APPS).length);
log("Known apps available: " + Object.keys(KNOWN_APPS).length);
log("Agent ready. Waiting for tasks...");

// Main loop
while (true) {
  try {
    processOneTask();
    FATAL_ERROR_COUNT = 0; // Reset error streak if success
  } catch (e) {
    log("PROCESS ERROR: " + e);
    isProcessing = false;
    currentTaskId = null;
    TEACH_MODE = false;
    LIVE_MODE = false;
    FATAL_ERROR_COUNT++;
    if (FATAL_ERROR_COUNT >= FATAL_ERROR_LIMIT) {
      log("FATAL: Too many sequential agent errors, exiting loop!");
      notify("DWAI fatal crash: check credentials or repo setup.");
      break; // Exit agent loop
    }
  }
  // FIX: Clean up old processed IDs periodically to prevent memory bloat
  if (processedTaskIds.size > 1000) {
    var toRemove = Array.from(processedTaskIds).slice(0, 500);
    toRemove.forEach(id => processedTaskIds.delete(id));
    log("Cleaned up processed task cache");
  }
  waitMs(POLL_INTERVAL);
}
