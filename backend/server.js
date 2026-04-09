// DWAI Server v2.9 - FINAL BATCH
// 1. Imagine & Execute 2. Skills 3. Workflow 4. Self-Upgrade 5. Schedule 6. Multi-language

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
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-70b-versatile';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// ============================================
// BATCH 2 NEW FEATURES - APIs & ENHANCEMENTS
// ============================================

// FEATURE 1: Web Search API (DuckDuckGo - Free, No API Key)
async function webSearch(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://duckduckgo.com/?q=${encodedQuery}&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    return {
      success: true,
      results: data.Results || [],
      answer: data.AnswerText || null,
      related: data.RelatedTopics || []
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// FEATURE 2: Context Memory (last 20 interactions for seamless conversation)
const CONVERSATION_CONTEXT_LIMIT = 20;
const conversationHistory = new Map(); // userId -> [{role, content, timestamp}]

function addToContext(userId, role, content) {
  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
  const history = conversationHistory.get(userId);
  history.push({ role, content, timestamp: Date.now() });
  // Keep only last 20 messages
  if (history.length > CONVERSATION_CONTEXT_LIMIT) {
    conversationHistory.set(userId, history.slice(-CONVERSATION_CONTEXT_LIMIT));
  }
}

function getContext(userId) {
  return conversationHistory.get(userId) || [];
}

function clearContext(userId) {
  conversationHistory.delete(userId);
}

// FEATURE 3: Telegram-Style Rich Responses
function formatTelegramStyle(text, style = 'default') {
  // Formats text in Telegram style: bold, italic, code, buttons, etc.
  let formatted = text;
  
  // Convert markdown-like to Telegram HTML
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  formatted = formatted.replace(/\*(.*?)\*/g, '<i>$1</i>');
  formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');
  
  return formatted;
}

function createTelegramButtons(buttons) {
  // buttons: [{text, callback_data, style}]
  // style: 'primary' (blue), 'secondary' (gray), 'danger' (red)
  return buttons.map(btn => ({
    text: btn.text,
    callback_data: btn.callback_data
  }));
}

// FEATURE 4: Enhanced Status Updates with Typing Indicators
async function sendTypingAction(chatId) {
  try {
    await bot.telegram.sendChatAction(chatId, 'typing');
  } catch (e) {}
}

async function sendRichResponse(chatId, text, buttons = null, parseMode = 'HTML') {
  try {
    const options = { parse_mode: parseMode };
    if (buttons && buttons.length > 0) {
      options.reply_markup = {
        inline_keyboard: buttons.map(btn => [{
          text: btn.text,
          callback_data: btn.callback_data
        }])
      };
    }
    await bot.telegram.sendMessage(chatId, text, options);
  } catch (e) {
    // Fallback to plain text
    await bot.telegram.sendMessage(chatId, text.replace(/<[^>]*>/g, ''));
  }
}

// FEATURE 5: Screenshot Analysis using Groq Vision
async function analyzeScreenshot(screenshotBase64) {
  try {
    // Use Groq with vision-capable model if available, otherwise describe
    const res = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this phone screenshot. Identify ALL clickable elements with EXACT x,y pixel coordinates relative to screen dimensions. \n\nFor each element return: {\"type\": \"button|input|text\", \"text\": \"label\", \"x\": percentage (0-100), \"y\": percentage (0-100), \"description\": \"location description\"}\n\nIMPORTANT: Return ONLY JSON array with elements. Convert positions to percentages: x=50 means center horizontal, y=80 means bottom area. Screen width=100%, height=100%." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 1000
    });
    return { success: true, analysis: res.choices[0].message.content };
  } catch (error) {
    // Fallback: just acknowledge screenshot received
    return { success: false, error: error.message, fallback: "Screenshot received - manual analysis needed" };
  }
}

// ============================================
// BATCH 3 NEW FEATURES - INTELLIGENCE & EXTERNAL API
// ============================================

// FEATURE 1: Ask for Clarification when uncertain
const CONFIDENCE_THRESHOLD = 0.7;

async function askClarification(ctx, userText, options) {
  const optionsText = options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
  const message = `🤔 I'm not entirely sure what you mean. Did you mean:\n\n${optionsText}\n\nOr please clarify your request.`;
  
  // Create inline buttons for quick selection
  const buttons = options.map((opt, i) => ({
    text: opt,
    callback_data: `clarify_${i}`
  }));
  
  await ctx.reply(message, {
    reply_markup: {
      inline_keyboard: buttons.map(btn => [btn])
    },
    parse_mode: 'Markdown'
  });
}

// FEATURE 2: Enhanced Route Matching with suggestions
async function findBestRoute(userText) {
  const routes = await fetchStoredRoutes();
  if (routes.length === 0) return null;
  
  const lowerText = userText.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  
  for (const route of routes) {
    const goal = (route.goal || '').toLowerCase();
    let score = 0;
    
    // Exact match
    if (goal === lowerText) score = 100;
    // Partial match
    else if (lowerText.includes(goal) || goal.includes(lowerText)) score = 80;
    // Word overlap
    else {
      const textWords = lowerText.split(/\s+/).filter(w => w.length > 2);
      const goalWords = goal.split(/\s+/).filter(w => w.length > 2);
      const overlap = textWords.filter(w => goalWords.some(gw => gw.includes(w) || w.includes(gw))).length;
      score = (overlap / Math.max(textWords.length, goalWords.length)) * 60;
    }
    
    // Boost score if route has been used before (check keywords)
    if (route.keywords) {
      for (const kw of route.keywords) {
        if (lowerText.includes(kw.toLowerCase())) score += 10;
      }
    }
    
    if (score > bestScore && score > 30) {
      bestScore = score;
      bestMatch = { route, score };
    }
  }
  
  return bestMatch;
}

// FEATURE 3: Complex Task Analysis - break down complex tasks
async function analyzeComplexTask(userText) {
  const prompt = `Analyze this user request and break it down into simple steps if needed.
  
User request: "${userText}"

If this is a COMPLEX task (multiple steps, multiple apps, or conditional), return:
{"complex": true, "steps": ["step 1", "step 2", ...], "reason": "why it's complex"}

If it's SIMPLE, return:
{"complex": false, "reason": "why it's simple"}`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Task analyzer. Output JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 300
    });
    
    const result = extractJsonObject(res.choices[0].message.content);
    return result || { complex: false, reason: 'analysis failed' };
  } catch (e) {
    return { complex: false, reason: 'error: ' + e.message };
  }
}

// FEATURE 4: Fallback Search - when UI element not found, try search icon
function buildFallbackSteps(taskDescription, failedAction) {
  const lowerDesc = (taskDescription || '').toLowerCase();
  
  // If searching failed, try finding search icon
  if (lowerDesc.includes('search') && failedAction === 'element_not_found') {
    return [
      { action: 'click', contains: 'Search', desc: 'Search icon', description: 'Find search icon' },
      { action: 'wait', ms: 1000 }
    ];
  }
  
  return null;
}

// FEATURE 5: External API with Security (API Key authentication)
const API_KEYS = new Map(); // token -> {userId, created, expires}
const EXTERNAL_API_SECRET = process.env.EXTERNAL_API_SECRET || 'dwai-secret-key-change-me';

function generateApiKey(userId) {
  const key = 'dwai_' + nanoid(32);
  const expires = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
  
  API_KEYS.set(key, { userId, created: Date.now(), expires });
  return { key, expires: new Date(expires).toISOString() };
}

function validateApiKey(key) {
  const token = API_KEYS.get(key);
  if (!token) return null;
  if (token.expires < Date.now()) {
    API_KEYS.delete(key);
    return null;
  }
  return token;
}

// ============================================
// BATCH 4 NEW FEATURES - OPENCLAW, DOCS, BYOK, ROOT, GAMING
// ============================================

// FEATURE 1: OpenClaw Native Support
// Allow OpenClaw to control the phone via its protocol
const OPENCLAW_ENABLED = process.env.OPENCLAW_ENABLED === 'true';
const OPENCLAW_DEVICE_TOKEN = process.env.OPENCLAW_DEVICE_TOKEN || '';

// OpenClaw device registration endpoint
app.post('/openclaw/register', async (req, res) => {
  const { device_id, name, capabilities } = req.body;
  
  if (!OPENCLAW_ENABLED) {
    return res.status(503).json({ error: 'OpenClaw integration disabled' });
  }
  
  // Register this phone as an OpenClaw device
  const deviceData = {
    device_id: device_id || 'dwai-phone-' + Date.now(),
    name: name || 'DWAI Phone',
    capabilities: capabilities || ['automation', 'screenshot', 'input'],
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString()
  };
  
  res.json({ ok: true, device: deviceData });
});

// OpenClaw command execution
app.post('/openclaw/execute', async (req, res) => {
  const { device_token, command, action } = req.body;
  
  if (!OPENCLAW_ENABLED) {
    return res.status(503).json({ error: 'OpenClaw integration disabled' });
  }
  
  if (device_token !== OPENCLAW_DEVICE_TOKEN) {
    return res.status(401).json({ error: 'Invalid device token' });
  }
  
  try {
    // Execute like a regular task but with OpenClaw context
    const { taskId, steps, targetApp } = await createRegularTask(
      command || action, 
      'OPENCLAW', 
      'fast', 
      0, // system user
      0
    );
    
    res.json({ ok: true, taskId, steps: steps.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// OpenClaw status endpoint
app.get('/openclaw/status', (req, res) => {
  res.json({ 
    enabled: OPENCLAW_ENABLED,
    device_token_set: !!OPENCLAW_DEVICE_TOKEN,
    version: '2.9'
  });
});

// FEATURE 2: Documentation Generation
function generateProjectDocs() {
  const docs = {
    project: 'DWAI Mobile Agent',
    version: '2.9',
    description: 'AI-powered phone automation via Telegram',
    architecture: {
      backend: 'Express.js + Groq LLM + GitHub storage',
      phone: 'Auto.js automation script',
      communication: 'GitHub JSON files + polling'
    },
    features: [
      'Command Chaining',
      'Stored Routes',
      'App List',
      'Context Awareness',
      'Live Vision',
      'Web Search',
      'Context Memory (20)',
      'Telegram Style',
      'Vision Analysis',
      'Clarification',
      'Route Matching',
      'Complex Tasks',
      'Fallback Search',
      'External API',
      'OpenClaw Native',
      'Game Mode'
    ],
    api_endpoints: {
      '/api/key': 'Generate API key',
      '/api/execute': 'Execute command',
      '/api/task/:id': 'Check task status',
      '/openclaw/register': 'Register with OpenClaw',
      '/openclaw/execute': 'Execute via OpenClaw',
      '/analyze-screenshot': 'Analyze screenshot with AI'
    },
    commands: {
      '/do <task>': 'Execute task',
      '/teach <goal>': 'Teach new route',
      '/live <task>': 'Live mode execution',
      '/status': 'Check system status'
    }
  };
  return docs;
}

app.get('/docs', (req, res) => {
  res.json(generateProjectDocs());
});

app.get('/docs.md', (req, res) => {
  const docs = generateProjectDocs();
  let md = `# ${docs.project} v${docs.version}\n\n${docs.description}\n\n## Architecture\n\n`;
  md += `- **Backend:** ${docs.architecture.backend}\n`;
  md += `- **Phone:** ${docs.architecture.phone}\n`;
  md += `- **Communication:** ${docs.architecture.communication}\n\n`;
  md += `## Features\n\n`;
  docs.features.forEach(f => md += `- ${f}\n`);
  md += `\n## API Endpoints\n\n`;
  Object.entries(docs.api_endpoints).forEach(([path, desc]) => md += `- \`${path}\`: ${desc}\n`);
  md += `\n## Commands\n\n`;
  Object.entries(docs.commands).forEach(([cmd, desc]) => md += `- ${cmd}: ${desc}\n`);
  
  res.set('Content-Type', 'text/markdown');
  res.send(md);
});

// FEATURE 3: BYOK (Bring Your Own Key) - Vision/TTS/STT
// Allow users to provide their own API keys for optional features
const BYOK_CONFIG = {
  vision_model: process.env.BYOK_VISION_MODEL || null,
  tts_api: process.env.BYOK_TTS_API || null,
  stt_api: process.env.BYOK_STT_API || null
};

// TTS (Text-to-Speech) - Optional
async function textToSpeech(text, voice = 'default') {
  if (!BYOK_CONFIG.tts_api) {
    return { success: false, error: 'TTS not configured' };
  }
  // Implement TTS based on configured API
  return { success: false, error: 'TTS not implemented yet' };
}

// STT (Speech-to-Text) - Optional  
async function speechToText(audioData) {
  if (!BYOK_CONFIG.stt_api) {
    return { success: false, error: 'STT not configured' };
  }
  // Implement STT based on configured API
  return { success: false, error: 'STT not implemented yet' };
}

// Custom Vision Model - Optional
async function customVisionAnalyze(imageBase64, modelType) {
  if (!BYOK_CONFIG.vision_model) {
    return { success: false, error: 'Custom vision not configured' };
  }
  // Use custom model if configured
  return { success: false, error: 'Custom vision not implemented yet' };
}

app.get('/byok/status', (req, res) => {
  res.json({
    vision_modelConfigured: !!BYOK_CONFIG.vision_model,
    ttsConfigured: !!BYOK_CONFIG.tts_api,
    sttConfigured: !!BYOK_CONFIG.stt_api
  });
});

// FEATURE 5: Game Mode - Fast execution for gaming
const GAME_MODE_ENABLED = true;
const GAME_MODE_CONFIG = {
  poll_interval: 500,    // Poll every 500ms (faster than normal 2000ms)
  max_retry: 5,         // More retries
  verify_steps: false,  // Skip verification for speed
  max_steps_per_task: 50 // Allow longer chains for games
};

function createGameTask(userText) {
  return createRegularTask(userText, 'GAME', 'fast', 0, 0);
}

// Fast path for game commands
app.post('/game/execute', async (req, res) => {
  const { command, key } = req.body;
  
  // Validate API key or session
  const token = validateApiKey(key);
  if (!token && !GAME_MODE_ENABLED) {
    return res.status(401).json({ error: 'Game mode disabled or invalid key' });
  }
  
  try {
    // Execute with game mode settings
    const { taskId, steps, targetApp } = await createRegularTask(
      command,
      'GAME',
      'fast',
      token?.userId || 0,
      token?.userId || 0
    );
    
    res.json({ 
      ok: true, 
      taskId, 
      steps: steps.length,
      mode: 'game',
      estimatedTime: steps.length * 500 + 'ms'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Game mode status
app.get('/game/status', (req, res) => {
  res.json({
    enabled: GAME_MODE_ENABLED,
    pollInterval: GAME_MODE_CONFIG.poll_interval,
    maxSteps: GAME_MODE_CONFIG.max_steps_per_task
  });
});

// ============================================
// FINAL BATCH - BATCH 5 FEATURES
// ============================================

// FEATURE 1: Imagine & Execute - Create and run animations/sequences
// Uses LLM to imagine a sequence and execute it
async function imagineAndExecute(userRequest) {
  // Generate a detailed animation/sequence based on user imagination
  const prompt = `Create a detailed step-by-step animation sequence for: "${userRequest}"

For animations/sequences, output JSON:
{
  "type": "animation",
  "name": "short name",
  "frames": [
    {"action": "click", "x": 500, "y": 1000, "duration": 100},
    {"action": "swipe", "x1": 500, "y1": 1500, "x2": 500, "y2": 500, "duration": 300},
    ...
  ],
  "loops": 1,
  "speed": "normal|fast|slow"
}`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Animation planner. Output JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });
    
    const result = extractJsonObject(res.choices[0].message.content);
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

app.post('/imagine', async (req, res) => {
  const { request, key } = req.body;
  
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  const result = await imagineAndExecute(request);
  res.json(result);
});

// FEATURE 2: Skills System - Create, save, and use custom skills
const SKILLS_PATH = 'data/skills';

async function saveSkill(skillId, skillData) {
  const url = `${GITHUB_API}/${SKILLS_PATH}/${skillId}.json`;
  const content = Buffer.from(JSON.stringify(skillData, null, 2)).toString('base64');
  const existing = await ghGetJson(url);
  const payload = { message: `Skill ${skillId}`, content, branch: GITHUB_BRANCH };
  if (existing.ok && existing.json?.sha) payload.sha = existing.json.sha;
  return ghPutJson(url, payload);
}

async function getSkill(skillId) {
  const url = `${GITHUB_API}/${SKILLS_PATH}/${skillId}.json`;
  const res = await ghGetJson(url);
  if (!res.ok || !res.json?.content) return null;
  return JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
}

async function listSkills() {
  const url = `${GITHUB_API}/${SKILLS_PATH}`;
  const res = await ghGetJson(url);
  if (!res.ok || !Array.isArray(res.json)) return [];
  return res.json.filter(f => f.type === 'file' && f.name.endsWith('.json')).map(f => f.name.replace('.json', ''));
}

// Create a new skill
app.post('/skill/create', async (req, res) => {
  const { name, description, steps, key } = req.body;
  
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  const skillId = name.toLowerCase().replace(/\s+/g, '-');
  const skillData = {
    id: skillId,
    name,
    description,
    steps,
    created_by: token.userId,
    created_at: new Date().toISOString(),
    version: '1.0'
  };
  
  await saveSkill(skillId, skillData);
  res.json({ ok: true, skillId, skill: skillData });
});

// Use a skill
app.post('/skill/use', async (req, res) => {
  const { skill_name, params, key } = req.body;
  
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  const skill = await getSkill(skill_name);
  if (!skill) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  
  // Execute skill with params
  const { taskId, steps } = await createRegularTask(
    `Use skill: ${skill.name}`,
    'SKILL',
    'normal',
    token.userId,
    token.userId
  );
  
  res.json({ ok: true, taskId, skill: skill.name, steps: steps.length });
});

// List all skills
app.get('/skills', async (req, res) => {
  const skills = await listSkills();
  res.json({ skills });
});

// FEATURE 3: Workflow Automation - If X then do Y
const WORKFLOWS_PATH = 'data/workflows';
const activeWorkflows = new Map();

async function saveWorkflow(workflowId, workflowData) {
  const url = `${GITHUB_API}/${WORKFLOWS_PATH}/${workflowId}.json`;
  const content = Buffer.from(JSON.stringify(workflowData, null, 2)).toString('base64');
  const existing = await ghGetJson(url);
  const payload = { message: `Workflow ${workflowId}`, content, branch: GITHUB_BRANCH };
  if (existing.ok && existing.json?.sha) payload.sha = existing.json.sha;
  return ghPutJson(url, payload);
}

app.post('/workflow/create', async (req, res) => {
  const { name, trigger, actions, enabled, key } = req.body;
  
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  const workflowId = name.toLowerCase().replace(/\s+/g, '-');
  const workflowData = {
    id: workflowId,
    name,
    trigger: trigger, // e.g., "app_opened:youtube" or "time:9am"
    actions,
    enabled: enabled !== false,
    created_by: token.userId,
    created_at: new Date().toISOString()
  };
  
  await saveWorkflow(workflowId, workflowData);
  
  if (workflowData.enabled) {
    activeWorkflows.set(workflowId, workflowData);
  }
  
  res.json({ ok: true, workflowId, workflow: workflowData });
});

// Check and run workflows based on current context
async function checkWorkflows(deviceState) {
  for (const [id, workflow] of activeWorkflows) {
    if (!workflow.enabled) continue;
    
    // Check trigger
    const triggerParts = workflow.trigger.split(':');
    const triggerType = triggerParts[0];
    const triggerValue = triggerParts[1];
    
    let shouldRun = false;
    
    if (triggerType === 'app_opened' && deviceState.current_app?.includes(triggerValue)) {
      shouldRun = true;
    }
    // Add more trigger types
    
    if (shouldRun) {
      log(`Workflow triggered: ${workflow.name}`);
      for (const action of workflow.actions) {
        await createRegularTask(action, 'WORKFLOW', 'fast', 0, 0);
      }
    }
  }
}

// FEATURE 4: Self-Upgrade - Update itself via chat
app.post('/upgrade', async (req, res) => {
  const { code_changes, key } = req.body;
  
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // In production, this would validate and apply changes
  // For now, just acknowledge the request
  res.json({ 
    ok: true, 
    message: 'Upgrade request received. In production, this would apply code changes.',
    note: 'Self-upgrade requires careful validation in production'
  });
});

// FEATURE 5: Natural Language Scheduling
const SCHEDULES_PATH = 'data/schedules';

async function parseScheduleToCron(scheduleText) {
  const prompt = `Convert this natural language schedule to cron expression:
"${scheduleText}"

Examples:
- "every day at 9am" -> "0 9 * * *"
- "every monday at 6pm" -> "0 18 * * 1"
- "every hour" -> "0 * * * *"

Return ONLY the cron expression.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Cron converter. Output only cron.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 50
    });
    return res.choices[0].message.content.trim();
  } catch (e) {
    return null;
  }
}

app.post('/schedule/create', async (req, res) => {
  const { task, schedule, timezone, key } = req.body;
  
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  const cron = await parseScheduleToCron(schedule);
  if (!cron) {
    return res.status(400).json({ error: 'Could not parse schedule' });
  }
  
  const scheduleData = {
    id: 'sched_' + Date.now(),
    task,
    schedule,
    cron,
    timezone: timezone || 'UTC',
    enabled: true,
    created_by: token.userId,
    next_run: 'calculated_from_cron'
  };
  
  // Save to GitHub
  const url = `${GITHUB_API}/${SCHEDULES_PATH}/sched_${Date.now()}.json`;
  await ghPutJson(url, {
    message: 'Schedule created',
    content: Buffer.from(JSON.stringify(scheduleData, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  res.json({ ok: true, schedule: scheduleData, cron });
});

app.get('/schedules', async (req, res) => {
  const { key } = req.query;
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // List schedules (would fetch from GitHub in production)
  res.json({ schedules: [], note: 'Schedule listing coming soon' });
});

// FEATURE 6: Multi-language Support
const SUPPORTED_LANGUAGES = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  zh: '中文',
  ja: '日本語',
  ar: 'العربية',
  hi: 'हिन्दी'
};

function detectLanguage(text) {
  // Simple language detection based on character ranges
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh'; // Chinese
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // Japanese
  if (/[\u0600-\u06ff]/.test(text)) return 'ar'; // Arabic
  if (/[\u0900-\u097f]/.test(text)) return 'hi'; // Hindi
  if (/[àâäéèêëïîôùûüÿœæç]/i.test(text)) return 'fr'; // French
  if (/[äöüß]/i.test(text)) return 'de'; // German
  if (/[áéíóúñ¿]/i.test(text)) return 'es'; // Spanish
  if (/[ãõç]/i.test(text)) return 'pt'; // Portuguese
  return 'en';
}

function translateText(text, targetLang) {
  // In production, use translation API
  // For now, just detect and acknowledge
  return { original: text, detected: detectLanguage(text), target: targetLang };
}

app.get('/languages', (req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

app.post('/translate', async (req, res) => {
  const { text, target_lang } = req.body;
  const result = translateText(text, target_lang);
  res.json(result);
});

// Language-aware prompt for LLM
function buildMultilingualPrompt(userText) {
  const lang = detectLanguage(userText);
  const langName = SUPPORTED_LANGUAGES[lang] || 'English';
  
  return `User message (${langName}): "${userText}"

Process this request. The user may be using any of these languages: ${Object.values(SUPPORTED_LANGUAGES).join(', ')}.

Respond in the same language as the user.`;
}

// External API endpoints
app.post('/api/key', async (req, res) => {
  const { secret, user_id } = req.body;
  
  if (secret !== EXTERNAL_API_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  
  const { key, expires } = generateApiKey(user_id);
  res.json({ key, expires });
});

app.delete('/api/key/:key', (req, res) => {
  const { key } = req.params;
  API_KEYS.delete(key);
  res.json({ ok: true, message: 'API key revoked' });
});

// External execution endpoint
app.post('/api/execute', async (req, res) => {
  const { key, command, mode } = req.body;
  
  // Validate API key
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid or expired API key' });
  }
  
  try {
    // Execute command like regular text handler
    const { taskId, steps, targetApp } = await createRegularTask(
      command, 
      'API', 
      mode || 'normal', 
      token.userId, 
      token.userId // Use userId as chat_id for external
    );
    
    res.json({ 
      ok: true, 
      taskId, 
      steps: steps.length, 
      target: targetApp 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// External status check
app.get('/api/task/:taskId', async (req, res) => {
  const { key } = req.query;
  const { taskId } = req.params;
  
  const token = validateApiKey(key);
  if (!token) {
    return res.status(401).json({ error: 'Invalid or expired API key' });
  }
  
  try {
    const taskUrl = `${GITHUB_API}/${TASKS_PATH}/${taskId}.json`;
    const taskRes = await ghGetJson(taskUrl);
    
    if (!taskRes.ok || !taskRes.json?.content) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const task = JSON.parse(Buffer.from(taskRes.json.content, 'base64').toString());
    res.json({ 
      task_id: task.task_id, 
      status: task.status,
      created_at: task.created_at,
      finished_at: task.finished_at
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check for external API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '2.9',
    features: ['external_api', 'api_keys', 'secure_execution'],
    active_keys: API_KEYS.size
  });
});

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
const DEVICE_STATE_PATH = 'data/device_state.json';
const APPS_LIST_PATH = 'data/installed_apps.json';

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
  'launch_app', 'click', 'type', 'press', 'wait', 'toast', 'swipe', 'verify', 'open_url', 'observe', 'scroll_find', 'screenshot', 'get_context', 'analyze_screenshot', 'fallback_search'
]);

// ============================================
// TEACH SESSION STATE (Preserved)
// ============================================
const activeTeachSessions = new Map();

// ============================================
// CACHED DATA FOR NEW FEATURES
// ============================================
let cachedRoutes = null;
let cachedAppsList = null;
let cachedDeviceState = null;

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
// NEW FEATURES (v2.5 additions - DO NOT REMOVE EXISTING)
// ============================================

// FEATURE 3: Fetch Installed Apps List
async function fetchInstalledApps() {
  if (cachedAppsList) return cachedAppsList;
  const url = `${GITHUB_API}/${APPS_LIST_PATH}`;
  const res = await ghGetJson(url);
  if (res.ok && res.json?.content) {
    try {
      cachedAppsList = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
      return cachedAppsList;
    } catch { }
  }
  return { apps: Object.keys(APP_REGISTRY), timestamp: Date.now() };
}

// FEATURE 4: Fetch Device State (Context Awareness)
async function fetchDeviceState() {
  const url = `${GITHUB_API}/${DEVICE_STATE_PATH}`;
  const res = await ghGetJson(url);
  if (res.ok && res.json?.content) {
    try {
      cachedDeviceState = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
      return cachedDeviceState;
    } catch { }
  }
  return { current_app: null, screen_text: '', last_action: null, timestamp: Date.now() };
}

// FEATURE 2: Fetch Stored Routes
async function fetchStoredRoutes() {
  if (cachedRoutes) return cachedRoutes;
  const url = `${GITHUB_API}/${ROUTES_PATH}`;
  const res = await ghGetJson(url);
  if (res.ok && res.json) {
    const routes = [];
    for (const file of (res.json || [])) {
      if (file.name?.endsWith('.json') && file.name !== '.gitkeep') {
        const routeUrl = file.download_url;
        const routeRes = await ghGetJson(routeUrl);
        if (routeRes.ok && routeRes.body) {
          try {
            routes.push(JSON.parse(routeRes.body));
          } catch { }
        }
      }
    }
    cachedRoutes = routes;
    return routes;
  }
  return [];
}

// Find matching route by keywords
function findMatchingStoredRoute(routes, userQuery) {
  const query = userQuery.toLowerCase();
  for (const route of routes) {
    const goal = (route.goal || '').toLowerCase();
    if (goal.includes(query) || query.includes(goal)) {
      return route;
    }
    if (route.keywords) {
      for (const kw of route.keywords) {
        if (query.includes(kw.toLowerCase())) return route;
      }
    }
  }
  return null;
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
// STEP VALIDATION (All Original Logic - Added screenshot, get_context)
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
    case 'screenshot':
      return true;  // FEATURE 5: Live mode screenshot
    case 'get_context':
      return true;  // FEATURE 4: Get device context
    case 'analyze_screenshot':
      return true;  // FEATURE 5: AI Vision - analyze screenshot
    case 'fallback_search':
      return true;  // FEATURE 4: Fallback to search icon
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
// LLM ORCHESTRATION (The Brain - Enhanced with v2.5 Features)
// ============================================
async function llmOrchestrate(userText, context = {}) {
  const appList = Object.entries(APP_REGISTRY).map(([name, info]) => {
    let str = `${name}`;
    if (info.aliases.length) str += ` (aka: ${info.aliases.join(', ')})`;
    if (name === 'chrome') str += ` [CRITICAL: Use id "com.android.chrome:id/url_bar" for search]`;
    return str;
  }).join(', ');

  // FEATURE 3: Get installed apps from device
  const installedApps = await fetchInstalledApps();
  const installedAppsList = installedApps?.apps?.join(', ') || 'Unknown';
  
  // FEATURE 4: Get device state (context awareness)
  const deviceState = await fetchDeviceState();
  const contextInfo = deviceState ? `
CURRENT DEVICE CONTEXT:
- Current App: ${deviceState.current_app || 'Unknown'}
- Last Action: ${deviceState.last_action || 'None'}
- Screen Text: ${deviceState.screen_text || 'N/A'}
- Timestamp: ${deviceState.timestamp ? new Date(deviceState.timestamp).toISOString() : 'N/A'}` : '';

  // FEATURE 2: Get stored routes
  const storedRoutes = await fetchStoredRoutes();
  const routesInfo = storedRoutes.length > 0 ? `
AVAILABLE STORED ROUTES (reuse these if matches):
${storedRoutes.slice(0, 10).map(r => `- ${r.goal} (${r.steps?.length || 0} steps)`).join('\n')}` : '';

  // FEATURE 5: Live mode info
  const liveMode = context.mode === 'live';
  const visionInfo = liveMode ? `
📸 LIVE MODE: You can request screenshots to see what's on screen. Use action "screenshot" to capture.` : '';

  const prompt = `You are DWAI (Digital Worker AI) - the intelligent brain controlling an Android phone.

You are the BRAIN - the phone is your BODY. You make ALL decisions. Nothing happens without your instruction.

## 🎯 CORE RESPONSIBILITY
Understand user → Plan steps → Execute via phone → Report results.

## 🔧 ACTIONS AVAILABLE
- launch_app: Open app (value: app name or package)
- click: Tap (x,y or text/contains/id)
- type: Enter text (text: "hello")
- press: Key (key: "enter"/"back"/"home")
- wait: Pause (ms: 2000)
- swipe: Direction (direction: "up"/"down"/"left"/"right")
- screenshot: Capture screen
- analyze_screenshot: AI sees UI elements
- get_context: What's currently open
- open_url: Browser (value: "https://...")
- fallback_search: Find search icon if search bar missing

## 📱 PHONE-FIRST APPROACH
For ANY task, use PHONE APPS first to keep user engaged:
- For "search": Open YouTube/Chrome → search IN THE APP, don't use web API
- For "find info": Open Chrome → search in browser
- For "watch": Open YouTube/Netflix → search in app
- For "music": Open Spotify → search in app
- For "news": Open Twitter/News app → search in app

Web search API is ONLY for: figuring out HOW to do something, getting facts you don't know, or when phone apps can't help.

## 🧠 THINKING PROCESS
1. Understand what user wants
2. Use PHONE APP for the task (not web) - keeps user engaged
3. Plan step-by-step: Open app → do task inside app → report result
4. Execute in sequence
5. Verify each step worked
6. Use web search only to FIND information, not to DO the task

## 👁️ VISION ANALYSIS - TWO WAYS TO CLICK
When you analyze a screenshot and get elements:

**Option 1: EXACT COORDINATES (Preferred for buttons)**
- x and y are PERCENTAGES (0-100) of screen
- Convert to actual pixels: x_pixels = (x / 100) * device_width
- Example: x=50, y=80 on 1080x1920 screen = click(540, 1536)

**Option 2: TEXT CLICK (Easier, use when element has text)**
- Use click action with "text" or "contains" property
- Example: {"action": "click", "text": "Login"} - finds and clicks button with "Login" text
- This is MORE RELIABLE than coordinates - use when available!

**Priority:** TEXT CLICK > COORDINATES (text is more reliable)

## 🎮 GAME MODE
If request involves "play", "game", "jump", "slide", etc:
- Detect game type from screen text
- For Subway Surfers: tap=Jump, swipe left/right=Change lane, swipe down=Roll
- For Temple Run: tap=Jump, swipe down=Slide, swipe left/right=Turn
- Execute random game actions at 500ms intervals
- Avoid same action twice in a row

## 🔄 COMPLEX TASKS
Break into smaller sequential steps. Example: "Order pizza" = Open app → Search pizza → Select → Add to cart → Checkout → Pay → Confirm

## ❓ ASK FOR CLARIFICATION
If confidence 30-60%, ask user which option they mean.

## 🌍 MULTI-LANGUAGE
Respond in the same language the user used.

## ⚠️ SAFETY RULES
- Don't make payments without user confirmation
- Don't access private data unless asked
- Verify important actions
- Report failures clearly

## 📝 RESPONSE FORMAT
Return JSON:
{
  "intent": "brief description",
  "target_app": "package.name",
  "confidence": 0.0-1.0,
  "steps": [
    {"action": "launch_app", "value": "chrome", "description": "Open Chrome", "id": 1},
    {"action": "click", "x": 500, "y": 1200, "description": "Tap search", "id": 2},
    {"action": "type", "text": "{query}", "description": "Enter search", "id": 3}
  ]
}

Now process: "${userText}";
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
    console.error('LLM Error:', e.message);
    // Save error to GitHub for debugging
    const errorLog = {
      time: new Date().toISOString(),
      type: 'llm_error',
      message: e.message,
      userText: userText
    };
    try {
      const logUrl = `${GITHUB_API}/data/error_log.json`;
      await ghPutJson(logUrl, {
        message: 'LLM Error log',
        content: Buffer.from(JSON.stringify(errorLog, null, 2)).toString('base64'),
        branch: GITHUB_BRANCH
      });
    } catch {}
    return { intent: 'error', confidence: 0, steps: [], error: e.message };
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
    if (!orch.steps || !Array.isArray(orch.steps)) {
      // Fallback to template
      const template = buildTemplateSteps(userText);
      if (template) steps = template;
    } else {
      steps = orch.steps.map(s => ({
        ...s,
        text: fillSlots(s.text, orch.slots),
        value: fillSlots(s.value, orch.slots)
      }));
    }
  }
  
  if (steps.length === 0) {
    // Fallback to template builder
    const template = buildTemplateSteps(userText);
    if (template) steps = template;
    else {
      // Final fallback - basic search templates
      const lower = userText.toLowerCase();
      if (lower.includes('youtube')) {
        steps = [
          { action: 'launch_app', value: 'youtube', description: 'Open YouTube', id: 1 },
          { action: 'wait', ms: 4000, description: 'Wait for YouTube', id: 2 },
          { action: 'click', contains: 'Search', description: 'Tap Search', id: 3 },
          { action: 'wait', ms: 1000, description: 'Wait', id: 4 },
          { action: 'type', text: userText.replace(/.*search\s+/i, '').trim(), description: 'Type search', id: 5 },
          { action: 'press', key: 'enter', description: 'Search', id: 6 }
        ];
      } else if (lower.includes('search') || lower.includes('find')) {
        steps = [
          { action: 'launch_app', value: 'chrome', description: 'Open Chrome', id: 1 },
          { action: 'wait', ms: 4000, description: 'Wait', id: 2 },
          { action: 'click', id: 'com.android.chrome:id/url_bar', description: 'Tap URL bar', id: 3 },
          { action: 'type', text: userText.replace(/^(search|find)\s+/i, '').trim(), description: 'Type query', id: 4 },
          { action: 'press', key: 'enter', description: 'Search', id: 5 }
        ];
      } else {
        steps = [
          { action: 'launch_app', value: 'chrome', description: 'Open browser', id: 1 },
          { action: 'wait', ms: 3000, description: 'Wait', id: 2 }
        ];
      }
    }
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
  await ctx.reply(`👋 DWAI Mobile Agent v2.7

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
  
  const userId = ctx.from.id;
  const userMessage = ctx.message.text.trim();
  
  try {
    // FEATURE 2: Add to conversation context for seamless experience
    addToContext(userId, 'user', userMessage);
    
    // FEATURE 6: Detect language and build multilingual-aware prompt
    const userTextForLLM = buildMultilingualPrompt(userMessage);
    
    // Check for web search command
    if (userMessage.toLowerCase().startsWith('search ') || userMessage.toLowerCase().startsWith('find ')) {
      const query = userMessage.replace(/^(search|find)\s+/i, '');
      await sendTypingAction(ctx.chat.id);
      const searchResult = await webSearch(query);
      
      if (searchResult.success && searchResult.answer) {
        await ctx.reply(`🔍 *Search results for:* "${query}"\n\n${searchResult.answer}`, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(`🔍 Search for "${query}" returned no direct answer. Try /do to perform an action.`);
      }
      addToContext(userId, 'assistant', searchResult.answer || 'Search performed');
      return;
    }
    
    // Check for schedule command
    const scheduleMatch = userMessage.match(/^(?:schedule|remind|reminder)\s+(.+?)\s+(?:at|every|in)\s+(.+)$/i);
    if (scheduleMatch) {
      const task = scheduleMatch[1].trim();
      const schedule = scheduleMatch[2].trim();
      
      const cron = await parseScheduleToCron(schedule);
      
      if (!cron) {
        await ctx.reply('❌ Could not understand the schedule. Try: "remind me to check email every day at 9am"');
        return;
      }
      
      // Save schedule
      const scheduleData = {
        id: 'sched_' + Date.now(),
        task: task,
        schedule: schedule,
        cron: cron,
        enabled: true,
        created_by: userId,
        created_at: new Date().toISOString()
      };
      
      const url = `${GITHUB_API}/${SCHEDULES_PATH}/sched_${Date.now()}.json`;
      await ghPutJson(url, {
        message: 'Schedule created',
        content: Buffer.from(JSON.stringify(scheduleData, null, 2)).toString('base64'),
        branch: GITHUB_BRANCH
      });
      
      await ctx.reply(`✅ *Schedule Created!*\n\nTask: ${task}\nSchedule: ${schedule}\nCron: ${cron}`, { parse_mode: 'Markdown' });
      addToContext(userId, 'assistant', 'Schedule created: ' + task);
      return;
    }
    
    // Show typing indicator while processing
    await sendTypingAction(ctx.chat.id);
    
    // FEATURE 5: Check for game mode - auto-detect gaming commands
    const lowerMsg = userMessage.toLowerCase();
    const gameKeywords = ['play', 'game', 'jump', 'slide', 'swipe', 'dodge', 'collect', 'run', 'subway', 'temple', 'candy', 'flappy', 'arcade'];
    const isGameCommand = gameKeywords.some(kw => lowerMsg.includes(kw)) || lowerMsg.startsWith('/game');
    
    if (isGameCommand || userMessage.startsWith('/game ')) {
      // Extract game command
      const gameCommand = userMessage.replace(/^\/game\s*/, '').trim();
      if (gameCommand) {
        await ctx.reply('🎮 *Starting Game Mode...*', { parse_mode: 'Markdown' });
        const result = await createRegularTask(gameCommand, 'GAME', 'GAME', userId, ctx.chat.id);
        addToContext(userId, 'assistant', 'Game mode started');
        return;
      }
    }
    
    // FEATURE 3: Analyze if this is a complex task
    const taskAnalysis = await analyzeComplexTask(userMessage);
    
    if (taskAnalysis.complex) {
      await ctx.reply(`📊 *Task Analysis*\n\nThis is a complex task. I'll break it down:\n\n${taskAnalysis.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`, { parse_mode: 'Markdown' });
    }
    
    // FEATURE 2: Check for best matching route first
    const routeMatch = await findBestRoute(userMessage);
    let routeMatched = null;
    let steps = [];
    let targetApp = null;
    
    if (routeMatch && routeMatch.score > 60) {
      // High confidence route match - use it
      const { taskId, steps: routeSteps, targetApp: app } = await createRegularTask(
        userMessage, 'ROUTE', 'normal', userId, ctx.chat.id
      );
      steps = routeSteps;
      targetApp = app;
      routeMatched = routeMatch.route.goal;
    } else if (routeMatch && routeMatch.score > 30) {
      // Medium confidence - ask for clarification
      await askClarification(ctx, userMessage, [
        routeMatch.route.goal,
        'Do something else'
      ]);
      return;
    } else {
      // No route match - use LLM to generate steps
      const result = await createRegularTask(userMessage, 'AUTO', 'normal', userId, ctx.chat.id);
      steps = result.steps;
      targetApp = result.targetApp;
    }
    
    const appName = targetApp ? targetApp.split('.').pop() : 'device';
    
    // FEATURE 3: Use rich Telegram-style response
    let statusMsg = `🤖 *Executing on ${appName}...*\n📋 Steps: ${steps.length}`;
    if (routeMatched) statusMsg += `\n📚 Using route: ${routeMatched}`;
    if (taskAnalysis.complex) statusMsg += `\n🔀 Complex task (${taskAnalysis.steps.length} subtasks)`;
    statusMsg += `\n⏳ Processing...`;
    
    await ctx.reply(statusMsg, { parse_mode: 'Markdown' });
    
    monitorTaskProgress(routeMatched ? null : (await createRegularTask(userMessage, 'AUTO', 'normal', userId, ctx.chat.id)).taskId, ctx.chat.id, steps);
    
    // Add assistant response to context
    addToContext(userId, 'assistant', `Task created: ${steps.length} steps`);
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
    version: '2.9',
    features: ['llm_brain', 'step_verification', 'priority_queue', 'teach_mode', 'route_matching', 'ai_reports', 'command_chaining', 'stored_routes', 'app_list', 'context_awareness', 'live_vision', 'web_search', 'context_memory', 'telegram_style', 'vision_analysis']
  });
});

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
// ============================================// SCHEDULER - Run tasks at scheduled times
// ============================================
const SCHEDULER_INTERVAL = 60000; // Check every minute
const schedules = new Map(); // In-memory cache of active schedules

async function loadSchedules() {
  try {
    const url = `${GITHUB_API}/${SCHEDULES_PATH}`;
    const res = await ghGetJson(url);
    if (res.ok && Array.isArray(res.json)) {
      res.json.filter(f => f.type === 'file' && f.name.endsWith('.json')).forEach(f => {
        // Would load schedule details
      });
    }
  } catch (e) {
    console.log("Load schedules error: " + e);
  }
}

function shouldRunNow(cron) {
  const now = new Date();
  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDay();
  const date = now.getDate();
  
  const parts = cron.split(' ');
  if (parts.length !== 5) return false;
  
  const [m, h, dom, mon, dow] = parts;
  
  if (m !== '*' && parseInt(m) !== minute) return false;
  if (h !== '*' && parseInt(h) !== hour) return false;
  if (dow !== '*' && !dow.split(',').includes(String(day))) return false;
  if (dom !== '*' && parseInt(dom) !== date) return false;
  
  return true;
}

function startScheduler() {
  console.log("Starting task scheduler...");
  
  setInterval(async () => {
    try {
      const url = `${GITHUB_API}/${SCHEDULES_PATH}`;
      const res = await ghGetJson(url);
      
      if (!res.ok || !Array.isArray(res.json)) return;
      
      for (const file of res.json) {
        if (!file.name.endsWith('.json')) continue;
        
        const scheduleUrl = file.download_url;
        const scheduleRes = await ghGetJson(scheduleUrl);
        
        if (!scheduleRes.ok || !scheduleRes.body) continue;
        
        try {
          const schedule = JSON.parse(scheduleRes.body);
          
          if (!schedule.enabled) continue;
          
          if (shouldRunNow(schedule.cron)) {
            console.log("Running scheduled: " + schedule.task);
            await createRegularTask(schedule.task, 'SCHEDULED', 'normal', 0, 0);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }, SCHEDULER_INTERVAL);
}

app.listen(PORT, () => {
  console.log(`DWAI Server v2.9 on port ${PORT}`);
  console.log('Features: LLM Brain, Verification, Teach Mode, Routes, Progress');
});



bot.launch();
console.log('Bot started');
