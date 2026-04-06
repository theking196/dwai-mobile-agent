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

async function generatePlan(userText) {
  const prompt = `You are a mobile automation planner that outputs JSON only.

Valid actions:
- {"action":"launch_app","value":"<package>"}
- {"action":"click","x":<number>,"y":<number>}
- {"action":"type","text":"<string>"}
- {"action":"press","key":"home|back|enter"}
- {"action":"wait","ms":<number>}

Return a JSON array of steps to accomplish: "${userText}"

Example:
[
  {"action":"launch_app","value":"com.android.chrome"},
  {"action":"wait","ms":3000},
  {"action":"click","x":500,"y":1200},
  {"action":"type","text":"OpenAI"},
  {"action":"press","key":"enter"}
]

Respond only with the JSON array, no commentary.`;
  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'You are a helpful mobile automation agent that outputs pure JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 800
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
    await ctx.reply(`Task queued!\nID: ${taskId}\nSteps: ${steps.length}`);
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

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  bot.launch();
});

process.on('SIGINT', () => { bot.stop(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); process.exit(0); });
