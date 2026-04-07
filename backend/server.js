require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const https = require('https');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3-32b';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY required');
if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN required');
if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error('GITHUB_TOKEN and GITHUB_REPO required');

const groq = new Groq({ apiKey: GROQ_API_KEY });
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

app.use(express.json());

const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
const TASKS_PATH = 'data/tasks';
const LOGS_PATH = 'data/logs';
const ROUTES_PATH = 'data/routes';
const CURRENT_TASK_PATH = 'data/current_task.json';

const APP_REGISTRY = {
  youtube: { aliases: ['yt', 'you tube'], package: 'com.google.android.youtube' },
  chrome: { aliases: ['browser', 'google chrome'], package: 'com.android.chrome' },
  whatsapp: { aliases: ['whatsapp business'], package: 'com.whatsapp' },
  calculator: { aliases: ['calc'], package: 'com.android.calculator2' },
  camera: { aliases: [], package: 'com.android.camera2' },
  photos: { aliases: ['gallery'], package: 'com.google.android.apps.photos' },
  settings: { aliases: [], package: 'com.android.settings' },
  phone: { aliases: ['dialer'], package: 'com.android.dialer' },
  messages: { aliases: ['sms'], package: 'com.android.mms' },
  gmail: { aliases: [], package: 'com.google.android.gm' },
  maps: { aliases: ['google maps'], package: 'com.google.android.apps.maps' },
  spotify: { aliases: [], package: 'com.spotify.music' },
  facebook: { aliases: [], package: 'com.facebook.katana' },
  instagram: { aliases: [], package: 'com.instagram.android' },
  twitter: { aliases: ['x'], package: 'com.twitter.android' },
  telegram: { aliases: [], package: 'org.telegram.messenger' },
  signal: { aliases: [], package: 'org.thoughtcrime.securesms' },
  discord: { aliases: [], package: 'com.discord' },
  slack: { aliases: [], package: 'com.Slack' },
  zoom: { aliases: [], package: 'us.zoom.videomeetings' },
};

const ALLOWED_ACTIONS = new Set([
  'launch_app',
  'click',
  'type',
  'press',
  'wait',
  'toast',
  'swipe',
  'verify',
  'open_url',
]);

function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DWAI/1.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function githubRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, headers: ghHeaders() },
      (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            statusCode: res.statusCode,
            body: d,
          });
        });
      }
    );

    req.on('error', reject);

    if (body !== undefined && body !== null) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }

    req.end();
  });
}

async function ghGetJson(url) {
  const res = await githubRequest('GET', url);
  let json = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }
  return { ...res, json };
}

async function ghPutJson(url, body) {
  return githubRequest('PUT', url, body);
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLaunchValue(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;

  if (APP_REGISTRY[v]) return v;

  for (const [canonical, info] of Object.entries(APP_REGISTRY)) {
    if (info.package && info.package.toLowerCase() === v) return canonical;
    if ((info.aliases || []).some((a) => a.toLowerCase() === v)) return canonical;
  }

  if (v.includes('.')) return v;
  return null;
}

function findAppCanonical(text) {
  const lower = String(text || '').toLowerCase();
  const entries = Object.entries(APP_REGISTRY).sort((a, b) => b[0].length - a[0].length);

  for (const [canonical, info] of entries) {
    const patterns = [canonical, ...(info.aliases || [])];
    for (const p of patterns) {
      const re = new RegExp(`\\b${escapeRegExp(p.toLowerCase())}\\b`, 'i');
      if (re.test(lower)) return canonical;
    }
  }

  return null;
}

function cleanQuery(q) {
  return String(q || '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^[\s:,-]*(a|an|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSearchQuery(text) {
  const input = String(text || '').trim();

  const patterns = [
    /search(?:\s+for)?\s+(.+)$/i,
    /find(?:\s+me)?\s+(.+)$/i,
    /look(?:\s+for)?\s+(.+)$/i,
    /browse(?:\s+for)?\s+(.+)$/i,
    /play\s+(.+)$/i,
    /watch\s+(.+)$/i,
  ];

  for (const re of patterns) {
    const m = input.match(re);
    if (m && m[1]) {
      const q = cleanQuery(m[1]);
      if (q) return q;
    }
  }

  return null;
}

function quickIntent(message) {
  const t = String(message || '').trim().toLowerCase();
  if (!t) return { intent: 'CHAT' };

  if (/^(hi|hello|hey|yo|good morning|good afternoon|good evening)\b/.test(t)) {
    return { intent: 'CHAT' };
  }
  if (/\b(help|commands?)\b/.test(t)) return { intent: 'HELP' };
  if (/\b(status|task status|check task|tasks?|queue)\b/.test(t)) return { intent: 'STATUS' };

  if (/(open|launch|search|find|look for|go to|start|watch|play|type|click|send|scroll)/.test(t)) {
    return { intent: 'TASK' };
  }

  return null;
}

function buildAppHintsText() {
  return Object.keys(APP_REGISTRY).join(', ');
}

function isStepValid(step) {
  if (!step || typeof step !== 'object') return false;
  if (!step.action || !ALLOWED_ACTIONS.has(step.action)) return false;

  switch (step.action) {
    case 'launch_app':
      return typeof step.value === 'string' && step.value.trim().length > 0;
    case 'click':
      return Boolean(
        step.text ||
          step.contains ||
          step.desc ||
          (typeof step.x === 'number' && typeof step.y === 'number')
      );
    case 'type':
      return typeof step.text === 'string' && step.text.trim().length > 0;
    case 'press':
      return ['enter', 'back', 'home', 'menu'].includes(String(step.key || '').toLowerCase());
    case 'wait':
      return Number(step.ms) >= 0;
    case 'toast':
      return true;
    case 'swipe':
      return (
        typeof step.x1 === 'number' &&
        typeof step.y1 === 'number' &&
        typeof step.x2 === 'number' &&
        typeof step.y2 === 'number'
      );
    case 'verify':
      return true;
    case 'open_url':
      return typeof step.value === 'string' && step.value.trim().length > 0;
    default:
      return false;
  }
}

function sanitizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) return [];

  const out = [];
  for (let i = 0; i < rawSteps.length; i++) {
    const original = rawSteps[i];
    if (!original || typeof original !== 'object' || !original.action) continue;
    if (!ALLOWED_ACTIONS.has(original.action)) continue;

    const step = JSON.parse(JSON.stringify(original));

    if (step.action === 'launch_app') {
      const normalized = normalizeLaunchValue(step.value);
      if (!normalized) continue;
      step.value = normalized;
    }

    if (step.action === 'wait') {
      const ms = Number(step.ms);
      step.ms = Number.isFinite(ms) && ms >= 0 ? ms : 1000;
    }

    if (step.action === 'type') {
      step.text = String(step.text || step.value || '').trim();
      if (!step.text) continue;
    }

    if (step.action === 'press') {
      step.key = String(step.key || '').toLowerCase();
      if (!['enter', 'back', 'home', 'menu'].includes(step.key)) continue;
    }

    if (step.action === 'verify') {
      if (!step.contains && !step.text && !step.desc && !step.package) continue;
    }

    if (!isStepValid(step)) continue;

    out.push(step);

    if (step.action === 'launch_app') {
      const next = rawSteps[i + 1];
      if (!next || next.action !== 'wait') {
        out.push({ action: 'wait', ms: 4000 });
      }
    }
  }

  return out.slice(0, 20);
}

function buildTemplateSteps(userText) {
  const text = String(userText || '');
  const lower = text.toLowerCase();

  const app = findAppCanonical(lower);
  const query = extractSearchQuery(text);
  const wantsSearch = /\b(search|find|look for|browse)\b/.test(lower);
  const wantsFirstResult = /\b(first|first one|watch|video|result|open the first)\b/.test(lower);
  const wantsLaunch = /\b(open|launch|start|go to)\b/.test(lower);

  if (app && wantsLaunch && !wantsSearch) {
    return sanitizeSteps([
      { action: 'launch_app', value: app },
      { action: 'wait', ms: 4000 },
      { action: 'verify', package: app },
    ]);
  }

  if (wantsSearch) {
    const targetApp = app === 'youtube' ? 'youtube' : 'chrome';
    const clickStep =
      targetApp === 'youtube'
        ? {
            action: 'click',
            text: 'Search',
            contains: 'Search',
            desc: 'Search',
            fallbacks: [{ action: 'click', x: 650, y: 120 }],
          }
        : {
            action: 'click',
            text: 'Search or type URL',
            contains: 'Search',
            desc: 'Search',
            fallbacks: [{ action: 'click', x: 650, y: 120 }],
          };

    const steps = [
      { action: 'launch_app', value: targetApp },
      { action: 'wait', ms: 4000 },
      clickStep,
      { action: 'wait', ms: 1000 },
      { action: 'type', text: query || cleanQuery(text) || text },
      { action: 'press', key: 'enter' },
      { action: 'wait', ms: 4000 },
    ];

    if (targetApp === 'youtube' && wantsFirstResult) {
      steps.push({
        action: 'click',
        contains: 'views',
        desc: 'video',
        x: 360,
        y: 560,
      });
      steps.push({ action: 'wait', ms: 4000 });
    }

    return sanitizeSteps(steps);
  }

  if (app) {
    return sanitizeSteps([
      { action: 'launch_app', value: app },
      { action: 'wait', ms: 4000 },
      { action: 'verify', package: app },
    ]);
  }

  return null;
}

function extractJsonArray(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function classifyIntent(userMessage) {
  const quick = quickIntent(userMessage);
  if (quick) return quick;

  const prompt = `Classify this user message and decide what to do.

User: "${userMessage}"

Return ONLY JSON with this shape:
{
  "intent": "TASK|CHAT|STATUS|HELP",
  "action": "launch_app|click|type|search|none|respond",
  "target": "app name or search query or none",
  "response": "short response if CHAT or HELP"
}

Rules:
- If the user wants phone automation, intent must be TASK.
- If the user is just talking, intent must be CHAT.
- If they want to check tasks/status, intent must be STATUS.
- If they want help, intent must be HELP.
- No markdown.
- No extra text.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are DWAI Intent Classifier. Output ONLY JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 250,
    });

    const content = res.choices?.[0]?.message?.content?.trim() || '';
    const parsed = extractJsonObject(content);
    if (parsed && parsed.intent) return parsed;
  } catch {
    // ignore
  }

  return { intent: 'CHAT', action: 'respond', target: null, response: "I'm here. What would you like to do?" };
}

async function generateTaskSteps(userText) {
  const template = buildTemplateSteps(userText);
  if (template && template.length) return template;

  const prompt = `Convert this user request into a JSON array of Android automation steps.

User request:
"${userText}"

App labels you may use in launch_app.value:
${buildAppHintsText()}

Allowed actions:
- launch_app
- click
- type
- press
- wait
- toast
- swipe
- verify
- open_url

Rules:
- Output ONLY a JSON array.
- Do NOT output package names.
- Prefer selectors (text, contains, desc) over coordinates.
- ALWAYS add a wait after launching an app.
- Keep the sequence short and practical.
- If a safe plan is not possible, return [].

Examples:
[
  {"action":"launch_app","value":"chrome"},
  {"action":"wait","ms":4000},
  {"action":"click","contains":"Search","desc":"Search"},
  {"action":"wait","ms":1000},
  {"action":"type","text":"AI news"},
  {"action":"press","key":"enter"},
  {"action":"wait","ms":4000}
]`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are DWAI Task Planner. Output ONLY JSON array.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 900,
    });

    const content = res.choices?.[0]?.message?.content?.trim() || '';
    const parsed = extractJsonArray(content);
    if (!parsed) return [];

    return sanitizeSteps(parsed);
  } catch {
    return [];
  }
}

function validateSteps(steps) {
  if (!Array.isArray(steps)) return false;
  if (steps.length === 0 || steps.length > 20) return false;

  for (const s of steps) {
    if (!isStepValid(s)) return false;
    if (s.action === 'launch_app') {
      const normalized = normalizeLaunchValue(s.value);
      if (!normalized) return false;
    }
  }

  return true;
}

async function generateChatResponse(userMessage) {
  const prompt = `You are DWAI, a helpful assistant that can chat and help control a phone.

User: "${userMessage}"

Respond naturally and briefly.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.6,
      max_tokens: 500,
    });

    return res.choices?.[0]?.message?.content?.trim() || "I'm here. What would you like to do?";
  } catch {
    return "I'm here. What would you like to do?";
  }
}

async function createTask(taskId, taskData) {
  const taskPath = `${TASKS_PATH}/${taskId}.json`;
  const taskUrl = `${GITHUB_API}/${taskPath}`;
  const contentBase64 = Buffer.from(JSON.stringify(taskData, null, 2)).toString('base64');

  const result = await ghPutJson(taskUrl, {
    message: `Task ${taskId}`,
    content: contentBase64,
    branch: GITHUB_BRANCH,
  });

  if (!result.ok) {
    throw new Error(`GitHub create task failed: ${result.statusCode} ${result.body}`);
  }

  return taskUrl;
}

async function writeCurrentTask(pointer) {
  const url = `${GITHUB_API}/${CURRENT_TASK_PATH}`;
  const contentBase64 = Buffer.from(JSON.stringify(pointer, null, 2)).toString('base64');

  const existing = await ghGetJson(url);

  const payload = {
    message: `current task ${pointer.task_id}`,
    content: contentBase64,
    branch: GITHUB_BRANCH,
  };

  if (existing.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }

  const result = await ghPutJson(url, payload);

  if (!result.ok) {
    throw new Error(`GitHub current_task write failed: ${result.statusCode} ${result.body}`);
  }

  return result;
}

async function getTaskFileById(taskId) {
  const fileUrl = `${GITHUB_API}/${TASKS_PATH}/${taskId}.json`;
  const res = await ghGetJson(fileUrl);

  if (!res.ok || !res.json || !res.json.content) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
  return { file: res.json, task, fileUrl };
}

async function listTaskSummaries(limit = 15) {
  const folder = await ghGetJson(`${GITHUB_API}/${TASKS_PATH}`);
  if (!folder.ok || !Array.isArray(folder.json)) return [];

  const files = folder.json
    .filter((f) => f.type === 'file' && f.name !== '.gitkeep' && !f.name.endsWith('_log.json'))
    .slice(0, limit);

  const out = [];
  for (const file of files) {
    try {
      const taskBundle = await getTaskFileById(file.name.replace('.json', ''));
      const task = taskBundle.task;
      out.push({
        id: task.task_id || file.name.replace('.json', ''),
        status: task.status || 'unknown',
        intent: task.intent || '',
      });
    } catch {
      out.push({
        id: file.name.replace('.json', ''),
        status: 'unknown',
        intent: '',
      });
    }
  }

  return out;
}

async function createTeachTask(goalText) {
  const parts = String(goalText || '').trim().split(/\s+/).filter(Boolean);
  const appGuess = parts[0] ? findAppCanonical(parts[0]) : null;

  const taskId = `teach_${nanoid(8)}`;
  const task = {
    task_id: taskId,
    type: 'teach_start',
    status: 'pending',
    intent: goalText || 'teach route',
    app: appGuess,
    goal: goalText || 'teach route',
    created_at: new Date().toISOString(),
    steps: [],
    source: 'telegram',
    planner_version: 'v10',
  };

  const taskUrl = await createTask(taskId, { ...task, file_url: `${GITHUB_API}/${TASKS_PATH}/${taskId}.json` });
  await writeCurrentTask({
    task_id: taskId,
    type: 'teach_start',
    status: 'pending',
    intent: task.intent,
    app: task.app || null,
    goal: task.goal,
    file_url: taskUrl,
    created_at: task.created_at,
    source: 'telegram',
  });

  return taskId;
}

async function createStopTeachTask(goalText) {
  const taskId = `stopteach_${nanoid(8)}`;
  const task = {
    task_id: taskId,
    type: 'teach_stop',
    status: 'pending',
    intent: goalText || 'stop teach',
    goal: goalText || 'teach route',
    created_at: new Date().toISOString(),
    steps: [],
    source: 'telegram',
    planner_version: 'v10',
  };

  const taskUrl = await createTask(taskId, { ...task, file_url: `${GITHUB_API}/${TASKS_PATH}/${taskId}.json` });
  await writeCurrentTask({
    task_id: taskId,
    type: 'teach_stop',
    status: 'pending',
    intent: task.intent,
    goal: task.goal,
    file_url: taskUrl,
    created_at: task.created_at,
    source: 'telegram',
  });

  return taskId;
}

async function replyTyping(ctx) {
  try {
    await ctx.sendChatAction('typing');
  } catch {
    // ignore
  }
}

async function handleSlashCommand(ctx) {
  const text = ctx.message?.text || '';
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] || '').replace(/^\/+/, '').split('@')[0].toLowerCase();
  const argText = parts.slice(1).join(' ').trim();

  await replyTyping(ctx);

  if (cmd === 'start') {
    const apps = Object.keys(APP_REGISTRY).slice(0, 8).join(', ');
    await ctx.reply(
      `DWAI Mobile Agent\n\nI can queue phone tasks from natural language.\n\nExamples:\nOpen YouTube\nSearch for AI news\nOpen Chrome and search for a new bicycle\n\nUse /teach <goal> to record a route.\nUse /stopteach <goal> to stop recording.\nUse /offteach as an alias for /stopteach.\n\nAvailable apps: ${apps}...`
    );
    return;
  }

  if (cmd === 'help') {
    await ctx.reply(
      `Commands:\n/start\n/help\n/cmd <task>\n/teach <goal>\n/stopteach <goal>\n/offteach <goal>\n/status <task_id>\n/tasks\n\nYou can also just type naturally and I will decide whether it is a task or normal chat.`
    );
    return;
  }

  if (cmd === 'teach') {
    if (!argText) {
      await ctx.reply('Usage: /teach youtube search');
      return;
    }

    try {
      const taskId = await createTeachTask(argText);
      await ctx.reply(`Teach mode queued: ${taskId}\nGoal: ${argText}`);
    } catch (e) {
      await ctx.reply(`Failed to queue teach task: ${e.message}`);
    }
    return;
  }

  if (cmd === 'stopteach' || cmd === 'offteach') {
    if (!argText) {
      await ctx.reply('Usage: /stopteach youtube search');
      return;
    }

    try {
      const taskId = await createStopTeachTask(argText);
      await ctx.reply(`Stop-teach queued: ${taskId}\nGoal: ${argText}`);
    } catch (e) {
      await ctx.reply(`Failed to queue stop-teach task: ${e.message}`);
    }
    return;
  }

  if (cmd === 'cmd') {
    if (!argText) {
      await ctx.reply('Usage: /cmd open YouTube');
      return;
    }

    await ctx.reply('Task planning started...');
    const steps = await generateTaskSteps(argText);

    if (!validateSteps(steps)) {
      await ctx.reply('Could not build a safe task for that request.');
      return;
    }

    const taskId = nanoid(8);
    const task = {
      task_id: taskId,
      status: 'pending',
      intent: argText,
      type: 'automation',
      created_at: new Date().toISOString(),
      steps,
      source: 'telegram',
      planner_version: 'v10',
    };

    try {
      const taskUrl = await createTask(taskId, { ...task, file_url: `${GITHUB_API}/${TASKS_PATH}/${taskId}.json` });
      await writeCurrentTask({
        task_id: taskId,
        type: 'automation',
        status: 'pending',
        intent: argText,
        file_url: taskUrl,
        created_at: task.created_at,
        source: 'telegram',
      });

      await ctx.reply(
        `Task queued: ${taskId}\nSteps: ${steps.length}\nPreview:\n${JSON.stringify(steps.slice(0, 4), null, 2)}`
      );
    } catch (e) {
      await ctx.reply(`Failed to save task: ${e.message}`);
    }

    return;
  }

  if (cmd === 'status') {
    if (!argText) {
      await ctx.reply('Usage: /status <task_id>');
      return;
    }

    try {
      const bundle = await getTaskFileById(argText);
      const task = bundle.task;
      const icon = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '⏳';
      await ctx.reply(
        `${icon} ${task.task_id}\nStatus: ${task.status}\nCreated: ${task.created_at || 'unknown'}\n${task.error ? `Error: ${task.error}` : ''}`
      );
    } catch {
      await ctx.reply(`Task not found: ${argText}`);
    }

    return;
  }

  if (cmd === 'tasks') {
    try {
      const summaries = await listTaskSummaries(15);
      if (!summaries.length) {
        await ctx.reply('No tasks found.');
        return;
      }

      const lines = summaries.map((t) => `• ${t.id} — ${t.status}${t.intent ? ` — ${t.intent}` : ''}`);
      await ctx.reply(`Tasks:\n${lines.join('\n')}`);
    } catch {
      await ctx.reply('Could not fetch tasks.');
    }

    return;
  }

  await ctx.reply('Unknown command. Try /help');
}

async function handleNaturalMessage(ctx) {
  const text = ctx.message?.text;
  if (!text || text.startsWith('/')) return;

  await replyTyping(ctx);

  try {
    const classification = await classifyIntent(text);

    if (classification.intent === 'STATUS') {
      const summaries = await listTaskSummaries(10);
      if (!summaries.length) {
        await ctx.reply('No tasks found.');
      } else {
        const lines = summaries.map((t) => `• ${t.id} — ${t.status}${t.intent ? ` — ${t.intent}` : ''}`);
        await ctx.reply(`Tasks:\n${lines.join('\n')}`);
      }
      return;
    }

    if (classification.intent === 'HELP') {
      await ctx.reply(
        `I can help you create phone tasks, check task status, and chat.\nTry:\nOpen YouTube\nSearch for AI news\nCheck tasks\nTeach me YouTube search`
      );
      return;
    }

    if (classification.intent === 'TASK') {
      const steps = await generateTaskSteps(text);

      if (!validateSteps(steps)) {
        await ctx.reply('I could not build a safe task for that request.');
        return;
      }

      const taskId = nanoid(8);
      const task = {
        task_id: taskId,
        status: 'pending',
        intent: text,
        type: 'automation',
        created_at: new Date().toISOString(),
        steps,
        source: 'telegram',
        planner_version: 'v10',
      };

      const taskUrl = await createTask(taskId, { ...task, file_url: `${GITHUB_API}/${TASKS_PATH}/${taskId}.json` });
      await writeCurrentTask({
        task_id: taskId,
        type: 'automation',
        status: 'pending',
        intent: text,
        file_url: taskUrl,
        created_at: task.created_at,
        source: 'telegram',
      });

      await ctx.reply(
        `Task queued: ${taskId}\nSteps: ${steps.length}\nPreview:\n${JSON.stringify(steps.slice(0, 4), null, 2)}`
      );
      return;
    }

    const response = await generateChatResponse(text);
    await ctx.reply(response);
  } catch (e) {
    console.error(e);
    const response = await generateChatResponse(text);
    await ctx.reply(response);
  }
}

bot.hears(/^\/(start|help|cmd|status|tasks|teach|stopteach|offteach)\b/i, handleSlashCommand);
bot.on('text', handleNaturalMessage);

bot.catch((err) => {
  console.error('BOT ERROR:', err);
});

app.get('/health', async (_, res) => {
  res.json({
    status: 'ok',
    apps: Object.keys(APP_REGISTRY).length,
    model: GROQ_MODEL,
  });
});

app.listen(PORT, () => {
  console.log(`DWAI main server listening on ${PORT}`);
  bot.launch().then(() => {
    console.log('Telegram bot launched');
  }).catch((err) => {
    console.error('Bot launch failed:', err);
  });
});

process.on('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});