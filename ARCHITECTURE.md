# DWAI Mobile Agent — System Architecture

## High-level decision: Cloud‑heavy + Phone‑light

- **Cloud (free tiers):** All heavy AI reasoning (Ollama via Groq API) and durable queue storage (GitHub).
- **Phone (local):** Only lightweight execution loop (Auto.js) that polls for tasks and performs actions.

---

## 1. Components

| Component | Technology | Role |
|-----------|-------------|------|
| **Telegram bot** | Telegraf on Railway | User interface: receives commands like “Search Google for X” |
| **Backend API** | Express on Railway | Calls LLM to turn command → JSON plan; writes tasks to GitHub |
| **LLM** | Groq API (Llama 3 70B) | Natural‑language → structured actions |
| **Task queue** | GitHub repository (JSON files) | Durable storage; backend writes tasks, phone reads them |
| **Phone agent** | Auto.js (Android) | Polls GitHub, executes actions, marks tasks done |

---

## 2. Action schema

```json
{
  "task_id": "uuid",
  "device_id": "abcd1234",
  "status": "pending",  // pending | executing | completed | failed
  "steps": [
    { "action": "launch_app", "value": "Chrome" },
    { "action": "wait", "ms": 3000 },
    { "action": "click", "x": 500, "y": 1200 },
    { "action": "type", "text": "OpenAI" },
    { "action": "press", "key": "enter" }
    // … more steps
  ]
}
```

- `launch_app(package)` – `launchApp(package)`
- `click(x, y)` – `click(x, y)`
- `type(text)` – `setText(text)`
- `press("home" | "back" | "enter")` – `press(key)`
- `wait(ms)` – `sleep(ms)`

---

## 3. Flows

### 3.1 Create task (user → phone)

1. User → Telegram bot: “Search for best laptops”
2. Bot → Backend: `POST /plan { text: "...", device_id: "abcd1234" }`
3. Backend → Groq with prompt → JSON action list
4. Backend → GitHub: write `data/tasks/<task_id>.json` with `status: "pending"`
5. Bot → User: “Task queued (id: …)”

### 3.2 Execute (phone → GitHub)

1. Phone (Auto.js) every 5s: `GET https://api.github.com/repos/<user>/<repo>/contents/data/tasks?device_id=abcd1234`
2. Find file with `status: "pending"` (responses include SHA)
3. Parse JSON, run steps in order
4. After each step, update `started_at`, `status: "executing"`
5. On success: `PATCH` file content with `status: "completed"`; on error: `status: "failed"`
6. (Optional) Backend can send Telegram confirmation via webhook.

---

## 4. GitHub API usage (free)

- Read: `GET /repos/:owner/:repo/contents/:path` (list)
- Get SHA + content, modify, then `PUT` with same SHA to update
- Authenticated with `GITHUB_TOKEN` (classic token with repo scope)
- Rate limits: 5 000 req/h per token (more than enough for 1 phone polling 12 req/min = 720/h)

---

## 5. Security

- Backend and phone both know a shared `DEVICE_ID`.
- GitHub token stored in Railway env.
- Optional: make repo private; if public, restrict writes to token anyway.
- No cloud secrets on phone.

---

## 6. Implementation plan

### Phase A – Backend
- `server.js` (Express)
- `/plan` endpoint → `Groq → plan`
- `github.js` read/write helpers
- `.env` support; `railway.json` for deployment

### Phase B – Telegram bot
- Minimal commands: `/cmd <text>` → `POST /plan`
- `/status <task_id>` → read task from GitHub

### Phase C – Phone (Auto.js)
- `agent.js` script:
  - `poll()` → GET tasks, filter pending, execute
  - `runSteps(steps)` → switch(action) with fallbacks
  - `updateTask(id, status)` → GitHub PUT
- Test with a simple `echo` task.

### Phase D – Polish
- Better error handling, retries, vision (optional screenshot → Groq for dynamic coordinates)
- Add `screenshot` step for verification.

---

## 7. Deploy

- Push backend to Railway (free tier)
- Set `GITHUB_TOKEN` in Railway env
- Phone: install Auto.js, import `agent.js`, set `DEVICE_ID` and `REPO_RAW_URL` (e.g., `https://api.github.com/repos/you/dwai-mobile-agent/contents/data/tasks`).

---

This architecture keeps the phone dumb (polling) and the cloud clever (LLM). It’s free, simple, and fully under your control.
