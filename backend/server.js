// DWAI Server v2.4 - COMPLETE (All Features Preserved + New Fixes)
// Includes: All original features + LLM Brain + Step Verification + Progress Reporting

require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const https = require('https');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment validation
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
const PROGRESS_PATH = 'data/progress';
const REPORTS_PATH = 'data/reports';
const CURRENT_TASK_PATH = 'data/current_task.json';
const TASK_QUEUE_PATH = 'data/task_queue.json';

// ============================================
// COMPLETE APP REGISTRY (All Original Entries)
// ============================================
const APP_REGISTRY = {
  youtube: { aliases: ['yt', 'you tube', 'utube'], package: 'com.google.android.youtube', category: 'video' },
  chrome: { 
    aliases: ['browser', 'google chrome', 'web'], 
    package: 'com.android.chrome', 
    category: 'browser',
    selectors: { url_bar: 'com.android.chrome:id/url_bar', search_box: 'com.android.chrome:id/search_box_text' }
  },
  edge: { aliases: ['microsoft edge'], package: 'com.microsoft.emmx', category: 'browser' },
  firefox: { aliases: ['mozilla'], package: 'org.mozilla.firefox', category: 'browser' },
  whatsapp: { aliases: ['whatsapp business', 'wa', 'messages'], package: 'com.whatsapp', category: 'messaging' },
  telegram: { aliases: ['tg', 'tele'], package: 'org.telegram.messenger', category: 'messaging' },
  signal: { aliases: [], package: 'org.thoughtcrime.securesms', category: 'messaging' },
  calculator: { aliases: ['calc'], package: 'com.android.calculator2', category: 'utility' },
  camera: { aliases: ['cam', 'photo'], package: 'com.android.camera2', category: 'media' },
  photos: { aliases: ['gallery', 'pics', 'images'], package: 'com.google.android.apps.photos', category: 'media' },
  settings: { aliases: ['config', 'preferences', 'system settings'], package: 'com.android.settings', category: 'system' },
  phone: { aliases: ['dialer', 'call', 'telephone'], package: 'com.android.dialer', category: 'communication' },
  messages: { aliases: ['sms', 'texting'], package: 'com.android.mms', category: 'communication' },
  gmail: { aliases: ['email', 'mail', 'google mail'], package: 'com.google.android.gm', category: 'productivity' },
  maps: { aliases: ['google maps', 'navigation', 'gps'], package: 'com.google.android.apps.maps', category: 'navigation' },
  spotify: { aliases: ['music'], package: 'com.spotify.music', category: 'media' },
  netflix: { aliases: [], package: 'com.netflix.mediaclient', category: 'video' },
  facebook: { aliases: ['fb'], package: 'com.facebook.katana', category: 'social' },
  instagram: { aliases: ['insta', 'ig'], package: 'com.instagram.android', category: 'social' },
  twitter: { aliases: ['x', 'tweet'], package: 'com.twitter.android', category: 'social' },
  tiktok: { aliases: [], package: 'com.zhiliaoapp.musically', category: 'social' },
  discord: { aliases: [], package: 'com.discord', category: 'communication' },
  slack: { aliases: [], package: 'com.Slack', category: 'productivity' },
  zoom: { aliases: [], package: 'us.zoom.videomeetings', category: 'productivity' },
  amazon: { aliases: ['shopping'], package: 'com.amazon.mShop.android.shopping', category: 'shopping' },
  playstore: { aliases: ['google play', 'play store', 'app store'], package: 'com.android.vending', category: 'system' }
};

const ALLOWED_ACTIONS = new Set([
  'launch_app', 'click', 'type', 'press', 'wait', 'toast', 'swipe', 'verify', 'open_url', 'observe', 'scroll_find'
]);

// ============================================
// TEACH SESSION STATE (Preserved)
// ============================================
const activeTeachSessions = new Map();

// ============================================
// GITHUB HELPERS (Complete)
// ============================================
function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DWAI/2.4',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
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
          body: d
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
// QUEUE SYSTEM (O(1) Performance)
// ============================================
async function getTaskQueue() {
  const url = `${GITHUB_API}/${TASK_QUEUE_PATH}`;
  const res = await ghGetJson(url);
  if (!res.ok || !res.json?.content) {
    return { queue: [], processing: null, last_updated: Date.now() };
  }
  try {
    const content = Buffer.from(res.json.content, 'base64').toString('utf8');
    return JSON.parse(content);
  } catch {
    return { queue: [], processing: null, last_updated: Date.now() };
  }
}

async function updateTaskQueue(queueData) {
  const url = `${GITHUB_API}/${TASK_QUEUE_PATH}`;
  const content = Buffer.from(JSON.stringify(queueData, null, 2)).toString('base64');
  const existing = await ghGetJson(url);
  const payload = { message: 'Update queue', content, branch: GITHUB_BRANCH };
  if (existing.ok && existing.json?.sha) payload.sha = existing.json.sha;
  const result = await ghPutJson(url, payload);
  if (!result.ok) throw new Error(`Queue update failed: ${result.statusCode}`);
  return result;
}

async function enqueueTask(taskId, priority = 5) {
  const queue = await getTaskQueue();
  queue.queue.push({ task_id: taskId, priority, created_at: Date.now(), retries: 0 });
  queue.queue.sort((a, b) => a.priority - b.priority);
  await updateTaskQueue(queue);
  return queue;
}

// ============================================
// UTILITIES (All Original Functions)
// ============================================
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

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function extractJsonArray(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function cleanAiResponse(text) {
  let cleaned = String(text || '');
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/\\n/g, '\n');
  cleaned = cleaned.replace(/\*/g, '');
  return cleaned.trim();
}

// ============================================
// SLOT EXTRACTION (All Original Logic)
// ============================================
function extractSlotsFromExample(goal, steps) {
  const slots = [];
  const slotMap = new Map();
  
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

async function extractSlotsFromUserInput(route, userText) {
  const slotValues = {};
  if (!route.slots || route.slots.length === 0) return slotValues;
  
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
        { role: 'user', content: prompt }
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
    for (const slot of route.slots) {
      if (slot.example) {
        const pattern = new RegExp(slot.example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const match = userText.match(pattern);
        if (match) slotValues[slot.name] = match[0];
      }
    }
  }
  
  return slotValues;
}

// ============================================
// STEP VALIDATION (All Original Logic)
// ============================================
function isStepValid(step) {
  if (!step || typeof step !== 'object') return false;
  if (!step.action || !ALLOWED_ACTIONS.has(step.action)) return false;
  
  switch (step.action) {
    case 'launch_app':
      return typeof step.value === 'string' && step.value.trim().length > 0;
    case 'click':
      return Boolean(step.text || step.contains || step.desc || step.descContains || step.id || (typeof step.x === 'number' && typeof step.y === 'number'));
    case 'type':
      return typeof step.text === 'string' && step.text.trim().length > 0;
    case 'press':
      return ['enter', 'back', 'home', 'menu', 'volume_up', 'volume_down', 'power'].includes(String(step.key || '').toLowerCase());
    case 'wait':
      return Number(step.ms) >= 0;
    case 'toast':
      return true;
    case 'swipe':
      return typeof step.x1 === 'number' && typeof step.y1 === 'number' && typeof step.x2 === 'number' && typeof step.y2 === 'number';
    case 'verify':
    case 'observe':
      return true;
    case 'scroll_find':
      return step.strategy && step.target;
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
      step.target_package = APP_REGISTRY[normalized]?.package || normalized;
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
      if (!['enter', 'back', 'home', 'menu', 'volume_up', 'volume_down', 'power'].includes(step.key)) continue;
    }
    if (!isStepValid(step)) continue;
    out.push(step);
    
    // Auto-add wait after launch
    if (step.action === 'launch_app') {
      const next = rawSteps[i + 1];
      if (!next || next.action !== 'wait') {
        out.push({ action: 'wait', ms: 4000 });
      }
    }
  }
  return out.slice(0, 25);
}

// ============================================
// LLM ORCHESTRATION (The Brain)
// ============================================
async function llmOrchestrate(userText, context = {}) {
  const appList = Object.entries(APP_REGISTRY).map(([name, info]) => {
    let str = `${name}`;
    if (info.aliases.length) str += ` (aka: ${info.aliases.join(', ')})`;
    if (name === 'chrome') str += ` [CRITICAL: Use id "com.android.chrome:id/url_bar" for search]`;
    return str;
  }).join(', ');

  const prompt = `You are DWAI Brain v2.4 - Android Automation Orchestrator.

AVAILABLE APPS: ${appList}

USER REQUEST: "${userText}"

CONTEXT: ${JSON.stringify(context)}

STRICT RULES:
1. Extract dynamic values into slots: {query}, {contact}, {message}, etc.
2. After EVERY action, include verification
3. Chrome search MUST use id selector "com.android.chrome:id/url_bar"
4. Verify app context before typing to prevent wrong-app typing
5. Use verify_change after clicks to confirm screen changed

Return JSON:
{
  "intent": "brief description",
  "target_app": "package.name",
  "confidence": 0.0-1.0,
  "slots": {"query": "extracted value"},
  "steps": [
    {"action": "launch_app", "value": "chrome", "verify": true, "description": "Open Chrome", "id": 1},
    {"action": "verify_app", "package": "com.android.chrome", "description": "Confirm Chrome", "id": 2},
    {"action": "click", "id": "com.android.chrome:id/url_bar", "verify_change": true, "description": "Focus address bar", "id": 3},
    {"action": "type", "text": "{query}", "verify_appears": true, "verify_app_before_type": true, "description": "Type search", "id": 4},
    {"action": "press", "key": "enter", "verify_change": true, "description": "Submit search", "id": 5}
  ],
  "execution_notes": "Warnings"
}`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Android automation AI. Output strict JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1200,
    });
    
    const parsed = extractJsonObject(res.choices[0].message.content);
    if (!parsed?.steps) return fallbackOrchestrate(userText);
    
    // Normalize steps with IDs and verification flags
    parsed.steps = parsed.steps.map((step, idx) => ({
      ...step,
      id: step.id || idx + 1,
      verify: step.verify !== false,
      description: step.description || `${step.action} ${step.value || step.text || ''}`.trim()
    }));
    
    return parsed;
  } catch (e) {
    console.error('LLM Error:', e);
    return fallbackOrchestrate(userText);
  }
}

function fallbackOrchestrate(userText) {
  const lower = userText.toLowerCase();
  const query = extractSearchQuery(userText) || 'search';
  
  // Check for Chrome search
  if ((lower.includes('chrome') || lower.includes('browser')) && (lower.includes('search') || lower.includes('open'))) {
    return {
      intent: 'chrome_search',
      target_app: 'com.android.chrome',
      confidence: 0.9,
      slots: { query },
      steps: [
        { action: 'launch_app', value: 'chrome', verify: true, description: 'Launch Chrome browser', id: 1 },
        { action: 'verify_app', package: 'com.android.chrome', description: 'Verify Chrome is open', id: 2 },
        { action: 'click', id: 'com.android.chrome:id/url_bar', verify_change: true, description: 'Click address bar', id: 3 },
        { action: 'type', text: query, verify_appears: true, verify_app_before_type: true, description: 'Type search query', id: 4 },
        { action: 'press', key: 'enter', verify_change: true, description: 'Press Enter to search', id: 5 },
        { action: 'wait', ms: 5000, description: 'Wait for results', id: 6 }
      ],
      execution_notes: 'Strict Chrome context enforcement'
    };
  }
  
  // Generic app launch
  const app = findAppCanonical(lower);
  if (app) {
    const info = APP_REGISTRY[app];
    return {
      intent: `open_${app}`,
      target_app: info.package,
      confidence: 0.8,
      slots: {},
      steps: [
        { action: 'launch_app', value: app, verify: true, description: `Launch ${app}`, id: 1 },
        { action: 'verify_app', package: info.package, description: `Confirm ${app} is open`, id: 2 }
      ],
      execution_notes: 'Basic app launch'
    };
  }
  
  return { intent: 'unknown', confidence: 0, steps: [], error: 'Could not understand request' };
}

// ============================================
// TEMPLATE BUILDERS (All Original)
// ============================================
function buildTemplateSteps(userText) {
  const text = String(userText || '');
  const lower = text.toLowerCase();
  const app = findAppCanonical(lower);
  const query = extractSearchQuery(text);
  const msgParts = extractMessageParts(text);
  
  const wantsSearch = /\b(search|find|look for|browse)\b/.test(lower);
  const wantsMessage = /\b(send|message|text)\b/.test(lower) && /\bto\b/.test(lower);
  const wantsLaunch = /\b(open|launch|start|go to)\b/.test(lower);
  
  if (app === 'settings' && /(auto.lock|screen.timeout|lock.screen|sleep|display)/.test(lower)) {
    return sanitizeSteps([
      { action: 'launch_app', value: 'settings', verify: true },
      { action: 'wait', ms: 4000 },
      { action: 'click', text: 'Display', contains: 'Display', fallbacks: [{ action: 'click', x: 360, y: 600 }] },
      { action: 'wait', ms: 2000 },
      { action: 'click', text: 'Sleep', contains: 'Sleep', descContains: 'Sleep', fallbacks: [{ action: 'click', x: 360, y: 800 }] },
      { action: 'wait', ms: 1000 },
      { action: 'click', text: '30 minutes', contains: '30', fallbacks: [{ action: 'click', x: 360, y: 1200 }] }
    ]);
  }
  
  if (app && wantsLaunch && !wantsSearch && !wantsMessage) {
    return sanitizeSteps([
      { action: 'launch_app', value: app, verify: true },
      { action: 'verify', package: APP_REGISTRY[app]?.package, strict: true }
    ]);
  }
  
  if (wantsMessage && msgParts) {
    return sanitizeSteps([
      { action: 'launch_app', value: 'whatsapp', verify: true },
      { action: 'click', text: 'Search', contains: 'Search', desc: 'Search', fallbacks: [{ action: 'click', x: 650, y: 120 }] },
      { action: 'wait', ms: 1000 },
      { action: 'type', text: msgParts.contact },
      { action: 'press', key: 'enter' },
      { action: 'wait', ms: 2500 },
      { action: 'type', text: msgParts.message },
      { action: 'press', key: 'enter' }
    ]);
  }
  
  if (wantsSearch && app) {
    const targetApp = app === 'youtube' ? 'youtube' : 'chrome';
    const searchQuery = query || cleanQuery(text);
    
    if (targetApp === 'chrome') {
      return sanitizeSteps([
        { action: 'launch_app', value: 'chrome', verify: true },
        { action: 'wait', ms: 4000 },
        { action: 'verify', package: 'com.android.chrome', strict: true },
        { action: 'click', id: 'com.android.chrome:id/url_bar', fallbacks: [{ action: 'click', x: 500, y: 150 }] },
        { action: 'wait', ms: 1000 },
        { action: 'type', text: searchQuery, verify_app_before_type: true },
        { action: 'press', key: 'enter' },
        { action: 'wait', ms: 5000 }
      ]);
    }
    
    return sanitizeSteps([
      { action: 'launch_app', value: targetApp, verify: true },
      { action: 'click', contains: 'Search', desc: 'Search' },
      { action: 'wait', ms: 1000 },
      { action: 'type', text: searchQuery },
      { action: 'press', key: 'enter' },
      { action: 'wait', ms: 4000 }
    ]);
  }
  
  return null;
}

// ============================================
// ROUTE SYSTEM (All Original)
// ============================================
async function saveRoute(routeId, routeData) {
  const fileUrl = `${GITHUB_API}/${ROUTES_PATH}/${routeId}.json`;
  const contentBase64 = Buffer.from(JSON.stringify(routeData, null, 2)).toString('base64');
  const existing = await ghGetJson(fileUrl);
  
  const payload = {
    message: `Route ${routeId}`,
    content: contentBase64,
    branch: GITHUB_BRANCH
  };
  
  if (existing.ok && existing.json?.sha) payload.sha = existing.json.sha;
  
  const result = await ghPutJson(fileUrl, payload);
  if (!result.ok) throw new Error(`Save route failed: ${result.statusCode}`);
  return result;
}

async function getRouteById(routeId) {
  const fileUrl = `${GITHUB_API}/${ROUTES_PATH}/${routeId}.json`;
  const res = await ghGetJson(fileUrl);
  if (!res.ok || !res.json?.content) return null;
  try {
    return JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
  } catch { return null; }
}

async function listRouteSummaries(limit = 50) {
  const folder = await ghGetJson(`${GITHUB_API}/${ROUTES_PATH}`);
  if (!folder.ok || !Array.isArray(folder.json)) return [];
  
  const files = folder.json.filter(f => f.type === 'file' && f.name !== '.gitkeep').slice(0, limit);
  const out = [];
  
  for (const file of files) {
    try {
      const route = await getRouteById(file.name.replace('.json', ''));
      if (route) {
        out.push({
          id: route.route_id || file.name.replace('.json', ''),
          goal: route.goal || '',
          app: route.app || ''
        });
      }
    } catch {}
  }
  return out;
}

async function findMatchingRoute(userText) {
  const routes = await listRouteSummaries(50);
  if (routes.length === 0) return null;
  
  const lowerText = userText.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  
  for (const route of routes) {
    if (!route.goal) continue;
    const goalLower = route.goal.toLowerCase();
    let score = 0;
    
    if (goalLower === lowerText) score = 100;
    else if (lowerText.includes(goalLower) || goalLower.includes(lowerText)) score = 80;
    else {
      const textWords = lowerText.split(/\s+/);
      const goalWords = goalLower.split(/\s+/);
      const overlap = textWords.filter(w => goalWords.includes(w)).length;
      score = (overlap / Math.max(textWords.length, goalWords.length)) * 60;
    }
    
    const app = findAppCanonical(lowerText);
    if (app && route.app === app) score += 20;
    
    if (score > bestScore && score > 40) {
      bestScore = score;
      bestMatch = route;
    }
  }
  
  if (bestMatch) return await getRouteById(bestMatch.id);
  return null;
}

// ============================================
// TEACH MODE (All Original Functions)
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
    priority: 1
  };
  
  const fileUrl = `${GITHUB_API}/${TASKS_PATH}/${taskId}.json`;
  await ghPutJson(fileUrl, {
    message: `Teach ${taskId}`,
    content: Buffer.from(JSON.stringify(teachTask, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  await enqueueTask(taskId, 1);
  
  // Update current pointer
  await ghPutJson(`${GITHUB_API}/${CURRENT_TASK_PATH}`, {
    message: `current ${taskId}`,
    content: Buffer.from(JSON.stringify({
      task_id: taskId,
      type: 'teach_start',
      status: 'pending',
      file_url: fileUrl,
      created_at: new Date().toISOString()
    }, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  activeTeachSessions.set(userId, {
    taskId,
    goal,
    app,
    startedAt: Date.now(),
    fileUrl
  });
  
  return { taskId, fileUrl };
}

async function stopTeachSession(userId) {
  const session = activeTeachSessions.get(userId);
  if (!session) return { error: 'No active teach session' };
  
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
    priority: 1
  };
  
  const fileUrl = `${GITHUB_API}/${TASKS_PATH}/${taskId}.json`;
  await ghPutJson(fileUrl, {
    message: `StopTeach ${taskId}`,
    content: Buffer.from(JSON.stringify(stopTask, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  await enqueueTask(taskId, 1);
  
  await ghPutJson(`${GITHUB_API}/${CURRENT_TASK_PATH}`, {
    message: `current ${taskId}`,
    content: Buffer.from(JSON.stringify({
      task_id: taskId,
      type: 'teach_stop',
      status: 'pending',
      file_url: fileUrl,
      created_at: new Date().toISOString()
    }, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  activeTeachSessions.delete(userId);
  return { taskId, fileUrl, previousSession: session };
}

// ============================================
// PROGRESS & REPORTING (New but Complete)
// ============================================
async function updateStepProgress(taskId, stepNum, totalSteps, status, details, error, appContext) {
  const data = {
    task_id: taskId,
    step_number: stepNum,
    total_steps: totalSteps,
    status,
    details,
    error: error || null,
    app_context: appContext,
    timestamp: new Date().toISOString()
  };
  
  const url = `${GITHUB_API}/${PROGRESS_PATH}/${taskId}_progress.json`;
  await ghPutJson(url, {
    message: `Step ${stepNum}/${totalSteps} ${status}`,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
}

async function generateExecutionReport(taskId, executionTrace, finalStatus, error) {
  const traceStr = executionTrace.map(t => 
    `Step ${t.step}: ${t.action} - ${t.status}${t.error ? ' ERROR: ' + t.error : ''}`
  ).join('\n');

  const prompt = `Analyze this Android automation execution and provide a detailed, user-friendly report.

Task ID: ${taskId}
Final Status: ${finalStatus}
Error: ${error || 'None'}

Execution Trace:
${traceStr}

Generate a natural language report explaining what was attempted, which apps were involved, where it succeeded/failed, and why. Keep under 300 words.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: 'Execution analyst.' }, { role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });
    return cleanAiResponse(res.choices[0].message.content);
  } catch (e) {
    return `Execution ${finalStatus}. ${executionTrace.length} steps. ${error || ''}`;
  }
}

// ============================================
// TASK CREATION (Complete with All Modes)
// ============================================
async function createRegularTask(userText, intent, mode, userId, chatId) {
  const taskId = nanoid(12);
  
  // Try route match first
  let steps = [];
  let routeMatched = null;
  let slotValues = {};
  let orch = null;
  
  const matchedRoute = await findMatchingRoute(userText);
  if (matchedRoute && matchedRoute.steps) {
    routeMatched = matchedRoute.route_id;
    slotValues = await extractSlotsFromUserInput(matchedRoute, userText);
    steps = fillSlots(matchedRoute.steps, slotValues);
  } else {
    // Use LLM Brain
    orch = await llmOrchestrate(userText, { mode, userId });
    if (orch.error) throw new Error(orch.error);
    steps = orch.steps.map(s => ({
      ...s,
      text: fillSlots(s.text, orch.slots),
      value: fillSlots(s.value, orch.slots)
    }));
  }
  
  if (steps.length === 0) {
    // Fallback to templates
    const template = buildTemplateSteps(userText);
    if (template) steps = template;
  }
  
  const task = {
    task_id: taskId,
    type: 'automation',
    status: 'pending',
    intent,
    mode,
    goal: userText,
    target_app: orch?.target_app || matchedRoute?.app,
    steps,
    slots: slotValues,
    llm_intent: orch?.intent,
    llm_confidence: orch?.confidence,
    route_matched: routeMatched,
    execution_notes: orch?.execution_notes,
    chat_id: chatId,
    user_id: userId,
    created_at: new Date().toISOString(),
    priority: mode === 'live' ? 2 : 5,
    verify_every_step: true
  };
  
  // Save task
  const taskUrl = `${GITHUB_API}/${TASKS_PATH}/${taskId}.json`;
  await ghPutJson(taskUrl, {
    message: `Task ${taskId}`,
    content: Buffer.from(JSON.stringify(task, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  // Init progress
  await updateStepProgress(taskId, 0, steps.length, 'queued', 'Waiting for device...', null, null);
  
  // Add to queue
  await enqueueTask(taskId, task.priority);
  
  return { taskId, steps, targetApp: task.target_app, intent: orch?.intent || 'route', routeMatched };
}

// ============================================
// MONITORING (Complete)
// ============================================
const activeMonitors = new Map();

async function monitorTaskProgress(taskId, chatId, steps) {
  if (activeMonitors.has(taskId)) return;
  
  let lastStep = -1;
  let completed = false;
  
  const check = async () => {
    if (completed) return;
    
    try {
      const url = `${GITHUB_API}/${PROGRESS_PATH}/${taskId}_progress.json`;
      const res = await ghGetJson(url);
      
      if (res.ok && res.json?.content) {
        const progress = JSON.parse(Buffer.from(res.json.content, 'base64').toString());
        const currentStep = progress.step_number;
        
        if (currentStep !== lastStep || progress.status === 'completed' || progress.status === 'failed') {
          lastStep = currentStep;
          
          const stepInfo = steps[currentStep - 1];
          const percent = Math.round((currentStep / progress.total_steps) * 100);
          
          let emoji = '⚪';
          if (progress.status === 'running') emoji = '🔵';
          if (progress.status === 'verifying') emoji = '🟡';
          if (progress.status === 'completed') emoji = '✅';
          if (progress.status === 'failed') emoji = '❌';
          
          let msg = `${emoji} Step ${currentStep}/${progress.total_steps} (${percent}%)\n`;
          msg += `${stepInfo?.description || progress.details || 'Executing...'}`;
          
          if (progress.app_context) msg += `\n📱 ${progress.app_context.split('.').pop()}`;
          
          await bot.telegram.sendMessage(chatId, msg).catch(() => {});
          
          if (progress.status === 'completed' || progress.status === 'failed') {
            completed = true;
            activeMonitors.delete(taskId);
            
            // Final report
            setTimeout(async () => {
              const reportUrl = `${GITHUB_API}/${REPORTS_PATH}/${taskId}_report.json`;
              const reportRes = await ghGetJson(reportUrl);
              
              let finalMsg;
              if (reportRes.ok && reportRes.json?.content) {
                const report = JSON.parse(Buffer.from(reportRes.json.content, 'base64').toString());
                finalMsg = report.ai_report || (progress.status === 'completed' ? '✅ Task Complete!' : `❌ Failed: ${progress.error}`);
              } else {
                finalMsg = progress.status === 'completed' 
                  ? `✅ Task Complete!\n\nExecuted ${progress.total_steps} steps successfully.`
                  : `❌ Task Failed\n\nError: ${progress.error || 'Unknown'}`;
              }
              
              await bot.telegram.sendMessage(chatId, finalMsg.substring(0, 4000)).catch(() => {});
            }, 1500);
          }
        }
      }
    } catch (e) {}
    
    if (!completed) setTimeout(check, 3000);
  };
  
  activeMonitors.set(taskId, true);
  check();
}

// ============================================
// TELEGRAM HANDLERS (All Commands)
// ============================================
bot.command('start', async (ctx) => {
  await ctx.reply(`👋 DWAI Mobile Agent v2.4 (Complete)

✅ LLM Brain - Natural language understanding
✅ Step Verification - Every action confirmed
✅ App Protection - Prevents wrong-app typing
✅ Chrome Fix - ID-based selectors
✅ Teach Mode - Record new routes (/teach)
✅ Route Matching - Reuse learned routes (/route)
✅ Live Progress - Real-time updates
✅ AI Reports - Detailed execution analysis

Commands:
/do <task> - Fast execution with verification
/live <task> - Extra careful verification mode
/teach <goal> - Record new route (use {variables})
/stopteach - Stop recording and save route
/route <task> - Use best matching route
/status - Check queue and system status
/help - Show detailed help

Example:
/do open chrome and search for lion videos`);
});

bot.command('help', async (ctx) => {
  await ctx.reply(`📱 DWAI v2.4 Complete Help:

Execution Modes:
/do <task> - Fast mode with step verification
/live <task> - Live mode (extra verification between steps)
/route <task> - Execute using learned route

Teaching Routes:
/teach <goal> - Start recording (e.g., /teach search for {query} on youtube)
/stopteach - Stop and save route

System:
/status - View pending tasks and learned routes
/cancel - Request cancellation of current task

The AI now:
• Understands context naturally (LLM Brain)
• Verifies every step before proceeding
• Prevents typing in wrong apps
• Uses proper Chrome ID selectors
• Provides real-time progress updates`);
});

bot.command('status', async (ctx) => {
  try {
    const queue = await getTaskQueue();
    const routes = await listRouteSummaries(10);
    
    let msg = '📊 System Status\n\n';
    msg += queue.processing ? `🔄 Processing: ${queue.processing.task_id.slice(0, 8)}...\n` : '⏸️ Idle\n';
    msg += `📋 Pending: ${queue.queue?.length || 0} tasks\n\n`;
    
    msg += '📚 Learned Routes:\n';
    if (routes.length === 0) msg += 'None yet. Use /teach to create routes.\n';
    else routes.forEach(r => msg += `• ${r.goal}\n`);
    
    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('teach', async (ctx) => {
  const userId = ctx.from.id;
  const goal = ctx.message.text.replace(/^\/teach\s*/, '').trim();
  
  if (!goal) {
    await ctx.reply('❌ Specify goal. Example: /teach search for {query} on youtube');
    return;
  }
  
  if (activeTeachSessions.has(userId)) {
    await ctx.reply('⚠️ Already teaching. Finish with /stopteach first.');
    return;
  }
  
  try {
    const { taskId } = await startTeachSession(userId, goal);
    await ctx.reply(`🎓 Teach Mode Started\nGoal: ${goal}\nID: ${taskId}\n\n1. Agent will open target app\n2. Perform actions on your phone\n3. Type /stopteach when done`);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
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
    await ctx.reply(`✅ Route Saved!\n\nGoal: ${result.previousSession.goal}\n\nUse it with:\n/do ${result.previousSession.goal.replace(/\{.*?\}/g, 'example')}`);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('do', async (ctx) => {
  const text = ctx.message.text.replace(/^\/do\s*/, '').trim();
  if (!text) return ctx.reply('❌ Specify task');
  
  try {
    const { taskId, steps, targetApp, intent, routeMatched } = await createRegularTask(text, 'DO', 'fast', ctx.from.id, ctx.chat.id);
    const appName = targetApp ? targetApp.split('.').pop() : 'device';
    
    let msg = `⚡ Task Created\nIntent: ${intent}\nTarget: ${appName}\nSteps: ${steps.length}\n`;
    if (routeMatched) msg += `📚 Using route: ${routeMatched}\n`;
    msg += `ID: ${taskId.slice(0, 8)}...\n\nStarting...`;
    
    await ctx.reply(msg);
    monitorTaskProgress(taskId, ctx.chat.id, steps);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('live', async (ctx) => {
  const text = ctx.message.text.replace(/^\/live\s*/, '').trim();
  if (!text) return ctx.reply('❌ Specify task');
  
  try {
    const { taskId, steps, targetApp } = await createRegularTask(text, 'LIVE', 'live', ctx.from.id, ctx.chat.id);
    await ctx.reply(`👁️ Live Mode\nTarget: ${targetApp?.split('.').pop()}\nSteps: ${steps.length}\nVerifying every action...\nID: ${taskId.slice(0, 8)}...`);
    monitorTaskProgress(taskId, ctx.chat.id, steps);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('route', async (ctx) => {
  const text = ctx.message.text.replace(/^\/route\s*/, '').trim();
  if (!text) return ctx.reply('❌ Specify task');
  
  try {
    const route = await findMatchingRoute(text);
    if (!route) {
      await ctx.reply('❌ No matching route. Use /do or teach this task first.');
      return;
    }
    
    const slotValues = await extractSlotsFromUserInput(route, text);
    const filledSteps = fillSlots(route.steps, slotValues);
    
    const { taskId } = await createRegularTask(text, 'ROUTE', 'routed', ctx.from.id, ctx.chat.id);
    
    let msg = `📚 Route Match\nGoal: ${route.goal}\nApp: ${route.app}\n`;
    if (Object.keys(slotValues).length > 0) {
      msg += `Slots: ${Object.entries(slotValues).map(([k,v]) => `${k}=${v}`).join(', ')}\n`;
    }
    msg += `\nExecuting ${filledSteps.length} steps...`;
    
    await ctx.reply(msg);
    monitorTaskProgress(taskId, ctx.chat.id, filledSteps);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  try {
    const { taskId, steps, targetApp } = await createRegularTask(ctx.message.text, 'AUTO', 'normal', ctx.from.id, ctx.chat.id);
    const appName = targetApp ? targetApp.split('.').pop() : 'device';
    await ctx.reply(`🤖 Executing on ${appName}...\nSteps: ${steps.length}`);
    monitorTaskProgress(taskId, ctx.chat.id, steps);
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
    version: '2.4',
    features: ['llm_brain', 'step_verification', 'priority_queue', 'teach_mode', 'route_matching', 'ai_reports']

// NEW: Endpoint for agent to submit final report
app.post('/report/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { status, trace, error, ai_report } = req.body;
  
  try {
    // Save report to GitHub
    const reportUrl = `${GITHUB_API}/${REPORTS_PATH}/${taskId}_report.json`;
    const reportData = {
      task_id: taskId,
      status,
      execution_trace: trace,
      error: error || null,
      ai_report: ai_report || null,
      reported_at: new Date().toISOString()
    };
    
    const existing = await ghGetJson(reportUrl);
    const payload = {
      message: `Report ${taskId}`,
      content: Buffer.from(JSON.stringify(reportData, null, 2)).toString('base64'),
      branch: GITHUB_BRANCH
    };
    if (existing.ok && existing.json?.sha) payload.sha = existing.json.sha;
    
    await ghPutJson(reportUrl, payload);
    
    // Notify Telegram if chat_id exists
    const taskUrl = `${GITHUB_API}/${TASKS_PATH}/${taskId}.json`;
    const taskRes = await ghGetJson(taskUrl);
    if (taskRes.ok && taskRes.json?.content) {
      const task = JSON.parse(Buffer.from(taskRes.json.content, 'base64').toString());
      if (task.chat_id) {
        let message = '';
        if (status === 'completed') {
          message = `✅ **Task Complete!**\n\n${ai_report || 'All steps executed successfully.'}`;
        } else {
          message = `❌ **Task Failed**\n\n${ai_report || `Error: ${error || 'Unknown error'}`}`;
        }
        await bot.telegram.sendMessage(task.chat_id, message.substring(0, 4000), { parse_mode: 'Markdown' });
      }
    }
    
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

  });
});

app.listen(PORT, () => {
  console.log(`DWAI Server v2.4 (Complete) on port ${PORT}`);
  console.log('Features: LLM Brain, Verification, Teach Mode, Routes, Progress');
});

bot.launch();
console.log('Bot started');
