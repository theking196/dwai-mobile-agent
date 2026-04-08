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

// ============================================
// APP REGISTRY
// ============================================
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
  'launch_app', 'click', 'type', 'press', 'wait', 'toast', 'swipe', 'verify', 'open_url', 'observe'
]);

// ============================================
// TEACH SESSION STATE (in-memory)
// ============================================
const activeTeachSessions = new Map(); // userId -> session data

// ============================================
// GITHUB HELPERS
// ============================================
function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DWAI/2.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function githubRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers: ghHeaders() }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          body: d,
        });
      });
    });
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
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { ...res, json };
}

async function ghPutJson(url, body) {
  return githubRequest('PUT', url, body);
}

// ============================================
// UTILITIES
// ============================================
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
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
      const re = new RegExp(`\\\\b${escapeRegExp(p.toLowerCase())}\\\\b`, 'i');
      if (re.test(lower)) return canonical;
    }
  }
  return null;
}

function cleanQuery(q) {
  return String(q || '')
    .replace(/^["'\`]+|["'\`]+$/g, '')
    .replace(/^[\\s:,-]*(a|an|the)\\s+/i, '')
    .replace(/\\s+/g, ' ')
    .trim();
}

function extractSearchQuery(text) {
  const input = String(text || '').trim();
  const patterns = [
    /search(?:\\s+for)?\\s+(.+)$/i,
    /find(?:\\s+me)?\\s+(.+)$/i,
    /look(?:\\s+for)?\\s+(.+)$/i,
    /browse(?:\\s+for)?\\s+(.+)$/i,
    /play\\s+(.+)$/i,
    /watch\\s+(.+)$/i,
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

function extractMessageParts(text) {
  const input = String(text || '').trim();
  const patterns = [
    /send (?:a )?message to (.+?) saying (.+)$/i,
    /send (.+?) a message saying (.+)$/i,
    /message (.+?) saying (.+)$/i,
    /text (.+?) saying (.+)$/i,
    /send (?:a )?message to (.+?) with (.+)$/i,
  ];
  for (const re of patterns) {
    const m = input.match(re);
    if (m && m[1] && m[2]) {
      return { contact: cleanQuery(m[1]), message: cleanQuery(m[2]) };
    }
  }
  return null;
}

// ============================================
// SLOT EXTRACTION FOR DYNAMIC TEACHING
// ============================================
function extractSlotsFromExample(goal, steps) {
  const slots = [];
  const slotMap = new Map();
  
  // Common variable patterns
  const patterns = [
    { regex: /search (?:for )?(.+)/i, slotName: 'query', type: 'text' },
    { regex: /send (?:a )?message to (.+?) saying (.+)/i, slots: ['contact', 'message'], type: 'text' },
    { regex: /type (.+)/i, slotName: 'text', type: 'text' },
    { regex: /click (.+)/i, slotName: 'target', type: 'text' },
    { regex: /open (.+)/i, slotName: 'app', type: 'app' },
  ];
  
  for (const pattern of patterns) {
    const match = goal.match(pattern.regex);
    if (match) {
      if (pattern.slots) {
        pattern.slots.forEach((name, idx) => {
          if (match[idx + 1]) {
            slots.push({ name, type: pattern.type, example: match[idx + 1] });
            slotMap.set(match[idx + 1], `{${name}}`);
          }
        });
      } else if (pattern.slotName && match[1]) {
        slots.push({ name: pattern.slotName, type: pattern.type, example: match[1] });
        slotMap.set(match[1], `{${pattern.slotName}}`);
      }
    }
  }
  
  // Transform steps to use slot placeholders
  const templatedSteps = steps.map(step => {
    const newStep = { ...step };
    for (const [value, placeholder] of slotMap) {
      if (newStep.text && newStep.text.includes(value)) {
        newStep.text = placeholder;
        newStep._slotRef = placeholder;
      }
      if (newStep.value && newStep.value.includes(value)) {
        newStep.value = placeholder;
        newStep._slotRef = placeholder;
      }
    }
    return newStep;
  });
  
  return { slots, templatedSteps };
}

function fillSlots(steps, slotValues) {
  return steps.map(step => {
    const newStep = { ...step };
    for (const [slotName, value] of Object.entries(slotValues)) {
      const placeholder = `{${slotName}}`;
      if (newStep.text && newStep.text.includes(placeholder)) {
        newStep.text = newStep.text.replace(placeholder, value);
      }
      if (newStep.value && newStep.value.includes(placeholder)) {
        newStep.value = newStep.value.replace(placeholder, value);
      }
    }
    return newStep;
  });
}

// ============================================
// INTENT CLASSIFICATION
// ============================================
function quickIntent(message) {
  const t = String(message || '').trim().toLowerCase();
  if (!t) return { intent: 'CHAT' };
  
  if (/^(hi|hello|hey|yo|good morning|good afternoon|good evening)\\b/.test(t)) {
    return { intent: 'CHAT' };
  }
  if (/\\b(help|commands?)\\b/.test(t)) return { intent: 'HELP' };
  if (/\\b(status|task status|check task|tasks?|queue|routes?)\\b/.test(t)) return { intent: 'STATUS' };
  if (/^\/teach\b/.test(t)) return { intent: 'TEACH' };
  if (/^\\/stopteach\\b/.test(t)) return { intent: 'STOPTEACH' };
  if (/^\\/do\\b/.test(t)) return { intent: 'DO' };
  if (/^\\/live\\b/.test(t)) return { intent: 'LIVE' };
  if (/^\\/route\\b/.test(t)) return { intent: 'ROUTE' };
  
  if (/(open|launch|search|find|look for|go to|start|watch|play|type|click|send|scroll)/.test(t)) {
    return { intent: 'TASK' };
  }
  return null;
}

async function classifyIntent(userMessage) {
  const quick = quickIntent(userMessage);
  if (quick) return quick;
  
  const prompt = `Classify this user message and decide what to do.
User: "${userMessage}"

Return ONLY JSON with this shape:
{
  "intent": "TASK|CHAT|STATUS|HELP|TEACH|STOPTEACH|DO|LIVE|ROUTE",
  "action": "launch_app|click|type|search|none|respond",
  "target": "app name or search query or none",
  "response": "short response if CHAT or HELP"
}

# Rules:
- If the user wants phone automation, intent must be TASK.
- If the user is just talking, intent must be CHAT.
- If they want to check tasks/status/routes, intent must be STATUS.
- If they want help, intent must be HELP.
- If they are asking to teach (/teach), intent must be TEACH.
- If they are asking to stop teaching (/stopteach), intent must be STOPTEACH.
- If they want fast execution (/do), intent must be DO.
- If they want live observation mode (/live), intent must be LIVE.
- If they want to use a route (/route), intent must be ROUTE.
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

// ============================================
// STEP VALIDATION & SANITIZATION
// ============================================
function isStepValid(step) {
  if (!step || typeof step !== 'object') return false;
  if (!step.action || !ALLOWED_ACTIONS.has(step.action)) return false;
  
  switch (step.action) {
    case 'launch_app':
      return typeof step.value === 'string' && step.value.trim().length > 0;
    case 'click':
      return Boolean(step.text || step.contains || step.desc || (typeof step.x === 'number' && typeof step.y === 'number'));
    case 'type':
      return typeof step.text === 'string' && step.text.trim().length > 0;
    case 'press':
      return ['enter', 'back', 'home', 'menu'].includes(String(step.key || '').toLowerCase());
    case 'wait':
      return Number(step.ms) >= 0;
    case 'toast':
      return true;
    case 'swipe':
      return typeof step.x1 === 'number' && typeof step.y1 === 'number' && typeof step.x2 === 'number' && typeof step.y2 === 'number';
    case 'verify':
      return true;
    case 'open_url':
      return typeof step.value === 'string' && step.value.trim().length > 0;
    case 'observe':
      return true;
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

function buildAppHintsText() {
  return Object.keys(APP_REGISTRY).join(', ');
}

// ============================================
// TEMPLATE BUILDERS
// ============================================
function buildTemplateSteps(userText) {
  const text = String(userText || '');
  const lower = text.toLowerCase();
  const app = findAppCanonical(lower);
  const query = extractSearchQuery(text);
  const msgParts = extractMessageParts(text);
  
  const wantsSearch = /\\b(search|find|look for|browse)\\b/.test(lower);
  const wantsMessage = /\\b(send|message|text)\\b/.test(lower) && /\\bto\\b/.test(lower);
  const wantsFirstResult = /\\b(first|first one|watch|video|result|open the first)\\b/.test(lower);
  const wantsLaunch = /\\b(open|launch|start|go to)\\b/.test(lower);
  
  if (app && wantsLaunch && !wantsSearch && !wantsMessage) {
    return sanitizeSteps([
      { action: 'launch_app', value: app },
      { action: 'wait', ms: 4000 },
      { action: 'verify', package: app },
    ]);
  }
  
  if (wantsMessage) {
    const contact = msgParts ? msgParts.contact : cleanQuery(text.replace(/^.*?to\\s+/i, '').replace(/\\s+say.*$/i, ''));
    const message = msgParts ? msgParts.message : cleanQuery(text);
    return sanitizeSteps([
      { action: 'launch_app', value: 'whatsapp' },
      { action: 'wait', ms: 4000 },
      { action: 'click', text: 'Search', contains: 'Search', desc: 'Search', fallbacks: [{ action: 'click', x: 650, y: 120 }] },
      { action: 'wait', ms: 1000 },
      { action: 'type', text: contact || '' },
      { action: 'press', key: 'enter' },
      { action: 'wait', ms: 2500 },
      { action: 'type', text: message || '' },
      { action: 'press', key: 'enter' },
      { action: 'wait', ms: 2000 },
    ]);
  }
  
  if (wantsSearch) {
    const targetApp = app === 'youtube' ? 'youtube' : 'chrome';
    const clickStep = targetApp === 'youtube'
      ? { action: 'click', text: 'Search', contains: 'Search', desc: 'Search', fallbacks: [{ action: 'click', x: 650, y: 120 }] }
      : { action: 'click', text: 'Search or type URL', contains: 'Search', desc: 'Search', fallbacks: [{ action: 'click', x: 650, y: 120 }] };
    
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
      steps.push({ action: 'click', contains: 'views', desc: 'video', x: 360, y: 560 });
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

// ============================================
// AI STEP GENERATION
// ============================================
async function generateTaskSteps(userText) {
  const template = buildTemplateSteps(userText);
  if (template && template.length) return template;
  
  const prompt = `Convert this user request into a JSON array of Android automation steps.
User request: "${userText}"

App labels you may use in launch_app.value: ${buildAppHintsText()}

Allowed actions: launch_app, click, type, press, wait, toast, swipe, verify, open_url

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

async function generateLiveSteps(userText) {
  // Generate steps with observation checkpoints for live mode
  const baseSteps = await generateTaskSteps(userText);
  
  // Insert observation steps between actions
  const liveSteps = [];
  for (let i = 0; i < baseSteps.length; i++) {
    liveSteps.push(baseSteps[i]);
    // Add observation after significant actions
    if (['launch_app', 'click', 'type', 'press'].includes(baseSteps[i].action)) {
      liveSteps.push({ 
        action: 'observe', 
        purpose: 'verify_state',
        on_mismatch: 'replan',
        timeout: 5000
      });
    }
  }
  return liveSteps;
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

// ============================================
// JSON EXTRACTION
// ============================================
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

// ============================================
// GITHUB OPERATIONS
// ============================================
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

async function getRouteById(routeId) {
  const fileUrl = `${GITHUB_API}/${ROUTES_PATH}/${routeId}.json`;
  const res = await ghGetJson(fileUrl);
  if (!res.ok || !res.json || !res.json.content) return null;
  try {
    return JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function saveRoute(routeId, routeData) {
  const fileUrl = `${GITHUB_API}/${ROUTES_PATH}/${routeId}.json`;
  const contentBase64 = Buffer.from(JSON.stringify(routeData, null, 2)).toString('base64');
  const existing = await ghGetJson(fileUrl);
  
  const payload = {
    message: `Route ${routeId}`,
    content: contentBase64,
    branch: GITHUB_BRANCH,
  };
  
  if (existing.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }
  
  const result = await ghPutJson(fileUrl, payload);
  if (!result.ok) {
    throw new Error(`GitHub save route failed: ${result.statusCode}`);
  }
  return result;
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

async function listRouteSummaries(limit = 15) {
  const folder = await ghGetJson(`${GITHUB_API}/${ROUTES_PATH}`);
  if (!folder.ok || !Array.isArray(folder.json)) return [];
  
  const files = folder.json
    .filter((f) => f.type === 'file' && f.name !== '.gitkeep')
    .slice(0, limit);
  
  const out = [];
  for (const file of files) {
    try {
      const routeFile = await ghGetJson(file.url);
      const route = JSON.parse(Buffer.from(routeFile.json.content, 'base64').toString('utf8'));
      out.push({
        id: route.route_id || file.name.replace('.json', ''),
        goal: route.goal || '',
        app: route.app || '',
      });
    } catch {
      out.push({
        id: file.name.replace('.json', ''),
        goal: '',
        app: '',
      });
    }
  }
  return out;
}

// ============================================
// ROUTE MATCHING ENGINE
// ============================================
async function findMatchingRoute(userText) {
  const routes = await listRouteSummaries(50);
  if (routes.length === 0) return null;
  
  const lowerText = userText.toLowerCase();
  
  // Score each route by similarity
  let bestMatch = null;
  let bestScore = 0;
  
  for (const route of routes) {
    if (!route.goal) continue;
    
    const goalLower = route.goal.toLowerCase();
    let score = 0;
    
    // Exact match
    if (goalLower === lowerText) score = 100;
    // Contains match
    else if (lowerText.includes(goalLower) || goalLower.includes(lowerText)) score = 80;
    // Word overlap
    else {
      const textWords = lowerText.split(/\\s+/);
      const goalWords = goalLower.split(/\\s+/);
      const overlap = textWords.filter(w => goalWords.includes(w)).length;
      score = (overlap / Math.max(textWords.length, goalWords.length)) * 60;
    }
    
    // Boost if app matches
    const app = findAppCanonical(lowerText);
    if (app && route.app === app) score += 20;
    
    if (score > bestScore && score > 40) {
      bestScore = score;
      bestMatch = route;
    }
  }
  
  if (bestMatch) {
    return await getRouteById(bestMatch.id);
  }
  return null;
}

async function extractSlotsFromUserInput(route, userText) {
  const slotValues = {};
  
  if (!route.slots || route.slots.length === 0) return slotValues;
  
  // Use AI to extract slot values
  const prompt = `Extract values for these slots from the user input.
Route goal template: "${route.goal}"
Slots needed: ${route.slots.map(s => s.name).join(', ')}
User input: "${userText}"

Return ONLY JSON: {"slotName": "extracted value", ...}
If a slot cannot be filled, omit it or use null.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Extract slot values. Output ONLY JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });
    const content = res.choices?.[0]?.message?.content?.trim() || '';
    const parsed = extractJsonObject(content);
    if (parsed) {
      for (const [key, value] of Object.entries(parsed)) {
        if (value && value !== 'null') slotValues[key] = value;
      }
    }
  } catch {
    // Fallback: regex extraction
    for (const slot of route.slots) {
      if (slot.example) {
        const pattern = new RegExp(slot.example.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'), 'i');
        const match = userText.match(pattern);
        if (match) slotValues[slot.name] = match[0];
      }
    }
  }
  
  return slotValues;
}

// ============================================
// TEACH MODE HANDLERS
// ============================================
async function startTeachSession(userId, goal) {
  const taskId = 'teach_' + nanoid(8);
  const app = findAppCanonical(goal) || 'unknown';
  
  const teachTask = {
    task_id: taskId,
    type: 'teach_start',
    status: 'pending',
    intent: 'TEACH',
    goal: goal,
    app: app,
    created_at: new Date().toISOString(),
    user_id: userId,
  };
  
  const fileUrl = await createTask(taskId, teachTask);
  
  // Write to current_task for immediate pickup
  await writeCurrentTask({
    task_id: taskId,
    type: 'teach_start',
    status: 'pending',
    file_url: fileUrl,
    created_at: new Date().toISOString(),
  });
  
  // Store session data
  activeTeachSessions.set(userId, {
    taskId,
    goal,
    app,
    startedAt: Date.now(),
    fileUrl,
  });
  
  return { taskId, fileUrl };
}

async function stopTeachSession(userId) {
  const session = activeTeachSessions.get(userId);
  if (!session) {
    return { error: 'No active teach session' };
  }
  
  const taskId = 'stop_' + nanoid(8);
  
  const stopTask = {
    task_id: taskId,
    type: 'teach_stop',
    status: 'pending',
    intent: 'STOPTEACH',
    goal: session.goal,
    app: session.app,
    parent_task_id: session.taskId,
    created_at: new Date().toISOString(),
    user_id: userId,
  };
  
  const fileUrl = await createTask(taskId, stopTask);
  
  await writeCurrentTask({
    task_id: taskId,
    type: 'teach_stop',
    status: 'pending',
    file_url: fileUrl,
    created_at: new Date().toISOString(),
  });
  
  activeTeachSessions.delete(userId);
  
  return { taskId, fileUrl, previousSession: session };
}

// ============================================
// TASK CREATION HELPERS
// ============================================
async function createRegularTask(userText, intent, mode = 'normal') {
  const taskId = nanoid(12);
  
  let steps = [];
  let routeMatched = null;
  let slotValues = {};
  
  // Try route matching first
  if (intent === 'TASK' || intent === 'DO' || intent === 'LIVE') {
    const matchedRoute = await findMatchingRoute(userText);
    if (matchedRoute) {
      routeMatched = matchedRoute.route_id;
      slotValues = await extractSlotsFromUserInput(matchedRoute, userText);
      steps = fillSlots(matchedRoute.steps, slotValues);
    }
  }
  
  // If no route match, generate steps
  if (steps.length === 0) {
    if (mode === 'live') {
      steps = await generateLiveSteps(userText);
    } else {
      steps = await generateTaskSteps(userText);
    }
  }
  
  const task = {
    task_id: taskId,
    type: 'automation',
    status: 'pending',
    intent: intent,
    mode: mode,
    goal: userText,
    steps: steps,
    route_matched: routeMatched,
    slot_values: slotValues,
    created_at: new Date().toISOString(),
    validate_steps: true,
  };
  
  const fileUrl = await createTask(taskId, task);
  
  await writeCurrentTask({
    task_id: taskId,
    type: 'automation',
    status: 'pending',
    file_url: fileUrl,
    mode: mode,
    created_at: new Date().toISOString(),
  });
  
  return { taskId, fileUrl, steps, routeMatched };
}

// ============================================
// TELEGRAM HANDLERS
// ============================================
const userSessions = new Map();

bot.command('start', async (ctx) => {
  await ctx.reply(`👋 Welcome to DWAI Mobile Agent v2!

Available commands:
/do <task> - Fast execution using learned routes
/live <task> - Execute with observation and adaptation
/teach <goal> - Start teaching a new route
/stopteach - Stop teaching and save the route
/route <task> - Use a specific route
/status - Check task queue and routes
/help - Show this help

Examples:
/do open chrome and search for AI news
/live send a message to John saying hello
/teach search for {query} on youtube`);
});

bot.command('help', async (ctx) => {
  await ctx.reply(`📱 DWAI Commands:

**Execution Modes:**
/do <task> - Fast execution (uses routes, minimal observation)
/live <task> - Live mode (observes, verifies, adapts)

**Teaching:**
/teach <goal> - Start recording your actions
/stopteach - Stop and save as reusable route

**Route Management:**
/route <task> - Execute using best matching route
/status - View recent tasks and routes

**Teaching Tips:**
- Use {variable} syntax for dynamic values
- Example: /teach search for {query} on youtube
- The agent will learn to extract "query" from your commands`);
});

bot.command('status', async (ctx) => {
  try {
    const [tasks, routes] = await Promise.all([
      listTaskSummaries(10),
      listRouteSummaries(10),
    ]);
    
    let msg = '📊 **Recent Tasks:**\\n';
    if (tasks.length === 0) {
      msg += 'No recent tasks\\n';
    } else {
      tasks.forEach(t => {
        msg += `• ${t.id.substring(0, 8)}... - ${t.status} (${t.intent})\\n`;
      });
    }
    
    msg += '\\n📚 **Learned Routes:**\\n';
    if (routes.length === 0) {
      msg += 'No routes learned yet. Use /teach to create one.';
    } else {
      routes.forEach(r => {
        msg += `• ${r.goal || r.id.substring(0, 8)} (${r.app})\\n`;
      });
    }
    
    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply('❌ Error fetching status: ' + e.message);
  }
});

bot.command('teach', async (ctx) => {
  const userId = ctx.from.id;
  const goal = ctx.message.text.replace(/^\\/teach\\s*/, '').trim();
  
  if (!goal) {
    await ctx.reply('❌ Please specify what you want to teach. Example: `/teach search for {query} on youtube`');
    return;
  }
  
  // Check if already teaching
  if (activeTeachSessions.has(userId)) {
    await ctx.reply('⚠️ You already have an active teach session. Use /stopteach to finish it first.');
    return;
  }
  
  try {
    const { taskId } = await startTeachSession(userId, goal);
    await ctx.reply(`🎓 **Teach Mode Started**\\n\\nGoal: ${goal}\\nTask ID: ${taskId}\\n\\n1. The agent will lock to the target app\\n2. Perform the actions you want to record\\n3. Use /stopteach when done\\n\\nThe agent is now waiting for your actions...`);
  } catch (e) {
    await ctx.reply('❌ Failed to start teach mode: ' + e.message);
  }
});

bot.command('stopteach', async (ctx) => {
  const userId = ctx.from.id;
  
  try {
    const result = await stopTeachSession(userId);
    if (result.error) {
      await ctx.reply('❌ ' + result.error);
      return;
    }
    await ctx.reply(`✅ **Teach Mode Stopped**\\n\\nGoal: ${result.previousSession.goal}\\n\\nThe route has been saved. You can now use:\\n\\n/do ${result.previousSession.goal}\\n\\nOr with variations:\\n/live ${result.previousSession.goal.replace(/\\{.*?\\}/g, 'something')}`);
  } catch (e) {
    await ctx.reply('❌ Error stopping teach mode: ' + e.message);
  }
});

bot.command('do', async (ctx) => {
  const taskText = ctx.message.text.replace(/^\\/do\\s*/, '').trim();
  
  if (!taskText) {
    await ctx.reply('❌ Please specify a task. Example: `/do open chrome and search for news`');
    return;
  }
  
  try {
    const { taskId, steps, routeMatched } = await createRegularTask(taskText, 'DO', 'fast');
    
    let msg = `⚡ **Fast Execution**\\n\\nTask: ${taskText}\\nID: ${taskId}`;
    if (routeMatched) {
      msg += `\\n📚 Using route: ${routeMatched}`;
    }
    msg += `\\n\\nSteps (${steps.length}):\\n`;
    steps.slice(0, 5).forEach((s, i) => {
      msg += `${i + 1}. ${s.action}${s.value ? ': ' + s.value : ''}${s.text ? ': ' + s.text : ''}\\n`;
    });
    if (steps.length > 5) msg += `... and ${steps.length - 5} more\\n`;
    msg += '\\nExecuting now...';
    
    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply('❌ Error creating task: ' + e.message);
  }
});

bot.command('live', async (ctx) => {
  const taskText = ctx.message.text.replace(/^\\/live\\s*/, '').trim();
  
  if (!taskText) {
    await ctx.reply('❌ Please specify a task. Example: `/live search for shoes on amazon`');
    return;
  }
  
  try {
    const { taskId, steps, routeMatched } = await createRegularTask(taskText, 'LIVE', 'live');
    
    let msg = `👁️ **Live Mode**\\n\\nTask: ${taskText}\\nID: ${taskId}`;
    if (routeMatched) {
      msg += `\\n📚 Using route: ${routeMatched}`;
    }
    msg += `\\n\\nThe agent will:\\n`;
    msg += `• Execute each step\\n`;
    msg += `• Observe screen state\\n`;
    msg += `• Verify results\\n`;
    msg += `• Adapt if needed\\n`;
    msg += `\\nStarting now...`;
    
    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply('❌ Error creating live task: ' + e.message);
  }
});

bot.command('route', async (ctx) => {
  const taskText = ctx.message.text.replace(/^\\/route\\s*/, '').trim();
  
  if (!taskText) {
    await ctx.reply('❌ Please specify a task to route.');
    return;
  }
  
  try {
    const matchedRoute = await findMatchingRoute(taskText);
    if (!matchedRoute) {
      await ctx.reply('❌ No matching route found. Try /do or /live instead, or teach this task first.');
      return;
    }
    
    const slotValues = await extractSlotsFromUserInput(matchedRoute, taskText);
    const filledSteps = fillSlots(matchedRoute.steps, slotValues);
    
    const { taskId } = await createRegularTask(taskText, 'ROUTE', 'routed');
    
    let msg = `📚 **Route Match**\\n\\nRoute: ${matchedRoute.goal}\\nApp: ${matchedRoute.app}\\n\\n`;
    if (Object.keys(slotValues).length > 0) {
      msg += `Extracted values:\\n`;
      for (const [k, v] of Object.entries(slotValues)) {
        msg += `• ${k}: ${v}\\n`;
      }
    }
    msg += `\\nExecuting ${filledSteps.length} steps...`;
    
    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

// Handle regular messages
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  
  // Skip commands
  if (text.startsWith('/')) return;
  
  try {
    const classification = await classifyIntent(text);
    
    switch (classification.intent) {
      case 'CHAT':
        const response = await generateChatResponse(text);
        await ctx.reply(response);
        break;
        
      case 'HELP':
        await ctx.reply(`Available commands:
/do <task> - Fast execution
/live <task> - Live observation mode
/teach <goal> - Teach a new route
/stopteach - Stop teaching
/status - Check queue
/help - Show help`);
        break;
        
      case 'STATUS':
        await ctx.reply('Use /status to see tasks and routes.');
        break;
        
      case 'TASK':
        // Default to /do behavior for natural language
        const { taskId, steps } = await createRegularTask(text, 'TASK', 'normal');
        await ctx.reply(`🤖 I'll help with that.\\n\\nTask ID: ${taskId}\\nSteps: ${steps.length}\\n\\nExecuting...`);
        break;
        
      default:
        await ctx.reply('I understood you want to ' + classification.intent + '. Use specific commands like /do or /live for better control.');
    }
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

// ============================================
// HTTP ENDPOINTS
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '2.0',
    modes: ['do', 'live', 'teach', 'route'],
    activeTeachSessions: activeTeachSessions.size
  });
});

app.post('/task', async (req, res) => {
  try {
    const { text, mode = 'normal', user_id } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    
    const intent = mode === 'live' ? 'LIVE' : 'TASK';
    const result = await createRegularTask(text, intent, mode);
    
    res.json({
      success: true,
      task_id: result.taskId,
      mode: mode,
      steps_count: result.steps.length,
      route_matched: result.routeMatched,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/teach/start', async (req, res) => {
  try {
    const { goal, user_id } = req.body;
    if (!goal) return res.status(400).json({ error: 'goal required' });
    
    const result = await startTeachSession(user_id || 'api', goal);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/teach/stop', async (req, res) => {
  try {
    const { user_id } = req.body;
    const result = await stopTeachSession(user_id || 'api');
    if (result.error) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/routes', async (req, res) => {
  try {
    const routes = await listRouteSummaries(50);
    res.json({ routes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/routes/:id', async (req, res) => {
  try {
    const route = await getRouteById(req.params.id);
    if (!route) return res.status(404).json({ error: 'Route not found' });
    res.json(route);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// STARTUP
// ============================================
app.listen(PORT, () => {
  console.log(`DWAI Server v2.0 running on port ${PORT}`);
  console.log(`Modes: /do (fast), /live (observation), /teach (record), /route (reuse)`);
});

bot.launch();
console.log('Telegram bot started');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
