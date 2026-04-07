require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const https = require('https');
const { nanoid } = require('nanoid');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error('GITHUB_TOKEN and GITHUB_REPO required');

function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DWAI/1.0',
  };
}

function ghPut(url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'PUT',
      headers: ghHeaders()
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function ghGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: ghHeaders() }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

// ==================== TOOLS ====================

const TOOLS = {
  // Execute mobile task
  execute_task: {
    name: "execute_task",
    description: "Control the phone - open apps, click, type, search. Use for: open YouTube, search Google, open calculator, etc.",
    params: {
      action: "launch_app | click | type | press | wait",
      target: "app name or search query",
      details: "optional: coordinates, text to type"
    }
  },
  
  // Check pending tasks
  list_tasks: {
    name: "list_tasks",
    description: "Show all pending tasks in the queue",
    params: {}
  },
  
  // Get task status
  task_status: {
    name: "task_status",
    description: "Check if a specific task completed or failed",
    params: { task_id: "the task ID" }
  },
  
  // General chat
  chat: {
    name: "chat",
    description: "Have a conversation, answer questions, be helpful",
    params: { message: "what user said" }
  }
};

// VALID APPS
const VALID_APPS = {
  "youtube": "com.google.android.youtube",
  "chrome": "com.android.chrome",
  "browser": "com.android.chrome",
  "whatsapp": "com.whatsapp",
  "calculator": "com.android.calculator2",
  "camera": "com.android.camera2",
  "photos": "com.google.android.apps.photos",
  "gallery": "com.android.gallery3d",
  "settings": "com.android.settings",
  "phone": "com.android.dialer",
  "messages": "com.android.mms",
  "gmail": "com.google.android.gm",
  "maps": "com.google.android.apps.maps",
  "spotify": "com.spotify.music",
  "facebook": "com.facebook.katana",
  "instagram": "com.instagram.android",
  "twitter": "com.twitter.android",
  "telegram": "org.telegram.messenger"
};

// ==================== INTENT CLASSIFIER ====================

async function classifyIntent(userMessage) {
  const prompt = `Classify this user message and decide what to do.

User: "${userMessage}"

Classify into ONE of these intents:
1. TASK - User wants to do something on the phone (open app, search, click, etc.)
2. CHAT - Just talking, questions, greeting, casual conversation
3. STATUS - Checking task status or list
4. HELP - Asking for help with the bot

Also extract:
- If TASK: What action? What target app/search?
- If CHAT: Just respond naturally

Response JSON:
{
  "intent": "TASK|CHAT|STATUS|HELP",
  "action": "launch_app|click|type|search|none|respond",
  "target": "app name or search query or none",
  "response": "what to say if CHAT or HELP"
}`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are DWAI Intent Classifier. Output ONLY JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 300
    });
    
    const content = res.choices[0].message.content.trim();
    const jsonStart = content.search('{');
    const jsonEnd = content.lastIndexOf('}') + 1;
    if (jsonStart === -1) return { intent: 'CHAT', action: 'respond', target: null, response: content };
    return JSON.parse(content.slice(jsonStart, jsonEnd));
  } catch(e) {
    return { intent: 'CHAT', action: 'respond', target: null, response: "I'm here! What would you like to do?" };
  }
}

// ==================== TASK GENERATOR ====================

async function generateTaskSteps(userText) {
  const prompt = `Convert to mobile automation JSON steps.

RULES:
- Use ONLY: ${Object.values(VALID_APPS).join(', ')}
- Use selectors (contains) over coordinates
- Add wait after launches

User: "${userText}"

Output JSON array only:`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'Output ONLY JSON array.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 800
    });
    
    const content = res.choices[0].message.content.trim();
    const jsonStart = content.search('[');
    const jsonEnd = content.lastIndexOf(']') + 1;
    if (jsonStart === -1) return [];
    return JSON.parse(content.slice(jsonStart, jsonEnd));
  } catch(e) {
    return [];
  }
}

function validateSteps(steps) {
  if (!Array.isArray(steps)) return false;
  const allowed = ["launch_app", "click", "type", "press", "wait", "toast"];
  for (let s of steps) {
    if (!s.action || !allowed.includes(s.action)) return false;
  }
  return steps.length <= 15;
}

function createTask(taskId, data) {
  const path = `data/tasks/${taskId}.json`;
  const contentBase64 = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  return ghPut(`${GITHUB_API}/${path}`, { message: `Task ${taskId}`, content: contentBase64, branch: "main" });
}

// ==================== CHATBOT RESPONSE ====================

async function generateChatResponse(userMessage, context = "") {
  const prompt = `You are DWAI - a helpful AI assistant that can control a phone and chat.

You have these capabilities:
1. Mobile automation - open apps, click, type, search
2. Task management - create and track tasks
3. General conversation - be helpful and friendly

User: "${userMessage}"

${context}

Respond naturally and helpfully. If they want to do something on the phone, suggest using a command or just describe what you would do.`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    });
    return res.choices[0].message.content.trim();
  } catch(e) {
    return "I'm here! You can ask me to do things on your phone, or just chat.";
  }
}

// ==================== BOT HANDLERS ====================

bot.command('start', async (ctx) => {
  const apps = Object.keys(VALID_APPS).slice(0, 8).join(', ');
  await ctx.reply(`🎯 DWAI Mobile Agent v8

I can:
• Do things on your phone (no /cmd needed!)
• Chat with you
• Manage tasks

Just talk to me naturally! Examples:
• "Open YouTube"
• "Search for AI news"
• "What's the weather?"
• "Open calculator and calculate 5+5"

Available apps: ${apps}...`);
});

bot.command('help', async (ctx) => {
  await ctx.reply(`📖 DWAI Commands

Just chat naturally! I understand:
• "Open YouTube" → creates task
• "Check tasks" → shows queue
• "Hello" → just chats

Or use commands:
/cmd <task> - explicit task
/status <id> - check task
/tasks - list all
/help - this help`);
});

bot.command('cmd', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /cmd open YouTube');
  
  await ctx.reply('📱 Creating task...');
  const steps = await generateTaskSteps(text);
  
  if (!validateSteps(steps)) {
    return ctx.reply('❌ Could not create valid task. Try again.');
  }
  
  const taskId = nanoid(8);
  const task = { task_id: taskId, status: 'pending', intent: text, type: 'automation', created_at: new Date().toISOString(), steps };
  
  try {
    await createTask(taskId, task);
    await ctx.reply(`✅ Task ${taskId}\n\n${steps.map((s, i) => `${i+1}. ${s.action}`).join(' → ')}`);
  } catch (e) {
    await ctx.reply('❌ Failed: ' + e.message);
  }
});

bot.command('status', async (ctx) => {
  const taskId = ctx.message.text.split(' ')[1];
  if (!taskId) return ctx.reply('Usage: /status <task_id>');
  try {
    const res = await ghGet(`${GITHUB_API}/data/tasks/${taskId}.json`);
    const task = JSON.parse(Buffer.from(res.content, 'base64').toString());
    const icon = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '⏳';
    await ctx.reply(`${icon} ${taskId}\nStatus: ${task.status}\n${task.error || ''}`);
  } catch (e) {
    await ctx.reply('❌ Not found');
  }
});

bot.command('tasks', async (ctx) => {
  try {
    const res = await ghGet(`${GITHUB_API}/data/tasks`);
    const files = res.filter(f => f.name !== '.gitkeep');
    if (!files.length) return ctx.reply('📭 No pending tasks');
    await ctx.reply(`📋 Tasks:\n${files.map(f => f.name.replace('.json', '')).join('\n')}`);
  } catch (e) {
    await ctx.reply('❌ Error');
  }
});

// ==================== NATURAL LANGUAGE HANDLING ====================

bot.on('message', async (ctx) => {
  const text = ctx.message.text;
  if (!text || text.startsWith('/')) return; // Ignore commands
  
  await ctx.reply('🤔...');
  
  try {
    // Classify intent
    const classification = await classifyIntent(text);
    
    if (classification.intent === 'TASK') {
      // Generate and create task
      const steps = await generateTaskSteps(text);
      if (validateSteps(steps)) {
        const taskId = nanoid(8);
        const task = { task_id: taskId, status: 'pending', intent: text, type: 'automation', created_at: new Date().toISOString(), steps };
        await createTask(taskId, task);
        await ctx.reply(`✅ Done! Task ${taskId} queued\n\n${steps.map((s, i) => `${i+1}. ${s.action}`).join(' → ')}`);
      } else {
        await ctx.reply("I'll create a task for that!");
      }
    }
    else if (classification.intent === 'STATUS') {
      // List tasks
      const res = await ghGet(`${GITHUB_API}/data/tasks`);
      const files = res.filter(f => f.name !== '.gitkeep');
      if (files.length) {
        await ctx.reply(`📋 Tasks:\n${files.map(f => f.name.replace('.json', '')).join('\n')}`);
      } else {
        await ctx.reply('📭 No pending tasks');
      }
    }
    else {
      // Just chat
      const response = await generateChatResponse(text);
      await ctx.reply(response);
    }
  } catch (e) {
    console.error(e);
    const response = await generateChatResponse(text);
    await ctx.reply(response);
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', tools: Object.keys(TOOLS) }));

app.listen(PORT, () => {
  console.log(`DWAI v8 running on ${PORT}`);
  bot.launch();
});

process.on('SIGINT', () => { bot.stop(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); process.exit(0); });