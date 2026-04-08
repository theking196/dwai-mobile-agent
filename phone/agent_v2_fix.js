// DWAI Mobile Agent v2 FIXED CORE
// Adds: App Registry, Command Parsing, Feedback System, Safer Execution

const APPS = {
  chrome: "com.android.chrome",
  whatsapp: "com.whatsapp",
  whatsapp_business: "com.whatsapp.w4b",
  facebook: "com.facebook.katana",
  facebook_lite: "com.facebook.lite",
  youtube: "com.google.android.youtube",
  settings: "com.android.settings"
};

function normalizeAppName(name) {
  return name.toLowerCase().replace(/\s+/g, "_");
}

function launchAppSafe(name) {
  let key = normalizeAppName(name);
  let pkg = APPS[key];

  if (!pkg) {
    logFeedback("error", "App not found: " + name);
    return false;
  }

  app.launchPackage(pkg);
  sleep(1500);

  if (currentPackage() !== pkg) {
    logFeedback("error", "Failed to launch " + name);
    return false;
  }

  logFeedback("success", "Launched " + name);
  return true;
}

// -------- COMMAND PARSER --------
function parseCommand(input) {
  input = input.toLowerCase();

  let result = {
    action: null,
    app: null,
    query: null
  };

  if (input.includes("chrome")) result.app = "chrome";
  if (input.includes("youtube")) result.app = "youtube";
  if (input.includes("whatsapp")) result.app = "whatsapp";
  if (input.includes("facebook lite")) result.app = "facebook_lite";

  if (input.includes("search")) {
    result.action = "search";
    result.query = input
      .replace(/search (for)?/g, "")
      .replace(/on (chrome|youtube)/g, "")
      .trim();
  }

  if (input.includes("open") || input.includes("launch")) {
    result.action = "open";
  }

  return result;
}

// -------- FEEDBACK SYSTEM --------
function logFeedback(status, message) {
  let log = {
    time: new Date().toISOString(),
    status: status,
    message: message
  };

  console.log("[FEEDBACK]", JSON.stringify(log));
}

// -------- EXECUTION ENGINE --------
function executeTask(input) {
  logFeedback("info", "Received task: " + input);

  let task = parseCommand(input);

  if (!task.action) {
    logFeedback("error", "Could not understand command");
    return;
  }

  if (task.action === "open") {
    if (!launchAppSafe(task.app)) return;
  }

  if (task.action === "search") {
    if (!launchAppSafe(task.app)) return;

    sleep(2000);

    let searchBox = textContains("Search").findOne(3000);
    if (!searchBox) {
      logFeedback("error", "Search box not found");
      return;
    }

    searchBox.click();
    sleep(1000);

    setText(task.query);
    sleep(500);

    press("enter");

    logFeedback("success", "Searched for: " + task.query);
  }
}

// Example usage:
// executeTask("open chrome and search for dog");
