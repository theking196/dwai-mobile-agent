# DWAI Mobile Agent v2.9

**Cloud-heavy + phone-light AI agent system with 25+ features**

---

## 🚀 Quick Start

### 1. Backend (Render)

```bash
cd backend
cp .env.example .env
# Fill in:
# - TELEGRAM_BOT_TOKEN (from BotFather)
# - GROQ_API_KEY (from groq.com)
# - GITHUB_TOKEN (with repo scope)
# - GITHUB_REPO = "theking196/dwai-mobile-agent"
npm install
npm start
```

Deploy to Render (free tier):
1. Go to https://render.com → New Blueprint
2. Connect your GitHub repository
3. Render reads `render.yaml` automatically
4. Fill environment variables when prompted

### 2. Phone (Auto.js)

1. Install **Auto.js 4.1.1** on Android
2. Copy `phone/agent.js` to your phone
3. Edit top constants:
   ```javascript
   var GITHUB_TOKEN = "ghp_xxx";        // Your GitHub token
   var REPO_OWNER = "theking196";       // Your GitHub username
   var REPO_NAME = "dwai-mobile-agent"; // Repository name
   ```
4. Run the script in Auto.js
5. Grant accessibility and background permissions

### 3. Telegram Bot

Send commands to your bot:
```
/start
/cmd Open Chrome and search for OpenAI
```

---

## 📋 All Features (5 Batches)

### Batch 1 (v2.5) - Core Automation
| Feature | Description |
|---------|-------------|
| **Command Chaining** | Execute multiple actions in sequence |
| **Stored Routes** | Save and reuse learned task routes |
| **App List** | Dynamic list of installed apps on device |
| **Context Awareness** | Know current app and last action |
| **Live Vision** | Screenshot capture for visual feedback |

### Batch 2 (v2.6) - Communication & Intelligence
| Feature | Description |
|---------|-------------|
| **Web Search** | DuckDuckGo integration - use "search X" or "find X" |
| **Context Memory** | Remembers last 20 messages per user |
| **Telegram Style** | Rich formatting, typing indicators |
| **Vision Analysis** | AI analyzes screenshots to find UI elements |

### Batch 3 (v2.7) - Smart Decision Making
| Feature | Description |
|---------|-------------|
| **Clarification** | Asks user when 30-60% confidence on intent |
| **Route Matching** | Enhanced route finding with scoring |
| **Complex Tasks** | LLM breaks down complex tasks into steps |
| **Fallback Search** | If search box not found, tries search icon |
| **External API** | Control phone from anywhere via secure API |

### Batch 4 (v2.8) - Platform & Performance
| Feature | Description |
|---------|-------------|
| **OpenClaw Native** | Register and control via OpenClaw protocol |
| **Auto Docs** | Auto-generated docs at `/docs` and `/docs.md` |
| **BYOK System** | Bring Your Own Keys for Vision/TTS/STT |
| **Root Detection** | Detects if device is rooted or not |
| **Game Mode** | Fast polling (500ms) for gaming like Subway Surfers |

### Batch 5 (v2.9) - Advanced Capabilities
| Feature | Description |
|---------|-------------|
| **Imagine & Execute** | Generate and run animation sequences |
| **Skills System** | Create, save, and reuse custom skills |
| **Workflow Automation** | If X happens → do Y (trigger-based) |
| **Self-Upgrade** | Update itself via chat |
| **Natural Language Schedule** | "Every day at 9am" → cron conversion |
| **Multi-language** | Auto-detects 9 languages (EN, ES, FR, DE, PT, ZH, JA, AR, HI) |

---

## 📡 API Endpoints

### Core
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | System health check |
| `/docs` | GET | JSON documentation |
| `/docs.md` | GET | Markdown documentation |

### External Control
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/key` | POST | Generate API key |
| `/api/execute` | POST | Execute command |
| `/api/task/:id` | GET | Check task status |

### OpenClaw
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/openclaw/register` | POST | Register with OpenClaw |
| `/openclaw/execute` | POST | Execute via OpenClaw |
| `/openclaw/status` | GET | OpenClaw status |

### Advanced Features
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/imagine` | POST | Imagine and execute animation |
| `/skill/create` | POST | Create custom skill |
| `/skill/use` | POST | Use a saved skill |
| `/skills` | GET | List all skills |
| `/workflow/create` | POST | Create if-then workflow |
| `/schedule/create` | POST | Natural language schedule |
| `/languages` | GET | Supported languages |
| `/translate` | POST | Translate text |

### Game Mode
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/game/execute` | POST | Fast game execution |
| `/game/status` | GET | Game mode status |

---

## 🤖 Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot |
| `/cmd <task>` | Execute a task |
| `/teach <goal>` | Teach a new route |
| `/routes` | List saved routes |
| `/live <task>` | Live mode execution |
| `/status` | Check system status |

**Text Commands:**
- `search X` - Web search for X
- `find X` - Web search for X

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | From BotFather |
| `GROQ_API_KEY` | Yes | From groq.com |
| `GITHUB_TOKEN` | Yes | With repo scope |
| `GITHUB_REPO` | Yes | Format: owner/repo |
| `GROQ_MODEL` | No | Default: qwen/qwen3-32b |
| `OPENCLAW_ENABLED` | No | Set to "true" for OpenClaw |
| `OPENCLAW_DEVICE_TOKEN` | No | Device token for OpenClaw |

### Phone Configuration (agent.js)

```javascript
var GITHUB_TOKEN = "";     // Your GitHub token
var REPO_OWNER = "";       // Your GitHub username
var REPO_NAME = "";        // Repository name
```

---

## 💰 Cost (All Free for Personal Use)

| Service | Free Tier | Usage |
|---------|-----------|-------|
| Groq API | ~30 RPM, generous tokens | LLM planning |
| Render | 750 hrs/month | Backend API |
| GitHub | 5000 req/hour | Storage |
| Telegram | Unlimited | UI |

---

## ⚠️ Important Information

### Security
1. **GitHub Token**: Use a token with only `repo` scope, not full access
2. **API Keys**: Keep external API secret safe - don't expose in public
3. **Phone Security**: The token is stored on the phone - use a dedicated token

### Limitations
1. **Groq Models**: Vision model (Llama-4-Scout) may not always be available
2. **Rate Limits**: GitHub API has 5000 req/hour limit
3. **Phone Permissions**: Needs accessibility permission for full automation
4. **Root vs Non-Root**: Some features work better on rooted devices

### Known Issues
1. **Screenshot Analysis**: Requires Groq vision model - falls back if unavailable
2. **Self-Upgrade**: Prototype only - needs careful validation in production
3. **Game Mode**: Works best on fast devices - 500ms polling may drain battery

### What You Need to Do
1. ✅ Set up Render backend with environment variables
2. ✅ Configure Telegram bot with BotFather
3. ✅ Get Groq API key from groq.com
4. ✅ Create GitHub token with repo scope
5. ✅ Install Auto.js on Android phone
6. ✅ Update agent.js with your credentials

---

## 🧪 Testing Checklist

- [ ] Backend deploys successfully to Render
- [ ] `/health` returns `{"status":"ok"}`
- [ ] Telegram bot responds to `/start`
- [ ] Phone polls GitHub and shows in logs
- [ ] Test: `/cmd Open Calculator`
- [ ] Test: `search What is AI`
- [ ] Test: Game mode with fast task

---

## 📁 Project Structure

```
dwai-mobile-agent/
├── backend/
│   ├── server.js        # Main Express server
│   ├── package.json
│   ├── .env.example
│   └── render.yaml     # Render deployment config
├── phone/
│   └── agent.js         # Auto.js phone script
├── data/                # GitHub storage (created at runtime)
│   ├── tasks/
│   ├── routes/
│   ├── logs/
│   ├── skills/
│   ├── workflows/
│   └── schedules/
├── README.md
└── ARCHITECTURE.md
```

---

## 🚀 Next Steps

1. Test all basic commands
2. Teach some routes with `/teach`
3. Create skills for common tasks
4. Set up workflows
5. Try game mode for fast-paced games
6. Explore OpenClaw integration

---

**Version:** 2.9 (Final Batch)
**Features:** 25+
**Last Updated:** April 2026