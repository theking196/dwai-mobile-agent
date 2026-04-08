// DWAI Mobile Agent v2 (FINAL WITH FULL FEEDBACK SYSTEM)
// Includes: App Registry, Parser, Step Feedback, Task Lifecycle

const APPS = {
  chrome: "com.android.chrome",
  whatsapp: "com.whatsapp",
  whatsapp_business: "com.whatsapp.w4b",
  facebook_lite: "com.facebook.lite",
  youtube: "com.google.android.youtube"
};

function normalize(name) {
  return (name || "").toLowerCase().replace(/\s+/g, "_");
}

function createTask(id, input) {
  return {
    id,
    input,
    status: "running",
    steps: [],
    start: new Date().toISOString()
  };
}

function step(task, name, status, msg) {
  const s = { name, status, msg, time: new Date().toISOString() };
  task.steps.push(s);
  console.log("STEP:", JSON.stringify(s));
}

function finish(task, success) {
  task.status = success ? "success" : "failed";
  task.end = new Date().toISOString();
  console.log("TASK:", JSON.stringify(task, null, 2));
}

function launch(name, task) {
  const pkg = APPS[normalize(name)];
  if (!pkg) return step(task, "launch", "error", "App not found");

  app.launchPackage(pkg);
  sleep(1500);

  if (currentPackage() !== pkg) {
    step(task, "launch", "error", "Launch failed");
    return false;
  }

  step(task, "launch", "success", name);
  return true;
}

function parse(input) {
  input = input.toLowerCase();

  return {
    open: input.includes("open") || input.includes("launch"),
    search: input.includes("search"),
    app: input.includes("youtube") ? "youtube" : input.includes("chrome") ? "chrome" : null,
    query: input.replace(/search (for)?/g, "").replace(/on .*/, "").trim()
  };
}

function run(input) {
  const task = createTask("task_" + Date.now(), input);

  const p = parse(input);
  step(task, "parse", "info", JSON.stringify(p));

  if (p.open && !p.search) {
    const ok = launch(p.app, task);
    return finish(task, ok);
  }

  if (p.search) {
    if (!launch(p.app, task)) return finish(task, false);

    let box = textContains("Search").findOne(3000);
    if (!box) {
      step(task, "find", "error", "No search box");
      return finish(task, false);
    }

    box.click();
    step(task, "click", "success", "search box");

    setText(p.query);
    step(task, "type", "success", p.query);

    press("enter");
    step(task, "submit", "success", "done");

    return finish(task, true);
  }

  finish(task, false);
}
