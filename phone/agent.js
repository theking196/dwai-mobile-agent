// DWAI Mobile Agent v2.4 - COMPLETE (All Features Preserved + New Verification)
// Includes: Original touch recording, teach mode, live mode, routes + New verification fixes

// ============================================
// CONFIGURATION - UPDATE THESE!
// ============================================
var GITHUB_TOKEN = ""; // ← REPLACE WITH YOUR GITHUB TOKEN
var REPO_OWNER = "theking196";            // Your GitHub username
var REPO_NAME = "dwai-mobile-agent";      // Your repo name

// ============================================
// PATHS & CONSTANTS (All Original)
// ============================================
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var ROUTES_PATH = "data/routes";
var PROGRESS_PATH = "data/progress";
var REPORTS_PATH = "data/reports";
var CURRENT_TASK_PATH = "data/current_task.json";
var TASK_QUEUE_PATH = "data/task_queue.json";
// NEW v2.5 FEATURES PATHS
var DEVICE_STATE_PATH = "data/device_state.json";
var APPS_LIST_PATH = "data/installed_apps.json";

var FATAL_ERROR_COUNT = 0;
var FATAL_ERROR_LIMIT = 15;  

var POLL_INTERVAL = 2000;
var BRANCH = "main";
var WORKER_ID = "phone-" + (device.model || "android") + "-" + device.width + "x" + device.height;
var BASE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/";

console.log("=== DWAI AGENT v2.0 ROOT-FREE START ===");
toast("DWAI v2.0 (No Root) starting...");

// ============================================
// STATE MANAGEMENT (All Original Variables)
// ============================================
var isProcessing = false;
var currentTaskId = null;
var lastTaskId = null;
var processedTaskIds = new Set();

// Teach mode state (All Original)
var TEACH_MODE = false;
var TEACH_SESSION = null;
var TEACH_LAST_FP = null;
var TEACH_SNAPS = [];
var TEACH_TOUCHES = [];
var TEACH_START_TIME = null;

// Live mode state (All Original)
var LIVE_MODE = false;
var LIVE_CURRENT_STEP = 0;
var LIVE_TASK = null;
var LIVE_VERIFICATION_FAILS = 0;

// Touch observer
var touchObserver = null;

// Current task and trace (New but necessary)
var CURRENT_TASK = null;
var EXECUTION_TRACE = [];
var LAST_SCREEN_STATE = null;

// ============================================
// APP DISCOVERY (All Original)
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
    var appList = [];
    for (var i = 0; i < apps.size(); i++) {
      var app = apps.get(i);
      var pkg = app.packageName;
      var label = "";
      try {
        label = pm.getApplicationLabel(app).toString().toLowerCase();
      } catch (e) {}
      if (label) {
        INSTALLED_APPS[label] = pkg;
        appList.push(label);
      }
      INSTALLED_APPS[pkg] = pkg;
    }
    APP_CACHE_BUILT = true;
    console.log("App cache built: " + Object.keys(INSTALLED_APPS).length);
    
    // FEATURE 3: Report installed apps to GitHub
    try {
      var url = BASE_URL + APPS_LIST_PATH;
      var data = {
        apps: appList,
        packages: Object.keys(INSTALLED_APPS),
        last_updated: Date.now()
      };
      ghPutJson(url, {
        message: "Update installed apps list",
        content: b64Encode(JSON.stringify(data)),
        branch: BRANCH
      });
      console.log("Apps list reported to GitHub");
    } catch (e) {
      log("Failed to report apps: " + e);
    }
  } catch (e) {
    console.log("App discovery failed: " + e);
    APP_CACHE_BUILT = true;
  }
}

// ============================================
// APP RESOLUTION (All Original + Fix)
// ============================================
function resolveApp(appName) {
  if (!appName || appName.length < 2) return null;
  var name = String(appName).toLowerCase().trim();
  
  // 1. Exact match first
  if (KNOWN_APPS[name]) return KNOWN_APPS[name];
  if (INSTALLED_APPS[name]) return INSTALLED_APPS[name];
  
  // 2. Strict start-of-word match
  for (var key in KNOWN_APPS) {
    if (key.indexOf(name) === 0 || name.indexOf(key) === 0) {
      return KNOWN_APPS[key];
    }
  }
  for (var k in INSTALLED_APPS) {
    if (k.indexOf(name) === 0 || name.indexOf(k) === 0) {
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
// UTILITIES (All Original)
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
// HTTP HELPERS (All Original)
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
// PROGRESS REPORTING (New Feature)
// ============================================
function reportProgress(stepNum, totalSteps, status, details, error) {
  if (!CURRENT_TASK) return;
  
  // Add to execution trace for final report
  if (CURRENT_TASK.steps && CURRENT_TASK.steps[stepNum - 1]) {
    EXECUTION_TRACE.push({
      step: stepNum,
      action: CURRENT_TASK.steps[stepNum - 1].action || 'unknown',
      status: status,
      details: details,
      error: error || null,
      timestamp: new Date().toISOString()
    });
  }
  
  var data = {
    task_id: CURRENT_TASK.task_id,
    step_number: stepNum,
    total_steps: totalSteps,
    status: status, // 'running', 'verifying', 'completed', 'failed'
    details: details,
    error: error || null,
    app_context: getCurrentPackage(),
    timestamp: new Date().toISOString()
  };
  
  var url = BASE_URL + PROGRESS_PATH + "/" + CURRENT_TASK.task_id + "_progress.json";
  ghPutJson(url, {
    message: "Step " + stepNum + "/" + totalSteps + " " + status,
    content: b64Encode(JSON.stringify(data, null, 2)),
    branch: BRANCH
  });
  
  log("[" + stepNum + "/" + totalSteps + "] " + status + ": " + details + (error ? " ERROR: " + error : ""));

// Submit final report to server
function submitFinalReport(task, status, errorMsg) {
  if (!task || !task.task_id) return;
  
  // Generate trace summary
  var traceSummary = EXECUTION_TRACE.map(function(t) {
    return {
      step: t.step,
      action: t.action,
      status: t.status,
      error: t.error || null,
      timestamp: t.timestamp
    };
  });
  
  // Save to GitHub as backup
  var ghUrl = BASE_URL + "data/reports/" + task.task_id + "_report.json";
  var reportData = {
    task_id: task.task_id,
    status: status,
    execution_trace: traceSummary,
    error: errorMsg || null,
    device: WORKER_ID,
    finished_at: new Date().toISOString()
  };
  
  var payload = {
    message: "Final report " + task.task_id,
    content: b64Encode(JSON.stringify(reportData, null, 2)),
    branch: BRANCH
  };
  
  var res = ghPutJson(ghUrl, payload);
  if (!res.ok) {
    log("Final report save failed: " + res.statusCode);
  } else {
    log("Final report saved to GitHub");
  }
}

}

// ============================================
// DEVICE STATE & VERIFICATION (Enhanced)
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

function getCurrentPackage() {
  try {
    return currentPackage() || "";
  } catch (e) {
    return "";
  }
}

// FEATURE 4: Context Awareness - Get current device context and report to GitHub
function getCurrentContext() {
  var context = {
    current_app: null,
    screen_text: "",
    last_action: null,
    timestamp: Date.now(),
    package: null
  };
  
  try {
    // Get current foreground app
    var am = context.getSystemService(context.ACTIVITY_SERVICE);
    var tasks = am.getRunningTasks(1);
    if (tasks && tasks.size() > 0) {
      var top = tasks.get(0);
      context.package = top.topActivity ? top.topActivity.getPackageName() : null;
      context.current_app = context.package;
    }
  } catch (e) {
    // Permission issues common - fallback
  }
  
  // Get screen text content
  try {
    var nodes = className("android.widget.TextView").find();
    var textContent = [];
    for (var i = 0; i < Math.min(nodes.size(), 10); i++) {
      var t = nodes.get(i).text();
      if (t) textContent.push(String(t));
    }
    context.screen_text = textContent.join(" | ");
  } catch (e) {}
  
  // Save to GitHub for backend to read (FEATURE 4)
  try {
    var url = BASE_URL + DEVICE_STATE_PATH;
    ghPutJson(url, {
      message: "Update device state",
      content: b64Encode(JSON.stringify(context)),
      branch: BRANCH
    });
  } catch (e) {
    log("Context upload failed: " + e);
  }
  
  return context;
}

function currentScreenFingerprint() {
  var pkg = "";
  var act = "";
  try {
    pkg = currentPackage() || "";
    var activity = currentActivity() || "";
    act = activity;
  } catch (e) {}
  var texts = [];
  var clickable = [];
  try {
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < Math.min(nodes.size(), 8); i++) {
      var t = nodes.get(i).text();
      if (t) texts.push(String(t));
    }
    
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

// Verification functions (New)
function verifyAppContext(expectedPackage) {
  var current = getCurrentPackage();
  if (!expectedPackage) return { ok: true, current: current };
  
  var match = (current === expectedPackage) || 
              current.includes(expectedPackage.split('.').pop()) ||
              expectedPackage.includes(current.split('.').pop());
              
  return {
    ok: match,
    current: current,
    expected: expectedPackage,
    mismatch: match ? null : "Expected " + expectedPackage + ", but in " + current
  };
}

function verifyScreenChanged(beforeTexts, threshold) {
  if (!beforeTexts || beforeTexts.length === 0) return { changed: true };
  
  var after = currentScreenFingerprint();
  var matches = 0;
  for (var i = 0; i < Math.min(beforeTexts.length, after.texts.length); i++) {
    if (beforeTexts[i] === after.texts[i]) matches++;
  }
  
  var similarity = matches / Math.max(beforeTexts.length, after.texts.length);
  return { changed: similarity < (threshold || 0.7), similarity: similarity };
}

function verifyTextAppears(targetText) {
  if (!targetText) return { found: false };
  var fp = currentScreenFingerprint();
  var found = fp.texts.some(function(t) {
    return t.toLowerCase().includes(targetText.toLowerCase().substring(0, 10));
  });
  return { found: found };
}

function verifyElementExists(selector) {
  try {
    var node = null;
    if (selector.id) node = id(selector.id).findOnce();
    else if (selector.text) node = text(selector.text).findOnce();
    else if (selector.contains) node = textContains(selector.contains).findOnce();
    else if (selector.desc) node = desc(selector.desc).findOnce();
    
    if (node && node.exists()) {
      var bounds = node.bounds();
      return {
        exists: true,
        x: bounds.centerX(),
        y: bounds.centerY(),
        text: node.text() || node.desc() || "element"
      };
    }
  } catch (e) {}
  return { exists: false };
}

// ============================================
// TOUCH OBSERVER (All Original - Preserved)
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
        } catch (e) {}
        return false;
      }
    });

    var roots = [];
    try {
      roots = (typeof windows === "object" && windows.getDecorView)
        ? [windows.getDecorView()]
        : [className("android.view.View").findOnce()];
    } catch (e) {}
    roots.forEach(function(root) {
      if (root && root.setOnTouchListener) {
        root.setOnTouchListener(touchObserver);
      }
    });
    log("Touch observer initialized.");
  } catch (e) {
    log("Touch observer unavailable: " + e);
  }
}

// ============================================
// TEACH MODE FUNCTIONS (All Original - Preserved)
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
      app.launchPackage(pkg);
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
  
  if (TEACH_SNAPS.length % 5 === 0) {
    log("Teach snapshots: " + TEACH_SNAPS.length);
  }
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
      steps.push({ action: "wait", ms: 4000 });
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
  
  // Save route
  var url = BASE_URL + ROUTES_PATH + "/" + TEACH_SESSION.task_id + ".json";
  var payload = {
    message: "route " + TEACH_SESSION.task_id,
    content: b64Encode(JSON.stringify(routeData, null, 2)),
    branch: BRANCH
  };
  ghPutJson(url, payload);
  
  TEACH_MODE = false;
  TEACH_SESSION = null;
  TEACH_LAST_FP = null;
  TEACH_SNAPS = [];
  TEACH_TOUCHES = [];
  TEACH_START_TIME = null;
  
  // Clear current pointer
  var clearPayload = {
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
    var currUrl = BASE_URL + CURRENT_TASK_PATH;
    var currRes = ghGetJson(currUrl);
    if (currRes.ok && currRes.json && currRes.json.sha) {
      // Update with SHA
    }
  } catch (e) {}
  
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
    var url = BASE_URL + CURRENT_TASK_PATH;
    var existing = ghGetJson(url);
    var putPayload = {
      message: "clear task",
      content: b64Encode(JSON.stringify(payload, null, 2)),
      branch: BRANCH
    };
    if (existing.ok && existing.json && existing.json.sha) {
      putPayload.sha = existing.json.sha;
    }
    ghPutJson(url, putPayload);
  } catch (e) {
    log("clearCurrentPointer error: " + e);
  }
}

// ============================================
// LIVE MODE FUNCTIONS (All Original - Preserved)
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
      var found = current.texts.some(function(t) { return t.indexOf(expectedState.text) !== -1; });
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
// ACTION EXECUTION WITH VERIFICATION (Enhanced)
// ============================================

function launchAppSafe(nameOrPackage, verify) {
  var target = normalizeLaunchTarget(nameOrPackage);
  if (!target) {
    log("App not resolvable: " + nameOrPackage);
    return null;
  }
  
  log("Launching (no root): " + nameOrPackage + " -> " + target);
  
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      app.launchPackage(target);
      waitMs(2000 + (attempt * 1000));
      
      if (currentAppIs(target)) {
        log("Launch success: " + target);
        return target;
      }
      
      try {
        app.startActivity({
          packageName: target,
          action: "android.intent.action.MAIN",
          category: "android.intent.category.LAUNCHER"
        });
        waitMs(2000);
        
        if (currentAppIs(target)) {
          log("Launch success via intent: " + target);
          return target;
        }
      } catch (intentErr) {
        log("Intent launch failed: " + intentErr);
      }
      
    } catch (e) {
      log("Launch attempt " + (attempt + 1) + " error: " + e);
    }
    waitMs(1000);
  }
  
  log("All launch attempts failed for: " + target);
  return null;
}

function clickSmart(step, stepNum, totalSteps) {
  // Get screen before for change detection
  var beforeFp = currentScreenFingerprint();
  
  try {
    // Try ID first (Chrome fix)
    if (step.id) {
      var byId = verifyElementExists({ id: step.id });
      if (byId.exists) {
        log("Clicking by ID: " + step.id + " at " + byId.x + "," + byId.y);
        click(byId.x, byId.y);
        
        if (step.verify_change) {
          waitMs(500);
          var change = verifyScreenChanged(beforeFp.texts);
          if (!change.changed) log("Warning: Screen unchanged after ID click");
        }
        return { success: true, method: 'id' };
      }
    }
    
    // Try text-based
    if (step.text) {
      var t = text(step.text).findOne(1000);
      if (t && t.clickable()) {
        t.click();
        if (step.verify_change) {
          waitMs(500);
          verifyScreenChanged(beforeFp.texts);
        }
        return { success: true, method: 'text' };
      }
    }
    
    if (step.contains) {
      var c = textContains(step.contains).findOne(1000);
      if (c && t.clickable()) {
        c.click();
        return { success: true, method: 'contains' };
      }
    }
    
    if (step.desc) {
      var d = desc(step.desc).findOne(1000);
      if (d && d.clickable()) {
        d.click();
        return { success: true, method: 'desc' };
      }
    }
    
    // Coordinates fallback
    if (typeof step.x === "number" && typeof step.y === "number") {
      click(step.x, step.y);
      return { success: true, method: 'coordinates' };
    }
    
    // Fallbacks from step definition
    if (step.fallbacks) {
      for (var i = 0; i < step.fallbacks.length; i++) {
        var fb = step.fallbacks[i];
        if (fb.action === 'click' && typeof fb.x === 'number' && typeof fb.y === 'number') {
          click(fb.x, fb.y);
          waitMs(500);
          return { success: true, method: 'fallback_coords' };
        }
      }
    }
  } catch (e) {
    log("clickSmart error: " + e);
  }
  return { success: false };
}

function typeText(value, verifyApp) {
  try {
    var t = String(value || "");
    if (!t) return false;
    
    // CRITICAL: Verify app context before typing
    if (verifyApp && CURRENT_TASK && CURRENT_TASK.target_app) {
      var ctx = verifyAppContext(CURRENT_TASK.target_app);
      if (!ctx.ok) {
        throw new Error("TYPE BLOCKED: In " + ctx.current + ", expected " + ctx.expected);
      }
    }
    
    setClip(t);
    waitMs(300);
    
    // Try paste first
    try {
      var focus = focusable(true).findOne(1000);
      if (focus && focus.paste) {
        focus.paste();
        return true;
      }
    } catch (e) {}
    
    // Fallback to input
    input(t);
    return true;
  } catch (e) {
    log("typeText error: " + e);
    throw e;
  }
}

function execStep(step, stepNum, totalSteps) {
  if (!step || !step.action) {
    throw new Error("Invalid step");
  }
  
  log("Executing: " + step.action + (step.value ? " -> " + step.value : "") + (step.text ? " -> " + step.text : ""));
  
  // Report progress
  reportProgress(stepNum, totalSteps, "running", "Starting: " + (step.description || step.action));
  
  switch (step.action) {
    case "launch_app":
      reportProgress(stepNum, totalSteps, "running", "Launching " + step.value);
      var launched = launchAppSafe(step.value, step.verify);
      if (!launched) throw new Error("Launch failed: " + step.value);
      
      // Verify
      if (step.verify) {
        reportProgress(stepNum, totalSteps, "verifying", "Checking app opened...");
        var verify = verifyAppContext(step.target_package || launched);
        if (!verify.ok) throw new Error("Launch verification failed: " + verify.mismatch);
      }
      
      reportProgress(stepNum, totalSteps, "completed", "App opened: " + launched);
      return true;
      
    case "click":
      var clickResult = clickSmart(step, stepNum, totalSteps);
      if (!clickResult.success) throw new Error("Click failed");
      reportProgress(stepNum, totalSteps, "completed", "Clicked via " + clickResult.method);
      return true;
      
    case "type":
      reportProgress(stepNum, totalSteps, "running", "Typing: " + (step.text || "").substring(0, 20));
      if (!typeText(step.text || step.value || "", step.verify_app_before_type !== false)) {
        throw new Error("Type failed");
      }
      if (step.verify_appears) {
        waitMs(500);
        var appears = verifyTextAppears(step.text);
        if (!appears.found) log("Warning: Typed text not visible");
      }
      reportProgress(stepNum, totalSteps, "completed", "Text entered");
      return true;
      
    case "press":
      var key = String(step.key || "").toLowerCase();
      
      if (key === "enter") {
        var enterBtn = text("Go").findOne(300) || 
                      desc("Go").findOne(300) ||
                      text("Search").findOne(300) || 
                      desc("Search").findOne(300);
        if (enterBtn && enterBtn.clickable()) {
          enterBtn.click();
          log("Pressed enter via button");
        } else {
          var screenW = device.width;
          var screenH = device.height;
          click(screenW - 100, screenH - 150);
          log("Pressed enter via screen click");
        }
        waitMs(500);
        reportProgress(stepNum, totalSteps, "completed", "Pressed Enter");
        return true;
      }
      else if (key === "back") {
        back();
        reportProgress(stepNum, totalSteps, "completed", "Pressed Back");
        return true;
      }
      else if (key === "home") {
        home();
        reportProgress(stepNum, totalSteps, "completed", "Pressed Home");
        return true;
      }
      else if (key === "menu") {
        var menuBtn = desc("More options").findOne(500);
        if (menuBtn && menuBtn.clickable()) {
          menuBtn.click();
        } else {
          back();
        }
        reportProgress(stepNum, totalSteps, "completed", "Pressed Menu");
        return true;
      }
      else {
        throw new Error("Unsupported key: " + key);
      }
      
    case "wait":
      waitMs(Number(step.ms || 1000));
      reportProgress(stepNum, totalSteps, "completed", "Wait complete");
      return true;
      
    case "toast":
      notify(String(step.text || step.value || "Done"));
      reportProgress(stepNum, totalSteps, "completed", "Toast shown");
      return true;
      
    case "swipe":
      if (typeof step.x1 === "number" && typeof step.y1 === "number" && 
          typeof step.x2 === "number" && typeof step.y2 === "number") {
        swipe(step.x1, step.y1, step.x2, step.y2, step.duration || 300);
        reportProgress(stepNum, totalSteps, "completed", "Swipe completed");
        return true;
      }
      throw new Error("Swipe requires x1, y1, x2, y2");
      
    case "verify":
    case "verify_app":
      reportProgress(stepNum, totalSteps, "verifying", "Verifying app context...");
      var v = verifyAppContext(step.package || step.expected_package);
      if (!v.ok) throw new Error("Verification failed: " + v.mismatch);
      reportProgress(stepNum, totalSteps, "completed", "Verified: " + v.current);
      return true;
      
    case "observe":
      if (step.expected_package || step.expected_text) {
        var obs = observeAndVerify({
          package: step.expected_package,
          text: step.expected_text
        });
        if (!obs.ok) {
          log("Observation warning: " + obs.reason);
        }
      }
      reportProgress(stepNum, totalSteps, "completed", "Observation complete");
      return true;
    
    // FEATURE 5: Live Mode Vision - Screenshot
    case "screenshot":
      try {
        var bitmap = context.takeScreenshot();
        if (bitmap) {
          var stream = new java.io.ByteArrayOutputStream();
          bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, stream);
          var bytes = stream.toByteArray();
          var b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
          
          // Upload to GitHub for live viewing
          try {
            var ssUrl = BASE_URL + "data/live_screenshot.jpg";
            ghPutJson(ssUrl, {
              message: "Live screenshot",
              content: b64,
              branch: BRANCH,
              encoding: "base64"
            });
            log("Screenshot captured and uploaded");
          } catch (e) {
            log("Screenshot upload failed: " + e);
          }
        }
      } catch (e) {
        log("Screenshot error: " + e);
      }
      reportProgress(stepNum, totalSteps, "completed", "Screenshot captured");
      return true;
    
    // FEATURE 4: Context Awareness - Get device state
    case "get_context":
      try {
        var ctx = getCurrentContext();
        log("Context: " + JSON.stringify(ctx));
      } catch (e) {
        log("Get context error: " + e);
      }
      reportProgress(stepNum, totalSteps, "completed", "Context retrieved");
      return true;
    
    // FEATURE 2: Open URL
    case "open_url":
      if (step.value) {
        try {
          var intent = new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(step.value));
          context.startActivity(intent);
        } catch (e) {
          throw new Error("Failed to open URL: " + e);
        }
      }
      reportProgress(stepNum, totalSteps, "completed", "URL opened: " + step.value);
      return true;
      
    default:
      throw new Error("Unknown action: " + step.action);
  }
}

function execWithRetry(step, stepNum, totalSteps) {
  for (var i = 0; i < 3; i++) {
    try {
      if (execStep(step, stepNum, totalSteps)) return true;
    } catch (e) {
      log("Step attempt " + (i + 1) + " failed: " + e);
      if (i === 2) throw e;
      waitMs(1000);
    }
  }
  return false;
}

// ============================================
// TASK PROCESSING (Enhanced with Verification)
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
  submitFinalReport(task, status, errorMsg);
  
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
  
  processedTaskIds.add(task.task_id);
  lastTaskId = task.task_id;
  
  return newSha;
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
// MODE HANDLERS (Enhanced)
// ============================================
function runTeachStart(bundle, pointerRef) {
  var task = bundle.task;
  
  log("TEACH START task: " + task.task_id);
  
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
  
  if (!TEACH_MODE) {
    log("StopTeach requested but not in teach mode");
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
  var task = bundle.task;
  
  if (processedTaskIds.has(task.task_id)) {
    log("Skipping already processed task: " + task.task_id);
    return;
  }
  
  // RESET EXECUTION TRACE FOR NEW TASK
  EXECUTION_TRACE = [];
  
  isProcessing = true;
  currentTaskId = task.task_id;
  CURRENT_TASK = task;
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
      
      if (step.action === "observe") continue;
      
      var ok = execWithRetry(step, j + 1, task.steps.length);
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
  CURRENT_TASK = null;
}

function runLiveTask(bundle, pointerRef) {
  var task = bundle.task;
  
  if (processedTaskIds.has(task.task_id)) {
    log("Skipping already processed live task: " + task.task_id);
    return;
  }
  
  // RESET EXECUTION TRACE FOR NEW TASK
  EXECUTION_TRACE = [];
  
  isProcessing = true;
  currentTaskId = task.task_id;
  CURRENT_TASK = task;
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
            var ok = false;
            try {
              ok = execWithRetry(task.steps[Math.max(0, j-1)] || step, j + 1, task.steps.length);
            } catch(e) {}
            if (ok) {
              log("Adaptation succeeded; continue execution.");
              LIVE_VERIFICATION_FAILS = 0;
              continue;
            }
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
      
      var ok = execWithRetry(step, j + 1, task.steps.length);
      if (!ok) {
        if (adaptationCount < 3) {
          log("Step failed, attempting recovery...");
          adaptationCount++;
          waitMs(3000);
          ok = execWithRetry(step, j + 1, task.steps.length);
        }
        
        if (!ok) {
          success = false;
          errorMsg = "Step " + (j + 1) + " (" + step.action + ") failed after retry";
          break;
        }
      }
      
      waitMs(800);
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
  CURRENT_TASK = null;
  LIVE_MODE = false;
}

// ============================================
// MAIN PROCESSING LOOP (Complete with Queue)
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

function processTeachTick() {
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
  
  if (TEACH_MODE) {
    recordTeachSnapshot();
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
        runFastTask(bundle, pointer);
      }
      break;
      
    default:
      runFastTask(bundle, pointer);
  }
}

function processOneTask() {
  if (isProcessing) {
    log("Already processing, skipping...");
    return;
  }
  
  if (TEACH_MODE) {
    processTeachTick();
    return;
  }
  
  // O(1) Queue check first
  var queue = getTaskQueue();
  if (queue.queue && queue.queue.length > 0) {
    var nextTask = queue.queue[0];
    
    if (!processedTaskIds.has(nextTask.task_id)) {
      var taskUrl = BASE_URL + TASKS_PATH + "/" + nextTask.task_id + ".json";
      var bundle = getTask(taskUrl);
      
      if (bundle && bundle.task && bundle.task.status === "pending") {
        // Mark as processing
        queue.processing = {
          task_id: nextTask.task_id,
          started_at: Date.now(),
          worker_id: WORKER_ID
        };
        updateTaskQueue(queue);
        
        routeTaskByType(bundle, null);
        
        // Clear processing
        queue = getTaskQueue();
        queue.processing = null;
        updateTaskQueue(queue);
        return;
      }
    }
  }
  
  // Fallback to old method for compatibility
  var pointer = getCurrentPointer();
  if (pointer && pointer.status === "pending" && pointer.file_url) {
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
    
    if (processedTaskIds.has(bundle.task.task_id)) {
      continue;
    }
    
    routeTaskByType(bundle, null);
    return;
  }
}

// ============================================
// STARTUP
// ============================================
buildInstalledAppsMap();
tryStartTouchObserver();

// FEATURE 4: Initial context update
getCurrentContext();

log("Installed apps discovered: " + Object.keys(INSTALLED_APPS).length);
log("Known apps available: " + Object.keys(KNOWN_APPS).length);
log("Agent ready (v2.5 - Features: Chaining, Routes, AppList, Context, LiveVision). Waiting for tasks...");

// Main loop
while (true) {
  try {
    processOneTask();
    FATAL_ERROR_COUNT = 0;
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
      break;
    }
  }
  
  if (processedTaskIds.size > 1000) {
    var toRemove = Array.from(processedTaskIds).slice(0, 500);
    toRemove.forEach(function(id) { processedTaskIds.delete(id); });
    log("Cleaned up processed task cache");
  }
  
  waitMs(POLL_INTERVAL);
}
