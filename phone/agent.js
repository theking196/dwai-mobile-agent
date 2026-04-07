// DWAI Mobile Agent v7.4 (Corrected)
// - Full logging
// - App discovery + app resolution
// - Verified app launch
// - Selector-first clicking
// - Safer GitHub task updates
// - Retry on steps
// - No silent failures

var GITHUB_TOKEN = "githubkey";
var REPO_OWNER = "theking196";
var REPO_NAME = "dwai-mobile-agent";
var TASKS_PATH = "data/tasks";
var LOGS_PATH = "data/logs";
var POLL_INTERVAL = 10000;
var BRANCH = "main";

var BASE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/";

toast("DWAI v7.4 starting...");
console.log("=== DWAI v7.4 START ===");

// ---------- App Discovery ----------
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
            var label = "";
            try {
                label = pm.getApplicationLabel(app).toString().toLowerCase();
            } catch (e) {}

            var pkg = app.packageName;
            if (label) {
                INSTALLED_APPS[label] = pkg;
            }
            INSTALLED_APPS[pkg] = pkg;
        }

        APP_CACHE_BUILT = true;
        log("App cache built: " + Object.keys(INSTALLED_APPS).length);
    } catch (e) {
        log("App discovery failed: " + e);
        APP_CACHE_BUILT = true;
    }
}

function resolveApp(appName) {
    if (!appName) return null;

    var name = String(appName).toLowerCase().trim();

    if (KNOWN_APPS[name]) {
        return KNOWN_APPS[name];
    }

    if (INSTALLED_APPS[name]) {
        return INSTALLED_APPS[name];
    }

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

// ---------- Utils ----------
function waitMs(ms) {
    java.lang.Thread.sleep(ms);
}

function log(msg) {
    console.log(new Date().toISOString() + " | " + msg);
}

function b64Encode(text) {
    try {
        return android.util.Base64.encodeToString(
            new java.lang.String(text).getBytes("UTF-8"),
            android.util.Base64.NO_WRAP
        );
    } catch (e) {
        log("b64Encode error: " + e);
        return "";
    }
}

function b64Decode(text) {
    try {
        var clean = (text || "").replace(/\n/g, "").replace(/\r/g, "");
        return new java.lang.String(
            android.util.Base64.decode(clean, android.util.Base64.DEFAULT),
            "UTF-8"
        ).toString();
    } catch (e) {
        log("b64Decode error: " + e);
        return "";
    }
}

// ---------- HTTP ----------
function readStream(stream) {
    if (!stream) return "";
    try {
        var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream));
        var line, out = "";
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

function httpRequest(method, url, body, headers) {
    try {
        log("HTTP " + method + " -> " + url);
        var conn = new java.net.URL(url).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);

        if (headers) {
            for (var k in headers) {
                conn.setRequestProperty(k, String(headers[k]));
            }
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

        log("HTTP response: " + code + " | " + (res.length > 120 ? res.substr(0, 120) + "..." : res));
        return { statusCode: code, body: res };
    } catch (e) {
        log("httpRequest exception: " + e);
        return { statusCode: -1, body: String(e) };
    }
}

function headers() {
    return {
        "Authorization": "token " + GITHUB_TOKEN,
        "User-Agent": "DWAI",
        "Accept": "application/vnd.github+json"
    };
}

// ---------- GitHub ----------
function getTaskList() {
    log("Fetching task list...");
    var res = httpRequest("GET", BASE_URL + TASKS_PATH, null, headers());
    if (res.statusCode !== 200) {
        log("Failed to fetch task list: " + res.statusCode);
        return [];
    }

    try {
        var tasks = JSON.parse(res.body);
        return tasks || [];
    } catch (e) {
        log("getTaskList JSON parse error: " + e);
        return [];
    }
}

function getTask(fileUrl) {
    log("Fetching task: " + fileUrl);
    var res = httpRequest("GET", fileUrl, null, headers());
    if (res.statusCode !== 200) {
        log("Failed to get task: " + res.statusCode);
        return null;
    }

    try {
        var file = JSON.parse(res.body);
        if (!file || !file.content) {
            return null;
        }

        var task = JSON.parse(b64Decode(file.content));
        log("Task loaded: " + (task.task_id || "unknown"));
        return { file: file, task: task };
    } catch (e) {
        log("getTask parse error: " + e);
        return null;
    }
}

function saveTask(fileUrl, sha, task, msg) {
    log("Saving task " + task.task_id + " | Status: " + task.status);
    var res = httpRequest("PUT", fileUrl, JSON.stringify({
        message: msg,
        content: b64Encode(JSON.stringify(task, null, 2)),
        sha: sha,
        branch: BRANCH
    }), headers());

    if (res.statusCode !== 200 && res.statusCode !== 201) {
        log("saveTask failed: " + res.statusCode + " | " + res.body);
        return sha;
    }

    try {
        var parsed = JSON.parse(res.body);
        if (parsed && parsed.content && parsed.content.sha) {
            log("Task saved successfully");
            return parsed.content.sha;
        }
    } catch (e) {
        log("saveTask parse error: " + e);
    }

    return sha;
}

// ---------- Feedback Logging ----------
function writeLog(taskId, status, error) {
    var logData = {
        task_id: taskId,
        status: status,
        error: error,
        timestamp: new Date().toISOString()
    };

    log("Writing log for task " + taskId + " | Status: " + status);

    httpRequest(
        "PUT",
        BASE_URL + LOGS_PATH + "/" + taskId + "_log.json",
        JSON.stringify({
            message: "log " + taskId,
            content: b64Encode(JSON.stringify(logData, null, 2)),
            branch: BRANCH
        }),
        headers()
    );
}

// ---------- Device ----------
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
        toast("Unlock phone...");
        log("Device locked, waiting...");
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

function launchAppSafe(nameOrPackage) {
    var resolved = resolveApp(nameOrPackage) || nameOrPackage;

    log("Launching app request: " + nameOrPackage + " -> " + resolved);

    try {
        app.launchPackage(resolved);
        waitMs(4000);
        if (currentAppIs(resolved)) {
            log("Launched by package: " + resolved);
            return resolved;
        }
    } catch (e1) {
        log("launchPackage failed: " + e1);
    }

    try {
        launchApp(nameOrPackage);
        waitMs(4000);
        var maybeResolved = resolveApp(nameOrPackage);
        if (maybeResolved && currentAppIs(maybeResolved)) {
            log("Launched by label: " + nameOrPackage);
            return maybeResolved;
        }
    } catch (e2) {
        log("launchApp failed: " + e2);
    }

    return null;
}

// ---------- Actions ----------
function clickSmart(step) {
    log("Clicking: " + JSON.stringify(step));

    try {
        if (step.text) {
            var el = text(step.text).findOne(3000);
            if (el) {
                el.click();
                log("Clicked by text");
                return true;
            }
        }

        if (step.contains) {
            var el2 = textContains(step.contains).findOne(3000);
            if (el2) {
                el2.click();
                log("Clicked by contains");
                return true;
            }
        }

        if (step.desc) {
            var el3 = descContains(step.desc).findOne(3000);
            if (el3) {
                el3.click();
                log("Clicked by description");
                return true;
            }
        }

        if (typeof step.x === "number" && typeof step.y === "number") {
            click(step.x, step.y);
            log("Clicked by coordinates: " + step.x + "," + step.y);
            return true;
        }
    } catch (e) {
        log("clickSmart error: " + e);
    }

    log("Click failed");
    return false;
}

function typeText(t) {
    try {
        t = String(t);
        log("Typing text: " + t);
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
    log("Executing step: " + JSON.stringify(step));

    if (step.action === "launch_app") {
        var launched = launchAppSafe(step.value);
        if (!launched) {
            throw "launch failed: " + step.value;
        }
        return true;
    }

    if (step.action === "click") {
        if (!clickSmart(step)) throw "click failed";
        return true;
    }

    if (step.action === "type") {
        if (!typeText(step.text || "")) throw "type failed";
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
            throw "unknown key: " + key;
        }

        log("Key pressed: " + key);
        return true;
    }

    if (step.action === "wait") {
        waitMs(step.ms || 1000);
        log("Waited " + (step.ms || 1000) + "ms");
        return true;
    }

    if (step.action === "toast") {
        toast(step.text || step.value || "Done");
        log(step.text || step.value || "Done");
        return true;
    }

    if (step.action === "swipe") {
        if (typeof step.x1 === "number" && typeof step.y1 === "number" &&
            typeof step.x2 === "number" && typeof step.y2 === "number") {
            swipe(step.x1, step.y1, step.x2, step.y2, step.duration || 300);
            log("Swiped");
            return true;
        }
        throw "swipe needs x1, y1, x2, y2";
    }

    log("Unknown step action: " + step.action);
    return false;
}

function execWithRetry(step) {
    for (var i = 0; i < 3; i++) {
        try {
            if (execStep(step)) return true;
        } catch (e) {
            log("Step failed on attempt " + (i + 1) + ": " + e);
        }
        waitMs(1000);
    }

    log("Step failed after 3 attempts: " + JSON.stringify(step));
    return false;
}

// ---------- Main ----------
var isProcessing = false;
var currentTaskId = null;

function process() {
    if (isProcessing) {
        log("Already processing, skip");
        return;
    }

    var files = getTaskList();

    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!f || !f.name) continue;
        if (f.name === ".gitkeep") continue;
        if (f.name.indexOf("_log") !== -1) continue;

        var bundle = getTask(f.url);
        if (!bundle) continue;

        var task = bundle.task;
        if (task.status !== "pending") continue;

        isProcessing = true;
        currentTaskId = task.task_id || f.name;

        log("RUNNING task: " + currentTaskId);

        task.status = "executing";
        task.started_at = new Date().toISOString();

        var sha = saveTask(f.url, bundle.file.sha, task, "executing");

        waitForUnlock();

        var success = true;
        var failedStep = -1;
        var errorMsg = "";

        for (var j = 0; j < (task.steps || []).length; j++) {
            if (!execWithRetry(task.steps[j])) {
                success = false;
                failedStep = j;
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

        log("Task " + currentTaskId + " finished | Status: " + task.status);

        saveTask(f.url, sha, task, task.status);
        writeLog(currentTaskId, task.status, task.error || null);

        isProcessing = false;
        currentTaskId = null;
        return;
    }
}

buildInstalledAppsMap();

toast("DWAI v7.4 running");
log("Apps discovered: " + Object.keys(INSTALLED_APPS).length);
log("Known apps: " + Object.keys(KNOWN_APPS).length);

while (true) {
    try {
        process();
    } catch (e) {
        log("PROCESS ERROR: " + e);
        isProcessing = false;
        currentTaskId = null;
    }
    waitMs(POLL_INTERVAL);
}