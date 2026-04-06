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
  return ghPut(url, { message: `Create task ${taskId}`, content: contentBase64 });
}

// NEW IMPROVED PROMPT WITH TRAINING
async function generatePlan(userText) {
  const prompt = `You are DWAI Mobile Agent - an intelligent automation planner for Android devices.

CORE RULES:
1. ALWAYS plan first, then execute
2. Prefer selectors (text, contains, desc) over coordinates
3. Every step must be verifiable
4. ALWAYS include wait times for UI to load
5. Add fallback strategies for each critical step
6. Think step-by-step before acting

ACTION SCHEMA:
{"action": "launch_app | click | type | press | wait | swipe | toast", "value": "package_name", "text": "string", "key": "home|back|enter", "x": number, "y": number, "ms": milliseconds, "contains": "partial text", "desc": "content description"}

DEVICE CONTEXT:
- screen_width: 720, screen_height: 1544
- prefer text/contains selectors over coordinates
- use coordinates only as fallback

PLANNING RULES:
- Each step needs: action + verification
- Use waits after every UI-changing action (1000-5000ms)
- For click: prefer "contains" or "desc" over x/y
- For launch_app: use package name (e.g., "com.google.android.youtube")

COMMON APPS:
- YouTube: com.google.android.youtube
- Chrome: com.android.chrome
- WhatsApp: com.whatsapp
- Calculator: com.android.calculator2

User task: "${userText}"

Generate ONLY a JSON array of steps. No explanation. Example:
[{"action":"launch_app","value":"com.google.android.youtube"},{"action":"wait","ms":4000},{"action":"click","contains":"Search"},{"action":"wait","ms":2000},{"action":"type","text":"AI news"},{"action":"press","key":"enter"},{"action":"wait","ms":5000}]`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'You are DWAI Mobile Agent - output ONLY JSON, no commentary.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 1000
  });

  const raw = res.choices[0].message.content.trim();
  const jsonStart = raw.search('[');
  const jsonEnd = raw.lastIndexOf(']') + 1;
  if (jsonStart === -1) return [];
  const jsonStr = raw.slice(jsonStart, jsonEnd);
  try { return JSON.parse(jsonStr); } catch { return []; }
}

bot.command('start', async (ctx) => {
  await ctx.reply('DWAI Mobile Agent – your phone, controlled by AI.\n\nCommands:\n/cmd <text> – plan & queue a task\n/status <task_id> – check a task\n/tasks – list pending tasks\n\nExample:\n/cmd Open Chrome and search OpenAI');
});

bot.command('cmd', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /cmd <description>');
  await ctx.reply('Thinking…');
  const steps = await generatePlan(text);
  if (!steps.length) return ctx.reply('Could not generate a plan.');
  const taskId = nanoid(8);
  const task = { task_id: taskId, status: 'pending', created_at: new Date().toISOString(), steps };
  try {
    await createTask(taskId, task);
    await ctx.reply(`Task queued!\nID: ${taskId}\nSteps: ${steps.length}\n\n${JSON.stringify(steps, null, 2)}`);
  } catch (e) {
    console.error(e);
    await ctx.reply('Failed to save task.');
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
    await ctx.reply(`Task ${taskId}\nStatus: ${task.status}\nCreated: ${task.created_at}\nSteps: ${task.steps.length}`);
  } catch (e) {
    console.error(e);
    await ctx.reply('Task not found.');
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
    if (!files.length) return ctx.reply('No pending tasks.');
    await ctx.reply(`Pending tasks:\n${files.map(f => f.name.replace('.json', '')).join('\n')}`);
  } catch (e) {
    await ctx.reply('Could not fetch tasks.');
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  bot.launch();
});

process.on('SIGINT', () => { bot.stop(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); process.exit(0); });