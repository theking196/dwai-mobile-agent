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

// ── GitHub helpers ──
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

function ghGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: ghHeaders() }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
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

// Functions for task storage
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

function createTask(taskId, data) {
  const path = `data/tasks/${taskId}.json`;
  const contentBase64 = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const url = `${GITHUB_API}/${path}`;
  return ghPut(url, { message: `Create task ${taskId}`, content: contentBase64 });
}

function getTask(taskId) {
  return new Promise((resolve, reject) => {
    const path = `data/tasks/${taskId}.json`;
    const url = `${GITHUB_API}/${path}`;
    https.get(url, { headers: ghHeaders() }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const meta = JSON.parse(d);
          const content = Buffer.from(meta.content, 'base64').toString();
          resolve({ ...JSON.parse(content), sha: meta.sha, url: meta.download_url });
        } else {
          reject(new Error(`Failed to get task: ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function listTaskFiles() {
  // Use GitHub API listing: we will list directory
  // Since we can't list directories natively, we rely on file names known? Alternative: maintain index file.
  // For simplicity, phone will list all files in data/tasks via GitHub tree API (requires branch parameter)
  // But easier: we can directly try to fetch one task by ID; phone polls by known IDs.
  // We'll improve later with an index file.
  return []; // stub
}

// ── LLM planning ──
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
    model: 'llama3-70b-8192',
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
  try { return JSON.parse(jsonStr); } catch (e) { console.error('Parse failed:', e); return []; }
}

// ── Telegram commands ──
bot.command('start', async (ctx) => {
  await ctx.reply(`📱 *DWAI Mobile Agent* — your phone, controlled by AI.

Commands:
/cmd <text> — plan & queue a task
/status <task_id> — check a task
/tasks — list all pending tasks

Example:
/cmd Open Chrome and search "OpenAI"`, { parse_mode: 'Markdown' });
});

bot.command('cmd', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /cmd <description>');
  await ctx.reply('⏳ Thinking...');

  const steps = await generatePlan(text);
  if (!steps.length) return ctx.reply('❌ Could not generate a plan. Try simpler wording.');

  const taskId = nanoid(8);
  const task = {
    task_id: taskId,
    status: 'pending',
    created_at: new Date().toISOString(),
    steps
  };

  try {
    await createTask(taskId, task);
    await ctx.reply(`✅ Task queued!\n\nID: \`${taskId}\`\nSteps: ${steps.length}`);
  } catch (e) {
    console.error('GitHub write failed:', e);
    await ctx.reply('❌ Failed to save task (GitHub error).');
  }
});

bot.command('status', async (ctx) => {
  const taskId = ctx.message.text.split(' ')[1];
  if (!taskId) return ctx.reply('Usage: /status <task_id>');
  try {
    const result = await getTask(taskId);
    await ctx.reply(`📋 Task *${taskId}*\nStatus: \`${result.status}\`\nCreated: ${result.created_at}\nSteps: ${result.steps.length}`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Task not found or error.');
  }
});

// ── Health endpoint ──
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Start ──
app.listen(PORT, () => {
  console.log(`🩺 Server on ${PORT}/health`);
  bot.launch();
  console.log('🤖 Telegram bot launched');
});

process.on('SIGINT', () => { bot.stop(); app.close(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); app.close(); process.exit(0); });
