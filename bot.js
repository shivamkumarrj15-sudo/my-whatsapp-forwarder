/**
 * Human Friend & Smart Service Assistant - WhatsApp Bot & Dashboard
 * 
 * Features:
 * - Natural 1-on-1 human chatting (sounds 100% like a real friend, NEVER a bot/AI).
 * - No symbols, no asterisks, no bullets - pure raw human WhatsApp texting.
 * - Concise, short replies (1 to 2 sentences max).
 * - Realistic ~10-second delay with WhatsApp 'composing' (typing...) presence.
 * - Service inquiry: asks what service they need and what their budget is.
 * - Service pricing rule: online starting & max price with 5% EXTRA added.
 * - Chats about any topic (stocks, tech, life, work) seamlessly as a friend.
 * - Multi-turn conversation memory per user.
 * - WhatsApp 8-Digit Pairing Code (Phone Number) + QR Code.
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

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 2785;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const CONFIG_FILE = path.join(__dirname, 'ai_stock_config.json');
const MEMORY_FILE = path.join(__dirname, 'conversations_memory.json');

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
  // Keep last 10 messages for context
  if (conversations[sender].length > 12) {
    conversations[sender] = conversations[sender].slice(-10);
  }
  saveConversations();
}

// Bot State
const botState = {
  status: 'connecting',
  qrDataUrl: null,
  qrRaw: null,
  pairingCode: null,
  connectedNumber: null,
  startTime: new Date().toISOString(),
  totalQueriesProcessed: 0,
  recentLogs: [],
};

function addLog(type, text) {
  const time = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  botState.recentLogs.unshift({ type, text, time });
  if (botState.recentLogs.length > 50) botState.recentLogs.pop();
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
    .replace(/[*_#~`]/g, '') // remove markdown symbols (*, _, #, ~, `)
    .replace(/^[•\-\*]\s+/gm, '') // remove bullet points
    .replace(/\b(Namaste|Hello|Hi),\s*(main|mein)\s*.*?(hoon|hu)\b/gi, '')
    .replace(/\bAs an AI\b.*?\./gi, '')
    .replace(/\bI am an AI\b.*?\./gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // If there are multiple paragraphs, keep it concise (max 2-3 lines)
  const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
  if (lines.length > 3) {
    cleaned = lines.slice(0, 3).join('\n');
  }
  return cleaned;
}

// ==================== NATURAL HUMAN AI ENGINE ====================
async function generateHumanReply(sender, userMessage) {
  const history = getHistory(sender);
  
  // Build real multi-turn conversation messages for thinking AI
  const conversationMessages = [
    {
      role: 'system',
      content: `You are an extremely intelligent, thinking AI friend and digital services consultant chatting 1-on-1 on WhatsApp.

CRITICAL INSTRUCTIONS:
1. THINK CAREFULLY & INTENSIVELY: Just like ChatGPT, Claude, or DeepSeek, understand the user's intent, context, emotions, and subtle meanings. Think deeply before replying.
2. NEVER EVER SAY 'mujhe samajh nahi aaya' or 'samajh nahi aaya' or 'clear batao'. Never give up or say you did not understand. Always give a thoughtful, helpful, and smart reply.
3. If the user asks general questions, thoughts, life, tech, coding, or daily chat, reply intelligently like a genius friend in natural Hinglish.
4. WHAT SERVICES WE PROVIDE: If user asks what services you have ('kya kya hai aapke pass', 'konsi service hai', 'kya kaam karte ho'):
   - Casually tell them: 'Mere paas har type ki digital service hai bhai, jaise website development, mobile app, logo design & graphics, video editing & reels, SEO, digital marketing aur WhatsApp bots.'
   - Always ask: 'Tujhe kis type ki service chahiye aur tera kitna budget hai?'
5. PROACTIVE SERVICE INQUIRY: If user greets ('hi', 'hello') or initiates a chat, reply warmly:
   - 'hello bhai, bolo kya scene hai? bata tujhe kis type ki service chahiye ya kaisa kaam karwana hai?'
6. PRICING RULES (Starting to Max online market price with 5% extra):
   - Website Development: starting 5,250 to max 26,250
   - E-Commerce Store: starting 12,600 to max 52,500
   - Mobile App Development: starting 26,250 to max 1,05,000
   - Graphic Design / Logo: starting 1,050 to max 5,250
   - Video Editing / Reels: starting 1,575 to max 8,400
   - SEO / Ads / Marketing: starting 6,300 to max 26,250
   - WhatsApp Bot / Automation: starting 3,150 to max 15,750
   - Always ask casually about their budget and requirements in 1-2 lines.
7. LOW BUDGET NEGOTIATION:
   - If user says their budget is less than the starting rate (e.g., offers 1000 or 2000 for a website), casually offer: 'Itne me to nahi ho payega bhai, par ek second option hai agar chalega to - AI se bani basic website chalegi kya?' (adapt to whatever service they asked).
8. NO BOT TONE & STRICTLY NO SYMBOLS:
   - Absolutely NO asterisks (*bold*), NO bullet points (- ), NO numbering (1. 2.), NO hashtags, and NO robotic emojis spam.
   - Output clean plain text only (2 to 3 sentences max) just like texting a real person on WhatsApp.`,
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

  // 1. OpenRouter AI (DeepSeek / Llama / etc.)
  if (activeOrKey) {
    const models = [
      appConfig.openrouterModel || 'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-r1',
    ];
    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeOrKey}`,
            'HTTP-Referer': 'https://my-whatsapp-forwarder.onrender.com',
            'X-Title': 'WhatsApp Smart AI Friend',
          },
          body: JSON.stringify({
            model,
            messages: conversationMessages,
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
  const lower = userMessage.toLowerCase().trim();

  // Greetings check
  if (/^(hi|hello|hey|hlo|helo|hy)\b/i.test(lower) || lower === 'hi' || lower === 'hello') {
    return 'hello bhai, bolo kya scene hai? bata tujhe kis type ki service chahiye ya kaisa kaam karwana hai?';
  }

  // Catalog / "Kya kya hai aapke pass" check
  if (
    lower.includes('kya kya hai') ||
    lower.includes('kya service') ||
    lower.includes('kya services') ||
    lower.includes('konsi service') ||
    lower.includes('konsi services') ||
    lower.includes('kya kaam') ||
    lower.includes('kya offer') ||
    lower.includes('kya kya karte ho') ||
    lower.includes('kya kya provide')
  ) {
    return 'Mere paas har type ki service hai bhai, jaise website development, mobile app, logo design, video editing aur marketing sab. Tujhe kis cheez ki zaroorat hai aur tera kitna budget hai?';
  }

  // Confirmation if user says haan/yes/ha
  if (/^(ha|haan|haa|yes|yep|sahi|wahi|ha bhai|haan bhai|bilkul)$/i.test(lower)) {
    return 'Sahi hai bhai, bata isme kya requirement hai aur kab tak chahiye? Budget kitna socha hai?';
  }

  // Low budget negotiation check
  if (lower.includes('budget') || lower.includes('kam') || /\b(500|1000|1500|2000|2500|3000|4000)\b/.test(lower)) {
    if (lower.includes('app')) {
      return 'Itne me to nahi ho payega bhai, par ek second option hai agar chalega to - AI ya no-code basic app chalega kya?';
    }
    if (lower.includes('logo') || lower.includes('graphic')) {
      return 'Itne me to nahi ho payega bhai, par ek second option hai - AI se bana basic logo chalega kya?';
    }
    if (lower.includes('video') || lower.includes('reel')) {
      return 'Itne me to nahi ho payega bhai, par ek second option hai - AI template se bani basic video chalegi kya?';
    }
    return 'Itne me to nahi ho payega bhai, par ek second option hai agar chalega to - AI se bani basic website chalegi kya?';
  }

  if (lower.includes('website') || lower.includes('web')) {
    return 'Bhai website ka market me starting 5,250 se lekar 26,250 tak rehta hai requirements ke hisaab se. Tera kaisa plan hai aur budget kitna hai?';
  }
  if (lower.includes('app') || lower.includes('application')) {
    return 'App ka starting lagbhag 26,250 se 1,05,000 tak jata hai features ke hisaab se. Tujhe kis type ka app banwana hai aur budget kya hai?';
  }
  if (lower.includes('logo') || lower.includes('graphic') || lower.includes('design')) {
    return 'Logo aur graphics ka normally 1,050 se 5,250 tak rehta hai quality pe depend karke. Tera kya budget hai bata?';
  }
  if (lower.includes('video') || lower.includes('reel') || lower.includes('edit')) {
    return 'Video editing ka starting 1,575 se 8,400 tak chal raha hai bhai video ke hisaab se. Kaisa content edit karwana hai aur budget kya hai?';
  }
  if (lower.includes('service') || lower.includes('kaam') || lower.includes('charges') || lower.includes('price')) {
    return 'Haan bhai bata kaunsa kaam karwana hai tujhe? Website, app, design ya video? Aur kitna budget socha hai tune?';
  }
  if (lower.includes('kaisa hai') || lower.includes('kya haal')) {
    return 'Sahi chal rha hai bhai, tu bata kya haal chaal? Kuch kaam ya service chahiye thi kya?';
  }

  // Default proactive helpful response (NEVER says 'samajh nahi aaya')
  return 'Bata bhai tujhe kis type ki service chahiye? (Website, app, logo design, video editing ya marketing) Aur tera kitna budget hai?';
}

// ==================== BAILEYS WHATSAPP BOT ====================
let sock = null;

// Debounce & 10-second human delay queue per contact
const messageQueues = new Map();

function enqueueHumanReply(remoteJid, senderPhone, incomingText) {
  // If queue doesn't exist, create it
  if (!messageQueues.has(remoteJid)) {
    messageQueues.set(remoteJid, {
      texts: [],
      timer: null,
    });
  }

  const q = messageQueues.get(remoteJid);
  q.texts.push(incomingText);

  // Reset timer on new rapid messages so we accumulate user's thought
  if (q.timer) clearTimeout(q.timer);

  // Set 10-second human delay
  q.timer = setTimeout(async () => {
    try {
      const combinedText = q.texts.join(' ');
      messageQueues.delete(remoteJid);

      appendHistory(senderPhone, 'user', combinedText);
      console.log(`\n⏳ Simulating human typing presence for +${senderPhone}...`);

      // Start WhatsApp typing status (composing)
      if (sock) {
        await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
      }

      // Generate natural human reply
      const reply = await generateHumanReply(senderPhone, combinedText);

      // Natural typing wait of ~4-5 seconds so the other person sees "typing..."
      await new Promise(r => setTimeout(r, 4500));

      if (sock && reply) {
        await sock.sendMessage(remoteJid, { text: reply });
        await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
        appendHistory(senderPhone, 'assistant', reply);
        console.log(`💬 Sent Human Reply to +${senderPhone}: "${reply}"`);
        addLog('reply', `Replied to +${senderPhone}: "${reply}"`);
      }
    } catch (err) {
      console.error('Error in delayed human reply:', err.message);
      addLog('error', `Reply error: ${err.message}`);
    }
  }, 6000); // 6s debounce + 4.5s typing = ~10.5s total realistic human response time
}

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 Initializing WhatsApp Human Friend Bot (Baileys v${version.join('.')})...`);
  botState.status = 'connecting';

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 15000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.status = 'qr_ready';
      botState.qrRaw = qr;
      try {
        botState.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
        console.log('📱 QR Code ready. Also available via 8-digit Pairing Code.');
        addLog('info', 'QR Code & Pairing Code ready.');
      } catch (err) {
        console.error('QR Render Error:', err);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      botState.status = 'error';
      botState.qrDataUrl = null;
      console.log(`⚠️ Connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
      addLog('warn', `Connection closed. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 3000);
      } else {
        console.log('❌ Logged out. Clearing session and regenerating QR...');
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        setTimeout(startWhatsAppBot, 3000);
      }
    } else if (connection === 'open') {
      botState.status = 'connected';
      botState.qrDataUrl = null;
      botState.pairingCode = null;
      const userJid = sock.user.id;
      const userPhone = userJid.split(':')[0].replace(/\D/g, '');
      botState.connectedNumber = `+${userPhone}`;
      console.log(`\n✅ WhatsApp Human Friend Assistant Connected as +${userPhone}!\n`);
      addLog('success', `WhatsApp Connected as +${userPhone}`);
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

        botState.totalQueriesProcessed++;
        console.log(`\n========================================`);
        console.log(`📩 Incoming message from +${senderPhone}: "${text}"`);
        addLog('query', `From +${senderPhone}: "${text}"`);

        // Queue with realistic 10-second human delay + typing simulation
        enqueueHumanReply(remoteJid, senderPhone, text);

        console.log(`========================================`);
      } catch (err) {
        console.error('⚠️ Error processing incoming message:', err.message);
        addLog('error', `Process error: ${err.message}`);
      }
    }
  });
}

// ==================== EXPRESS WEB DASHBOARD ====================
const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    botStatus: botState.status,
    connectedAs: botState.connectedNumber,
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    ...botState,
    hasOpenrouterKey: !!appConfig.openrouterApiKey,
    openrouterModel: appConfig.openrouterModel || 'deepseek/deepseek-chat',
    hasGeminiKey: !!appConfig.geminiApiKey,
    hasOpenAiKey: !!appConfig.openaiApiKey,
    hasGroqKey: !!appConfig.groqApiKey,
  });
});

// Request 8-Digit Pairing Code (Phone Number based - No QR / camera needed)
app.post('/api/pair', async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    phone = phone.replace(/\D/g, '');
    if (!phone.startsWith('91') && phone.length === 10) {
      phone = '91' + phone;
    }
    if (!sock) {
      return res.status(500).json({ error: 'WhatsApp bot engine starting... please try again in 5 seconds.' });
    }
    if (botState.status === 'connected') {
      return res.json({ success: false, message: 'WhatsApp is already connected!' });
    }
    const code = await sock.requestPairingCode(phone);
    botState.pairingCode = code;
    console.log(`📱 Generated WhatsApp Pairing Code: ${code} for +${phone}`);
    addLog('info', `Pairing Code: ${code} generated for +${phone}`);
    res.json({ success: true, code, formattedPhone: `+${phone}` });
  } catch (err) {
    console.error('Error requesting pairing code:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

// Live Test Chat Endpoint
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });
  const reply = await generateHumanReply('web_tester', question);
  res.json({ success: true, answer: reply });
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Human Friend AI Assistant - WhatsApp Bot Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { background-color: #0b1329; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; }
    .badge-status { font-size: 0.9rem; padding: 6px 12px; }
    .pairing-box { background: #0f172a; border: 2px dashed #38bdf8; border-radius: 12px; }
    .code-display { font-size: 2.2rem; letter-spacing: 6px; font-weight: 800; color: #38bdf8; }
    .human-chat-box { background: #0f172a; border-radius: 10px; border: 1px solid #334155; }
  </style>
</head>
<body class="p-3 p-md-4">
  <div class="container" style="max-width: 950px;">
    <!-- Top Header -->
    <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom border-secondary">
      <div>
        <h3 class="fw-bold mb-0" style="color: #38bdf8;"><i class="fa-solid fa-user-group me-2"></i>Human Friend WhatsApp Assistant</h3>
        <p class="text-secondary small mb-0">100% Real Human Persona, 10s Typing Delay, Clean Text, Service & 5% Price Engine</p>
      </div>
      <div class="text-end">
        <span id="statusBadge" class="badge bg-secondary badge-status">Connecting...</span>
        <div class="text-success small mt-1 fw-bold"><i class="fa-solid fa-circle me-1" style="font-size: 8px;"></i>Human Persona Live</div>
      </div>
    </div>
    
    <!-- Status Metrics -->
    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Connected WhatsApp</div>
          <div id="connectedAs" class="fs-6 fw-bold text-light mt-1">Not Connected</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Messages Handled</div>
          <div id="queryCount" class="fs-6 fw-bold text-success mt-1">0</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Active Persona Mode</div>
          <div id="aiEngineStatus" class="fs-6 fw-bold text-info mt-1">Human Friend (~10s Delay)</div>
        </div>
      </div>
    </div>

    <!-- WhatsApp Connection Box (Both QR Scanner & Pairing Code visible together) -->
    <div class="card p-4 mb-4 border-warning" id="connectContainer">
      <h5 class="fw-bold text-warning mb-3"><i class="fa-brands fa-whatsapp me-2"></i>Connect WhatsApp (Scan QR or Use 8-Digit Code)</h5>
      
      <div class="row g-4 align-items-center">
        <!-- Side 1: Direct QR Code Scanner -->
        <div class="col-md-5 text-center border-end border-secondary">
          <h6 class="fw-bold text-light mb-2"><i class="fa-solid fa-qrcode me-1 text-warning"></i> 1. Scan QR Code</h6>
          <div class="text-secondary small mb-2">WhatsApp ➡️ Linked Devices se scan karein:</div>
          <div class="p-2 bg-dark rounded d-inline-block shadow">
            <div id="qrLoading" class="text-muted small py-4">Generating QR Code...</div>
            <img id="qrImg" src="" alt="WhatsApp QR" class="img-fluid rounded" style="max-width: 230px; display: none;">
          </div>
        </div>

        <!-- Side 2: Phone Pairing Code (Alternative) -->
        <div class="col-md-7">
          <h6 class="fw-bold text-light mb-2"><i class="fa-solid fa-mobile-screen-button me-1 text-info"></i> 2. Ya 8-Digit Code Se Connect Karein (Bina Scanner Ke)</h6>
          <p class="small text-secondary mb-2">
            Agar camera kaam nahi kar raha to apna mobile number daal kar code le lijiye:
          </p>
          <div class="input-group mb-2">
            <span class="input-group-text bg-dark text-secondary border-secondary">+91</span>
            <input type="text" id="phoneNumberInput" class="form-control bg-dark text-light border-secondary" placeholder="Enter 10-digit number (e.g. 8005844014)..." value="8005844014">
            <button class="btn btn-warning fw-bold text-dark" onclick="requestPairingCode()"><i class="fa-solid fa-key me-1"></i> Get Code</button>
          </div>
          
          <div id="pairingResultBox" style="display:none;" class="p-2 bg-dark rounded border border-warning text-center">
            <div class="text-secondary small">WhatsApp me ye code daalein:</div>
            <div id="pairingCodeDisplay" class="code-display my-1">--------</div>
            <div class="text-start small text-warning p-2 rounded bg-black bg-opacity-50">
              <strong>WhatsApp ➡️ Linked Devices ➡️ Link a Device ➡️ "Link with phone number instead"</strong> par tap karke ye code daalein.
            </div>
          </div>
          <div id="pairError" class="small text-danger mt-1" style="display:none;"></div>
        </div>
      </div>
    </div>

    <!-- Live Human Chat Simulator -->
    <div class="card p-4 mb-4 border-info">
      <h5 class="fw-bold text-info mb-2"><i class="fa-solid fa-comments me-2"></i>Test Human Friend Chat (Live Simulator)</h5>
      <p class="text-secondary small mb-3">Yahan test karein ki bot kitna natural human friend ki tarah reply deta hai (Bina symbols ke, 1-2 line, service inquiry & +5% price rate ke sath):</p>
      
      <div class="input-group mb-3">
        <input type="text" id="testMsgInput" class="form-control bg-dark text-light border-secondary" placeholder="Type a message (e.g. bhai kaisa hai? / website banwani thi / reliance ka kya scene hai)..." value="bhai website banwani thi kitna kharcha aayega">
        <button class="btn btn-info fw-bold text-dark" onclick="sendTestChat()"><i class="fa-solid fa-paper-plane me-1"></i> Send</button>
      </div>

      <div id="chatReplyBox" class="p-3 human-chat-box" style="display:none; font-size: 15px; line-height: 1.6;">
        <div class="text-secondary small mb-1">Human Reply:</div>
        <div id="chatReplyText" class="text-light fw-semibold"></div>
      </div>
    </div>

    <!-- OpenRouter & AI Key Settings -->
    <div class="card p-3 mb-4 border-primary">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-primary mb-0"><i class="fa-solid fa-key me-2"></i>OpenRouter AI Key Settings</h6>
        <a href="https://openrouter.ai/keys" target="_blank" class="btn btn-sm btn-outline-primary fw-bold">OpenRouter Keys</a>
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-7">
          <input type="password" id="openrouterKeyInput" class="form-control bg-dark text-light border-secondary" placeholder="Paste OpenRouter Key (sk-or-v1-...)...">
        </div>
        <div class="col-md-5">
          <select id="openrouterModelSelect" class="form-select bg-dark text-light border-secondary">
            <option value="deepseek/deepseek-chat">DeepSeek V3 (Recommended)</option>
            <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
            <option value="deepseek/deepseek-r1">DeepSeek R1</option>
            <option value="openai/gpt-4o-mini">OpenAI GPT-4o-mini</option>
          </select>
        </div>
      </div>
      <div class="d-flex justify-content-end">
        <button class="btn btn-primary fw-bold" onclick="saveOpenRouterKey()"><i class="fa-solid fa-floppy-disk me-1"></i> Save Key</button>
      </div>
      <div id="keyAlert" class="small mt-2" style="display:none;"></div>
    </div>

    <!-- Live Activity Logs -->
    <div class="card p-3">
      <h5 class="fw-bold text-light mb-3"><i class="fa-solid fa-clock-rotate-left me-2"></i>Live Activity Logs</h5>
      <div id="logsContainer" style="max-height: 250px; overflow-y: auto; font-family: monospace; font-size: 13px;">
        <div class="text-muted">Listening for incoming WhatsApp messages...</div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    async function updateStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const badge = document.getElementById('statusBadge');
        if (data.status === 'connected') {
          badge.className = 'badge bg-success badge-status';
          badge.innerHTML = '<i class="fa-solid fa-circle-check me-1"></i> Connected';
          document.getElementById('connectedAs').innerText = data.connectedNumber || 'Active';
          document.getElementById('connectContainer').style.display = 'none';
        } else if (data.status === 'qr_ready') {
          badge.className = 'badge bg-warning text-dark badge-status';
          badge.innerHTML = '<i class="fa-solid fa-qrcode me-1"></i> Ready to Connect';
          document.getElementById('connectContainer').style.display = 'block';
          if (data.qrDataUrl) {
            document.getElementById('qrImg').src = data.qrDataUrl;
            document.getElementById('qrImg').style.display = 'inline-block';
            document.getElementById('qrLoading').style.display = 'none';
          }
        }
        document.getElementById('queryCount').innerText = data.totalQueriesProcessed || 0;
        
        if (data.recentLogs && data.recentLogs.length > 0) {
          document.getElementById('logsContainer').innerHTML = data.recentLogs.map(function(l) {
            return '<div class="py-1 border-bottom border-secondary border-opacity-25"><span class="text-secondary">[' + l.time + ']</span> ' + l.text + '</div>';
          }).join('');
        }
      } catch {}
    }

    async function requestPairingCode() {
      const phoneInput = document.getElementById('phoneNumberInput').value.trim();
      const errBox = document.getElementById('pairError');
      const resBox = document.getElementById('pairingResultBox');
      const codeDisplay = document.getElementById('pairingCodeDisplay');
      
      if (!phoneInput) {
        errBox.style.display = 'block';
        errBox.innerText = 'Please enter phone number.';
        return;
      }

      errBox.style.display = 'none';
      codeDisplay.innerText = 'FETCHING...';
      resBox.style.display = 'block';

      try {
        const res = await fetch('/api/pair', {
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
      replyEl.innerText = 'Typing... (thinking naturally)';
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
      if (!key) {
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-danger';
        alertBox.innerText = 'Please paste a valid key.';
        return;
      }
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openrouterApiKey: key, openrouterModel: model })
        });
        const d = await res.json();
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-success';
        alertBox.innerText = '✅ Key saved successfully!';
        updateStatus();
      } catch (e) {
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-danger';
        alertBox.innerText = 'Error: ' + e.message;
      }
    }

    setInterval(updateStatus, 3000);
    updateStatus();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`
======================================================
🌐 Human Friend AI WhatsApp Bot: http://localhost:${PORT}
⚡ 100% Real Human Persona, ~10s Delay, Service & +5% Price Engine
======================================================
`);
  startWhatsAppBot();
});
