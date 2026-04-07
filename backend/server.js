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

function createTask(taskId, data, taskType = 'automation', intent = '') {
  const path = `data/tasks/${taskId}.json`;
  const contentBase64 = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const url = `${GITHUB_API}/${path}`;
  return ghPut(url, { 
    message: `Create task ${taskId}`, 
    content: contentBase64,
    branch: "main"
  });
}

// ❗ VALIDATION - Validate every step
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
  
  // Max steps check
  if (steps.length > 20) return { valid: false, error: 'Too many steps (max 20)' };
  
  return { valid: true };
}

// ❗ IMPROVED PROMPT - Stricter output format
async function generatePlan(userText) {
  const prompt = `You are DWAI Mobile Agent - a STRICT mobile automation planner.

OUTPUT STRICT JSON ONLY - no text, no explanation.

Format:
{
  "steps": [...],
  "reasoning": "short explanation",
  "confidence": 0-1
}

RULES:
- NEVER return plain text
- ALWAYS include wait after UI actions (1000-5000ms)
- ALWAYS prefer selectors (contains, desc) over coordinates
- DO NOT hallucinate UI elements
- Keep steps under 20
- For click: use "contains" or "desc" first, x/y as fallback
- For launch_app: use known package names

VALID ACTIONS:
- {"action":"launch_app","value":"package_name"}
- {"action":"click","contains":"text"} or {"action":"click","x":540,"y":300}
- {"action":"type","text":"string"}
- {"action":"press","key":"enter|back|home"}
- {"action":"wait","ms":3000}
- {"action":"toast","text":"message"}

COMMON APPS:
- YouTube: com.google.android.youtube
- Chrome: com.android.chrome
- WhatsApp: com.whatsapp

User task: "${userText}"`;

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'You are DWAI Mobile Agent. Output ONLY valid JSON with "steps" array.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1, // Lower temp for more precise output
    max_tokens: 1500
  });

  const raw = res.choices[0].message.content.trim();
  
  // Try to parse as full JSON first
  try {
    const parsed = JSON.parse(raw);
    if (parsed.steps && Array.isArray(parsed.steps)) {
      return parsed.steps;
    }
  } catch (e) {}
  
  // Fallback: extract array from text
  const jsonStart = raw.search('[');
  const jsonEnd = raw.lastIndexOf(']') + 1;
  if (jsonStart === -1) return [];
  const jsonStr = raw.slice(jsonStart, jsonEnd);
  try { return JSON.parse(jsonStr); } catch { return []; }
}

bot.command('start', async (ctx) => {
  await ctx.reply('DWAI Mobile Agent v2 – your phone, controlled by AI.\n\nCommands:\n/cmd <text> – plan & queue a task\n/status <task_id> – check a task\n/tasks – list pending tasks\n\nExample:\n/cmd Open YouTube and search for AI');
});

bot.command('cmd', async (ctx) => {
  const text = ctx.message.text.split(' ').slice(1).join(' ');
  if (!text) return ctx.reply('Usage: /cmd <description>');
  
  await ctx.reply('🤔 Planning...');
  const steps = await generatePlan(text);
  
  // ❗ VALIDATION - Check steps before creating task
  const validation = validateSteps(steps);
  if (!validation.valid) {
    return ctx.reply(`❌ Invalid plan: ${validation.error}\nTry again with a simpler task.`);
  }
  
  const taskId = nanoid(8);
  
  // ❗ ADDED: task type and intent
  const task = { 
    task_id: taskId, 
    status: 'pending', 
    intent: text,  // Store original intent
    type: 'automation',  // Task type
    created_at: new Date().toISOString(), 
    steps 
  };
  
  try {
    await createTask(taskId, task);
    await ctx.reply(`✅ Task queued!\n\nID: ${taskId}\nSteps: ${steps.length}\nIntent: ${text}\n\nPreview:\n${JSON.stringify(steps.slice(0, 3), null, 2)}${steps.length > 3 ? '\n...' : ''}`);
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Failed to save task. Check GitHub config.');
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
    
    // Better status display
    let statusIcon = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '⏳';
    await ctx.reply(`${statusIcon} Task ${taskId}\n\nStatus: ${task.status}\nIntent: ${task.intent || 'N/A'}\nType: ${task.type || 'automation'}\nCreated: ${task.created_at}\nSteps: ${task.steps.length}\n${task.completed_at ? 'Completed: ' + task.completed_at : ''}\n${task.error ? 'Error: ' + task.error : ''}`);
  } catch (e) {
    console.error(e);
    await ctx.reply('❌ Task not found.');
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
    if (!files.length) return ctx.reply('📭 No pending tasks.');
    await ctx.reply(`📋 Pending tasks (${files.length}):\n\n${files.map(f => f.name.replace('.json', '')).join('\n')}`);
  } catch (e) {
    await ctx.reply('❌ Could not fetch tasks.');
  }
});

// ❗ FEEDBACK LOOP - Log endpoint (for future AutoX integration)
app.post('/log', express.json(), (req, res) => {
  const { task_id, status, result, error } = req.body;
  console.log(`[LOG] ${task_id}: ${status} - ${error || result || ''}`);
  res.json({ received: true });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  bot.launch();
});

process.on('SIGINT', () => { bot.stop(); process.exit(0); });
process.on('SIGTERM', () => { bot.stop(); process.exit(0); });