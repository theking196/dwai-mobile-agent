// DWAI Agent v2.4 - COMPLETE with ALL Features
// Original: Touch recording, Teach mode, Live mode, Step verification

var GITHUB_TOKEN = "ghp_YOUR_TOKEN_HERE";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";

var BASE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/";
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var ROUTES_PATH = "data/routes";
var PROGRESS_PATH = "data/progress";
var REPORTS_PATH = "data/reports";
var CURRENT_TASK_PATH = "data/current_task.json";
var TASK_QUEUE_PATH = "data/task_queue.json";
var BRANCH = "main";

var FATAL_ERROR_COUNT = 0;
var FATAL_ERROR_LIMIT = 15;
var POLL_INTERVAL = 2000;
var WORKER_ID = "phone-" + (device.model || "android") + "-" + device.width + "x" + device.height;

console.log("=== DWAI AGENT v2.4 COMPLETE START ===");
toast("DWAI v2.4 (Full Features) starting...");

// ============================================
// STATE MANAGEMENT
// ============================================
var isProcessing = false;
var currentTaskId = null;
var processedTaskIds = new Set();
var CURRENT_TASK = null;
var EXECUTION_TRACE = [];

// Teach mode state (Preserved)
var TEACH_MODE = false;
var TEACH_SESSION = null;
var TEACH_LAST_FP = null;
var TEACH_SNAPS = [];
var TEACH_TOUCHES = [];
var TEACH_START_TIME = null;
var touchObserver = null;

// Live mode state (Preserved)
var LIVE_MODE = false;
var LIVE_CURRENT_STEP = 0;
var LIVE_TASK = null;
var LIVE_VERIFICATION_FAILS = 0;
var LAST_SCREEN_STATE = null;

// App cache
var INSTALLED_APPS = {};
var APP_CACHE_BUILT = false;

// ============================================
// APP REGISTRY (Complete)
// ============================================
var APP_REGISTRY = {
  "youtube": { pkg: "com.google.android.youtube", aliases: ["yt", "you tube"] },
  "chrome": { 
    pkg: "com.android.chrome", 
    aliases: ["browser", "google chrome"],
    selectors: { url_bar: "com.android.chrome:id/url_bar" }
  },
  "edge": { pkg: "com.microsoft.emmx", aliases: ["microsoft edge"] },
  "firefox": { pkg: "org.mozilla.firefox", aliases: ["mozilla"] },
  "whatsapp": { pkg: "com.whatsapp", aliases: ["whatsapp business", "wa"] },
  "telegram": { pkg: "org.telegram.messenger", aliases: ["tg", "tele"] },
  "signal": { pkg: "org.thoughtcrime.securesms", aliases: [] },
  "calculator": { pkg: "com.android.calculator2", aliases: ["calc"] },
  "camera": { pkg: "com.android.camera2", aliases: ["cam"] },
  "photos": { pkg: "com.google.android.apps.photos", aliases: ["gallery", "pics"] },
  "settings": { pkg: "com.android.settings", aliases: ["config"] },
  "phone": { pkg: "com.android.dialer", aliases: ["dialer"] },
  "messages": { pkg: "com.android.mms", aliases: ["sms"] },
  "gmail": { pkg: "com.google.android.gm", aliases: ["email", "mail"] },
  "maps": { pkg: "com.google.android.apps.maps", aliases: ["google maps"] },
  "spotify": { pkg: "com.spotify.music", aliases: ["music"] },
  "facebook": { pkg: "com.facebook.katana", aliases: ["fb"] },
  "instagram": { pkg: "com.instagram.android", aliases: ["insta", "ig"] },
  "twitter": { pkg: "com.twitter.android", aliases: ["x"] },
  "discord": { pkg: "com.discord", aliases: [] },
  "slack": { pkg: "com.Slack", aliases: [] },
  "zoom": { pkg: "us.zoom.videomeetings", aliases: [] }
};

// ============================================
// UTILITIES
// ============================================
function waitMs(ms) { java.lang.Thread.sleep(ms); }

function log(msg) { console.log(new Date().toISOString() + " | " + msg); }

function notify(msg) { toast(msg); }

function b64Encode(text) {
  try {
    return android.util.Base64.encodeToString(
      new java.lang.String(String(text)).getBytes("UTF-8"),
      android.util.Base64.NO_WRAP
    );
  } catch (e) { return ""; }
}

function b64Decode(text) {
  try {
    var clean = String(text || "").replace(/\\n/g, "").replace(/\\r/g, "");
    return new java.lang.String(
      android.util.Base64.decode(clean, android.util.Base64.DEFAULT),
      "UTF-8"
    ).toString();
  } catch (e) { return ""; }
}

// ============================================
// HTTP HELPERS
// ============================================
function readStream(stream) {
  if (!stream) return "";
  try {
    var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream));
    var line, out = "";
    while ((line = reader.readLine()) !== null) out += line;
    reader.close();
    return out;
  } catch (e) { return ""; }
}

function httpRequest(method, url, body) {
  try {
    var conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod(method);
    conn.setConnectTimeout(15000);
    conn.setReadTimeout(15000);
    conn.setRequestProperty("Authorization", "token " + GITHUB_TOKEN);
    conn.setRequestProperty("Accept", "application/vnd.github+json");
    
    if (body) {
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
    return { statusCode: -1, body: String(e) };
  }
}

function ghGetJson(url) {
  var res = httpRequest("GET", url, null);
  try { return { ...res, json: JSON.parse(res.body) }; } catch (e) { return { ...res, json: null }; }
}

function ghPutJson(url, body) {
  return httpRequest("PUT", url, JSON.stringify(body));
}

// ============================================
// QUEUE SYSTEM (O(1))
// ============================================
function getTaskQueue() {
  var url = BASE_URL + TASK_QUEUE_PATH;
  var res = ghGetJson(url);
  if (!res.ok || !res.json || !res.json.content) return { queue: [], processing: null };
  try { return JSON.parse(b64Decode(res.json.content)); } catch (e) { return { queue: [], processing: null }; }
}

function updateTaskQueue(queue) {
  var url = BASE_URL + TASK_QUEUE_PATH;
  var res = ghGetJson(url);
  var payload = {
    message: "queue update",
    content: b64Encode(JSON.stringify(queue, null, 2)),
    branch: BRANCH
  };
  if (res.ok && res.json && res.json.sha) payload.sha = res.json.sha;
  return ghPutJson(url, payload);
}

// ============================================
// PROGRESS REPORTING (New)
// ============================================
function reportProgress(stepNum, totalSteps, status, details, error) {
  if (!CURRENT_TASK) return;
  
  var data = {
    task_id: CURRENT_TASK.task_id,
    step_number: stepNum,
    total_steps: totalSteps,
    status: status,
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
}

// ============================================
// DEVICE STATE & VERIFICATION (Enhanced)
// ============================================
function getCurrentPackage() {
  try { return currentPackage(); } catch (e) { return "unknown"; }
}

function isLocked() {
  try {
    var km = context.getSystemService(context.KEYGUARD_SERVICE);
    return km.isKeyguardLocked();
  } catch (e) { return false; }
}

function waitForUnlock() {
  while (isLocked()) {
    notify("Unlock phone...");
    waitMs(2000);
  }
}

function currentScreenFingerprint() {
  var pkg = "";
  try { pkg = currentPackage(); } catch (e) {}
  
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
  
  return { pkg: pkg, texts: texts, clickable: clickable, ts: Date.now() };
}

// Verification functions
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
      return { exists: true, x: bounds.centerX(), y: bounds.centerY(), text: node.text() || node.desc() || "element" };
    }
  } catch (e) {}
  return { exists: false };
}

// ============================================
// APP RESOLUTION (Strict)
// ============================================
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
      } catch (e) {}
      INSTALLED_APPS[pkg] = pkg;
    }
    APP_CACHE_BUILT = true;
  } catch (e) { APP_CACHE_BUILT = true; }
}

function resolveApp(appName) {
  if (!appName || appName.length < 2) return null;
  var name = String(appName).toLowerCase().trim();
  
  if (APP_REGISTRY[name]) return APP_REGISTRY[name].pkg;
  
  for (var key in APP_REGISTRY) {
    if (key === name || APP_REGISTRY[key].aliases.includes(name)) {
      return APP_REGISTRY[key].pkg;
    }
  }
  
  if (INSTALLED_APPS[name]) return INSTALLED_APPS[name];
  
  if (name.indexOf(".") !== -1) {
    for (var installed in INSTALLED_APPS) {
      if (installed === name) return name;
    }
  }
  
  return null;
}

function normalizeLaunchTarget(value) {
  if (!value) return null;
  var resolved = resolveApp(value);
  if (resolved) return resolved;
  return null;
}

// ============================================
// TOUCH OBSERVER (Teach Mode - Preserved)
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
            TEACH_TOUCHES.push({
              x: event.getRawX(),
              y: event.getRawY(),
              ts: Date.now()
            });
            log("Touch recorded: " + event.getRawX() + "," + event.getRawY());
          }
        } catch (e) {}
        return false;
      }
    });
    log("Touch observer initialized");
  } catch (e) {
    log("Touch observer unavailable: " + e);
  }
}

// ============================================
// STEP EXECUTORS WITH VERIFICATION
// ============================================
function executeLaunchApp(step, stepNum, totalSteps) {
  reportProgress(stepNum, totalSteps, "running", "Launching " + step.value);
  
  var targetPkg = step.target_package || normalizeLaunchTarget(step.value);
  if (!targetPkg) throw new Error("Cannot resolve app: " + step.value);
  
  app.launchPackage(targetPkg);
  waitMs(3000);
  
  reportProgress(stepNum, totalSteps, "verifying", "Checking app opened...");
  var verify = verifyAppContext(targetPkg);
  
  if (!verify.ok) {
    // Retry with intent
    try {
      var intent = new android.content.Intent();
      intent.setPackage(targetPkg);
      intent.setAction("android.intent.action.MAIN");
      intent.addCategory("android.intent.category.LAUNCHER");
      intent.setFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
      context.startActivity(intent);
      waitMs(3000);
      verify = verifyAppContext(targetPkg);
    } catch (e) {}
  }
  
  if (!verify.ok) throw new Error("LAUNCH FAILED: " + verify.mismatch);
  
  reportProgress(stepNum, totalSteps, "completed", "App opened: " + verify.current);
  return true;
}

function executeClick(step, stepNum, totalSteps) {
  var beforeFp = currentScreenFingerprint();
  
  // Verify context if specified
  if (CURRENT_TASK.target_app) {
    var ctx = verifyAppContext(CURRENT_TASK.target_app);
    if (!ctx.ok) throw new Error("CONTEXT MISMATCH: " + ctx.mismatch);
  }
  
  reportProgress(stepNum, totalSteps, "running", "Locating element...");
  
  var element = null;
  if (step.id) element = verifyElementExists({ id: step.id });
  else if (step.text) element = verifyElementExists({ text: step.text });
  else if (step.contains) element = verifyElementExists({ contains: step.contains });
  else if (typeof step.x === 'number') element = { exists: true, x: step.x, y: step.y, text: 'coords' };
  
  // Fallbacks
  if (!element.exists && step.fallbacks) {
    for (var i = 0; i < step.fallbacks.length; i++) {
      var fb = step.fallbacks[i];
      if (fb.x && fb.y) {
        element = { exists: true, x: fb.x, y: fb.y, text: 'fallback' };
        break;
      }
    }
  }
  
  if (!element.exists) throw new Error("CLICK FAILED: Element not found");
  
  reportProgress(stepNum, totalSteps, "running", "Clicking " + element.text);
  click(element.x, element.y);
  waitMs(800);
  
  if (step.verify_change) {
    var change = verifyScreenChanged(beforeFp.texts);
    if (!change.changed) log("Warning: Screen didn't change significantly");
  }
  
  reportProgress(stepNum, totalSteps, "completed", "Clicked: " + element.text);
  return true;
}

function executeType(step, stepNum, totalSteps) {
  var text = step.text || "";
  
  // CRITICAL: Verify app context
  if (step.verify_app_before_type !== false && CURRENT_TASK.target_app) {
    reportProgress(stepNum, totalSteps, "verifying", "Checking context before typing...");
    var ctx = verifyAppContext(CURRENT_TASK.target_app);
    if (!ctx.ok) throw new Error("TYPE BLOCKED: " + ctx.mismatch);
  }
  
  reportProgress(stepNum, totalSteps, "running", "Typing: " + text.substring(0, 20));
  
  setClip(text);
  waitMs(400);
  
  try {
    var inputNode = focusable(true).findOne(1000);
    if (inputNode && inputNode.paste) inputNode.paste();
    else input(text);
  } catch (e) {
    input(text);
  }
  
  if (step.verify_appears) {
    waitMs(600);
    var appears = verifyTextAppears(text);
    if (!appears.found) log("Warning: Text not immediately visible");
  }
  
  reportProgress(stepNum, totalSteps, "completed", "Text entered");
  return true;
}

function executePress(step, stepNum, totalSteps) {
  var key = step.key;
  reportProgress(stepNum, totalSteps, "running", "Pressing: " + key);
  
  if (key === 'enter') {
    var goBtn = text("Go").findOne(500) || desc("Search").findOne(500);
    if (goBtn && goBtn.clickable()) goBtn.click();
    else {
      try { KeyCode("KEYCODE_ENTER"); } catch (e) {
        click(device.width - 100, device.height - 150);
      }
    }
  } else if (key === 'back') {
    back();
  } else if (key === 'home') {
    home();
  }
  
  waitMs(500);
  reportProgress(stepNum, totalSteps, "completed", "Key pressed: " + key);
  return true;
}

function executeVerifyApp(step, stepNum, totalSteps) {
  reportProgress(stepNum, totalSteps, "verifying", "Confirming app...");
  var verify = verifyAppContext(step.package || step.expected_package);
  if (!verify.ok) throw new Error("VERIFICATION FAILED: " + verify.mismatch);
  reportProgress(stepNum, totalSteps, "completed", "Confirmed: " + verify.current);
  return true;
}

function executeWait(step, stepNum, totalSteps) {
  var ms = step.ms || 1000;
  reportProgress(stepNum, totalSteps, "running", "Waiting " + ms + "ms");
  waitMs(ms);
  reportProgress(stepNum, totalSteps, "completed", "Wait complete");
  return true;
}

// ============================================
// TASK EXECUTION ENGINE
// ============================================
function executeStep(step, stepNum, totalSteps) {
  log("=== STEP " + stepNum + "/" + totalSteps + ": " + step.action + " ===");
  
  switch (step.action) {
    case 'launch_app':
      return executeLaunchApp(step, stepNum, totalSteps);
    case 'click':
      return executeClick(step, stepNum, totalSteps);
    case 'type':
      return executeType(step, stepNum, totalSteps);
    case 'press':
      return executePress(step, stepNum, totalSteps);
    case 'verify':
    case 'verify_app':
      return executeVerifyApp(step, stepNum, totalSteps);
    case 'wait':
      return executeWait(step, stepNum, totalSteps);
    default:
      log("Unknown action: " + step.action);
      return true;
  }
}

function runAutomationTask(task) {
  CURRENT_TASK = task;
  isProcessing = true;
  LIVE_MODE = (task.mode === 'live');
  EXECUTION_TRACE = [];
  
  log("========================================");
  log("TASK: " + task.task_id);
  log("Goal: " + task.goal);
  log("Steps: " + task.steps.length);
  log("========================================");
  
  try {
    for (var i = 0; i < task.steps.length; i++) {
      LIVE_CURRENT_STEP = i + 1;
      var step = task.steps[i];
      
      // Retry logic
      var attempts = 0;
      var maxAttempts = (step.action === 'launch_app') ? 3 : 2;
      var success = false;
      
      while (attempts < maxAttempts && !success) {
        attempts++;
        try {
          executeStep(step, i + 1, task.steps.length);
          success = true;
        } catch (e) {
          log("Attempt " + attempts + " failed: " + e);
          if (attempts >= maxAttempts) throw e;
          waitMs(2000);
        }
      }
      
      if (i < task.steps.length - 1) waitMs(800);
    }
    
    log("TASK COMPLETED");
    saveResults(task, true, null);
    
  } catch (e) {
    log("TASK FAILED: " + e);
    saveResults(task, false, String(e));
  }
  
  isProcessing = false;
  CURRENT_TASK = null;
  LIVE_MODE = false;
}

function saveResults(task, success, error) {
  // Save report
  var report = {
    task_id: task.task_id,
    goal: task.goal,
    status: success ? "completed" : "failed",
    error: error,
    worker_id: WORKER_ID,
    timestamp: new Date().toISOString()
  };
  
  ghPutJson(BASE_URL + REPORTS_PATH + "/" + task.task_id + "_report.json", {
    message: "Report " + task.task_id,
    content: b64Encode(JSON.stringify(report, null, 2)),
    branch: BRANCH
  });
  
  // Save log
  var logData = {
    task_id: task.task_id,
    status: success ? "completed" : "failed",
    error: error,
    details: success ? "All steps completed" : ("Failed: " + error),
    timestamp: new Date().toISOString()
  };
  
  ghPutJson(BASE_URL + LOGS_PATH + "/" + task.task_id + "_log.json", {
    message: "Log " + task.task_id,
    content: b64Encode(JSON.stringify(logData, null, 2)),
    branch: BRANCH
  });
  
  // Update progress final
  reportProgress(task.steps.length, task.steps.length, success ? "completed" : "failed", 
    success ? "Task complete" : "Task failed: " + error, error);
  
  // Remove from queue
  var queue = getTaskQueue();
  queue.queue = queue.queue.filter(function(item) { return item.task_id !== task.task_id; });
  queue.processing = null;
  updateTaskQueue(queue);
}

// ============================================
// TEACH MODE (Preserved)
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
  
  notify("Teach mode: " + task.goal);
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
      steps.push({ action: "launch_app", value: snap.pkg, verify: true, _from_teach: true });
      lastPkg = snap.pkg;
    }
    
    if (snap.touches && snap.touches.length > 0) {
      for (var j = 0; j < snap.touches.length; j++) {
        var touch = snap.touches[j];
        steps.push({ action: "click", x: touch.x, y: touch.y, _from_teach: true });
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
  
  // Save route
  var url = BASE_URL + ROUTES_PATH + "/" + TEACH_SESSION.task_id + ".json";
  ghPutJson(url, {
    message: "Route " + TEACH_SESSION.task_id,
    content: b64Encode(JSON.stringify(routeData, null, 2)),
    branch: BRANCH
  });
  
  TEACH_MODE = false;
  TEACH_SESSION = null;
  
  notify("Route saved!");
  log("Teach finalized");
}

// ============================================
// QUEUE PROCESSING
// ============================================
function getTask(taskId) {
  var url = BASE_URL + TASKS_PATH + "/" + taskId + ".json";
  var res = ghGetJson(url);
  if (!res.ok || !res.json || !res.json.content) return null;
  try {
    return JSON.parse(b64Decode(res.json.content));
  } catch { return null; }
}

function processQueue() {
  if (isProcessing) {
    if (TEACH_MODE) recordTeachSnapshot();
    return;
  }
  
  var queue = getTaskQueue();
  
  // Check for teach_stop
  if (TEACH_MODE) {
    for (var i = 0; i < queue.queue.length; i++) {
      var item = queue.queue[i];
      if (item.task_id.indexOf('stop_') === 0 || item.task_id.indexOf('teach_stop') !== -1) {
        var task = getTask(item.task_id);
        if (task && task.type === 'teach_stop') {
          finalizeTeachSession();
          // Remove from queue
          queue.queue.splice(i, 1);
          updateTaskQueue(queue);
          return;
        }
      }
    }
    recordTeachSnapshot();
    return;
  }
  
  if (!queue.queue || queue.queue.length === 0) return;
  
  var item = queue.queue[0];
  var task = getTask(item.task_id);
  
  if (!task || task.status !== "pending") {
    queue.queue.shift();
    updateTaskQueue(queue);
    return;
  }
  
  // Handle teach_start
  if (task.type === 'teach_start') {
    queue.queue.shift();
    queue.processing = { task_id: item.task_id, started_at: Date.now() };
    updateTaskQueue(queue);
    startTeachSession(task);
    return;
  }
  
  // Handle automation
  queue.queue.shift();
  queue.processing = { task_id: item.task_id, started_at: Date.now() };
  updateTaskQueue(queue);
  
  runAutomationTask(task);
}

// ============================================
// MAIN LOOP
// ============================================
buildInstalledAppsMap();
tryStartTouchObserver();

log("DWAI Agent v2.4 Complete - Starting");
log("Features: Verification, Teach Mode, Progress Reporting");

while (true) {
  try {
    processQueue();
    FATAL_ERROR_COUNT = 0;
  } catch (e) {
    log("FATAL ERROR: " + e);
    isProcessing = false;
    TEACH_MODE = false;
    FATAL_ERROR_COUNT++;
    if (FATAL_ERROR_COUNT >= FATAL_ERROR_LIMIT) {
      notify("DWAI fatal error - restarting");
      waitMs(10000);
      FATAL_ERROR_COUNT = 0;
    }
  }
  
  if (processedTaskIds.size > 500) processedTaskIds.clear();
  waitMs(POLL_INTERVAL);
}
