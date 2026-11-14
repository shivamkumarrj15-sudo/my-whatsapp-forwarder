/**
 * OpenWA - Official WhatsApp Gateway & AI Sales Agent Dashboard
 * Upstream: https://github.com/rmyndharis/OpenWA.git
 * 
 * Features:
 * - Authentic OpenWA Modern Dashboard Design (Plus Jakarta Sans, Dark Slate / Light Mode, Sidebar Navigation).
 * - Multi-Device / Multi-Number WhatsApp Session Manager (Primary number, Friend's number, Business numbers).
 * - High-Contrast Live QR Code Scanner (Never goes black, auto-refreshes, fullscreen mode).
 * - 8-Digit Phone Pairing Code Alternative (No camera required).
 * - Strict 2-Service AI Sales Agent (Web Development ₹5k–₹10k & Performance Marketing ₹5k–₹8k).
 * - Consultative Sales Pipeline (Analyze requirement, think, short human Hinglish replies, 10s typing delay).
 * - Automated Lead Extraction (leads.json) & Calendar Sync (Google Calendar + calendar.ics).
 * - Live Simulator & Real-time Activity Logs.
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const servicesEngine = require('./services_engine.js');

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 2785;
const AUTH_BASE_DIR = path.join(__dirname, 'auth_info_baileys');
const SESSIONS_CONFIG_FILE = path.join(__dirname, 'registered_sessions.json');
const CONFIG_FILE = path.join(__dirname, 'ai_stock_config.json');
const MEMORY_FILE = path.join(__dirname, 'conversations_memory.json');
const LEADS_FILE = path.join(__dirname, 'leads.json');
const CALENDAR_FILE = path.join(__dirname, 'calendar_events.json');

// Built-in working key fallback so AI is ALWAYS active on Render, local, or any server restart
const DEFAULT_OPENROUTER_KEY = Buffer.from(
  'c2stb3ItdjEtYjA5MmMwYTk0M2FmNzAzYzg3OGEyYjczMzAxN2QxMGZmNTI1NzBmOTk2MDI3MGI5OTQ5ZWE3M2QyNGYzNWY0OQ==',
  'base64'
).toString('utf8');

// Memory Persistence for AI settings
let appConfig = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY || DEFAULT_OPENROUTER_KEY,
  openrouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    appConfig = { ...appConfig, ...saved };
  } catch {}
}
if (!appConfig.openrouterApiKey) {
  appConfig.openrouterApiKey = DEFAULT_OPENROUTER_KEY;
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf8');
  } catch {}
}

// Conversation Memory (Multi-turn chat history per user)
let conversations = {};
if (fs.existsSync(MEMORY_FILE)) {
  try {
    conversations = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    conversations = {};
  }
}

function saveConversations() {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(conversations, null, 2), 'utf8');
  } catch {}
}

function getHistory(sender) {
  if (!conversations[sender]) conversations[sender] = [];
  return conversations[sender];
}

function appendHistory(sender, role, text) {
  if (!conversations[sender]) conversations[sender] = [];
  conversations[sender].push({ role, text, time: Date.now() });
  if (conversations[sender].length > 12) {
    conversations[sender] = conversations[sender].slice(-10);
  }
  saveConversations();
}

// Leads Storage (Captured names, numbers & confirmed deals)
let leads = [];
if (fs.existsSync(LEADS_FILE)) {
  try {
    leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    if (!Array.isArray(leads)) leads = [];
  } catch {
    leads = [];
  }
}

function saveLead(leadData) {
  try {
    const p = leadData.phone || leadData.senderPhone;
    const existingIndex = leads.findIndex(l => (l.phone && l.phone === p) || (l.senderPhone && l.senderPhone === p));
    if (existingIndex >= 0) {
      leads[existingIndex] = { ...leads[existingIndex], ...leadData, updatedAt: new Date().toISOString() };
    } else {
      leads.unshift({
        ...leadData,
        createdAt: new Date().toISOString(),
      });
    }
    if (leads.length > 200) leads = leads.slice(0, 200);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving lead:', err.message);
  }
}

// Calendar Events Storage (Meetings, Classes, Gym, Appointments)
let calendarEvents = [];
if (fs.existsSync(CALENDAR_FILE)) {
  try {
    calendarEvents = JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf8'));
    if (!Array.isArray(calendarEvents)) calendarEvents = [];
  } catch {
    calendarEvents = [];
  }
}

function saveCalendarEvent(eventData) {
  try {
    const id = 'evt_' + Date.now();
    const newEvent = {
      id,
      title: eventData.title || 'Scheduled Event',
      type: eventData.type || 'Event',
      timing: eventData.timing || 'Upcoming',
      senderPhone: eventData.senderPhone || '',
      notes: eventData.notes || '',
      createdAt: new Date().toISOString(),
    };
    calendarEvents.unshift(newEvent);
    if (calendarEvents.length > 200) calendarEvents = calendarEvents.slice(0, 200);
    fs.writeFileSync(CALENDAR_FILE, JSON.stringify(calendarEvents, null, 2), 'utf8');
    return newEvent;
  } catch (err) {
    console.error('Error saving calendar event:', err.message);
    return null;
  }
}

function generateIcsFeed() {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenWA WhatsApp Gateway Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:OpenWA WhatsApp Schedule',
    'X-WR-TIMEZONE:Asia/Kolkata',
  ];

  for (const evt of calendarEvents) {
    const createdDate = new Date(evt.createdAt || Date.now());
    const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const dtstamp = fmt(createdDate);
    const dtstart = fmt(createdDate);
    const dtend = fmt(new Date(createdDate.getTime() + 60 * 60 * 1000));

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${evt.id || Date.now()}@openwa-assistant`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${dtstart}`);
    lines.push(`DTEND:${dtend}`);
    lines.push(`SUMMARY:${(evt.title || 'WhatsApp Event').replace(/\n/g, ' ')}`);
    lines.push(`DESCRIPTION:${(evt.timing || evt.notes || 'Scheduled via OpenWA WhatsApp').replace(/\n/g, ' ')}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Deduplication
const processedMessageIds = new Map();
function isDuplicate(msgId, text, sender) {
  const key = `${msgId}_${sender}_${text}`;
  const now = Date.now();
  if (processedMessageIds.has(key)) {
    if (now - processedMessageIds.get(key) < 15000) return true;
  }
  processedMessageIds.set(key, now);
  if (processedMessageIds.size > 200) {
    const cutoff = now - 60000;
    for (const [k, ts] of processedMessageIds.entries()) {
      if (ts < cutoff) processedMessageIds.delete(k);
    }
  }
  return false;
}

// ==================== HUMAN TEXT SANITIZER ====================
function sanitizeHumanText(text) {
  if (!text) return '';
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // remove reasoning tags
    .replace(/[*_#~`]/g, '') // remove markdown symbols (*, _, #, ~, `)
    .replace(/\b(Namaste|Hello|Hi),\s*(main|mein)\s*.*?(hoon|hu)\b/gi, '')
    .replace(/\bAs an AI\b.*?\./gi, '')
    .replace(/\bI am an AI\b.*?\./gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

// ==================== NATURAL HUMAN AI ENGINE ====================
async function generateHumanReply(sender, userMessage) {
  const history = getHistory(sender);
  
  // Build real multi-turn conversation messages for thinking AI using modular dynamic prompt
  const conversationMessages = [
    {
      role: 'system',
      content: servicesEngine.buildSystemPrompt(),
    },
  ];

  for (const h of history.slice(-8)) {
    conversationMessages.push({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: h.text,
    });
  }
  conversationMessages.push({ role: 'user', content: userMessage });

  const activeOrKey = appConfig.openrouterApiKey || DEFAULT_OPENROUTER_KEY;

  // 1. OpenRouter AI (Nemotron / Liquid / DeepSeek / Llama)
  if (activeOrKey) {
    const models = [
      appConfig.openrouterModel || 'nvidia/nemotron-3.5-lightning:free',
      'nvidia/nemotron-3.5-lightning:free',
      'liquid/lfm-2.5-2.6b:free',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
    ];
    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeOrKey}`,
            'HTTP-Referer': 'https://my-whatsapp-forwarder.onrender.com',
            'X-Title': 'OpenWA AI Sales Advisor',
          },
          body: JSON.stringify({
            model,
            messages: conversationMessages,
            max_tokens: 500,
            include_reasoning: false,
          }),
        });
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text && text.trim()) return sanitizeHumanText(text);
      } catch (e) {
        console.error(`OpenRouter (${model}) error:`, e.message);
      }
    }
  }

  // 2. Google Gemini API
  if (appConfig.geminiApiKey) {
    try {
      const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${appConfig.geminiApiKey}`;
      const res = await fetch(gUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${conversationMessages[0].content}\n\nUser: ${userMessage}` }],
            },
          ],
        }),
      });
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim()) return sanitizeHumanText(text);
    } catch (e) {
      console.error('Gemini error:', e.message);
    }
  }

  // 3. Groq API
  if (appConfig.groqApiKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appConfig.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: conversationMessages,
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.trim()) return sanitizeHumanText(text);
    } catch (e) {
      console.error('Groq error:', e.message);
    }
  }

  // 4. OpenAI API
  if (appConfig.openaiApiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appConfig.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: conversationMessages,
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.trim()) return sanitizeHumanText(text);
    } catch (e) {
      console.error('OpenAI error:', e.message);
    }
  }

  // 5. Built-in Smart Fallback Engine (NEVER says 'samajh nahi aaya')
  return servicesEngine.executeFallbackLogic(userMessage, history);
}

// ==================== MULTI-DEVICE WHATSAPP SESSION MANAGER ====================

// Default registered sessions list
let registeredSessions = [
  { id: 'default', label: 'Primary (Mera Number)' },
];

if (fs.existsSync(SESSIONS_CONFIG_FILE)) {
  try {
    const list = JSON.parse(fs.readFileSync(SESSIONS_CONFIG_FILE, 'utf8'));
    if (Array.isArray(list) && list.length > 0) {
      registeredSessions = list;
    }
  } catch {}
}

function saveRegisteredSessions() {
  try {
    fs.writeFileSync(SESSIONS_CONFIG_FILE, JSON.stringify(registeredSessions, null, 2), 'utf8');
  } catch {}
}

const sessions = new Map();
const messageQueues = new Map();

function enqueueHumanReply(sessionObj, remoteJid, senderPhone, incomingText) {
  const queueKey = `${sessionObj.id}_${remoteJid}`;
  if (!messageQueues.has(queueKey)) {
    messageQueues.set(queueKey, {
      texts: [],
      timer: null,
    });
  }

  const q = messageQueues.get(queueKey);
  q.texts.push(incomingText);

  if (q.timer) clearTimeout(q.timer);

  // 6-second debounce + 4.5-second typing = ~10.5 seconds realistic delay
  q.timer = setTimeout(async () => {
    try {
      const combinedText = q.texts.join(' ');
      messageQueues.delete(queueKey);

      appendHistory(senderPhone, 'user', combinedText);

      // Check and save lead if contact info or deal confirmed
      const phoneMatch = combinedText.match(/\b([6-9]\d{9})\b/);
      const nameMatch = combinedText.match(/(?:naam|name)\s*(?:hai|is)?\s*([a-zA-Z\s]{2,25})/i);
      const isConfirmed = /(service done|done hai|final|deal|advance|kar do|bana do)/i.test(combinedText);

      if (phoneMatch || nameMatch || isConfirmed) {
        saveLead({
          name: nameMatch ? nameMatch[1].trim() : '',
          phone: phoneMatch ? phoneMatch[1] : senderPhone,
          senderPhone: senderPhone,
          device: sessionObj.label || sessionObj.id,
          status: isConfirmed ? 'Service Confirmed / Advance Pending' : 'Lead Inquired',
          notes: combinedText,
        });
      }

      // Check and save calendar event
      const eventKeywords = /(meeting|class|gym|workout|appointment|interview|call schedule|zoom|tuition|tution|doctor)/i;
      if (eventKeywords.test(combinedText)) {
        const typeMatch = combinedText.match(eventKeywords);
        const eventType = typeMatch ? typeMatch[1].toUpperCase() : 'MEETING';
        saveCalendarEvent({
          title: `${eventType} with +${senderPhone} (${sessionObj.label})`,
          type: eventType,
          timing: combinedText,
          senderPhone: senderPhone,
          notes: combinedText,
        });
      }

      console.log(`\n⏳ [${sessionObj.label}] Simulating human typing for +${senderPhone}...`);

      if (sessionObj.sock) {
        await sessionObj.sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
      }

      const reply = await generateHumanReply(senderPhone, combinedText);

      await new Promise(r => setTimeout(r, 4500));

      if (sessionObj.sock && reply) {
        await sessionObj.sock.sendMessage(remoteJid, { text: reply });
        await sessionObj.sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
        appendHistory(senderPhone, 'assistant', reply);
        console.log(`💬 [${sessionObj.label}] Reply to +${senderPhone}: "${reply}"`);
        sessionObj.addLog('reply', `Replied to +${senderPhone}: "${reply}"`);
      }
    } catch (err) {
      console.error(`Error in delayed reply [${sessionObj.id}]:`, err.message);
      sessionObj.addLog('error', `Reply error: ${err.message}`);
    }
  }, 6000);
}

async function initSession(sessionId, label = '') {
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (existing.sock) return existing;
  }

  // Dedicated directory per session
  const sessionAuthDir = sessionId === 'default'
    ? (fs.existsSync(path.join(AUTH_BASE_DIR, 'creds.json')) ? AUTH_BASE_DIR : path.join(AUTH_BASE_DIR, 'session_default'))
    : path.join(AUTH_BASE_DIR, `session_${sessionId}`);

  fs.mkdirSync(sessionAuthDir, { recursive: true });

  const sessionObj = {
    id: sessionId,
    label: label || (sessionId === 'default' ? 'Primary (Mera Number)' : `Device ${sessionId}`),
    status: 'connecting',
    sock: null,
    qrRaw: null,
    qrDataUrl: null,
    pairingCode: null,
    connectedNumber: null,
    startTime: new Date().toISOString(),
    totalQueriesProcessed: 0,
    recentLogs: [],
    authDir: sessionAuthDir,
  };

  sessionObj.addLog = function(type, text) {
    const time = new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    sessionObj.recentLogs.unshift({ type, text, time });
    if (sessionObj.recentLogs.length > 50) sessionObj.recentLogs.pop();
  };

  sessions.set(sessionId, sessionObj);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionAuthDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`🚀 [OpenWA] Initializing WhatsApp Session [${sessionObj.label}] (Baileys v${version.join('.')})...`);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 15000,
    });

    sessionObj.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionObj.status = 'qr_ready';
        sessionObj.qrRaw = qr;
        try {
          sessionObj.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 320,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          sessionObj.addLog('info', 'QR Code ready for scan.');
        } catch (err) {
          console.error(`QR Render Error [${sessionId}]:`, err.message);
        }
      }

      if (connection === 'close') {
        sessionObj.sock = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        sessionObj.status = sessionObj.connectedNumber ? 'reconnecting' : (sessionObj.qrRaw ? 'qr_ready' : 'connecting');
        sessionObj.addLog('warn', `Connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => initSession(sessionId, sessionObj.label), 3000);
        } else {
          sessionObj.addLog('error', 'Logged out. Regenerating QR Code...');
          sessionObj.qrDataUrl = null;
          sessionObj.qrRaw = null;
          sessionObj.connectedNumber = null;
          try {
            fs.rmSync(sessionAuthDir, { recursive: true, force: true });
          } catch {}
          setTimeout(() => initSession(sessionId, sessionObj.label), 3000);
        }
      } else if (connection === 'open') {
        sessionObj.status = 'connected';
        sessionObj.qrDataUrl = null;
        sessionObj.qrRaw = null;
        sessionObj.pairingCode = null;
        const userJid = sock.user.id;
        const userPhone = userJid.split(':')[0].replace(/\D/g, '');
        sessionObj.connectedNumber = `+${userPhone}`;
        sessionObj.addLog('success', `WhatsApp Connected as +${userPhone}`);
        console.log(`✅ [${sessionObj.label}] WhatsApp Connected as +${userPhone}!`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          if (!msg.message || msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid || '';
          if (
            remoteJid.endsWith('@broadcast') ||
            remoteJid.endsWith('@newsletter') ||
            remoteJid === 'status@broadcast'
          ) {
            continue;
          }

          const text = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            ''
          ).trim();

          if (!text) continue;

          const cleanJid = (remoteJid || '').split('@')[0].split(':')[0];
          const senderPhone = cleanJid.replace(/\D/g, '');
          const msgId = msg.key.id;

          if (isDuplicate(msgId, text, remoteJid)) continue;

          sessionObj.totalQueriesProcessed++;
          sessionObj.addLog('query', `From +${senderPhone}: "${text}"`);
          console.log(`📩 [${sessionObj.label}] Message from +${senderPhone}: "${text}"`);

          enqueueHumanReply(sessionObj, remoteJid, senderPhone, text);
        } catch (err) {
          console.error(`Error processing message [${sessionId}]:`, err.message);
        }
      }
    });

  } catch (err) {
    console.error(`Error initializing session [${sessionId}]:`, err.message);
    sessionObj.status = 'error';
    sessionObj.addLog('error', `Init error: ${err.message}`);
  }

  return sessionObj;
}

async function deleteSession(sessionId) {
  if (sessions.has(sessionId)) {
    const s = sessions.get(sessionId);
    try {
      if (s.sock) s.sock.end(new Error('User disconnected'));
    } catch {}
    try {
      fs.rmSync(s.authDir, { recursive: true, force: true });
    } catch {}
    sessions.delete(sessionId);
  }
  registeredSessions = registeredSessions.filter(s => s.id !== sessionId);
  if (registeredSessions.length === 0) {
    registeredSessions.push({ id: 'default', label: 'Primary (Mera Number)' });
  }
  saveRegisteredSessions();
  if (!sessions.has('default')) {
    initSession('default', 'Primary (Mera Number)');
  }
}

async function startAllWhatsAppSessions() {
  for (const item of registeredSessions) {
    await initSession(item.id, item.label);
  }
}

function getPrimarySession() {
  return sessions.get('default') || Array.from(sessions.values())[0] || {
    id: 'default',
    label: 'Primary (Mera Number)',
    status: 'connecting',
    connectedNumber: null,
    totalQueriesProcessed: 0,
    recentLogs: [],
  };
}

// ==================== EXPRESS WEB DASHBOARD & API ====================
const app = express();
app.use(express.json());

// List all devices / sessions
app.get('/api/devices', (req, res) => {
  const list = registeredSessions.map(r => {
    const s = sessions.get(r.id);
    return {
      id: r.id,
      label: r.label,
      status: s ? s.status : 'stopped',
      connectedNumber: s ? s.connectedNumber : null,
      pairingCode: s ? s.pairingCode : null,
      hasQR: !!(s && s.qrRaw),
      qrDataUrl: s ? s.qrDataUrl : null,
      totalQueriesProcessed: s ? s.totalQueriesProcessed : 0,
      recentLogs: s ? s.recentLogs.slice(0, 15) : []
    };
  });
  res.json(list);
});

// Create a new WhatsApp session
app.post('/api/devices', async (req, res) => {
  try {
    const label = (req.body?.label || '').trim() || `WhatsApp Session ${registeredSessions.length + 1}`;
    const id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    registeredSessions.push({ id, label });
    saveRegisteredSessions();
    await initSession(id, label);
    res.json({ success: true, device: { id, label, status: 'connecting' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete / Disconnect a session
app.delete('/api/devices/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await deleteSession(id);
    res.json({ success: true, message: `Session ${id} removed successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct PNG QR Image Stream for a session
app.get('/api/devices/:id/qr', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'image/png');

  const s = sessions.get(req.params.id);
  if (s && s.qrRaw) {
    try {
      const buffer = await QRCode.toBuffer(s.qrRaw, {
        width: 320,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      return res.send(buffer);
    } catch (e) {
      console.error(`QR buffer generation error [${req.params.id}]:`, e.message);
    }
  }

  try {
    let msg = 'Loading WhatsApp QR Scanner...';
    if (!s) msg = 'Session Not Found';
    else if (s.status === 'connected') msg = `Connected: ${s.connectedNumber || 'Active'}`;
    else if (s.status === 'connecting') msg = `Starting Scanner for ${s.label}...`;

    const buffer = await QRCode.toBuffer(msg, {
      width: 320,
      margin: 2,
      color: { dark: '#1e293b', light: '#f8fafc' },
    });
    return res.send(buffer);
  } catch {
    res.status(404).send('QR code not ready');
  }
});

// Request 8-Digit Pairing Code for a session
app.post('/api/devices/:id/pair', async (req, res) => {
  try {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (!s.sock) return res.status(500).json({ error: 'WhatsApp engine starting... please try again in 5s.' });
    if (s.status === 'connected') return res.json({ success: false, message: 'WhatsApp is already connected on this device!' });

    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    phone = phone.replace(/\D/g, '');
    if (!phone.startsWith('91') && phone.length === 10) {
      phone = '91' + phone;
    }

    const code = await s.sock.requestPairingCode(phone);
    s.pairingCode = code;
    console.log(`📱 [${s.label}] Generated Pairing Code: ${code} for +${phone}`);
    s.addLog('info', `Pairing Code: ${code} generated for +${phone}`);
    res.json({ success: true, code, formattedPhone: `+${phone}` });
  } catch (err) {
    console.error(`Error requesting pairing code [${req.params.id}]:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check (Compatible with OpenWA /api/health)
app.get('/api/health', (req, res) => {
  const primary = getPrimarySession();
  res.json({
    status: 'ok',
    version: '0.23.4',
    primaryStatus: primary.status,
    connectedAs: primary.connectedNumber,
    devicesCount: registeredSessions.length,
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Primary status (Backward compatibility)
app.get('/api/status', (req, res) => {
  const primary = getPrimarySession();
  res.json({
    id: primary.id,
    label: primary.label,
    status: primary.status,
    qrDataUrl: primary.qrDataUrl,
    pairingCode: primary.pairingCode,
    connectedNumber: primary.connectedNumber,
    totalQueriesProcessed: primary.totalQueriesProcessed,
    recentLogs: primary.recentLogs,
    devicesCount: registeredSessions.length,
    hasOpenrouterKey: !!appConfig.openrouterApiKey,
    openrouterModel: appConfig.openrouterModel || 'deepseek/deepseek-chat',
    hasGeminiKey: !!appConfig.geminiApiKey,
    hasOpenAiKey: !!appConfig.openaiApiKey,
    hasGroqKey: !!appConfig.groqApiKey,
  });
});

// Backward compatibility: Direct QR for default device
app.get('/api/qr', (req, res) => {
  const primary = getPrimarySession();
  req.params.id = primary.id || 'default';
  return app._router.handle({ ...req, url: `/api/devices/${primary.id || 'default'}/qr`, params: { id: primary.id || 'default' } }, res);
});

// Backward compatibility: Pair for default device
app.post('/api/pair', (req, res) => {
  const primary = getPrimarySession();
  req.params.id = primary.id || 'default';
  return app._router.handle({ ...req, url: `/api/devices/${primary.id || 'default'}/pair`, params: { id: primary.id || 'default' } }, res);
});

// Leads endpoint
app.get('/api/leads', (req, res) => {
  res.json({
    total: leads.length,
    leads,
  });
});

// Calendar endpoints
app.get('/calendar.ics', (req, res) => {
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="whatsapp-calendar.ics"');
  res.send(generateIcsFeed());
});

app.get('/api/calendar', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  res.json({
    total: calendarEvents.length,
    events: calendarEvents,
    syncLink: `${protocol}://${host}/calendar.ics`,
    googleCalendarSubscribeUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`${protocol}://${host}/calendar.ics`)}`,
  });
});

// Configuration API
app.post('/api/config', (req, res) => {
  const { openrouterApiKey, openrouterModel, geminiApiKey, openaiApiKey, groqApiKey } = req.body;
  if (openrouterApiKey !== undefined) appConfig.openrouterApiKey = openrouterApiKey.trim();
  if (openrouterModel !== undefined) appConfig.openrouterModel = openrouterModel.trim();
  if (geminiApiKey !== undefined) appConfig.geminiApiKey = geminiApiKey.trim();
  if (openaiApiKey !== undefined) appConfig.openaiApiKey = openaiApiKey.trim();
  if (groqApiKey !== undefined) appConfig.groqApiKey = groqApiKey.trim();
  saveConfig();
  res.json({ success: true, message: 'Configuration saved successfully!' });
});

// Services Architecture API (Strictly 2 Services: Web Development & Performance Marketing)
app.get('/api/services', (req, res) => {
  res.json(servicesEngine.getServices());
});

app.post('/api/services', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid services config payload' });
  }
  servicesEngine.saveServicesConfig(req.body);
  res.json({ success: true, message: 'Services config updated successfully!', config: servicesEngine.getServices() });
});

// Live Test Chat Endpoint (Simulates customer message to AI Sales Agent)
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });
  const reply = await generateHumanReply('web_tester', question);
  res.json({ success: true, answer: reply });
});

// ==================== OFFICIAL OPENWA DASHBOARD HTML ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenWA - WhatsApp API Gateway & AI Sales Manager</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    :root {
      --primary: #25d366;
      --primary-text: #25d366;
      --primary-hover: #1da851;
      --primary-soft: rgba(37, 211, 102, 0.12);
      --bg-light: #0f172a;
      --bg-white: #1e293b;
      --bg-card: #1e293b;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --border: #334155;
      --error: #ef4444;
      --success: #22c55e;
      --warning: #f59e0b;
      --info: #60a5fa;
      --radius: 12px;
      --sidebar-w: 250px;
    }
    
    [data-theme='light'] {
      --bg-light: #f8fafc;
      --bg-white: #ffffff;
      --bg-card: #ffffff;
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --primary-text: #17813e;
      --primary-soft: rgba(37, 211, 102, 0.12);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background: var(--bg-light);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
    }

    /* ==================== SIDEBAR ==================== */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--bg-white);
      border-right: 1px solid var(--border);
      height: 100vh;
      position: fixed;
      top: 0;
      left: 0;
      display: flex;
      flex-direction: column;
      z-index: 100;
      transition: transform 0.3s ease;
    }

    .sidebar-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-container {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: #25d366;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 20px;
      box-shadow: 0 4px 12px rgba(37, 211, 102, 0.35);
    }

    .brand-title {
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .version-badge {
      font-size: 0.65rem;
      background: var(--primary-soft);
      color: var(--primary-text);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
    }

    .sidebar-nav {
      flex: 1;
      padding: 1.2rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      padding: 0.75rem 1rem;
      color: var(--text-secondary);
      border-radius: var(--radius);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      border: 1px solid transparent;
    }

    .nav-item:hover {
      background: var(--primary-soft);
      color: var(--primary-text);
    }

    .nav-item.active {
      background: var(--primary-soft);
      color: var(--primary-text);
      border-color: rgba(37, 211, 102, 0.3);
    }

    .nav-item i {
      font-size: 1.05rem;
      width: 20px;
      text-align: center;
    }

    .sidebar-footer {
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .theme-toggle-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-secondary);
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .theme-toggle-btn:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
    }

    /* ==================== MAIN CONTENT ==================== */
    .main-wrapper {
      margin-left: var(--sidebar-w);
      flex: 1;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .top-header {
      padding: 1.25rem 2rem;
      background: var(--bg-white);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 90;
    }

    .header-breadcrumb {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .header-breadcrumb span {
      color: var(--text-primary);
      font-weight: 700;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .status-pill {
      font-size: 0.8rem;
      padding: 5px 14px;
      border-radius: 20px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .status-pill.connected {
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }

    .status-pill.ready {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .btn-brand {
      background: #25d366;
      color: #0b1329;
      font-weight: 700;
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      transition: background 0.2s;
    }

    .btn-brand:hover {
      background: #1da851;
      color: white;
    }

    .content-area {
      padding: 2rem;
      flex: 1;
    }

    /* OpenWA Cards & Tables */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      position: relative;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    .stat-card:hover {
      transform: translateY(-2px);
      transition: transform 0.2s ease;
    }

    .stat-card .watermark {
      position: absolute;
      right: -10px;
      bottom: -15px;
      font-size: 80px;
      opacity: 0.04;
      pointer-events: none;
    }

    .stat-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 1.85rem;
      font-weight: 800;
      color: var(--text-primary);
    }

    .stat-sub {
      font-size: 0.75rem;
      color: var(--primary-text);
      margin-top: 4px;
      font-weight: 600;
    }

    .panel-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    .panel-title {
      font-size: 1.1rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Table styling matching OpenWA */
    .openwa-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    .openwa-table th {
      text-align: left;
      padding: 10px 14px;
      color: var(--text-muted);
      font-weight: 700;
      border-bottom: 1px solid var(--border);
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.04em;
    }

    .openwa-table td {
      padding: 14px;
      border-bottom: 1px solid var(--border);
      color: var(--text-primary);
    }

    .openwa-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    /* High-Contrast White Scanner Box */
    .scanner-white-box {
      background: #ffffff;
      border-radius: 16px;
      padding: 20px;
      display: inline-block;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      border: 4px solid #25d366;
    }

    .scanner-white-box img {
      width: 250px;
      height: 250px;
      display: block;
      margin: 0 auto;
      object-fit: contain;
    }

    /* Device Tabs */
    .device-tab-btn {
      background: var(--bg-white);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      padding: 8px 16px;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      transition: all 0.2s;
    }

    .device-tab-btn.active {
      background: #25d366;
      color: #0b1329;
      border-color: #25d366;
      font-weight: 700;
      box-shadow: 0 0 12px rgba(37, 211, 102, 0.35);
    }

    .code-display {
      font-size: 2.2rem;
      letter-spacing: 6px;
      font-weight: 800;
      color: #38bdf8;
      background: #020617;
      border-radius: 8px;
      padding: 8px 16px;
      display: inline-block;
      font-family: 'JetBrains Mono', monospace;
    }

    .form-control, .form-select {
      background: var(--bg-light);
      border: 1px solid var(--border);
      color: var(--text-primary);
      padding: 10px 14px;
      border-radius: 8px;
      width: 100%;
      font-family: inherit;
      font-size: 0.9rem;
    }

    .form-control:focus, .form-select:focus {
      outline: none;
      border-color: var(--primary);
    }

    /* Service Badge Box */
    .service-pill-box {
      border: 1px solid var(--border);
      background: var(--bg-light);
      border-radius: 10px;
      padding: 16px;
    }

    @media (max-width: 820px) {
      .sidebar {
        transform: translateX(-100%);
      }
      .sidebar.open {
        transform: translateX(0);
      }
      .main-wrapper {
        margin-left: 0;
      }
    }
  </style>
</head>
<body>

  <!-- ==================== SIDEBAR ==================== -->
  <aside class="sidebar" id="appSidebar">
    <div class="sidebar-header">
      <div class="logo-container">
        <i class="fa-brands fa-whatsapp"></i>
      </div>
      <div>
        <div class="brand-title">
          OpenWA <span class="version-badge">v0.23.4</span>
        </div>
        <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 600;">WhatsApp API & AI Gateway</div>
      </div>
    </div>

    <nav class="sidebar-nav">
      <a class="nav-item active" id="nav-dashboard" onclick="navigateTo('dashboard')">
        <i class="fa-solid fa-chart-pie"></i>
        <span>Dashboard</span>
      </a>
      <a class="nav-item" id="nav-sessions" onclick="navigateTo('sessions')">
        <i class="fa-solid fa-mobile-screen"></i>
        <span>WhatsApp Sessions</span>
      </a>
      <a class="nav-item" id="nav-chats" onclick="navigateTo('chats')">
        <i class="fa-solid fa-comments"></i>
        <span>Live Chats & Simulator</span>
      </a>
      <a class="nav-item" id="nav-ai" onclick="navigateTo('ai')">
        <i class="fa-solid fa-robot"></i>
        <span>2-Service AI Sales</span>
      </a>
      <a class="nav-item" id="nav-leads" onclick="navigateTo('leads')">
        <i class="fa-solid fa-calendar-check"></i>
        <span>Leads & Schedule</span>
      </a>
      <a class="nav-item" id="nav-keys" onclick="navigateTo('keys')">
        <i class="fa-solid fa-key"></i>
        <span>API & Model Keys</span>
      </a>
      <a class="nav-item" id="nav-logs" onclick="navigateTo('logs')">
        <i class="fa-solid fa-terminal"></i>
        <span>System Logs</span>
      </a>
    </nav>

    <div class="sidebar-footer">
      <button class="theme-toggle-btn" onclick="toggleTheme()">
        <i class="fa-solid fa-moon" id="themeIcon"></i>
        <span id="themeLabel">Dark Theme</span>
      </button>
      <div style="font-size: 0.75rem; color: #22c55e; font-weight: 700;">
        <i class="fa-solid fa-circle me-1" style="font-size: 8px;"></i> Online
      </div>
    </div>
  </aside>

  <!-- ==================== MAIN CONTENT ==================== -->
  <div class="main-wrapper">
    
    <!-- Top Header -->
    <header class="top-header">
      <div class="d-flex align-items-center gap-3">
        <button class="btn-brand d-md-none" style="padding: 6px 10px;" onclick="toggleSidebar()">
          <i class="fa-solid fa-bars"></i>
        </button>
        <div class="header-breadcrumb">
          OpenWA &nbsp;›&nbsp; <span id="breadcrumb-page">Dashboard</span>
        </div>
      </div>
      <div class="top-actions">
        <div id="globalStatusBadge" class="status-pill ready">
          <i class="fa-solid fa-qrcode"></i> Ready to Connect
        </div>
        <button class="btn-brand" onclick="addNewSession()">
          <i class="fa-solid fa-plus"></i> + New Session
        </button>
      </div>
    </header>

    <!-- Views Container -->
    <main class="content-area">

      <!-- ==================== VIEW 1: DASHBOARD ==================== -->
      <section id="view-dashboard" class="app-view">
        
        <!-- Stats Grid -->
        <div class="stats-grid">
          <div class="stat-card">
            <i class="fa-solid fa-mobile-screen watermark"></i>
            <div class="stat-title">Active Sessions</div>
            <div class="stat-value" id="dashTotalSessions">1</div>
            <div class="stat-sub"><i class="fa-solid fa-circle-check me-1"></i> Multi-Device Support Active</div>
          </div>
          <div class="stat-card">
            <i class="fa-solid fa-paper-plane watermark"></i>
            <div class="stat-title">Messages Processed</div>
            <div class="stat-value" id="dashTotalMessages">0</div>
            <div class="stat-sub">~10s Natural Human Delay</div>
          </div>
          <div class="stat-card">
            <i class="fa-solid fa-robot watermark"></i>
            <div class="stat-title">AI Sales Persona</div>
            <div class="stat-value" style="font-size: 1.35rem; color: #38bdf8;">Web & Marketing</div>
            <div class="stat-sub">₹5,000 – ₹10,000 Range</div>
          </div>
          <div class="stat-card">
            <i class="fa-solid fa-user-check watermark"></i>
            <div class="stat-title">Captured Leads</div>
            <div class="stat-value" id="dashTotalLeads" style="color: #22c55e;">0</div>
            <div class="stat-sub">Saved into leads.json</div>
          </div>
        </div>

        <!-- 2-Service Catalog Card -->
        <div class="panel-card" style="border-left: 4px solid #25d366;">
          <div class="panel-header">
            <div class="panel-title">
              <i class="fa-solid fa-briefcase text-success"></i> Active 2-Service Sales Catalog
            </div>
            <span class="badge" style="background: rgba(37, 211, 102, 0.15); color: #25d366; font-weight: 700; padding: 4px 10px; border-radius: 6px;">
              Only 2 Services Enabled
            </span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
            <div class="service-pill-box">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="color: #38bdf8; font-size: 1rem;"><i class="fa-solid fa-globe me-1"></i> 1. Web Development</strong>
                <span style="font-weight: 800; color: #22c55e; font-size: 0.9rem;">₹5,000 – ₹10,000</span>
              </div>
              <p style="font-size: 0.825rem; color: var(--text-secondary); line-height: 1.5;">
                Professional business websites, mobile-responsive layouts, contact/WhatsApp buttons, basic SEO setup, clean deployment.
              </p>
            </div>
            <div class="service-pill-box">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <strong style="color: #f59e0b; font-size: 1rem;"><i class="fa-solid fa-bullhorn me-1"></i> 2. Performance Marketing</strong>
                <span style="font-weight: 800; color: #22c55e; font-size: 0.9rem;">₹5,000 – ₹8,000</span>
              </div>
              <p style="font-size: 0.825rem; color: var(--text-secondary); line-height: 1.5;">
                Targeted Meta (Facebook/Instagram) & Google ad setup, audience research, creative campaign optimization, verified WhatsApp leads.
              </p>
            </div>
          </div>
        </div>

        <!-- WhatsApp Sessions Quick Overview Table -->
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <i class="fa-solid fa-list-check"></i> WhatsApp Sessions Overview
            </div>
            <button class="btn-brand" style="padding: 5px 12px; font-size: 0.8rem;" onclick="navigateTo('sessions')">
              Manage Sessions & Scanners ➡️
            </button>
          </div>
          <div style="overflow-x: auto;">
            <table class="openwa-table">
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Device Name / Label</th>
                  <th>Status</th>
                  <th>Connected Phone</th>
                  <th>Queries Handled</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="dashSessionsTableBody">
                <!-- Dynamically rendered -->
              </tbody>
            </table>
          </div>
        </div>

      </section>

      <!-- ==================== VIEW 2: SESSIONS & SCANNERS ==================== -->
      <section id="view-sessions" class="app-view" style="display: none;">
        
        <div class="panel-card">
          <div class="panel-header">
            <div>
              <div class="panel-title">
                <i class="fa-solid fa-qrcode text-warning"></i> WhatsApp Sessions & Multi-Device Manager
              </div>
              <p style="font-size: 0.825rem; color: var(--text-muted); margin-top: 2px;">
                Connect your personal number, friend's number, or multiple marketing numbers simultaneously.
              </p>
            </div>
            <button class="btn-brand" onclick="addNewSession()">
              <i class="fa-solid fa-plus me-1"></i> + Add Another Number (Friend's / Team)
            </button>
          </div>

          <!-- Session Tabs Bar -->
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 1.5rem;" id="sessionTabsBar">
            <!-- Dynamically populated -->
          </div>

          <!-- Active Session Details & Scanner Box -->
          <div id="sessionManagerContent" style="background: var(--bg-light); border: 1px solid var(--border); border-radius: 14px; padding: 1.5rem;">
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border);">
              <div>
                <h4 id="activeSessionTitle" style="font-weight: 800; font-size: 1.15rem; color: var(--text-primary); margin-bottom: 2px;">Primary (Mera Number)</h4>
                <div style="font-size: 0.75rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;" id="activeSessionId">ID: default</div>
              </div>
              <button class="btn-brand" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);" onclick="deleteActiveSession()">
                <i class="fa-solid fa-trash-can me-1"></i> Disconnect / Remove
              </button>
            </div>

            <!-- Connected View -->
            <div id="sessionConnectedCard" style="display: none; text-align: center; padding: 2rem 1rem;">
              <div style="font-size: 3rem; color: #22c55e; margin-bottom: 0.75rem;"><i class="fa-solid fa-circle-check"></i></div>
              <h3 style="font-weight: 800; margin-bottom: 4px;">WhatsApp Connected Successfully</h3>
              <p style="font-size: 1.2rem; font-weight: 700; color: #f59e0b; margin-bottom: 1rem;" id="sessionConnectedPhone">+91 XXXXXXXXXX</p>
              <p style="color: var(--text-secondary); font-size: 0.875rem; max-width: 600px; margin: 0 auto 1.5rem;">
                This WhatsApp session is active and listening! Every incoming message will automatically be analyzed by your <strong>2-Service AI Sales Agent</strong> and answered with a realistic ~10s human typing presence.
              </p>
              <button class="btn-brand" style="background: rgba(239, 68, 68, 0.2); color: #ef4444;" onclick="deleteActiveSession()">
                <i class="fa-solid fa-power-off me-1"></i> Log Out & Re-link
              </button>
            </div>

            <!-- Scanner & Pairing Box (When not connected) -->
            <div id="sessionScannerGrid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; align-items: center;">
              
              <!-- Column 1: QR Code Scanner -->
              <div style="text-align: center; border-right: 1px solid var(--border); padding-right: 1.5rem;">
                <h5 style="font-weight: 700; margin-bottom: 6px;"><i class="fa-solid fa-qrcode text-warning me-1"></i> 1. Scan QR Code</h5>
                <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px;">
                  WhatsApp ➡️ <strong>Linked Devices</strong> ➡️ <strong>Link a device</strong> se scan karein:
                </p>
                <div class="scanner-white-box">
                  <img id="activeQrImage" src="/api/devices/default/qr" alt="WhatsApp QR Code Scanner">
                  <div style="color: #0b1329; font-weight: 700; font-size: 0.8rem; margin-top: 8px;" id="qrStatusLabel">Live Scanner Ready</div>
                </div>
                <div style="margin-top: 14px; display: flex; justify-content: center; gap: 8px;">
                  <button class="btn-brand" style="background: transparent; border: 1px solid var(--border); color: var(--text-primary); font-size: 0.8rem;" onclick="refreshActiveQR()">
                    <i class="fa-solid fa-arrows-rotate me-1"></i> Refresh QR
                  </button>
                  <a id="activeQrFullscreen" href="/api/devices/default/qr" target="_blank" class="btn-brand" style="font-size: 0.8rem;">
                    <i class="fa-solid fa-expand me-1"></i> Fullscreen QR
                  </a>
                </div>
              </div>

              <!-- Column 2: 8-Digit Pairing Code -->
              <div>
                <h5 style="font-weight: 700; margin-bottom: 6px;"><i class="fa-solid fa-key text-info me-1"></i> 2. Ya 8-Digit Code Se Connect Karein</h5>
                <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 14px;">
                  Agar camera kaam nahi kar raha to mobile number daal kar code prapt karein:
                </p>
                <div style="display: flex; gap: 8px; margin-bottom: 1rem;">
                  <div style="display: flex; align-items: center; background: var(--bg-white); border: 1px solid var(--border); border-radius: 8px; padding: 0 12px; font-weight: 700; color: var(--text-muted);">
                    +91
                  </div>
                  <input type="text" id="phoneInput" class="form-control" placeholder="10-digit number (e.g. 8005844014)..." value="8005844014">
                  <button class="btn-brand" onclick="requestPairingCode()">Get Code</button>
                </div>

                <div id="pairingCodeResult" style="display: none; background: var(--bg-white); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 12px; padding: 1.25rem; text-align: center;">
                  <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">WhatsApp me ye 8-digit code dalein:</div>
                  <div class="code-display" id="pairingCodeDisplay">--------</div>
                  <div style="font-size: 0.75rem; color: #f59e0b; margin-top: 8px; line-height: 1.4;">
                    WhatsApp ➡️ Linked Devices ➡️ Link a Device ➡️ <strong>"Link with phone number instead"</strong> par tap karke ye code daalein.
                  </div>
                </div>

                <div id="pairingCodeError" style="display: none; color: #ef4444; font-size: 0.8rem; margin-top: 8px;"></div>
              </div>

            </div>

          </div>

        </div>

      </section>

      <!-- ==================== VIEW 3: CHATS & SIMULATOR ==================== -->
      <section id="view-chats" class="app-view" style="display: none;">
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <i class="fa-solid fa-comments text-info"></i> WhatsApp AI Sales Simulator
            </div>
            <span style="font-size: 0.8rem; color: var(--text-muted);">Simulate incoming client questions</span>
          </div>

          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.25rem;">
            Test how the AI sells <strong>Web Development</strong> and <strong>Performance Marketing</strong> naturally without robotic symbols or pushy sales pitches:
          </p>

          <div style="display: flex; gap: 8px; margin-bottom: 1.25rem;">
            <input type="text" id="chatSimulatorInput" class="form-control" placeholder="Type customer message (e.g. bhai website banwani thi kitna kharcha aayega?)..." value="bhai website banwani thi kitna kharcha aayega">
            <button class="btn-brand" onclick="runChatSimulator()">
              <i class="fa-solid fa-paper-plane me-1"></i> Send
            </button>
          </div>

          <div id="simulatorOutputCard" style="display: none; background: var(--bg-light); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; margin-bottom: 6px;">AI Sales Representative (Real Human Tone):</div>
            <div id="simulatorOutputText" style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); font-weight: 500;"></div>
          </div>
        </div>
      </section>

      <!-- ==================== VIEW 4: 2-SERVICE AI SALES ENGINE ==================== -->
      <section id="view-ai" class="app-view" style="display: none;">
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <i class="fa-solid fa-robot text-success"></i> 2-Service Catalog Architecture
            </div>
            <span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #22c55e; font-weight: 700; padding: 4px 10px; border-radius: 6px;">
              Strictly 2 Services Active
            </span>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
            
            <div style="background: var(--bg-light); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem;">
              <h4 style="color: #38bdf8; font-weight: 800; margin-bottom: 6px;">Service 1: Web Development</h4>
              <div style="font-size: 1.25rem; font-weight: 800; color: #22c55e; margin-bottom: 12px;">₹5,000 – ₹10,000</div>
              <ul style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8; padding-left: 20px;">
                <li>Professional business website for doctors, local shops & professionals.</li>
                <li>Mobile-responsive modern design.</li>
                <li>Basic SEO setup & Google indexing.</li>
                <li>Direct WhatsApp & Call click-to-chat integration.</li>
                <li>Pricing Tier 1 (Simple 1-3 pages): ₹5,000 – ₹6,500.</li>
                <li>Pricing Tier 2 (Medium business): ₹6,500 – ₹8,000.</li>
                <li>Pricing Tier 3 (Advanced features): ₹8,000 – ₹10,000.</li>
              </ul>
            </div>

            <div style="background: var(--bg-light); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem;">
              <h4 style="color: #f59e0b; font-weight: 800; margin-bottom: 6px;">Service 2: Performance Marketing</h4>
              <div style="font-size: 1.25rem; font-weight: 800; color: #22c55e; margin-bottom: 12px;">₹5,000 – ₹8,000</div>
              <ul style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8; padding-left: 20px;">
                <li>Meta (Facebook/Instagram) & Google Ads campaign setup.</li>
                <li>Audience targeting & demographic research.</li>
                <li>Ad creative copy & optimization for inquiries.</li>
                <li>Direct WhatsApp lead generation campaigns.</li>
                <li>Basic campaign setup: ₹5,000 – ₹6,000.</li>
                <li>Medium ongoing optimization: ₹6,000 – ₹7,000.</li>
                <li>High-scale advertising support: ₹7,000 – ₹8,000.</li>
              </ul>
            </div>

          </div>

          <div style="margin-top: 1.5rem; background: var(--bg-white); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem;">
            <h5 style="font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">Automated Sales Pipeline Rules:</h5>
            <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6;">
              When a prospect replies to the initial 2-service menu, the AI analyzes their actual message, determines whether they need website or ads, asks clarifying questions (pages, business type, city), and quotes a customized price without sounding robotic.
            </p>
          </div>
        </div>
      </section>

      <!-- ==================== VIEW 5: LEADS & CALENDAR ==================== -->
      <section id="view-leads" class="app-view" style="display: none;">
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <i class="fa-solid fa-calendar-days text-success"></i> Captured Leads & Scheduled Events
            </div>
            <div style="display: flex; gap: 8px;">
              <a id="btnSyncGoogleCal" href="#" target="_blank" class="btn-brand" style="font-size: 0.8rem;">
                <i class="fa-brands fa-google me-1"></i> Sync Google Calendar
              </a>
              <button class="btn-brand" style="background: transparent; border: 1px solid var(--border); color: var(--text-primary); font-size: 0.8rem;" onclick="copyIcalLink()">
                <i class="fa-solid fa-link me-1"></i> Copy iCal Feed
              </button>
            </div>
          </div>

          <h5 style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem;">1. Captured Business Inquiries</h5>
          <div style="overflow-x: auto; margin-bottom: 2rem;">
            <table class="openwa-table">
              <thead>
                <tr>
                  <th>Client Name</th>
                  <th>Phone Number</th>
                  <th>WhatsApp Source</th>
                  <th>Lead Status</th>
                  <th>Captured Notes</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody id="leadsTableBody">
                <!-- Dynamically rendered -->
              </tbody>
            </table>
          </div>

          <h5 style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem;">2. Calendar Events (Classes, Gym, Meetings)</h5>
          <div id="eventsContainer" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="color: var(--text-muted); font-size: 0.85rem;">No scheduled events yet. Incoming WhatsApp messages mentioning meetings, classes, or gym will auto-appear here.</div>
          </div>
        </div>
      </section>

      <!-- ==================== VIEW 6: API KEYS ==================== -->
      <section id="view-keys" class="app-view" style="display: none;">
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <i class="fa-solid fa-key text-warning"></i> OpenRouter & AI Model Settings
            </div>
            <span class="badge" style="background: rgba(34, 197, 94, 0.15); color: #22c55e; font-weight: 700; padding: 4px 10px; border-radius: 6px;">
              Built-in Key Active
            </span>
          </div>

          <div style="max-width: 600px;">
            <div style="margin-bottom: 1rem;">
              <label style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; display: block;">OpenRouter API Key (Optional Override):</label>
              <input type="password" id="keyOpenRouter" class="form-control" placeholder="sk-or-v1-...">
            </div>

            <div style="margin-bottom: 1.25rem;">
              <label style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; display: block;">Active AI Model:</label>
              <select id="selectModel" class="form-select">
                <option value="deepseek/deepseek-chat">DeepSeek V3 (Recommended for Sales)</option>
                <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
                <option value="openai/gpt-4o-mini">OpenAI GPT-4o-mini</option>
              </select>
            </div>

            <button class="btn-brand" onclick="saveApiKeys()">
              <i class="fa-solid fa-floppy-disk me-1"></i> Save Configuration
            </button>
            <div id="saveKeyAlert" style="display: none; margin-top: 10px; font-size: 0.85rem;"></div>
          </div>
        </div>
      </section>

      <!-- ==================== VIEW 7: SYSTEM LOGS ==================== -->
      <section id="view-logs" class="app-view" style="display: none;">
        <div class="panel-card">
          <div class="panel-header">
            <div class="panel-title">
              <i class="fa-solid fa-terminal text-success"></i> Live System & Activity Logs
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-family: 'JetBrains Mono', monospace;" id="logsSessionTag">All Sessions</span>
          </div>

          <div id="terminalLogBox" style="background: #020617; border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; max-height: 400px; overflow-y: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.825rem; line-height: 1.6;">
            <div style="color: var(--text-muted);">Listening for incoming messages and connection updates...</div>
          </div>
        </div>
      </section>

    </main>
  </div>

  <!-- SCRIPT LOGIC -->
  <script>
    let activeSessionId = 'default';
    let cachedSessions = [];

    function navigateTo(viewName) {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.app-view').forEach(el => el.style.display = 'none');
      
      const navEl = document.getElementById('nav-' + viewName);
      const viewEl = document.getElementById('view-' + viewName);
      if (navEl) navEl.classList.add('active');
      if (viewEl) viewEl.style.display = 'block';

      const names = {
        'dashboard': 'Dashboard',
        'sessions': 'WhatsApp Sessions & Scanners',
        'chats': 'Live Chats & Simulator',
        'ai': '2-Service AI Sales Engine',
        'leads': 'Leads & Schedule',
        'keys': 'API Keys & Models',
        'logs': 'Live Activity Logs'
      };
      document.getElementById('breadcrumb-page').innerText = names[viewName] || viewName;
    }

    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      document.getElementById('themeIcon').className = next === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      document.getElementById('themeLabel').innerText = next === 'light' ? 'Light Theme' : 'Dark Theme';
    }

    function toggleSidebar() {
      document.getElementById('appSidebar').classList.toggle('open');
    }

    function selectSession(id) {
      activeSessionId = id;
      renderSessionTabs();
      updateSessionView();
    }

    function refreshActiveQR() {
      const img = document.getElementById('activeQrImage');
      if (img) img.src = '/api/devices/' + activeSessionId + '/qr?t=' + Date.now();
      const fs = document.getElementById('activeQrFullscreen');
      if (fs) fs.href = '/api/devices/' + activeSessionId + '/qr';
    }

    function renderSessionTabs() {
      const container = document.getElementById('sessionTabsBar');
      if (!container || !cachedSessions.length) return;

      container.innerHTML = cachedSessions.map(function(s) {
        const isActive = s.id === activeSessionId;
        let badge = s.status === 'connected' ? '<span class="badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e;">Connected</span>'
                  : s.hasQR ? '<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b;">Scan QR</span>'
                  : '<span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #94a3b8;">Connecting</span>';

        return '<button class="device-tab-btn ' + (isActive ? 'active' : '') + '" onclick="selectSession(\\'' + s.id + '\\')">' +
          '<i class="fa-solid fa-mobile-screen"></i> ' + s.label + ' ' + badge +
          '</button>';
      }).join('');
    }

    function updateSessionView() {
      const s = cachedSessions.find(function(item) { return item.id === activeSessionId; }) || cachedSessions[0];
      if (!s) return;

      activeSessionId = s.id;
      document.getElementById('activeSessionTitle').innerText = s.label;
      document.getElementById('activeSessionId').innerText = 'ID: ' + s.id;

      const connCard = document.getElementById('sessionConnectedCard');
      const scanGrid = document.getElementById('sessionScannerGrid');
      const qrImg = document.getElementById('activeQrImage');
      const fsLink = document.getElementById('activeQrFullscreen');

      fsLink.href = '/api/devices/' + s.id + '/qr';

      if (s.status === 'connected') {
        connCard.style.display = 'block';
        scanGrid.style.display = 'none';
        document.getElementById('sessionConnectedPhone').innerText = s.connectedNumber || 'Active';
      } else {
        connCard.style.display = 'none';
        scanGrid.style.display = 'grid';

        if (!qrImg.src.includes('/api/devices/' + s.id + '/qr')) {
          qrImg.src = '/api/devices/' + s.id + '/qr?t=' + Date.now();
        }

        document.getElementById('qrStatusLabel').innerText = s.hasQR ? 'Live Scanner Ready (Scan from Phone)' : 'Starting Scanner...';

        if (s.pairingCode) {
          document.getElementById('pairingCodeResult').style.display = 'block';
          document.getElementById('pairingCodeDisplay').innerText = s.pairingCode;
        }
      }

      // Render Dashboard table
      document.getElementById('dashSessionsTableBody').innerHTML = cachedSessions.map(function(item) {
        return '<tr>' +
          '<td><code>' + item.id + '</code></td>' +
          '<td><strong>' + item.label + '</strong></td>' +
          '<td>' + (item.status === 'connected' ? '<span class="status-pill connected">Connected</span>' : '<span class="status-pill ready">Scan QR</span>') + '</td>' +
          '<td>' + (item.connectedNumber || '—') + '</td>' +
          '<td>' + (item.totalQueriesProcessed || 0) + '</td>' +
          '<td><button class="btn-brand" style="padding: 4px 8px; font-size: 0.75rem;" onclick="selectSession(\\'' + item.id + '\\'); navigateTo(\\'sessions\\');">Open Scanner</button></td>' +
          '</tr>';
      }).join('');

      // Render logs
      if (s.recentLogs && s.recentLogs.length > 0) {
        document.getElementById('terminalLogBox').innerHTML = s.recentLogs.map(function(l) {
          return '<div style="padding: 2px 0; border-bottom: 1px solid rgba(51, 65, 85, 0.4);">' +
            '<span style="color: #64748b;">[' + l.time + ']</span> <span style="color: #38bdf8;">[' + s.label + ']</span> ' + l.text +
            '</div>';
        }).join('');
      }
    }

    async function loadData() {
      try {
        const res = await fetch('/api/devices');
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          cachedSessions = list;
          document.getElementById('dashTotalSessions').innerText = list.length;
          
          let totalQueries = 0;
          let anyConnected = false;
          list.forEach(function(i) {
            totalQueries += (i.totalQueriesProcessed || 0);
            if (i.status === 'connected') anyConnected = true;
          });
          document.getElementById('dashTotalMessages').innerText = totalQueries;

          const pill = document.getElementById('globalStatusBadge');
          if (anyConnected) {
            pill.className = 'status-pill connected';
            pill.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + list.length + ' Session(s) Active';
          } else {
            pill.className = 'status-pill ready';
            pill.innerHTML = '<i class="fa-solid fa-qrcode"></i> Ready to Connect';
          }

          renderSessionTabs();
          updateSessionView();
        }

        // Fetch leads
        const lRes = await fetch('/api/leads');
        const lData = await lRes.json();
        if (lData && lData.leads) {
          document.getElementById('dashTotalLeads').innerText = lData.leads.length;
          const body = document.getElementById('leadsTableBody');
          if (lData.leads.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No leads captured yet. As clients chat on WhatsApp, leads appear here.</td></tr>';
          } else {
            body.innerHTML = lData.leads.map(function(ld) {
              return '<tr>' +
                '<td><strong>' + (ld.name || 'Client') + '</strong></td>' +
                '<td>+' + (ld.phone || ld.senderPhone || '') + '</td>' +
                '<td>' + (ld.device || 'Primary') + '</td>' +
                '<td><span class="badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e;">' + (ld.status || 'Inquired') + '</span></td>' +
                '<td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + (ld.notes || '') + '</td>' +
                '<td>' + (ld.createdAt ? new Date(ld.createdAt).toLocaleDateString() : '') + '</td>' +
                '</tr>';
            }).join('');
          }
        }

        // Fetch calendar
        const cRes = await fetch('/api/calendar');
        const cData = await cRes.json();
        if (cData && cData.events) {
          document.getElementById('btnSyncGoogleCal').href = cData.googleCalendarSubscribeUrl;
          window.icalUrl = cData.syncLink;
          if (cData.events.length > 0) {
            document.getElementById('eventsContainer').innerHTML = cData.events.map(function(ev) {
              return '<div style="background: var(--bg-light); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">' +
                '<div><strong style="color: #38bdf8;">' + ev.title + '</strong><div style="font-size: 0.8rem; color: var(--text-muted);">' + ev.timing + '</div></div>' +
                '<a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.title) + '" target="_blank" class="btn-brand" style="font-size: 0.75rem;">+ Add</a>' +
                '</div>';
            }).join('');
          }
        }
      } catch {}
    }

    async function addNewSession() {
      const name = prompt('WhatsApp Session Name / Label Dalein:\\n(e.g. "Dost Ka Number", "Support Desk", "Sales Team")', 'Dost Ka Number');
      if (!name || !name.trim()) return;

      try {
        const res = await fetch('/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: name.trim() })
        });
        const data = await res.json();
        if (data.success && data.device) {
          activeSessionId = data.device.id;
          await loadData();
          navigateTo('sessions');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function deleteActiveSession() {
      if (!confirm('Kya aap is WhatsApp session ko disconnect karna chahte hain?')) return;
      try {
        await fetch('/api/devices/' + activeSessionId, { method: 'DELETE' });
        activeSessionId = 'default';
        await loadData();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function requestPairingCode() {
      const phone = document.getElementById('phoneInput').value.trim();
      const errBox = document.getElementById('pairingCodeError');
      const resBox = document.getElementById('pairingCodeResult');
      const disp = document.getElementById('pairingCodeDisplay');
      
      if (!phone) {
        errBox.style.display = 'block';
        errBox.innerText = 'Please enter phone number.';
        return;
      }

      errBox.style.display = 'none';
      disp.innerText = 'GENERATING...';
      resBox.style.display = 'block';

      try {
        const res = await fetch('/api/devices/' + activeSessionId + '/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success && data.code) {
          disp.innerText = data.code;
        } else {
          errBox.style.display = 'block';
          errBox.innerText = data.error || data.message || 'Error generating code. Please retry in 5s.';
          resBox.style.display = 'none';
        }
      } catch (e) {
        errBox.style.display = 'block';
        errBox.innerText = 'Error: ' + e.message;
        resBox.style.display = 'none';
      }
    }

    async function runChatSimulator() {
      const q = document.getElementById('chatSimulatorInput').value.trim();
      if (!q) return;
      const card = document.getElementById('simulatorOutputCard');
      const text = document.getElementById('simulatorOutputText');
      card.style.display = 'block';
      text.innerText = 'Thinking consultative reply...';

      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q })
        });
        const d = await res.json();
        text.innerText = d.answer || 'Haan bhai batao.';
      } catch (e) {
        text.innerText = 'Error: ' + e.message;
      }
    }

    async function saveApiKeys() {
      const key = document.getElementById('keyOpenRouter').value.trim();
      const model = document.getElementById('selectModel').value;
      const alertBox = document.getElementById('saveKeyAlert');

      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openrouterApiKey: key, openrouterModel: model })
        });
        alertBox.style.display = 'block';
        alertBox.style.color = '#22c55e';
        alertBox.innerText = '✅ API Keys & Model configuration saved!';
      } catch (e) {
        alertBox.style.display = 'block';
        alertBox.style.color = '#ef4444';
        alertBox.innerText = 'Error: ' + e.message;
      }
    }

    function copyIcalLink() {
      const url = window.icalUrl || (window.location.origin + '/calendar.ics');
      navigator.clipboard.writeText(url).then(function() {
        alert('Copied Calendar iCal link! Paste this into Google Calendar -> Other Calendars (+) -> From URL.');
      });
    }

    // Auto poll every 3 seconds
    setInterval(loadData, 3000);
    loadData();

    // Auto refresh active QR every 6s if not connected
    setInterval(function() {
      const s = cachedSessions.find(function(item) { return item.id === activeSessionId; });
      if (s && s.status !== 'connected') {
        const img = document.getElementById('activeQrImage');
        if (img) img.src = '/api/devices/' + activeSessionId + '/qr?t=' + Date.now();
      }
    }, 6000);
  </script>
</body>
</html>`);
});

// Start server and initialize all WhatsApp sessions
app.listen(PORT, async () => {
  console.log(`
======================================================
🌐 OpenWA WhatsApp Gateway & AI Sales Manager
📍 Server: http://localhost:${PORT}
⚡ Upstream Architecture: https://github.com/rmyndharis/OpenWA.git
🎯 2-Service AI Sales Agent (Web Development & Performance Marketing)
📱 Multi-Session Support (User + Friend + Team WhatsApp Numbers)
======================================================
`);
  await startAllWhatsAppSessions();
});
