/**
 * Multi-Device Human Friend & 2-Service Sales Agent - WhatsApp Bot & Dashboard
 * 
 * Features:
 * - Multi-Device / Multi-Number WhatsApp Support: Connect user's number, friend's number, or multiple numbers simultaneously!
 * - High-Contrast Direct QR Code Scanner & 8-Digit Pairing Code per device.
 * - AI Sales Agent (Strictly 2 Services: Web Development ₹5k-₹10k & Performance Marketing ₹5k-₹8k).
 * - Human-like consultative sales flow (Analyze, Think, Short natural Hinglish replies).
 * - Realistic ~10s typing delay with WhatsApp 'composing' presence.
 * - Dedicated auth session folders per device.
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
    'PRODID:-//WhatsApp Assistant Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:WhatsApp Schedule (Classes, Meetings, Gym)',
    'X-WR-TIMEZONE:Asia/Kolkata',
  ];

  for (const evt of calendarEvents) {
    const createdDate = new Date(evt.createdAt || Date.now());
    const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const dtstamp = fmt(createdDate);
    const dtstart = fmt(createdDate);
    const dtend = fmt(new Date(createdDate.getTime() + 60 * 60 * 1000));

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${evt.id || Date.now()}@whatsapp-assistant`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${dtstart}`);
    lines.push(`DTEND:${dtend}`);
    lines.push(`SUMMARY:${(evt.title || 'WhatsApp Event').replace(/\n/g, ' ')}`);
    lines.push(`DESCRIPTION:${(evt.timing || evt.notes || 'Scheduled via WhatsApp').replace(/\n/g, ' ')}`);
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
            'X-Title': 'WhatsApp Professional 2-Service Advisor',
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

  // Set 6-second debounce + 4.5-second typing = ~10.5 seconds realistic delay
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
          status: isConfirmed ? 'Service Confirmed / Waiting Boss Verification' : 'Lead Inquired',
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

  // Use dedicated folder per session
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

    console.log(`🚀 Initializing WhatsApp Session [${sessionObj.label}] (Baileys v${version.join('.')})...`);

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

// List all devices
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

// Add a new device
app.post('/api/devices', async (req, res) => {
  try {
    const label = (req.body?.label || '').trim() || `WhatsApp Device ${registeredSessions.length + 1}`;
    const id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    registeredSessions.push({ id, label });
    saveRegisteredSessions();
    await initSession(id, label);
    res.json({ success: true, device: { id, label, status: 'connecting' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete / Disconnect a device
app.delete('/api/devices/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await deleteSession(id);
    res.json({ success: true, message: `Device ${id} removed successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct PNG QR Image Stream for a specific device
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
    if (!s) msg = 'Device Not Found';
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

// Request 8-Digit Pairing Code for a specific device
app.post('/api/devices/:id/pair', async (req, res) => {
  try {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Device not found' });
    if (!s.sock) return res.status(500).json({ error: 'Device WhatsApp engine starting... please try again in 5s.' });
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

// Health check
app.get('/api/health', (req, res) => {
  const primary = getPrimarySession();
  res.json({
    status: 'ok',
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

// ==================== DASHBOARD HTML PAGE ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Device WhatsApp AI Sales Manager</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { background-color: #0b1329; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; }
    .badge-status { font-size: 0.85rem; padding: 5px 12px; border-radius: 20px; }
    .code-display { font-size: 2.3rem; letter-spacing: 6px; font-weight: 800; color: #38bdf8; background: #020617; border-radius: 8px; }
    .human-chat-box { background: #0f172a; border-radius: 10px; border: 1px solid #334155; }
    
    /* Device Tabs Styling */
    .device-tab-btn {
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      padding: 10px 18px;
      border-radius: 10px;
      font-weight: 600;
      transition: all 0.2s ease;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .device-tab-btn:hover {
      background: #334155;
      color: #f8fafc;
    }
    .device-tab-btn.active {
      background: #0284c7;
      color: #ffffff;
      border-color: #38bdf8;
      box-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
    }
    .scanner-white-box {
      background: #ffffff;
      border-radius: 16px;
      padding: 18px;
      display: inline-block;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .service-chip {
      background: #0f172a;
      border: 1px solid #38bdf8;
      border-radius: 10px;
      padding: 12px 16px;
    }
  </style>
</head>
<body class="p-3 p-md-4">
  <div class="container" style="max-width: 1000px;">
    
    <!-- Top Header -->
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-4 pb-3 border-bottom border-secondary">
      <div>
        <h3 class="fw-bold mb-1" style="color: #38bdf8;">
          <i class="fa-brands fa-whatsapp text-success me-2"></i>Multi-Device WhatsApp AI Sales Manager
        </h3>
        <p class="text-secondary small mb-0">
          Connect Multiple WhatsApp Numbers (Your number, Friend's number) & Run 24/7 AI Sales Agent (Web Development & Marketing)
        </p>
      </div>
      <div class="mt-2 mt-md-0 d-flex align-items-center gap-2">
        <span id="globalDeviceCountBadge" class="badge bg-primary badge-status"><i class="fa-solid fa-mobile-screen me-1"></i> 1 Device</span>
        <span class="badge bg-success badge-status"><i class="fa-solid fa-robot me-1"></i> 2-Service AI Live</span>
      </div>
    </div>

    <!-- Active 2-Service Catalog Overview -->
    <div class="row g-3 mb-4">
      <div class="col-md-6">
        <div class="service-chip">
          <div class="d-flex justify-content-between align-items-center">
            <h6 class="fw-bold text-info mb-1"><i class="fa-solid fa-globe me-2"></i>Service 1: Web Development</h6>
            <span class="badge bg-info text-dark fw-bold">₹5,000 – ₹10,000</span>
          </div>
          <div class="text-secondary small">
            Professional business website, Mobile-responsive, WhatsApp integration, Contact form, Basic SEO setup.
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="service-chip">
          <div class="d-flex justify-content-between align-items-center">
            <h6 class="fw-bold text-warning mb-1"><i class="fa-solid fa-bullhorn me-2"></i>Service 2: Performance Marketing</h6>
            <span class="badge bg-warning text-dark fw-bold">₹5,000 – ₹8,000</span>
          </div>
          <div class="text-secondary small">
            Google & Meta Ads support, Campaign setup, Audience targeting, Ad optimization, Performance monitoring.
          </div>
        </div>
      </div>
    </div>

    <!-- Multi-Device Tab Bar -->
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <div id="deviceTabsContainer" class="d-flex flex-wrap gap-2 align-items-center">
        <!-- Rendered dynamically -->
        <button class="device-tab-btn active"><i class="fa-solid fa-mobile-screen"></i> Primary (Mera Number)</button>
      </div>
      <button class="btn btn-warning fw-bold text-dark btn-sm" onclick="showAddDevicePrompt()">
        <i class="fa-solid fa-plus me-1"></i> + Add WhatsApp Number (Friend's / Other)
      </button>
    </div>

    <!-- Active Device Management Card -->
    <div class="card p-4 mb-4 border-info">
      
      <!-- Device Header -->
      <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 pb-2 border-bottom border-secondary border-opacity-50">
        <div>
          <h5 class="fw-bold text-light mb-0 d-inline-block me-2">
            Managing: <span id="activeDeviceTitle" class="text-info">Primary (Mera Number)</span>
          </h5>
          <span id="activeDeviceStatusBadge" class="badge bg-warning text-dark badge-status">Ready to Scan</span>
        </div>
        <div class="mt-2 mt-md-0">
          <button class="btn btn-sm btn-outline-danger" onclick="deleteActiveDevice()">
            <i class="fa-solid fa-trash-can me-1"></i> Disconnect / Remove Device
          </button>
        </div>
      </div>

      <!-- State 1: When WhatsApp is ALREADY CONNECTED -->
      <div id="connectedDeviceView" style="display: none;" class="p-4 bg-dark bg-opacity-75 rounded-3 border border-success text-center">
        <div class="display-6 text-success mb-2"><i class="fa-solid fa-circle-check"></i></div>
        <h4 class="fw-bold text-light">WhatsApp Connected Successfully!</h4>
        <p class="fs-5 text-warning fw-semibold mb-2" id="connectedNumberText">+91 XXXXXXXXXX</p>
        <p class="text-secondary small mb-3">
          This WhatsApp number is live and linked! Incoming client inquiries for <strong>Web Development</strong> and <strong>Performance Marketing</strong> are handled automatically by the AI Sales Agent with realistic ~10s human typing delay.
        </p>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteActiveDevice()">
          <i class="fa-solid fa-arrow-right-from-bracket me-1"></i> Log Out & Re-Scan
        </button>
      </div>

      <!-- State 2: When WhatsApp is NOT CONNECTED (Show Scanner & Pairing Code together) -->
      <div id="scannerDeviceView" class="row g-4 align-items-center">
        
        <!-- Left: Live QR Code Scanner directly on website -->
        <div class="col-md-5 text-center border-end border-secondary">
          <h6 class="fw-bold text-light mb-1">
            <i class="fa-solid fa-qrcode text-warning me-1"></i> 1. Scan QR Code Scanner
          </h6>
          <p class="text-secondary small mb-2">
            Apne mobile me WhatsApp kholein ➡️ <strong>Linked Devices</strong> ➡️ <strong>Link a device</strong> karke scan karein:
          </p>

          <!-- High-Contrast White Scanner Card -->
          <div class="scanner-white-box my-2">
            <img id="deviceQrImage" src="/api/devices/default/qr" alt="WhatsApp QR Code Scanner" class="img-fluid rounded" style="width: 240px; height: 240px; display: block; margin: 0 auto; object-fit: contain;">
            <div id="qrLoadingText" class="mt-2 text-dark small fw-bold">Live QR Scanner Ready</div>
          </div>

          <div class="mt-2 d-flex justify-content-center gap-2">
            <button class="btn btn-sm btn-outline-warning" onclick="refreshActiveQR()">
              <i class="fa-solid fa-arrows-rotate me-1"></i> Refresh Scanner
            </button>
            <a id="fullscreenQrLink" href="/api/devices/default/qr" target="_blank" class="btn btn-sm btn-warning fw-bold text-dark">
              <i class="fa-solid fa-expand me-1"></i> Open Fullscreen
            </a>
          </div>
        </div>

        <!-- Right: 8-Digit Pairing Code Alternative (Bina Camera ke) -->
        <div class="col-md-7">
          <h6 class="fw-bold text-light mb-1">
            <i class="fa-solid fa-mobile-screen-button text-info me-1"></i> 2. Ya 8-Digit Code Se Connect Karein
          </h6>
          <p class="small text-secondary mb-3">
            Agar camera kaam nahi kar raha to mobile number daal kar WhatsApp 8-digit code generate karein:
          </p>

          <div class="input-group mb-3">
            <span class="input-group-text bg-dark text-secondary border-secondary">+91</span>
            <input type="text" id="phonePairInput" class="form-control bg-dark text-light border-secondary" placeholder="Enter 10-digit number (e.g. 8005844014)..." value="8005844014">
            <button class="btn btn-info fw-bold text-dark" onclick="requestDevicePairingCode()">
              <i class="fa-solid fa-key me-1"></i> Get 8-Digit Code
            </button>
          </div>

          <div id="devicePairResultBox" style="display:none;" class="p-3 bg-dark rounded border border-warning text-center">
            <div class="text-secondary small mb-1">WhatsApp me ye 8-digit code enter karein:</div>
            <div id="devicePairCodeDisplay" class="code-display my-2 py-1">--------</div>
            <div class="text-start small text-warning p-2 rounded bg-black bg-opacity-60">
              <strong>Kaise Dalein:</strong> WhatsApp ➡️ Linked Devices ➡️ Link a Device ➡️ Niche <strong>"Link with phone number instead"</strong> par tap karein aur ye code daalein.
            </div>
          </div>

          <div id="devicePairError" class="small text-danger mt-2" style="display:none;"></div>
        </div>

      </div>

    </div>

    <!-- Live Human AI Chat Simulator -->
    <div class="card p-4 mb-4 border-primary">
      <h5 class="fw-bold text-primary mb-1"><i class="fa-solid fa-comments me-2"></i>Test AI Sales Agent (Live Simulator)</h5>
      <p class="text-secondary small mb-3">
        Test how the AI sells Web Development (₹5k-₹10k) and Performance Marketing (₹5k-₹8k) with realistic thinking and no robotic symbols:
      </p>
      
      <div class="input-group mb-3">
        <input type="text" id="testMsgInput" class="form-control bg-dark text-light border-secondary" placeholder="Type customer message (e.g. website banwani hai kitna kharcha aayega? / marketing karwani hai)..." value="website banwani hai kitna kharcha aayega">
        <button class="btn btn-primary fw-bold" onclick="sendTestChat()"><i class="fa-solid fa-paper-plane me-1"></i> Send Test Message</button>
      </div>

      <div id="chatReplyBox" class="p-3 human-chat-box" style="display:none; font-size: 15px; line-height: 1.6;">
        <div class="text-secondary small mb-1">AI Sales Representative:</div>
        <div id="chatReplyText" class="text-light fw-semibold"></div>
      </div>
    </div>

    <!-- OpenRouter & AI Settings -->
    <div class="card p-3 mb-4 border-secondary">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-light mb-0"><i class="fa-solid fa-key text-warning me-2"></i>OpenRouter AI Key Settings</h6>
        <span class="badge bg-success small">Built-in Key Active</span>
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-7">
          <input type="password" id="openrouterKeyInput" class="form-control bg-dark text-light border-secondary" placeholder="Custom OpenRouter Key (Optional)...">
        </div>
        <div class="col-md-5">
          <select id="openrouterModelSelect" class="form-select bg-dark text-light border-secondary">
            <option value="deepseek/deepseek-chat">DeepSeek V3 (Recommended)</option>
            <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
            <option value="openai/gpt-4o-mini">OpenAI GPT-4o-mini</option>
          </select>
        </div>
      </div>
      <div class="d-flex justify-content-end">
        <button class="btn btn-sm btn-outline-info fw-bold" onclick="saveOpenRouterKey()"><i class="fa-solid fa-floppy-disk me-1"></i> Save Key</button>
      </div>
      <div id="keyAlert" class="small mt-2" style="display:none;"></div>
    </div>

    <!-- Live Activity Logs -->
    <div class="card p-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-light mb-0"><i class="fa-solid fa-clock-rotate-left me-2"></i>Live Multi-Device Activity Logs</h6>
        <span class="text-secondary small" id="activeDeviceLogLabel">All Devices</span>
      </div>
      <div id="logsContainer" class="p-2 bg-dark rounded border border-secondary" style="max-height: 250px; overflow-y: auto; font-family: monospace; font-size: 13px;">
        <div class="text-muted">Listening for incoming WhatsApp messages across connected devices...</div>
      </div>
    </div>

  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    let activeDeviceId = 'default';
    let cachedDevices = [];

    function selectDevice(id) {
      activeDeviceId = id;
      renderDeviceTabs();
      updateActiveDeviceView();
    }

    function refreshActiveQR() {
      const img = document.getElementById('deviceQrImage');
      if (img) {
        img.src = '/api/devices/' + activeDeviceId + '/qr?t=' + Date.now();
      }
      const fsLink = document.getElementById('fullscreenQrLink');
      if (fsLink) {
        fsLink.href = '/api/devices/' + activeDeviceId + '/qr';
      }
    }

    function renderDeviceTabs() {
      const container = document.getElementById('deviceTabsContainer');
      if (!container || !cachedDevices.length) return;

      container.innerHTML = cachedDevices.map(function(d) {
        const isActive = d.id === activeDeviceId;
        let badgeHtml = '';
        if (d.status === 'connected') {
          badgeHtml = '<span class="badge bg-success ms-1"><i class="fa-solid fa-check"></i> Connected</span>';
        } else if (d.hasQR || d.status === 'qr_ready') {
          badgeHtml = '<span class="badge bg-warning text-dark ms-1">Scan QR</span>';
        } else {
          badgeHtml = '<span class="badge bg-secondary ms-1">Connecting</span>';
        }

        return '<button class="device-tab-btn ' + (isActive ? 'active' : '') + '" onclick="selectDevice(\\'' + d.id + '\\')">' +
          '<i class="fa-solid fa-mobile-screen"></i> ' + d.label + ' ' + badgeHtml +
          '</button>';
      }).join('');
    }

    function updateActiveDeviceView() {
      const dev = cachedDevices.find(function(d) { return d.id === activeDeviceId; }) || cachedDevices[0];
      if (!dev) return;

      activeDeviceId = dev.id;
      document.getElementById('activeDeviceTitle').innerText = dev.label;
      
      const badge = document.getElementById('activeDeviceStatusBadge');
      const connView = document.getElementById('connectedDeviceView');
      const scanView = document.getElementById('scannerDeviceView');
      const qrImg = document.getElementById('deviceQrImage');
      const fsLink = document.getElementById('fullscreenQrLink');

      fsLink.href = '/api/devices/' + dev.id + '/qr';

      if (dev.status === 'connected') {
        badge.className = 'badge bg-success badge-status';
        badge.innerHTML = '<i class="fa-solid fa-circle-check me-1"></i> Connected';
        connView.style.display = 'block';
        scanView.style.display = 'none';
        document.getElementById('connectedNumberText').innerText = dev.connectedNumber || 'Active';
      } else {
        connView.style.display = 'none';
        scanView.style.display = 'flex';

        if (dev.hasQR || dev.status === 'qr_ready') {
          badge.className = 'badge bg-warning text-dark badge-status';
          badge.innerHTML = '<i class="fa-solid fa-qrcode me-1"></i> Ready to Scan';
          document.getElementById('qrLoadingText').innerText = 'Live Scanner Ready (Scan with Phone)';
        } else {
          badge.className = 'badge bg-secondary badge-status';
          badge.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Starting Scanner...';
          document.getElementById('qrLoadingText').innerText = 'Starting Scanner...';
        }

        // Only reload QR image every 5 seconds or if src does not match
        const expectedSrc = '/api/devices/' + dev.id + '/qr';
        if (!qrImg.src.includes('/api/devices/' + dev.id + '/qr')) {
          qrImg.src = expectedSrc + '?t=' + Date.now();
        }

        if (dev.pairingCode) {
          document.getElementById('devicePairResultBox').style.display = 'block';
          document.getElementById('devicePairCodeDisplay').innerText = dev.pairingCode;
        }
      }

      // Render logs for active device
      if (dev.recentLogs && dev.recentLogs.length > 0) {
        document.getElementById('logsContainer').innerHTML = dev.recentLogs.map(function(l) {
          return '<div class="py-1 border-bottom border-secondary border-opacity-25">' +
            '<span class="text-secondary">[' + l.time + ']</span> <span class="badge bg-secondary me-1">' + dev.label + '</span> ' + l.text +
            '</div>';
        }).join('');
      }
    }

    async function loadDevices() {
      try {
        const res = await fetch('/api/devices');
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          cachedDevices = list;
          document.getElementById('globalDeviceCountBadge').innerHTML = '<i class="fa-solid fa-mobile-screen me-1"></i> ' + list.length + ' Device(s)';
          renderDeviceTabs();
          updateActiveDeviceView();
        }
      } catch {}
    }

    async function showAddDevicePrompt() {
      const name = prompt('WhatsApp Number Ka Naam / Label Dalein:\\n(Jaise: "Dost Ka Number", "Mera Dusra Number", "Sales WhatsApp")', 'Dost Ka Number');
      if (!name || !name.trim()) return;

      try {
        const res = await fetch('/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: name.trim() })
        });
        const data = await res.json();
        if (data.success && data.device) {
          activeDeviceId = data.device.id;
          await loadDevices();
          alert('✅ Naya Device add ho gaya! Ab samne wale QR code scanner se dost ka WhatsApp link kar sakte hain.');
        } else {
          alert('Error adding device: ' + (data.error || 'Failed'));
        }
      } catch (e) {
        alert('Network error: ' + e.message);
      }
    }

    async function deleteActiveDevice() {
      if (!confirm('Kya aap sach me is WhatsApp device ko disconnect aur remove karna chahte hain?')) return;
      try {
        const res = await fetch('/api/devices/' + activeDeviceId, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          activeDeviceId = 'default';
          await loadDevices();
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function requestDevicePairingCode() {
      const phoneInput = document.getElementById('phonePairInput').value.trim();
      const errBox = document.getElementById('devicePairError');
      const resBox = document.getElementById('devicePairResultBox');
      const codeDisplay = document.getElementById('devicePairCodeDisplay');
      
      if (!phoneInput) {
        errBox.style.display = 'block';
        errBox.innerText = 'Please enter phone number.';
        return;
      }

      errBox.style.display = 'none';
      codeDisplay.innerText = 'FETCHING...';
      resBox.style.display = 'block';

      try {
        const res = await fetch('/api/devices/' + activeDeviceId + '/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phoneInput })
        });
        const data = await res.json();
        if (data.success && data.code) {
          codeDisplay.innerText = data.code;
        } else {
          errBox.style.display = 'block';
          errBox.innerText = data.error || data.message || 'Failed to generate code. Try again in 5s.';
          resBox.style.display = 'none';
        }
      } catch (e) {
        errBox.style.display = 'block';
        errBox.innerText = 'Error: ' + e.message;
        resBox.style.display = 'none';
      }
    }

    async function sendTestChat() {
      const q = document.getElementById('testMsgInput').value.trim();
      if (!q) return;
      const box = document.getElementById('chatReplyBox');
      const replyEl = document.getElementById('chatReplyText');
      box.style.display = 'block';
      replyEl.innerText = 'Typing... (AI thinking consultative sales reply)';
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q })
        });
        const data = await res.json();
        replyEl.innerText = data.answer || 'Haan bhai bol.';
      } catch (e) {
        replyEl.innerText = 'Error: ' + e.message;
      }
    }

    async function saveOpenRouterKey() {
      const key = document.getElementById('openrouterKeyInput').value.trim();
      const model = document.getElementById('openrouterModelSelect').value;
      const alertBox = document.getElementById('keyAlert');
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openrouterApiKey: key, openrouterModel: model })
        });
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-success';
        alertBox.innerText = '✅ Key saved successfully!';
      } catch (e) {
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-danger';
        alertBox.innerText = 'Error: ' + e.message;
      }
    }

    // Auto Refresh device status every 3 seconds
    setInterval(loadDevices, 3000);
    loadDevices();

    // Refresh QR code image every 6 seconds if not connected
    setInterval(function() {
      const dev = cachedDevices.find(function(d) { return d.id === activeDeviceId; });
      if (dev && dev.status !== 'connected') {
        const img = document.getElementById('deviceQrImage');
        if (img) img.src = '/api/devices/' + activeDeviceId + '/qr?t=' + Date.now();
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
🌐 Multi-Device AI WhatsApp Manager: http://localhost:${PORT}
⚡ 2-Service Sales Agent (Web Development & Performance Marketing)
📱 Supports Multiple WhatsApp Numbers (Your number, Friend's number)
======================================================
`);
  await startAllWhatsAppSessions();
});
