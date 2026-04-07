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

const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

function createTask(taskId, data) {
  const path = `data/tasks/${taskId}.json`;
  const contentBase64 = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const url = `${GITHUB_API}/${path}`;
  return ghPut(url, { 
    message: `Create task ${taskId}`, 
    content: contentBase64,
    branch: "main"
  });
}

// VALID APP LIST - Only these packages are allowed
const VALID_APPS = {
  "youtube": "com.google.android.youtube",
  "chrome": "com.android.chrome",
  "google chrome": "com.android.chrome",
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
  "telegram": "org.telegram.messenger",
  "signal": "org.thoughtcrime.securesms",
  "discord": "com.discord",
  "slack": "com.Slack",
  "zoom": "us.zoom.videomeetings"
};

function resolveAppName(text) {
  text = text.toLowerCase().trim();
  return VALID_APPS[text] || null;
}

// VALIDATION - Strict step validation
function validateSteps(steps) {
  if (!Array.isArray(steps)) return { valid: false, error: 'Not an array' };
  
  const allowed = ["launch_app", "click", "type", "press", "wait", "swipe", "toast"];
  
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.action) return { valid: false, error: `Step ${i}: missing action` };
    if (!allowed.includes(s.action)) return { valid: false, error: `Step ${i}: invalid action "${s.action}"` };
    
    // Validate action-specific fields
    if (s.action === 'launch_app' && !s.value) return { valid: false, error: `Step ${i}: launch_app needs value` };
    if (s.action === 'click' && !s.x && !s.y && !s.contains && !s.desc) return { valid: false, error: `Step ${i}: click needs x,y or contains or desc` };
    if (s.action === 'type' && !s.text) return { valid: false, error: `Step ${i}: type needs text` };
    if (s.action === 'press' && !s.key) return { valid: false, error: `Step ${i}: press needs key` };
    if (s.action === 'wait' && !s.ms) return { valid: false, error: `Step ${i}: wait needs ms` };
  }
  
  if (steps.length > 20) return { valid: false, error: 'Too many steps (max 20)' };
  
  return { valid: true };
}

// IMPROVED PLANNER - With app resolution
async function generatePlan(userText) {
  const prompt = `You are DWAI Mobile Agent Planner - STRICT JSON output only.

TASK: Convert user command to executable steps.

CRITICAL RULES:
1. Use ONLY these verified app packages - DO NOT guess:
${Object.entries(VALID_APPS).map(([k,v]) => `- "${k}" -> ${v}`).join('\n')}

2. Always use verified package names from above list
3. If app not in list, use description and let executor resolve
4. Prefer selectors (contains, desc) over coordinates
5. Always add wait after launch_app (2000-4000ms)
6. Always add wait after type (1000-2000ms)
7. Max 15 steps

VALID ACTIONS:
- {"action":"launch_app","value":"PACKAGE_NAME"}
- {"action":"click","contains":"TEXT"} or {"action":"click","x":540,"y":300}
- {"action":"type","text":"STRING"}
- {"action":"press","key":"enter|back|home"}
- {"action":"wait","ms":3000}
- {"action":"toast","text":"MESSAGE"}

User command: "${userText}"

Output ONLY JSON array. Example:
[{"action":"launch_app","value":"com.google.android.youtube"},{"action":"wait","ms":4000},{"action":"click","contains":"Search"},{"action":"wait","ms":2000},{"action":"type","text":"AI news"},{"action":"press","key":"enter"},{"action":"wait","ms":5000}]`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'You are DWAI Planner. Output ONLY valid JSON array of steps.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 1500
  });

  const raw = res.choices[0].message.content.trim();
  
  // Try full JSON parse first
  try {
    const parsed = JSON.parse(raw);
    if (parsed.steps && Array.isArray(parsed.steps)) return parsed.steps;
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  
  // Extract array
  const jsonStart = raw.search('[');
  const jsonEnd = raw.lastIndexOf(']') + 1;
  if (jsonStart === -1) return [];
  const jsonStr = raw.slice(jsonStart, jsonEnd);
  try { return JSON.parse(jsonStr); } catch { return []; }
}

bot.command('start', async (ctx) => {
  await ctx.reply('DWAI Mobile Agent v8\n\nCommands:\n/cmd <task> - Plan & queue\n/status <id> - Check task\n/tasks - List pending\n\nApps: ' + Object.keys(VALID_APPS).slice(0, 5).join(', ') + '...');
});

bot.command('cmd', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /cmd <description>');
  
  await ctx.reply('🤔 Planning...');
  const steps = await generatePlan(text);
  
  const validation = validateSteps(steps);
  if (!validation.valid) {
    return ctx.reply('❌ Invalid plan: ' + validation.error);
  }
  
  const taskId = nanoid(8);
  const task = { 
    task_id: taskId, 
    status: 'pending', 
    intent: text,
    type: 'automation',
    created_at: new Date().toISOString(), 
    steps 
  };
  
  try {
    await createTask(taskId, task);
    await ctx.reply(`✅ Task ${taskId}\n\nSteps: ${steps.length}\n${steps.map((s, i) => `${i+1}. ${s.action}`).join('\n')}`);
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Failed to save task');
  }
});

bot.command('status', async (ctx) => {
  const taskId = ctx.message.text.split(' ')[1];
  if (!taskId) return ctx.reply('Usage: /status <task_id>');
  try {
    const url = `${GITHUB_API}/data/tasks/${taskId}.json`;
    const res = await new Promise((resolve, reject) => {
      https.get(url, { headers: ghHeaders() }, (r) => {
        let d = '';
        r.on('data', (c) => d += c);
        r.on('end', () => resolve(JSON.parse(d)));
      }).on('error', reject);
    });
    const content = Buffer.from(res.content, 'base64').toString();
    const task = JSON.parse(content);
    const icon = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '⏳';
    await ctx.reply(`${icon} ${taskId}\n\nStatus: ${task.status}\nIntent: ${task.intent || 'N/A'}\nSteps: ${task.steps.length}\n${task.error ? '\nError: ' + task.error : ''}`);
  } catch (e) {
    await ctx.reply('❌ Task not found');
  }
});

bot.command('tasks', async (ctx) => {
  try {
    const url = `${GITHUB_API}/data/tasks`;
    const res = await new Promise((resolve, reject) => {
      https.get(url, { headers: ghHeaders() }, (r) => {
        let d = '';
        r.on('data', (c) => d += c);
        r.on('end', () => resolve(JSON.parse(d)));
      }).on('error', reject);
    });
    const files = res.filter(f => f.name !== '.gitkeep');
    if (!files.length) return ctx.reply('📭 No pending tasks');
    await ctx.reply(`📋 ${files.length} tasks:\n\n${files.map(f => f.name.replace('.json', '')).join('\n')}`);
  } catch (e) {
    await ctx.reply('❌ Error fetching tasks');
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server on ${PORT}`);
  bot.launch();
});

process.on('SIGINT', () => { bot.stop(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); process.exit(0); });