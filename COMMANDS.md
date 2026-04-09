# Complete Command List for DWAI Mobile Agent v2.9

## 🤖 TELEGRAM BOT COMMANDS

### Main Commands
/start - Start the bot and get welcome message
/status - Check system status and current task
/help - Get help information

### Task Execution
/cmd <task> - Execute any task (e.g., /cmd Open Chrome and search for AI)
/live <task> - Execute in live mode with verification
/do <task> - Alternative task execution

### Route Teaching
/teach <goal> - Start teaching a new route
/save - Save the taught route
/routes - List all saved routes

### Mode Commands
/game <task> - Execute with game mode (fastest, for gaming)

---

## 💬 TEXT COMMANDS (Just type naturally)

### Web Search
search <query> - Search the web (e.g., search What is AI)
find <query> - Same as search
lookup <query> - Same as search

### Automation Commands
These work naturally - just describe what you want:

Examples:
- "Open Chrome" → Opens Chrome browser
- "Search for cats on YouTube" → Opens YouTube and searches
- "Send message to John saying Hello" → Opens WhatsApp and sends
- "Open calculator" → Opens calculator app
- "Take a screenshot" → Captures screen
- "Check current app" → Shows what app is open

---

## 🔧 ACTION TYPES (What the AI can do)

launch_app - Open any app
click - Tap on screen (by text, ID, or coordinates)
type - Type text into a field
press - Press key (enter, back, home, menu)
wait - Wait for milliseconds
toast - Show notification
swipe - Swipe screen (up, down, left, right)
verify - Verify app context
open_url - Open a URL in browser
observe - Observe screen state
screenshot - Capture screenshot
get_context - Get current device context
analyze_screenshot - AI analyzes screenshot
fallback_search - Find search icon if search bar missing

---

## 🔗 EXTERNAL API COMMANDS

If using the external API:

POST /api/execute
{"key": "your-api-key", "command": "open chrome"}

POST /game/execute
{"key": "your-api-key", "command": "jump", "mode": "game"}

---

## 📱 PHONE SIDE COMMANDS

These are automatic - the phone responds to tasks from Telegram:

1. LAUNCH APPS:
   - "Open YouTube"
   - "Open Chrome"
   - "Open WhatsApp"
   - "Open Calculator"
   - Any installed app

2. DO TASKS:
   - "Search for X"
   - "Send message to X saying Y"
   - "Open website X"
   - "Click X"
   - "Type X"

3. INFORMATION:
   - "What app is open"
   - "Take screenshot"
   - "Check status"

---

## 🎮 GAME MODE COMMANDS

For fast games like Subway Surfers:
/game jump
/game slide
/game collect
/game dodge

Or any natural command:
"jump"
"slide left"
"collect coins"
"swipe up"

---

## 🌍 MULTI-LANGUAGE SUPPORT

The bot understands:
English, Spanish, French, German, Portuguese, Chinese, Japanese, Arabic, Hindi

Just write in your language!

---

## 💡 EXAMPLE COMMANDS

Basic:
"Open Chrome"
"Open calculator"
"Take a screenshot"

Search:
"Search for weather"
"Find restaurants near me"
"lookup Python tutorials"

Messaging:
"Send message to Mom saying I'll be late"
"Text John on WhatsApp: Hello"

Automation:
"Open YouTube and search for songs"
"Open Chrome go to google.com"
"Open settings and turn on WiFi"

Complex:
"Search for a recipe for pizza"
"Find the nearest gas station"
"Watch cat videos on YouTube"

Game:
"Jump"
"Slide"
"Swipe right"

---

## ⚡ QUICK REFERENCE

1. Basic: /cmd <what you want>
2. Natural: Just describe what you want
3. Search: search <anything>
4. Routes: /teach <task> then do it, then /save
5. Game: /game <action> or just <action> in game mode

