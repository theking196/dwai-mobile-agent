# 📱 DWAI Mobile Agent — Build Plan

> Cloud‑heavy (free), phone‑light (local). Telegram interface. AI plans, phone executes.

---

## 🏗️ Architecture Overview

```
You (Telegram) → Railway Backend → Groq AI → JSON plan → GitHub repo → Auto.js phone → Done
```

| Layer | Where | Cost |
|-------|-------|------|
| AI Reasoning | Groq API (Llama 3 70B) | ✅ Free |
| Backend API | Railway | ✅ Free tier |
| Task Storage | GitHub repo (JSON files) | ✅ Free |
| Phone Execution | Auto.js (Android) | ✅ Free |
| Interface | Telegram Bot | ✅ Free |

---

## 📁 Repo Structure

```
dwai-mobile-agent/
├── ARCHITECTURE.md          # System design
├── BUILD_PLAN.md             # This file
│
├── backend/                  # Railway server
│   ├── package.json
│   ├── server.js             # Express API + Telegram bot
│   └── .env.example
│
│── phone/                    # Phone side
│   └── agent.js              # Auto.js script to poll & execute
```

---

## 🧩 STEP 1 — Backend Setup (5 min)

### 1. Create the files

**`backend/package.json`** — already created. Contains Express, Groq SDK, dotenv.

**`backend/.env.example`**:
```env
TELEGRAM_BOT_TOKEN=
GROQ_API_KEY=
GITHUB_TOKEN=
GITHUB_REPO=theking196/dwai-mobile-agent
RAILWAY_PORT=3000
```

### 2. Backend code (`server.js`)

```js
require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const https = require('https');
const fs = require('fs');
const { nanoid } = require('nanoid');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── GitHub helpers ──
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const BASE = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

function ghHeader(method = 'GET') {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DWAI/1.0'
  };
}

// Write task to GitHub
async function writeTask(taskId, data) {
  const path = `data/tasks/${taskId}.json`;
  const body = JSON.stringify({
    message: `Queue task ${taskId}`,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64')
  });

  return new Promise((resolve, reject) => {
    const req = https.request(`${BASE}/${path}`, {
      method: 'PUT',
      headers: ghHeader('PUT')
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Read latest pending task for device
async function readPendingTasks(deviceId) {
  const path = `data/tasks`;
  return new Promise((resolve) => {
    https.get(`${BASE}/${path}`, { headers: ghHeader() }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', () => resolve([]));
  });
}

// Update task status in repo
async function updateTask(taskId, sha, data) {
  const path = `data/tasks/${taskId}.json`;
  const body = JSON.stringify({
    message: `Update task ${taskId}`,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    sha
  });
  return new Promise((resolve, reject) => {
    const req = https.request(`${BASE}/${path}`, {
      method: 'PUT',
      headers: ghHeader('PUT')
    }, (res) => {
      let r = '';
      res.on('data', (c) => r += c);
      res.on('end', () => resolve(JSON.parse(r)));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Telegram commands ──
bot.command('start', async (ctx) => {
  await ctx.reply('📱 *DWAI Mobile Agent*\n\nSend commands:\n/cmd <what to do>\n/status <task_id>\n/tasks — list pending', { parse_mode: 'Markdown' });
});

bot.command('cmd', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /cmd <describe what to do>');

  ctx.reply('⏳ Planning...');

  // Step 1: Generate actions from AI
  const plan = await groq.chat.completions.create({
    model: 'llama3-70b-8192',
    messages: [
      { role: 'system', content: `You are a mobile automation planner.

Return ONLY valid JSON array of actions to complete the task on Android via Auto.js.

Valid actions:
- { "action": "launch_app", "value": "package.name" }
- { "action": "click", "x": 500, "y": 1200 }
- { "action": "type", "text": "something" }
- { "action": "press", "key": "home|back|enter" }
- { "action": "wait", "ms": 3000 }

Example:
[{ "action": "launch_app", "value": "com.android.chrome" },
 { "action": "wait", "ms": 3000 },
 { "action": "click", "x": 500, "y": 1200 },
 { "action": "type", "text": "search query" },
 { "action": "press", "key": "enter" }]

Respond ONLY with the JSON array. No explanation.` },
      { role: 'user', content: text }
    ],
    temperature: 0.3,
    max_tokens: 800
  });

  let steps;
  try {
    const raw = plan.choices[0].message.content;
    const jsonStart = raw.indexOf('[');
    steps = JSON.parse(raw.slice(jsonStart));
  } catch (e) {
    return ctx.reply('❌ Failed to generate plan. Try a simpler command.');
  }

  const taskId = nanoid(8);
  const taskData = {
    task_id: taskId,
    status: 'pending',
    created_at: new Date().toISOString(),
    steps: steps
  };

  await writeTask(taskId, taskData);
  await ctx.reply(`✅ Task created!\n\nID: \`${taskId}\`\nSteps: ${steps.length}`);
});

bot.command('status', async (ctx) => {
  const taskId = ctx.message.text.split(' ')[1];
  if (!taskId) return ctx.reply('Usage: /status <task_id>');

  try {
    const path = `data/tasks/${taskId}.json`;
    const res = await new Promise((resolve) => {
      https.get(`${BASE}/${path}`, { headers: ghHeader() }, (r) => {
        let d = '';
        r.on('data', (c) => d += c);
        r.on('end', () => resolve(JSON.parse(d)));
      });
    });
    const content = JSON.parse(Buffer.from(res.content, 'base64').toString());
    ctx.reply(`📋 *${taskId}*\nStatus: \`${content.status || 'unknown'}\`\nCreated: ${content.created_at}`);
  } catch (e) {
    ctx.reply('❌ Task not found');
  }
});

bot.command('tasks', async (ctx) => {
  const tasks = await readPendingTasks('');
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return ctx.reply('📭 No tasks in queue.');
  }
  const lines = tasks.filter(t => t && t.sha && t.size > 0).map(t => `• ${t.name.replace('.json','')} (${t.size} bytes)`);
  ctx.reply(`📋 Tasks:\n\n${lines.join('\n')}`);
});

// ── Health ──
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Start ──
app.listen(PORT, () => {
  console.log(`🩺 Health on :${PORT}/health`);
  bot.launch();
  console.log('🤖 DWAI Bot running...');
});

process.on('SIGINT', () => { bot.stop(); app.close(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); app.close(); process.exit(0); });
```

### 3. Create a GitHub repo

```bash
gh repo create dwai-mobile-agent --public --description "DWAI Mobile Agent System"
```

Or via the GitHub web UI: create `theking196/dwai-mobile-agent`.

### 4. Deploy to Railway

1. Create service → deploy from `theking196/dwai-mobile-agent` with path `backend/`
2. Set environment variables in Railway:
   ```
   TELEGRAM_BOT_TOKEN=<from BotFather>
   GROQ_API_KEY=gsk_...
   GITHUB_TOKEN=ghp_...
   GITHUB_REPO=theking196/dwai-mobile-agent
   ```
3. Healthcheck: `/health`
4. Deploy! Your bot should answer to `/start`.

---

## 📱 STEP 2 — Phone Script (Auto.js)

Install **Auto.js 4.1.1** from GitHub releases: https://github.com/SuperMonster003/AutoJsProject/releases

Create a file `phone/agent.js`:

```js
// ═══════════════════════════════════════
//  DWAI Mobile Agent — Auto.js
//  Polls GitHub for tasks and executes
// ═══════════════════════════════════════

const GITHUB_TOKEN = "YOUR_GITHUB_TOKEN";
const REPO_OWNER = "theking196";
const REPO_NAME = "dwai-mobile-agent";
const DEVICE_ID = "my-phone";  // Match to filter tasks if needed
const POLL_INTERVAL = 5000;    // 5 seconds

const TASKS_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/data/tasks`;

function httpGet(url) {
  let res = http.get(url, {
    headers: {
      "Authorization": "Bearer " + GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "User-Agent": "DWAI/1.0"
    }
  });
  if (!res.body) return null;
  return JSON.parse(res.body.string());
}

function httpPut(url, body) {
  let res = http.put(url, {
    headers: {
      "Authorization": "Bearer " + GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "User-Agent": "DWAI/1.0",
      "Content-Type": "application/json"
    },
    body: body
  });
  return res.body ? JSON.parse(res.body.string()) : null;
}

// Execute a single action
function runAction(step) {
  switch (step.action) {
    case 'launch_app':
      launchApp(step.value);
      toast("Launched: " + step.value);
      break;
    case 'click':
      click(step.x, step.y);
      toast("Click (" + step.x + ", " + step.y + ")");
      break;
    case 'type':
      // Auto.js needs an input field focused; use setText if possible
      let text = step.text;
      // Try clipboard paste as fallback
      setClip(text);
      paste();
      toast("Typed: " + text);
      break;
    case 'press':
      if (step.key === 'enter') {
        keyCode(66); // KEYCODE_ENTER
      } else if (step.key === 'home') {
        home();
      } else if (step.key === 'back') {
        back();
      } else {
        toast("Unknown key: " + step.key);
      }
      break;
    case 'wait':
      sleep(step.ms);
      break;
    default:
      toast("Unknown action: " + step.action);
  }
}

// Find and execute a pending task
function pollAndExecute() {
  try {
    log("Polling GitHub...");
    const files = httpGet(TASKS_URL);

    if (!Array.isArray(files)) {
      log("No files or error.");
      return;
    }

    // Find the first pending task file
    for (const file of files) {
      if (!file.sha || !file.name) continue;
      
      // Get content
      const contentRes = http.get(file.url, {
        headers: {
          "Authorization": "Bearer " + GITHUB_TOKEN,
          "Accept": "application/vnd.github.raw+json"
        }
      });
      
      if (!contentRes || !contentRes.body) continue;

      const taskData = JSON.parse(contentRes.body.string());

      if (taskData.status === 'pending') {
        let taskId = file.name.replace('.json', '');

        // Mark as executing
        taskData.status = 'executing';
        taskData.started_at = new Date().toISOString();
        httpPut(file.url, JSON.stringify({
          message: "Executing task " + taskId,
          content: java.util.Base64.getEncoder().encodeToString(
            java.lang.String(JSON.stringify(taskData)).getBytes()
          ),
          sha: file.sha
        }));

        // Execute steps
        toast("🚀 Executing task: " + taskId);
        for (let i = 0; i < taskData.steps.length; i++) {
          let step = taskData.steps[i];
          log("[Step " + (i+1) + "/" + taskData.steps.length + "] " + JSON.stringify(step));
          taskData.current_step = i;
          taskData.status = 'executing';
          runAction(step);
          sleep(500); // Small delay between steps
        }

        // Mark completed
        taskData.status = 'completed';
        taskData.completed_at = new Date().toISOString();
        delete taskData.current_step;
        httpPut(file.url, JSON.stringify({
          message: "Completed task " + taskId,
          content: java.util.Base64.getEncoder().encodeToString(
            java.lang.String(JSON.stringify(taskData)).getBytes()
          ),
          sha: file.sha
        }));

        toast("✅ Task completed: " + taskId);
        log("Task completed: " + taskId);
        return; // Only do one task per poll
      }
    }

    log("No pending tasks.");
  } catch (e) {
    log("Error in poll: " + e);
    toast("❌ Error: " + e);
  }
}

// Main loop
toast("🤖 DWAI Agent starting...");
log("DWAI Mobile Agent running on " + DEVICE_ID);

while (true) {
  pollAndExecute();
  sleep(POLL_INTERVAL);
}
```

---

## 🧪 STEP 3 — Test End-to-End

1. **Backend up** on Railway (check `/health`).
2. **Bot responds** in Telegram (`/start`).
3. Send `/cmd Open Chrome and search OpenAI`.
4. Groq returns JSON → Bot creates `data/tasks/<task_id>.json` in GitHub.
5. Auto.js on phone polls, finds the task, executes steps.
6. Task marked `completed`.
7. You can check `/status <task_id>`.

---

## 📊 STEP 4 — Cost Breakdown (all free)

| Service | Free Tier | Your usage |
|---------|-----------|------------|
| Groq API | ~30 RPM, 1000+ req/day |