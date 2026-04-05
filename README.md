# DWAI Mobile Agent

Cloud‑heavy + phone‑light AI agent system. Free stack:

- **Cloud:** Groq API (LLM), Railway backend, GitHub storage (all free tiers)
- **Phone:** Auto.js script (Android) that polls and executes

You send a command via Telegram → AI reasons → produces JSON steps → phone executes them.

---

## 🚀 Quick Start

### 1. Backend (Railway)

```bash
cd backend
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, GROQ_API_KEY, GITHUB_TOKEN, GITHUB_REPO
npm install
npm start
```

Deploy to Railway (free) with:
- Build command: `npm install`
- Start command: `npm start`
- Env vars as above
- Healthcheck: `/health`

### 2. GitHub repo

Create a **public** GitHub repository `dwai-mobile-agent` with two directories:

- `backend/` (your deployed code)
- `phone/agent.js` (the phone script)

Make sure the GitHub token you give Railway has **repo** scope.

### 3. Phone (Auto.js)

1. Install **Auto.js 4.1.1** on your Android.
2. Copy `phone/agent.js` to your phone.
3. Edit the top constants: `GITHUB_TOKEN`, `REPO_OWNER`, `REPO_NAME`.
4. Run the script in Auto.js (grant accessibility and background permissions).
5. The script will poll GitHub every 5 seconds for tasks.

### 4. Telegram bot

Open Telegram, start your bot, send:

```
/cmd Open Chrome and search for OpenAI
```

If all goes well:

- Backend creates a task file in `data/tasks/<id>.json`
- Phone sees it, executes: launch Chrome, click search bar, type, enter
- Task status becomes `completed`

---

## 🧠 How the AI plans

Groq (Llama 3 70B) receives your text and outputs a JSON array like:

```json
[
  { "action": "launch_app", "value": "com.android.chrome" },
  { "action": "wait", "ms": 3000 },
  { "action": "click", "x": 500, "y": 1200 },
  { "action": "type", "text": "OpenAI" },
  { "action": "press", "key": "enter" }
]
```

Any valid action is then translated to Auto.js APIs.

---

## 📦 Project structure

```
dwai-mobile-agent/
├── backend/
│   ├── package.json
│   ├── server.js           # Express + Telegraf + Groq + GitHub
│   └── .env.example
├── phone/
│   └── agent.js            # Auto.js polling + execution script
├── ARCHITECTURE.md
└── README.md
```

---

## 🆓 Cost breakdown (all free for personal use)

| Service       | Free tier limits                      | What we use                      |
|---------------|---------------------------------------|----------------------------------|
| Groq API      | ~30 RPM, generous tokens/day         | LLM planning                     |
| Railway       | 512 MB RAM, free 24/7                | Backend API                      |
| GitHub        | 5 000 req/h per token                | Task storage                     |
| Telegram      | Unlimited (polling)                   | User interface                   |

---

## ⚠️ Security notes

- The phone stores your `GITHUB_TOKEN`. Use a token with only **repo** scope, not full account access.
- For production, consider per‑device IDs and limiting which tasks a phone can claim.
- The repo can be **private**; Auto.js can still access it with the token.

---

## 🧪 Testing

1. Make sure your Telegram bot token works (BotFather).
2. In Railway console, check `/health` returns `{"status":"ok"}`.
3. Send `/start` to the bot; it should respond.
4. Send `/cmd Open Calculator` (simple test). Phone should open the calculator app.

---

Enjoy your fully cloud‑driven mobile agent. Build as you go. 🚀
