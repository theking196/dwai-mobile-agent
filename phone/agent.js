// DWAI Mobile Agent v10
// - Reads current_task first for speed
// - Falls back to tasks folder
// - No delete after completion
// - Stop on failure
// - Teach mode recording
// - Route memory saving
// - App discovery + app resolution
// - Selector-first execution
// - Verified launch
// - No overlapping polling

var GITHUB_TOKEN = "PUT_A_NEW_TOKEN_HERE";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var ROUTES_PATH = "data/routes";
var CURRENT_TASK_PATH = "data/current_task.json";
var POLL_INTERVAL = 2000;
var BRANCH = "main";
var WORKER_ID = "phone-" + (device.model || "android") + "-" + device.width + "x" + device.height;

var BASE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/";

console.log("=== DWAI AGENT START ===");
toast("DWAI agent starting...");

// =====================================================
// APP DISCOVERY
// =====================================================

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

// =====================================================
// UTILS
// =====================================================

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
        var clean = String(text || "").replace(/\n/g, "").replace(/\r/g, "");
        return new java.lang.String(
            android.util.Base64.decode(clean, android.util.Base64.DEFAULT),
            "UTF-8"
        ).toString();
    } catch (e) {
        log("b64Decode error: " + e);
        return "";
    }
}

// =====================================================
// HTTP
// =====================================================

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
        "User-Agent": "DWAI-Agent",
        "Accept": "application/vnd.github+json"
    };
}

function httpRequest(method, url, body, extraHeaders) {
    try {
        log("HTTP " + method + " -> " + url);
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

        log("HTTP response: " + code);
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

// =====================================================
// GITHUB TASKS
// =====================================================

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
        return { file: file, task: task };
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

// =====================================================
// DEVICE STATE
// =====================================================

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
    try { pkg = currentPackage(); } catch (e) {}
    try { act = currentActivity(); } catch (e2) {}

    var texts = [];
    try {
        var nodes = className("android.widget.TextView").find();
        var max = Math.min(nodes.length, 12);
        for (var i = 0; i < max; i++) {
            var t = nodes[i].text();
            if (t && String(t).trim()) texts.push(String(t).trim());
        }
    } catch (e3) {}

    return {
        package: pkg,
        activity: act,
        texts: texts.slice(0, 10),
        ts: new Date().toISOString()
    };
}

// =====================================================
// TEACH MODE
// =====================================================

var TEACH_MODE = false;
var TEACH_SESSION = null;
var TEACH_LAST_FP = "";
var TEACH_SNAPS = [];
var TEACH_TOUCHES = [];

function startTeachSession(task) {
    TEACH_MODE = true;
    TEACH_SESSION = {
        task_id: task.task_id,
        goal: task.goal || task.intent || "teach route",
        app: task.app || null,
        started_at: new Date().toISOString(),
        snapshots: [],
        touches: []
    };

    TEACH_LAST_FP = "";
    TEACH_SNAPS = [];
    TEACH_TOUCHES = [];

    if (task.app) {
        var pkg = normalizeLaunchTarget(task.app);
        if (pkg) {
            launchAppSafe(pkg);
        }
    }

    log("Teach session started: " + TEACH_SESSION.goal);
}

function recordTeachSnapshot() {
    if (!TEACH_MODE || !TEACH_SESSION) return;

    var fp = currentScreenFingerprint();
    var fingerprintKey = fp.package + "|" + fp.activity + "|" + fp.texts.join("|");

    if (fingerprintKey === TEACH_LAST_FP) return;

    TEACH_LAST_FP = fingerprintKey;
    TEACH_SNAPS.push(fp);

    log("Teach snapshot captured: " + fp.package + " / " + fp.activity);
}

function recordTeachTouch(x, y, action) {
    if (!TEACH_MODE || !TEACH_SESSION) return;

    TEACH_TOUCHES.push({
        x: x,
        y: y,
        action: action,
        package: (function () {
            try { return currentPackage(); } catch (e) { return ""; }
        })(),
        ts: new Date().toISOString()
    });
}

function tryStartTouchObserver() {
    try {
        if (events && events.observeTouch) {
            events.observeTouch();
            if (events.onTouch) {
                events.onTouch(function (e) {
                    try {
                        var x = e && typeof e.x === "number" ? e.x : null;
                        var y = e && typeof e.y === "number" ? e.y : null;
                        var action = e && e.action !== undefined ? String(e.action) : "touch";
                        recordTeachTouch(x, y, action);
                    } catch (inner) {
                        log("Touch event record error: " + inner);
                    }
                });
                log("Touch observer started");
            }
        }
    } catch (e) {
        log("Touch observer unavailable: " + e);
    }
}

function finalizeTeachSession(task, fileUrl, sha) {
    if (!TEACH_SESSION) return;

    var routeData = {
        route_id: TEACH_SESSION.task_id,
        goal: TEACH_SESSION.goal,
        app: TEACH_SESSION.app,
        started_at: TEACH_SESSION.started_at,
        finished_at: new Date().toISOString(),
        snapshots: TEACH_SNAPS,
        touches: TEACH_TOUCHES,
        notes: "Route memory captured from teach mode."
    };

    saveRoute(TEACH_SESSION.goal, routeData);

    TEACH_MODE = false;
    TEACH_SESSION = null;
    TEACH_LAST_FP = "";
    TEACH_SNAPS = [];
    TEACH_TOUCHES = [];
    log("Teach session finalized");
}

// =====================================================
// APP LAUNCH
// =====================================================

function launchAppSafe(nameOrPackage) {
    var target = normalizeLaunchTarget(nameOrPackage);
    if (!target) return null;

    log("Launching: " + nameOrPackage + " -> " + target);

    for (var attempt = 0; attempt < 3; attempt++) {
        try {
            app.launchPackage(target);
            if (waitForPackage(target, 5000)) {
                log("Launched package: " + target);
                return target;
            }
        } catch (e1) {
            log("launchPackage attempt " + (attempt + 1) + " failed: " + e1);
        }

        try {
            launchApp(nameOrPackage);
            if (waitForPackage(target, 5000)) {
                log("Launched by label: " + nameOrPackage);
                return target;
            }
        } catch (e2) {
            log("launchApp attempt " + (attempt + 1) + " failed: " + e2);
        }

        waitMs(1000);
    }

    return null;
}

// =====================================================
// STEP EXECUTION
// =====================================================

function clickSmart(step) {
    log("Click step: " + JSON.stringify(step));

    try {
        if (step.text) {
            var n1 = text(step.text).findOne(3000);
            if (n1) {
                n1.click();
                return true;
            }
        }

        if (step.contains) {
            var n2 = textContains(step.contains).findOne(3000);
            if (n2) {
                n2.click();
                return true;
            }
        }

        if (step.desc) {
            var n3 = desc(step.desc).findOne(3000);
            if (n3) {
                n3.click();
                return true;
            }

            var n4 = descContains(step.desc).findOne(3000);
            if (n4) {
                n4.click();
                return true;
            }
        }

        if (step.className) {
            var n5 = className(step.className).findOne(3000);
            if (n5) {
                n5.click();
                return true;
            }
        }

        if (typeof step.x === "number" && typeof step.y === "number") {
            click(step.x, step.y);
            return true;
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

function verifyStep(step) {
    if (!step.verify) return true;

    try {
        if (step.verify.package) {
            var pkg = normalizeLaunchTarget(step.verify.package) || step.verify.package;
            if (!currentAppIs(pkg)) return false;
        }

        if (step.verify.text) {
            if (!textContains(step.verify.text).exists()) return false;
        }

        if (step.verify.contains) {
            if (!textContains(step.verify.contains).exists()) return false;
        }

        if (step.verify.desc) {
            if (!descContains(step.verify.desc).exists()) return false;
        }
    } catch (e) {
        log("verifyStep error: " + e);
        return false;
    }

    return true;
}

function execStep(step) {
    if (!step || !step.action) {
        throw new Error("Invalid step");
    }

    log("Executing step: " + JSON.stringify(step));

    if (step.action === "launch_app") {
        var launched = launchAppSafe(step.value);
        if (!launched) {
            throw new Error("Launch failed: " + step.value);
        }

        if (step.verify && !verifyStep(step)) {
            throw new Error("Launch verification failed: " + step.value);
        }

        return true;
    }

    if (step.action === "click") {
        if (!clickSmart(step)) {
            throw new Error("Click failed");
        }

        if (step.verify && !verifyStep(step)) {
            throw new Error("Click verification failed");
        }

        return true;
    }

    if (step.action === "type") {
        if (!typeText(step.text || step.value || "")) {
            throw new Error("Type failed");
        }
        return true;
    }

    if (step.action === "press") {
        var key = String(step.key || "").toLowerCase();

        if (key === "enter") {
            shell("input keyevent 66", false);
        } else if (key === "back") {
            back();
        } else if (key === "home") {
            home();
        } else if (key === "menu") {
            shell("input keyevent 82", false);
        } else {
            throw new Error("Unsupported key: " + key);
        }

        return true;
    }

    if (step.action === "wait") {
        waitMs(Number(step.ms || 1000));
        return true;
    }

    if (step.action === "toast") {
        notify(String(step.text || step.value || "Done"));
        return true;
    }

    if (step.action === "swipe") {
        if (
            typeof step.x1 === "number" &&
            typeof step.y1 === "number" &&
            typeof step.x2 === "number" &&
            typeof step.y2 === "number"
        ) {
            swipe(step.x1, step.y1, step.x2, step.y2, step.duration || 300);
            return true;
        }
        throw new Error("Swipe requires x1, y1, x2, y2");
    }

    if (step.action === "verify") {
        return verifyStep({ verify: step });
    }

    if (step.action === "open_url") {
        var url = String(step.value || "");
        if (!url) throw new Error("open_url missing URL");
        app.startActivity({
            action: "android.intent.action.VIEW",
            data: url
        });
        return true;
    }

    throw new Error("Unknown action: " + step.action);
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

// =====================================================
// TASK LOOP
// =====================================================

var isProcessing = false;
var currentTaskId = null;
var lastTaskId = null;

function processTeachModeIfActive() {
    if (!TEACH_MODE) return;

    recordTeachSnapshot();

    var current = getCurrentPointer();
    if (current && current.type === 'teach_stop' && current.status === 'pending') {
        var stopBundle = current.file_url ? getTask(current.file_url) : null;
        if (stopBundle) {
            try {
                var stopTask = stopBundle.task;
                var stopSha = stopBundle.file.sha;

                stopTask.status = "executing";
                stopTask.started_at = new Date().toISOString();
                saveTask(current.file_url, stopSha, stopTask, "executing");

                finalizeTeachSession(stopTask, current.file_url, stopSha);

                stopTask.status = "completed";
                stopTask.finished_at = new Date().toISOString();
                var newSha = saveTask(current.file_url, stopSha, stopTask, "completed");
                writeLog(stopTask.task_id, "completed", null);
                log("Teach stop completed");
            } catch (e) {
                log("Teach stop error: " + e);
            }
        }
    }
}

function processOneTask() {
    if (isProcessing) {
        log("Already processing");
        return;
    }

    if (TEACH_MODE) {
        processTeachModeIfActive();
        return;
    }

    var pointer = getCurrentPointer();
    if (pointer && pointer.task_id && pointer.status === 'pending' && pointer.file_url) {
        var bundle = getTask(pointer.file_url);
        if (bundle && bundle.task && bundle.task.status === 'pending') {
            runTaskBundle(bundle);
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
        runTaskBundle(bundle);
        return;
    }
}

function runTaskBundle(bundle) {
    var task = bundle.task;

    if (!task || !task.task_id) return;
    if (task.task_id === lastTaskId && task.status !== 'pending') {
        log("Skipping already handled task: " + task.task_id);
        return;
    }

    isProcessing = true;
    currentTaskId = task.task_id;

    log("RUNNING task: " + currentTaskId);
    log("Intent: " + (task.intent || "unknown"));

    var sha = null;

    try {
        task.status = "executing";
        task.started_at = new Date().toISOString();
        task.worker_id = WORKER_ID;

        sha = saveTask(bundle.file.url, bundle.file.sha, task, "executing");

        waitForUnlock();

        if (task.type === "teach_start") {
            startTeachSession(task);
            task.status = "completed";
            task.finished_at = new Date().toISOString();
            sha = saveTask(bundle.file.url, sha, task, "completed");
            writeLog(currentTaskId, "completed", null);
            lastTaskId = currentTaskId;
            isProcessing = false;
            currentTaskId = null;
            return;
        }

        var success = true;
        var errorMsg = "";

        if (!task.steps || !task.steps.length) {
            throw new Error("Task has no steps");
        }

        for (var j = 0; j < task.steps.length; j++) {
            var ok = execWithRetry(task.steps[j]);
            if (!ok) {
                success = false;
                errorMsg = "Step " + (j + 1) + " failed";
                break;
            }
            waitMs(500);
        }

        task.status = success ? "completed" : "failed";
        task.finished_at = new Date().toISOString();
        if (!success) {
            task.error = errorMsg;
        }

        saveTask(bundle.file.url, sha, task, task.status);
        writeLog(currentTaskId, task.status, task.error || null);

        log("Task " + currentTaskId + " finished: " + task.status);
        lastTaskId = currentTaskId;
    } catch (e) {
        log("Task error: " + e);

        try {
            if (task) {
                task.status = "failed";
                task.finished_at = new Date().toISOString();
                task.error = String(e);

                if (sha) {
                    saveTask(bundle.file.url, sha, task, "failed");
                }

                writeLog(currentTaskId, "failed", task.error);
            }
        } catch (inner) {
            log("Finalization error: " + inner);
        }
    }

    isProcessing = false;
    currentTaskId = null;
}

buildInstalledAppsMap();
tryStartTouchObserver();

log("Installed apps discovered: " + Object.keys(INSTALLED_APPS).length);
log("Known apps available: " + Object.keys(KNOWN_APPS).length);

while (true) {
    try {
        processOneTask();
    } catch (e) {
        log("PROCESS ERROR: " + e);
        isProcessing = false;
        currentTaskId = null;
    }
    waitMs(POLL_INTERVAL);
}