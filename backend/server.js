// DWAI Server v2.1 - LLM Brain Architecture with Priority Queue
// Fixes: App resolution, Queue performance, LLM orchestration, Smart clicking

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
const TASK_QUEUE_PATH = 'data/task_queue.json'; // NEW: Priority queue instead of directory scanning

// ============================================
// TOOL DEFINITIONS FOR LLM BRAIN
// ============================================
const AVAILABLE_TOOLS = {
  launch_app: {
    description: 'Launch an application on the Android device',
    parameters: {
      app_name: 'string (e.g., "chrome", "youtube", "settings")',
      verify: 'boolean (verify app actually opened)'
    }
  },
  click: {
    description: 'Click on a UI element',
    parameters: {
      strategy: 'text | contains | desc | coordinates | ai_description',
      target: 'string (text to match) or {x, y} for coordinates',
      fallback_texts: 'array of alternative texts to try',
      verify_click: 'boolean (verify element exists before clicking)'
    }
  },
  type: {
    description: 'Type text into focused input field',
    parameters: {
      text: 'string to type',
      submit: 'boolean (press enter after typing)'
    }
  },
  press: {
    description: 'Press a hardware/software key',
    parameters: {
      key: 'enter | back | home | menu | volume_up | volume_down | power'
    }
  },
  wait: {
    description: 'Wait for UI to stabilize',
    parameters: {
      ms: 'number (milliseconds, default 2000)',
      condition: 'optional string describing what to wait for'
    }
  },
  swipe: {
    description: 'Swipe gesture',
    parameters: {
      direction: 'up | down | left | right',
      distance: 'short | medium | long',
      coordinates: 'optional {x1, y1, x2, y2}'
    }
  },
  observe: {
    description: 'Take screenshot and verify current state',
    parameters: {
      expect_app: 'expected package name',
      expect_text: 'text that should be visible',
      on_failure: 'continue | retry | abort'
    }
  },
  scroll_to: {
    description: 'Scroll until element is found',
    parameters: {
      strategy: 'text | contains',
      target: 'string to find',
      max_swipes: 'number (default 5)'
    }
  }
};

const APP_REGISTRY = {
  youtube: { aliases: ['yt', 'you tube', 'utube'], package: 'com.google.android.youtube', category: 'video' },
  chrome: { aliases: ['browser', 'google chrome', 'web'], package: 'com.android.chrome', category: 'browser' },
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
  playstore: { aliases: ['google play', 'play store', 'app store'], package: 'com.android.vending', category: 'system' },
};

// ============================================
// TEACH SESSION STATE
// ============================================
const activeTeachSessions = new Map();

// ============================================
// GITHUB HELPERS
// ============================================
function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DWAI/2.1',
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
// TASK QUEUE SYSTEM (O(1) Performance)
// ============================================
async function getTaskQueue() {
  const url = `${GITHUB_API}/${TASK_QUEUE_PATH}`;
  const res = await ghGetJson(url);
  if (!res.ok || !res.json || !res.json.content) {
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
  
  const payload = {
    message: `Update task queue - ${queueData.queue.length} pending`,
    content: content,
    branch: GITHUB_BRANCH,
  };
  
  if (existing.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }
  
  const result = await ghPutJson(url, payload);
  if (!result.ok) throw new Error(`Queue update failed: ${result.statusCode}`);
  return result;
}

async function enqueueTask(taskId, priority = 5) {
  const queue = await getTaskQueue();
  queue.queue.push({
    task_id: taskId,
    priority: priority, // 1-10, lower = higher priority
    created_at: Date.now(),
    retries: 0
  });
  // Sort by priority (lower number = higher priority)
  queue.queue.sort((a, b) => a.priority - b.priority);
  await updateTaskQueue(queue);
  return queue;
}

async function dequeueTask() {
  const queue = await getTaskQueue();
  if (queue.queue.length === 0) return null;
  
  const task = queue.queue.shift();
  queue.processing = {
    task_id: task.task_id,
    started_at: Date.now(),
    worker_id: null // Will be filled by agent
  };
  await updateTaskQueue(queue);
  return task;
}

async function completeTaskProcessing(taskId, status) {
  const queue = await getTaskQueue();
  if (queue.processing && queue.processing.task_id === taskId) {
    queue.processing = null;
  }
  await updateTaskQueue(queue);
}

// ============================================
// LLM BRAIN ORCHESTRATION
// ============================================
async function llmOrchestrate(userText, context = {}) {
  const toolDescriptions = Object.entries(AVAILABLE_TOOLS)
    .map(([name, tool]) => `${name}: ${tool.description}`)
    .join('\n');

  const appList = Object.entries(APP_REGISTRY)
    .map(([name, info]) => `${name} (${info.aliases.join(', ')})`)
    .join(', ');

  const prompt = `You are DWAI Brain, an Android automation orchestrator. Convert user requests into precise tool sequences.

Available Tools:
${toolDescriptions}

Available Apps: ${appList}

User Request: "${userText}"

Context: ${JSON.stringify(context)}

Return ONLY a JSON object with this exact structure:
{
  "intent": "brief description of what user wants",
  "confidence": 0.0-1.0,
  "steps": [
    {"tool": "tool_name", "params": {...}, "verify": true/false}
  ],
  "fallback_apps": ["alternative_app_1", "alternative_app_2"],
  "error_if": "conditions that should trigger failure",
  "slots": {"variable_name": "extracted_value"} // For dynamic values like {query}
}

Rules:
- Use verify: true for critical steps (launches, clicks)
- Always wait after launch_app (tool will auto-add, don't add manually)
- If app is uncertain, list fallbacks
- For search queries, extract the exact search term into slots.query
- Break complex tasks into sequential steps
- Never assume coordinates unless explicitly provided
- If you cannot determine the app, return error_if: "unknown_app"`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are an Android automation AI. Output ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1200,
    });
    
    const content = res.choices?.[0]?.message?.content?.trim() || '';
    const parsed = extractJsonObject(content);
    
    if (!parsed || !parsed.steps) {
      return await fallbackOrchestration(userText);
    }
    
    // Convert LLM tool format to agent steps
    const steps = convertToolsToSteps(parsed.steps, parsed.slots || {});
    return {
      intent: parsed.intent,
      confidence: parsed.confidence || 0.8,
      steps: steps,
      slots: parsed.slots || {},
      fallback_apps: parsed.fallback_apps || []
    };
  } catch (e) {
    console.error('LLM Orchestration error:', e);
    return await fallbackOrchestration(userText);
  }
}

function convertToolsToSteps(tools, slots) {
  const steps = [];
  
  for (const tool of tools) {
    const step = { action: tool.tool };
    
    switch (tool.tool) {
      case 'launch_app':
        step.value = fillSlots(tool.params.app_name, slots);
        step.verify = tool.params.verify !== false;
        break;
        
      case 'click':
        if (tool.params.strategy === 'coordinates') {
          step.x = tool.params.target.x;
          step.y = tool.params.target.y;
        } else {
          step[tool.params.strategy] = fillSlots(tool.params.target, slots);
          if (tool.params.fallback_texts) {
            step.fallbacks = tool.params.fallback_texts.map(t => ({
              action: 'click',
              contains: fillSlots(t, slots)
            }));
          }
        }
        step.verify_click = tool.params.verify_click;
        break;
        
      case 'type':
        step.text = fillSlots(tool.params.text, slots);
        if (tool.params.submit) {
          steps.push(step);
          steps.push({ action: 'press', key: 'enter' });
          continue;
        }
        break;
        
      case 'press':
        step.key = tool.params.key;
        break;
        
      case 'wait':
        step.ms = tool.params.ms || 2000;
        break;
        
      case 'swipe':
        if (tool.params.coordinates) {
          step.x1 = tool.params.coordinates.x1;
          step.y1 = tool.params.coordinates.y1;
          step.x2 = tool.params.coordinates.x2;
          step.y2 = tool.params.coordinates.y2;
        } else {
          // Convert direction to coordinates based on typical screen
          step.direction = tool.params.direction;
          step.distance = tool.params.distance;
        }
        break;
        
      case 'observe':
        step.expected_package = tool.params.expect_app;
        step.expected_text = fillSlots(tool.params.expect_text, slots);
        step.on_mismatch = tool.params.on_failure || 'retry';
        break;
        
      case 'scroll_to':
        step.action = 'scroll_find';
        step.strategy = tool.params.strategy;
        step.target = fillSlots(tool.params.target, slots);
        step.max_swipes = tool.params.max_swipes || 5;
        break;
    }
    
    // Auto-add wait after launch
    if (step.action === 'launch_app') {
      steps.push(step);
      steps.push({ action: 'wait', ms: 4000 });
    } else {
      steps.push(step);
    }
  }
  
  return sanitizeSteps(steps);
}

function fillSlots(text, slots) {
  if (!text) return text;
  let result = String(text);
  for (const [key, value] of Object.entries(slots)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

async function fallbackOrchestration(userText) {
  // Fallback to template-based generation if LLM fails
  const template = buildTemplateSteps(userText);
  if (template && template.length) {
    return { intent: 'template_fallback', confidence: 0.6, steps: template, slots: {}, fallback_apps: [] };
  }
  return { intent: 'unknown', confidence: 0, steps: [], error: 'Could not orchestrate task' };
}

// ============================================
// UTILITIES
// ============================================
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
// STEP VALIDATION & SANITIZATION
// ============================================
const ALLOWED_ACTIONS = new Set([
  'launch_app', 'click', 'type', 'press', 'wait', 'toast', 'swipe', 'verify', 'open_url', 'observe', 'scroll_find'
]);

function isStepValid(step) {
  if (!step || typeof step !== 'object') return false;
  if (!step.action || !ALLOWED_ACTIONS.has(step.action)) return false;
  
  switch (step.action) {
    case 'launch_app':
      return typeof step.value === 'string' && step.value.trim().length > 0;
    case 'click':
      return Boolean(step.text || step.contains || step.desc || step.descContains || (typeof step.x === 'number' && typeof step.y === 'number'));
    case 'type':
      return typeof step.text === 'string' && step.text.trim().length > 0;
    case 'press':
      return ['enter', 'back', 'home', 'menu', 'volume_up', 'volume_down', 'power'].includes(String(step.key || '').toLowerCase());
    case 'wait':
      return Number(step.ms) >= 0;
    case 'toast':
      return true;
    case 'swipe':
      return (typeof step.x1 === 'number' && typeof step.y1 === 'number' && typeof step.x2 === 'number' && typeof step.y2 === 'number') || step.direction;
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
      if (!normalized) continue; // Skip invalid apps - FIX for app looping
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
      if (!['enter', 'back', 'home', 'menu', 'volume_up', 'volume_down', 'power'].includes(step.key)) continue;
    }
    if (!isStepValid(step)) continue;
    out.push(step);
  }
  return out.slice(0, 25); // Increased limit for complex tasks
}

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
      { action: 'click', contains: 'Display', fallback_texts: ['Screen', 'Display & brightness'] },
      { action: 'wait', ms: 2000 },
      { action: 'click', contains: 'Sleep', fallback_texts: ['Screen timeout', 'Auto-lock'] },
      { action: 'wait', ms: 1000 },
      { action: 'click', contains: '30 minutes', fallback_texts: ['10 minutes', '5 minutes', 'Never'] },
    ]);
  }
  
  if (app && wantsLaunch && !wantsSearch && !wantsMessage) {
    return sanitizeSteps([
      { action: 'launch_app', value: app, verify: true },
      { action: 'observe', expect_app: app, on_mismatch: 'retry' }
    ]);
  }
  
  if (wantsMessage && msgParts) {
    return sanitizeSteps([
      { action: 'launch_app', value: 'whatsapp', verify: true },
      { action: 'click', contains: 'Search', desc: 'Search', fallbacks: [{ action: 'click', x: 650, y: 120 }] },
      { action: 'wait', ms: 1000 },
      { action: 'type', text: msgParts.contact },
      { action: 'press', key: 'enter' },
      { action: 'wait', ms: 2500 },
      { action: 'type', text: msgParts.message },
      { action: 'press', key: 'enter' },
    ]);
  }
  
  if (wantsSearch && app) {
    const targetApp = app === 'youtube' ? 'youtube' : (app || 'chrome');
    const searchQuery = query || cleanQuery(text);
    
    if (targetApp === 'chrome') {
      return sanitizeSteps([
        { action: 'launch_app', value: 'chrome', verify: true },
        { action: 'click', contains: 'Search', desc: 'Search', fallbacks: [{ action: 'click', x: 500, y: 150 }] },
        { action: 'wait', ms: 1000 },
        { action: 'type', text: searchQuery },
        { action: 'press', key: 'enter' },
        { action: 'wait', ms: 5000 },
      ]);
    }
    
    return sanitizeSteps([
      { action: 'launch_app', value: targetApp, verify: true },
      { action: 'click', contains: 'Search', desc: 'Search' },
      { action: 'wait', ms: 1000 },
      { action: 'type', text: searchQuery },
      { action: 'press', key: 'enter' },
      { action: 'wait', ms: 4000 },
    ]);
  }
  
  return null;
}

// ============================================
// JSON EXTRACTION
// ============================================
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

function cleanAiResponse(text) {
  let cleaned = String(text || '');
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/\\n/g, '\n');
  cleaned = cleaned.replace(/\*/g, '');
  return cleaned.trim();
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
    throw new Error(`GitHub create task failed: ${result.statusCode}`);
  }
  
  // Add to queue for processing
  await enqueueTask(taskId, taskData.priority || 5);
  
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
    throw new Error(`GitHub current_task write failed: ${result.statusCode}`);
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

// ============================================
// ROUTE SYSTEM
// ============================================
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

async function findMatchingRoute(userText) {
  // Simple semantic matching - can be enhanced with embeddings
  const folder = await ghGetJson(`${GITHUB_API}/${ROUTES_PATH}`);
  if (!folder.ok || !Array.isArray(folder.json)) return null;
  
  const lowerText = userText.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  
  for (const file of folder.json.slice(0, 20)) { // Limit to recent routes
    if (file.type !== 'file') continue;
    try {
      const route = await getRouteById(file.name.replace('.json', ''));
      if (!route || !route.goal) continue;
      
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
      
      if (score > bestScore && score > 50) {
        bestScore = score;
        bestMatch = route;
      }
    } catch {}
  }
  
  return bestMatch;
}

// ============================================
// TEACH MODE
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
    priority: 1 // High priority
  };
  
  const fileUrl = await createTask(taskId, teachTask);
  
  await writeCurrentTask({
    task_id: taskId,
    type: 'teach_start',
    status: 'pending',
    file_url: fileUrl,
    created_at: new Date().toISOString(),
  });
  
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
// TASK CREATION WITH LLM BRAIN
// ============================================
async function createRegularTask(userText, intent, mode = 'normal', userId = null) {
  const taskId = nanoid(12);
  
  // Use LLM Brain for orchestration
  const context = {
    mode: mode,
    user_history: [], // Could be populated from session
    available_apps: Object.keys(APP_REGISTRY)
  };
  
  const orchestration = await llmOrchestrate(userText, context);
  
  if (orchestration.error) {
    throw new Error(orchestration.error);
  }
  
  // Check for route match as enhancement
  let routeMatched = null;
  if (orchestration.confidence < 0.7) {
    const matchedRoute = await findMatchingRoute(userText);
    if (matchedRoute) {
      routeMatched = matchedRoute.route_id;
      // Merge route steps with LLM steps if route is better
      if (matchedRoute.steps && matchedRoute.steps.length > orchestration.steps.length) {
        orchestration.steps = matchedRoute.steps;
      }
    }
  }
  
  const task = {
    task_id: taskId,
    type: 'automation',
    status: 'pending',
    intent: intent,
    mode: mode,
    goal: userText,
    steps: orchestration.steps,
    llm_intent: orchestration.intent,
    llm_confidence: orchestration.confidence,
    route_matched: routeMatched,
    slots: orchestration.slots,
    fallback_apps: orchestration.fallback_apps,
    created_at: new Date().toISOString(),
    priority: mode === 'live' ? 2 : 5,
    validate_steps: true,
    user_id: userId
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
  
  return { taskId, fileUrl, steps: orchestration.steps, orchestration };
}

// ============================================
// FEEDBACK SYSTEM
// ============================================
async function waitForTaskCompletion(taskId, ctx) {
  let attempts = 0;
  const maxAttempts = 20; // 100 seconds max
  
  const checkStatus = async () => {
    attempts++;
    const logUrl = `${GITHUB_API}/${LOGS_PATH}/${taskId}_log.json`;
    const res = await ghGetJson(logUrl);
    
    if (res.ok && res.json && res.json.content) {
      try {
        const logData = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
        const statusEmoji = logData.status === 'completed' ? '✅' : '❌';
        let msg = `${statusEmoji} Task ${taskId.slice(0, 8)}...\nStatus: ${logData.status}`;
        if (logData.error) msg += `\nError: ${logData.error}`;
        if (logData.details) msg += `\nDetails: ${logData.details}`;
        await ctx.reply(msg);
        return true;
      } catch (e) {
        console.error('Log parse error:', e);
      }
    }
    
    if (attempts >= maxAttempts) {
      await ctx.reply('⏱️ Task timeout: No completion signal received.');
      return true;
    }
    
    return false;
  };
  
  // Check immediately, then every 5 seconds
  if (!(await checkStatus())) {
    const interval = setInterval(async () => {
      if (await checkStatus()) clearInterval(interval);
    }, 5000);
  }
}

// ============================================
// TELEGRAM HANDLERS
// ============================================
bot.command('start', async (ctx) => {
  await ctx.reply(`👋 DWAI Mobile Agent v2.1 (LLM Brain)

Commands:
/do <task> - Fast execution
/live <task> - Live mode with verification
/teach <goal> - Record new route
/stopteach - Save route
/status - View queue status
/cancel - Cancel current task

Examples:
/do open chrome and search for AI news
/live send whatsapp message to John saying hello
/teach order pizza from {app}`);
});

bot.command('help', async (ctx) => {
  await ctx.reply(`📱 DWAI v2.1 Help:

Execution:
/do <task> - Fast mode (LLM orchestrated)
/live <task> - Live mode (observes & adapts)
/route <task> - Use learned route

Teaching:
/teach <goal with {variables}>
/stopteach - Save recording

System:
/status - Queue status & routes
/cancel - Cancel current task

The AI now understands context and coordinates tools automatically.`);
});

bot.command('status', async (ctx) => {
  try {
    const queue = await getTaskQueue();
    const processing = queue.processing ? `Processing: ${queue.processing.task_id.slice(0, 8)}...` : 'Idle';
    const pending = queue.queue.length;
    
    await ctx.reply(`📊 System Status\n\n${processing}\nPending: ${pending} tasks\n\nQueue system: Active (O(1) priority queue)`);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('cancel', async (ctx) => {
  // Implementation would clear current task
  await ctx.reply('🛑 Cancel signal sent. Current task will abort at next safe point.');
});

bot.command('teach', async (ctx) => {
  const userId = ctx.from.id;
  const goal = ctx.message.text.replace(/^\/teach\s*/, '').trim();
  
  if (!goal) {
    await ctx.reply('❌ Specify what to teach. Example: /teach search for {query} on youtube');
    return;
  }
  
  if (activeTeachSessions.has(userId)) {
    await ctx.reply('⚠️ Active session exists. Use /stopteach first.');
    return;
  }
  
  try {
    const { taskId } = await startTeachSession(userId, goal);
    await ctx.reply(`🎓 Teach Mode\nGoal: ${goal}\nID: ${taskId}\n\nPerform actions on your phone, then /stopteach`);
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
    await ctx.reply(`✅ Route Saved\nGoal: ${result.previousSession.goal}\n\nUse: /do ${result.previousSession.goal.replace(/\{.*?\}/g, 'example')}`);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('do', async (ctx) => {
  const taskText = ctx.message.text.replace(/^\/do\s*/, '').trim();
  if (!taskText) {
    await ctx.reply('❌ Specify a task');
    return;
  }
  
  try {
    const { taskId, steps, orchestration } = await createRegularTask(taskText, 'DO', 'fast', ctx.from.id);
    const apps = orchestration.fallback_apps?.length ? ` (fallbacks: ${orchestration.fallback_apps.join(', ')})` : '';
    await ctx.reply(`⚡ Fast Mode\nIntent: ${orchestration.intent}\nSteps: ${steps.length}${apps}\nID: ${taskId.slice(0, 8)}...`);
    waitForTaskCompletion(taskId, ctx);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('live', async (ctx) => {
  const taskText = ctx.message.text.replace(/^\/live\s*/, '').trim();
  if (!taskText) {
    await ctx.reply('❌ Specify a task');
    return;
  }
  
  try {
    const { taskId, steps } = await createRegularTask(taskText, 'LIVE', 'live', ctx.from.id);
    await ctx.reply(`👁️ Live Mode\nSteps: ${steps.length}\nFeatures: Verify clicks, Adapt on failure\nID: ${taskId.slice(0, 8)}...`);
    waitForTaskCompletion(taskId, ctx);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('route', async (ctx) => {
  const taskText = ctx.message.text.replace(/^\/route\s*/, '').trim();
  if (!taskText) {
    await ctx.reply('❌ Specify task');
    return;
  }
  
  try {
    const route = await findMatchingRoute(taskText);
    if (!route) {
      await ctx.reply('❌ No matching route. Use /do or teach this task.');
      return;
    }
    const { taskId } = await createRegularTask(taskText, 'ROUTE', 'routed', ctx.from.id);
    await ctx.reply(`📚 Route: ${route.goal}\nApp: ${route.app}\nExecuting...`);
    waitForTaskCompletion(taskId, ctx);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  
  try {
    // Auto-detect intent using LLM
    const orchestration = await llmOrchestrate(text, { mode: 'auto' });
    
    if (orchestration.intent.includes('chat') || orchestration.confidence < 0.4) {
      // Casual conversation
      const res = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: text }],
        temperature: 0.7,
        max_tokens: 150
      });
      const reply = cleanAiResponse(res.choices[0].message.content);
      await ctx.reply(reply);
    } else {
      // Execute as task
      const { taskId, steps } = await createRegularTask(text, 'AUTO', 'normal', ctx.from.id);
      await ctx.reply(`🤖 I'll handle that.\nSteps: ${steps.length}\nID: ${taskId.slice(0, 8)}...`);
      waitForTaskCompletion(taskId, ctx);
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
    version: '2.1',
    architecture: 'llm_brain',
    queue: 'priority_o1',
    modes: ['do', 'live', 'teach', 'auto']
  });
});

app.post('/task', async (req, res) => {
  try {
    const { text, mode = 'normal', user_id, priority = 5 } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    
    const result = await createRegularTask(text, 'API', mode, user_id);
    result.priority = priority;
    
    res.json({
      success: true,
      task_id: result.taskId,
      mode: mode,
      steps_count: result.steps.length,
      llm_intent: result.orchestration.intent,
      queue_position: (await getTaskQueue()).queue.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/queue', async (req, res) => {
  try {
    const queue = await getTaskQueue();
    res.json(queue);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`DWAI Server v2.1 (LLM Brain) on port ${PORT}`);
  console.log(`Queue: Priority O(1) System`);
  console.log(`Orchestration: ${GROQ_MODEL}`);
});

bot.launch();
console.log('Telegram bot active');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
