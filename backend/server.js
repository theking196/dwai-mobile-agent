// DWAI Server v2.4 - Complete Implementation
// Features: LLM Brain, Step Verification, Priority Queue, AI Reports, Real-time Progress

require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const Groq = require('groq-sdk');
const https = require('https');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;

// Config
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

// GitHub API
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
const TASKS_PATH = 'data/tasks';
const LOGS_PATH = 'data/logs';
const PROGRESS_PATH = 'data/progress';
const REPORTS_PATH = 'data/reports';
const CURRENT_TASK_PATH = 'data/current_task.json';
const TASK_QUEUE_PATH = 'data/task_queue.json';

// App Registry with Selectors
const APP_REGISTRY = {
  chrome: { 
    pkg: 'com.android.chrome', 
    aliases: ['browser', 'google chrome'],
    selectors: { url_bar: 'com.android.chrome:id/url_bar', search_box: 'com.android.chrome:id/search_box_text' }
  },
  youtube: { pkg: 'com.google.android.youtube', aliases: ['yt', 'you tube'] },
  telegram: { pkg: 'org.telegram.messenger', aliases: ['tg', 'tele'] },
  whatsapp: { pkg: 'com.whatsapp', aliases: ['wa', 'whatsapp business'] },
  settings: { pkg: 'com.android.settings', aliases: ['config', 'system settings'] },
  photos: { pkg: 'com.google.android.apps.photos', aliases: ['gallery', 'pics'] },
  calculator: { pkg: 'com.android.calculator2', aliases: ['calc'] },
  gmail: { pkg: 'com.google.android.gm', aliases: ['email', 'mail'] },
  maps: { pkg: 'com.google.android.apps.maps', aliases: ['google maps', 'navigation'] },
  spotify: { pkg: 'com.spotify.music', aliases: ['music'] },
  phone: { pkg: 'com.android.dialer', aliases: ['dialer', 'call'] },
  messages: { pkg: 'com.android.mms', aliases: ['sms', 'texting'] },
  camera: { pkg: 'com.android.camera2', aliases: ['cam'] },
  instagram: { pkg: 'com.instagram.android', aliases: ['insta', 'ig'] },
  twitter: { pkg: 'com.twitter.android', aliases: ['x'] },
  facebook: { pkg: 'com.facebook.katana', aliases: ['fb'] },
  discord: { pkg: 'com.discord', aliases: [] },
  netflix: { pkg: 'com.netflix.mediaclient', aliases: [] },
  playstore: { pkg: 'com.android.vending', aliases: ['play store', 'app store'] }
};

// ============================================
// GITHUB HELPERS
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
      res.on('data', (c) => d += c);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function ghGetJson(url) {
  const res = await githubRequest('GET', url);
  try { return { ...res, json: JSON.parse(res.body) }; } catch { return { ...res, json: null }; }
}

async function ghPutJson(url, body) {
  return githubRequest('PUT', url, body);
}

// ============================================
// QUEUE SYSTEM (O(1))
// ============================================
async function getTaskQueue() {
  const url = `${GITHUB_API}/${TASK_QUEUE_PATH}`;
  const res = await ghGetJson(url);
  if (!res.ok || !res.json?.content) return { queue: [], processing: null, last_updated: Date.now() };
  try {
    const content = Buffer.from(res.json.content, 'base64').toString('utf8');
    return JSON.parse(content);
  } catch { return { queue: [], processing: null, last_updated: Date.now() }; }
}

async function updateTaskQueue(queueData) {
  const url = `${GITHUB_API}/${TASK_QUEUE_PATH}`;
  const content = Buffer.from(JSON.stringify(queueData, null, 2)).toString('base64');
  const existing = await ghGetJson(url);
  const payload = { message: 'Update queue', content, branch: GITHUB_BRANCH };
  if (existing.ok && existing.json?.sha) payload.sha = existing.json.sha;
  const res = await ghPutJson(url, payload);
  if (!res.ok) throw new Error('Queue update failed');
  return res;
}

async function enqueueTask(taskId, priority = 5) {
  const queue = await getTaskQueue();
  queue.queue.push({ task_id: taskId, priority, created_at: Date.now(), retries: 0 });
  queue.queue.sort((a, b) => a.priority - b.priority);
  await updateTaskQueue(queue);
  return queue;
}

// ============================================
// LLM ORCHESTRATION (THE BRAIN)
// ============================================
function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

async function llmOrchestrate(userText, context = {}) {
  const appDescriptions = Object.entries(APP_REGISTRY).map(([name, info]) => {
    let desc = `${name}`;
    if (info.aliases.length) desc += ` (also: ${info.aliases.join(', ')})`;
    if (name === 'chrome') desc += ` [CRITICAL: Use id "com.android.chrome:id/url_bar" for search, never text-based]`;
    return desc;
  }).join(', ');

  const prompt = `You are DWAI Brain v2.4 - Android Automation Orchestrator.

MISSION: Convert user requests into precise, verifiable Android automation steps.

AVAILABLE APPS: ${appDescriptions}

USER REQUEST: "${userText}"

CONTEXT: ${JSON.stringify(context)}

STRICT RULES:
1. Always extract search queries/messages into slots like {query}, {contact}, {message}
2. After EVERY action, a verification step must confirm success
3. Chrome search MUST use id selector, never text "Search"
4. Verify app context before typing to prevent typing in wrong app
5. Include human-readable descriptions for each step

Return JSON:
{
  "intent": "brief description of task",
  "target_app": "package.name",
  "confidence": 0.0-1.0,
  "slots": {"query": "extracted search term", "contact": "name", "message": "text"},
  "steps": [
    {"action": "launch_app", "value": "chrome", "verify": true, "description": "Open Chrome browser", "id": 1},
    {"action": "verify_app", "package": "com.android.chrome", "description": "Confirm Chrome is active", "id": 2},
    {"action": "click", "id": "com.android.chrome:id/url_bar", "verify_change": true, "description": "Focus address bar", "id": 3},
    {"action": "type", "text": "{query}", "verify_appears": true, "description": "Enter search query", "id": 4},
    {"action": "press", "key": "enter", "verify_change": true, "description": "Submit search", "id": 5}
  ],
  "execution_notes": "Warnings or special instructions"
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
    
    // Normalize steps
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
  
  // Chrome search pattern
  if (lower.includes('chrome') && (lower.includes('search') || lower.includes('open'))) {
    const query = lower.replace(/.*search for/, '').replace(/.*search/, '').replace(/open chrome.*and/, '').trim() || 'google';
    return {
      intent: 'chrome_search',
      target_app: 'com.android.chrome',
      confidence: 0.9,
      slots: { query },
      steps: [
        { action: 'launch_app', value: 'chrome', verify: true, description: 'Launch Chrome', id: 1 },
        { action: 'verify_app', package: 'com.android.chrome', description: 'Verify Chrome open', id: 2 },
        { action: 'click', id: 'com.android.chrome:id/url_bar', verify_change: true, description: 'Click address bar', id: 3 },
        { action: 'type', text: query, verify_appears: true, description: 'Type search query', id: 4 },
        { action: 'press', key: 'enter', verify_change: true, description: 'Press Enter', id: 5 }
      ],
      execution_notes: 'Strict Chrome context enforcement'
    };
  }
  
  // Generic app open
  for (const [appName, info] of Object.entries(APP_REGISTRY)) {
    if (lower.includes(appName) || info.aliases.some(a => lower.includes(a))) {
      return {
        intent: `open_${appName}`,
        target_app: info.pkg,
        confidence: 0.8,
        slots: {},
        steps: [
          { action: 'launch_app', value: appName, verify: true, description: `Launch ${appName}`, id: 1 },
          { action: 'verify_app', package: info.pkg, description: `Confirm ${appName} open`, id: 2 }
        ],
        execution_notes: 'Basic app launch'
      };
    }
  }
  
  return { intent: 'unknown', confidence: 0, steps: [], error: 'Could not understand request' };
}

function fillSlots(text, slots) {
  if (!text || !slots) return text;
  let result = String(text);
  for (const [key, value] of Object.entries(slots)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

// ============================================
// TASK CREATION
// ============================================
async function createTask(userText, userId, chatId, mode = 'normal') {
  const taskId = nanoid(12);
  const orch = await llmOrchestrate(userText, { mode, userId });
  
  if (orch.error) throw new Error(orch.error);
  
  // Fill slots in steps
  const steps = orch.steps.map(step => ({
    ...step,
    text: fillSlots(step.text, orch.slots),
    value: fillSlots(step.value, orch.slots)
  }));
  
  const task = {
    task_id: taskId,
    type: 'automation',
    status: 'pending',
    mode,
    goal: userText,
    target_app: orch.target_app,
    steps,
    total_steps: steps.length,
    slots: orch.slots,
    llm_intent: orch.intent,
    llm_confidence: orch.confidence,
    execution_notes: orch.execution_notes,
    chat_id: chatId,
    user_id: userId,
    created_at: new Date().toISOString(),
    verify_every_step: true
  };
  
  // Save task
  const taskUrl = `${GITHUB_API}/${TASKS_PATH}/${taskId}.json`;
  await ghPutJson(taskUrl, {
    message: `Task ${taskId}`,
    content: Buffer.from(JSON.stringify(task, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  // Initialize progress
  const progressUrl = `${GITHUB_API}/${PROGRESS_PATH}/${taskId}_progress.json`;
  await ghPutJson(progressUrl, {
    message: 'Init progress',
    content: Buffer.from(JSON.stringify({
      task_id: taskId,
      step_number: 0,
      total_steps: steps.length,
      status: 'queued',
      details: 'Waiting for device...',
      timestamp: new Date().toISOString()
    }, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  });
  
  // Add to queue
  await enqueueTask(taskId, mode === 'live' ? 2 : 5);
  
  return { taskId, steps, targetApp: orch.target_app, intent: orch.intent };
}

// ============================================
// AI REPORT GENERATION
// ============================================
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

Generate a natural language report explaining:
1. What was attempted
2. Which apps were involved
3. Where it succeeded/failed
4. Specific UI elements interacted with
5. Why it failed (if failed) and how to fix

Keep it under 300 words, suitable for Telegram. Be specific about errors.`;

  try {
    const res = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: 'Execution analyst. Be precise about failures.' }, { role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });
    return res.choices[0].message.content.trim();
  } catch (e) {
    return `Execution ${finalStatus}. ${executionTrace.length} steps performed. ${error || ''}`;
  }
}

// ============================================
// REAL-TIME MONITORING
// ============================================
const activeMonitors = new Map();

async function monitorTaskProgress(taskId, chatId, steps) {
  if (activeMonitors.has(taskId)) return; // Already monitoring
  
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
          msg += `${stepInfo?.description || progress.details || 'Executing...'}\n`;
          
          if (progress.app_context && progress.app_context !== 'unknown') {
            msg += `📱 ${progress.app_context.split('.').pop()}`;
          }
          
          await bot.telegram.sendMessage(chatId, msg).catch(() => {});
          
          if (progress.status === 'completed' || progress.status === 'failed') {
            completed = true;
            activeMonitors.delete(taskId);
            
            // Get final report
            setTimeout(async () => {
              const reportUrl = `${GITHUB_API}/${REPORTS_PATH}/${taskId}_report.json`;
              const reportRes = await ghGetJson(reportUrl);
              
              let finalMsg;
              if (reportRes.ok && reportRes.json?.content) {
                const report = JSON.parse(Buffer.from(reportRes.json.content, 'base64').toString());
                finalMsg = report.ai_report;
              } else {
                finalMsg = progress.status === 'completed' 
                  ? `✅ Task Complete!\n\nAll ${progress.total_steps} steps executed successfully.`
                  : `❌ Task Failed\n\nError: ${progress.error || 'Unknown error'}`;
              }
              
              await bot.telegram.sendMessage(chatId, finalMsg.substring(0, 4000)).catch(() => {});
            }, 1500);
          }
        }
      }
    } catch (e) {
      console.error('Monitor error:', e);
    }
    
    if (!completed) {
      setTimeout(check, 3000);
    }
  };
  
  activeMonitors.set(taskId, true);
  check();
}

// ============================================
// TELEGRAM HANDLERS
// ============================================
bot.command('start', async (ctx) => {
  await ctx.reply(`👋 DWAI Mobile Agent v2.4

✅ LLM Brain - Understands context naturally
✅ Step Verification - Every action confirmed
✅ App Protection - Prevents typing in wrong app
✅ Chrome Fix - Uses ID selectors only
✅ Live Progress - Real-time step updates
✅ AI Reports - Detailed execution analysis

Commands:
/do <task> - Fast execution with verification
/live <task> - Extra careful mode
/status - Check system status

Example:
/do open chrome and search for lion videos`);
});

bot.command('status', async (ctx) => {
  try {
    const queue = await getTaskQueue();
    const pending = queue.queue?.length || 0;
    const processing = queue.processing ? `Processing: ${queue.processing.task_id.slice(0, 8)}...` : 'Idle';
    
    await ctx.reply(`📊 System Status\n\n${processing}\nPending: ${pending} tasks\nVersion: 2.4 (LLM Brain + Verification)`);
  } catch (e) {
    await ctx.reply('❌ Error checking status');
  }
});

bot.command('do', async (ctx) => {
  const text = ctx.message.text.replace(/^\/do\s*/, '').trim();
  if (!text) return ctx.reply('❌ Please specify a task. Example: /do open chrome and search for news');
  
  try {
    const { taskId, steps, targetApp, intent } = await createTask(text, ctx.from.id, ctx.chat.id, 'fast');
    const appName = targetApp ? targetApp.split('.').pop() : 'device';
    
    await ctx.reply(`⚡ Task Created\nIntent: ${intent}\nTarget: ${appName}\nSteps: ${steps.length}\nID: ${taskId.slice(0, 8)}...\n\nStarting execution...`);
    
    monitorTaskProgress(taskId, ctx.chat.id, steps);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.command('live', async (ctx) => {
  const text = ctx.message.text.replace(/^\/live\s*/, '').trim();
  if (!text) return ctx.reply('❌ Please specify a task');
  
  try {
    const { taskId, steps, targetApp } = await createTask(text, ctx.from.id, ctx.chat.id, 'live');
    await ctx.reply(`👁️ Live Mode (High Verification)\nTarget: ${targetApp?.split('.').pop()}\nSteps: ${steps.length}\nID: ${taskId.slice(0, 8)}...`);
    
    monitorTaskProgress(taskId, ctx.chat.id, steps);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  try {
    const { taskId, steps, targetApp } = await createTask(ctx.message.text, ctx.from.id, ctx.chat.id, 'auto');
    const appName = targetApp ? targetApp.split('.').pop() : 'device';
    
    await ctx.reply(`🤖 Understood\nTarget: ${appName}\nSteps: ${steps.length}\nExecuting...`);
    monitorTaskProgress(taskId, ctx.chat.id, steps);
  } catch (e) {
    await ctx.reply('❌ Error: ' + e.message);
  }
});

// HTTP Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.4', features: ['llm_brain', 'step_verification', 'priority_queue', 'ai_reports'] });
});

app.listen(PORT, () => console.log(`DWAI Server v2.4 on port ${PORT}`));
bot.launch();
console.log('Bot started');
