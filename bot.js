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

// Leads Storage (Captured names, numbers & confirmed deals)
const LEADS_FILE = path.join(__dirname, 'leads.json');
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
    console.log(`📋 Lead Saved/Updated: ${leadData.name || 'Client'} (${p})`);
    addLog('lead', `Lead captured: ${leadData.name || 'Client'} (${p})`);
  } catch (err) {
    console.error('Error saving lead:', err.message);
  }
}

// Calendar Events Storage (Meetings, Classes, Gym, Appointments)
const CALENDAR_FILE = path.join(__dirname, 'calendar_events.json');
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
    console.log(`📅 Calendar Event Saved: "${newEvent.title}" (${newEvent.timing}) from +${newEvent.senderPhone}`);
    addLog('calendar', `Scheduled: ${newEvent.title} (${newEvent.timing})`);
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
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // remove reasoning tags
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
      content: `You are a polite, professional, and intelligent Website Consultant and Client Advisor chatting 1-on-1 on WhatsApp.

CRITICAL INSTRUCTIONS:
1. PROFESSIONAL & POLITE TONE:
   - Talk respectfully, warmly, and professionally (use polite Hindi/Hinglish like 'aap', 'ji', 'kaise hain aap', friendly yet business-professional).
   - Do NOT use cheap slang (avoid 'bolo kya scene hai', 'kya cheez ki zaroorat hai', aggressive questions).
   - Talk like an experienced, thoughtful web consultant who genuinely listens.

2. GRADUAL CONVERSATION FLOW (NO AGGRESSIVE DUMPS):
   - When user sends a greeting like 'Hi', 'Hello', 'Hey', 'Namaste':
     Reply smoothly, warmly, and politely:
     'Hello ji! Kaise hain aap? Kahiye, website ke regarding kya inquiry thi aapki?' or 'Hello! Kaise hain aap? Boliye, kaise help kar sakta hu aapki?'
   - Do NOT immediately dump pricing or bombard them with questions in the first greeting. Start the conversation gradually and naturally.

3. THINK & ANALYZE DEEPLY:
   - Carefully read and analyze the user's actual message, context, and intent.
   - Do NOT copy-paste rigid templates or dump pre-written scripts.
   - Flow the conversation strictly according to what the client is saying.

4. EXCLUSIVE FOCUS - ONLY WEBSITE DEVELOPMENT SERVICES:
   - We sell ONLY Website Services. DO NOT mention or sell apps, logo design, video editing, social media ads, gym, classes or any other service.
   - What Website Services We Provide:
     * Business & Corporate Websites (company profile, services, about, contact)
     * E-Commerce Stores (Online shop, product catalog, cart, payments)
     * Portfolio & Personal Websites (doctors, advocates, creators, consultants)
     * Landing Pages & Lead Generation Websites
     * Key Features: Modern clean UI design, 100% mobile-friendly on all devices, fast loading, WhatsApp chat & call button, contact inquiry form, domain & hosting guidance.
   - If asked what services you provide: Explain that we specialize exclusively in professional Website Development (Business websites, E-commerce stores, Portfolios, Landing pages) and ask what type of website they are planning.

5. WEBSITE PRICING:
   - Website starting price starts from 5,250 (Basic professional website starts from 5,250 to 15,000; dynamic / e-commerce websites start 15,000 to 26,250 depending on requirements).
   - Explain politely that starting is 5,250 and ask what kind of website they have in mind.
   - If user has a lower budget (e.g. 2000-3000):
     Politely explain that custom development starts at 5,250, but we can offer a basic starter website option within their budget.

6. ADVANCE PAYMENT & BOOKING:
   - When client confirms or wants to start the website project:
     * 20% to 50% advance payment is required to start the work.
     * Online payment number: 9785260088 (available on GPay, PhonePe, Paytm, UPI).
     * Ask them to share the payment screenshot on WhatsApp so work begins immediately.

7. CALL CONFIRMATION & BOSS VERIFICATION:
   - When user confirms the service or says they want to talk on call:
     * Ask for their Name and Contact Number so the boss can verify.
     * Tell them they can call on 9785260088 for confirmation.

8. FORMATTING & CLEAN TEXT:
   - Absolutely NO asterisks (*bold*), NO bullet points (- ), NO numbering (1. 2.), NO hashtags, and NO robot emojis spam.
   - Pure, clean, professional plain text (2 to 3 sentences max) just like texting on WhatsApp.`,
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
            'X-Title': 'WhatsApp Professional Website Advisor',
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
  const lower = userMessage.toLowerCase().trim();

  // Greetings check (Gradual, polite, professional start)
  if (/^(hi|hello|hey|hlo|helo|hy|namaste)\b/i.test(lower) || lower === 'hi' || lower === 'hello') {
    return 'Hello ji! Kaise hain aap? Kahiye, website ke regarding kya inquiry thi aapki?';
  }

  // Catalog / "Kya kya hai aapke pass" / Services check
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
    return 'Hum exclusively professional Website Development services provide karte hain ji, jaise Business websites, E-commerce stores, Portfolio aur Landing pages. Aapko kis type ki website banwani hai?';
  }

  // Confirmation if user says haan/yes/ha
  if (/^(ha|haan|haa|yes|yep|sahi|wahi|ha bhai|haan bhai|bilkul|ji haan|ji)$/i.test(lower)) {
    return 'Ji bilkul, aap apne business ya website ki requirements thoda share karenge to main aapko best structure aur details suggest kar sakta hu.';
  }

  // Service Done / Final Deal & Boss Verification check
  if (
    lower.includes('service done') ||
    lower.includes('done hai') ||
    lower.includes('deal done') ||
    lower.includes('deal pakki') ||
    lower.includes('final hai') ||
    lower.includes('final kar do') ||
    lower.includes('final kr do') ||
    lower.includes('start kar do') ||
    lower.includes('shuru kar do') ||
    lower.includes('kar do') ||
    lower.includes('advance bhej raha') ||
    lower.includes('advance bhej diya')
  ) {
    return 'Deal done ji! Ek baar apna Name aur Contact Number yahan share kar dijiye taaki mere boss verify kar sakein. Aur agar aap call karke confirm karna chahte hain to is number par call kar sakte hain: 9785260088 (pehle name aur number yahan de dijiyega taaki boss verify kar sakein). Kaam shuru karne ke liye 20% se 50% advance payment 9785260088 par send karke screenshot share kar dijiye.';
  }

  // Call Confirmation check
  if (
    lower.includes('call karke') ||
    lower.includes('call karna') ||
    lower.includes('call pe') ||
    lower.includes('phone pe baat') ||
    lower.includes('calling') ||
    lower.includes('call confirm')
  ) {
    return 'Ji bilkul, aap 9785260088 par call karke confirm kar sakte hain. Bas pehle apna Name aur Contact Number yahan share kar dijiye taaki mere boss verify kar sakein.';
  }

  // Customer sharing Name or Contact Number check
  if (
    /\b[6-9]\d{9}\b/.test(lower) ||
    lower.includes('mera naam') ||
    lower.includes('naam mera') ||
    lower.includes('my name is') ||
    lower.includes('number hai')
  ) {
    return 'Thank you ji, aapka name aur contact number note kar liya hai! Mere boss verify karke aapse jald hi connect karenge. Confirmation ke liye aap 9785260088 par call bhi kar sakte hain.';
  }

  // Advance Payment & Service Booking check
  if (
    lower.includes('payment') ||
    lower.includes('pay') ||
    lower.includes('advance') ||
    lower.includes('shuru kar') ||
    lower.includes('start kar') ||
    lower.includes('service leni') ||
    lower.includes('service lena') ||
    lower.includes('kaam shuru') ||
    lower.includes('kab shuru') ||
    lower.includes('deal') ||
    lower.includes('final') ||
    lower.includes('karwana hai') ||
    lower.includes('banwana hai payment') ||
    lower.includes('account') ||
    lower.includes('upi') ||
    lower.includes('gpay') ||
    lower.includes('phonepe') ||
    lower.includes('paytm') ||
    lower.includes('scanner') ||
    lower.includes('qr')
  ) {
    return 'Website ka kaam start karne ke liye 20% se 50% advance payment required hota hai ji. Online payment ke liye number hai 9785260088 (GPay, PhonePe, Paytm, UPI). Payment karke screenshot share kar dijiye, hum turant work initiate kar denge.';
  }

  // Website details / features check
  if (
    lower.includes('website details') ||
    lower.includes('kya kya milega') ||
    lower.includes('features') ||
    lower.includes('kya features') ||
    lower.includes('website me kya')
  ) {
    return 'Hamari websites 100% mobile responsive aur fast loading hoti hain, modern UI design, WhatsApp chat button, call now button, direct contact form aur complete domain-hosting setup ke saath milti hain. Aapko kis type ki website chahiye?';
  }

  // Low budget negotiation check
  if (lower.includes('budget') || lower.includes('kam') || /\b(500|1000|1500|2000|2500|3000|4000)\b/.test(lower)) {
    return 'Hamari professional custom website ka starting price 5,250 se shuru hota hai ji. Lekin agar aapka budget limited hai, to hum aapke liye ek basic starter website customize kar sakte hain. Aapka estimated budget kitna hai?';
  }

  // Pricing check
  if (
    lower.includes('price') ||
    lower.includes('rate') ||
    lower.includes('cost') ||
    lower.includes('charge') ||
    lower.includes('charges') ||
    lower.includes('kitna lagega') ||
    lower.includes('kitne me') ||
    lower.includes('starting')
  ) {
    return 'Website development ka starting price 5,250 se hota hai ji. Basic professional website 5,250 se 15,000 tak aur dynamic ya e-commerce websites 15,000 se 26,250 tak hoti hain. Aapko kis tarah ki website banwani hai?';
  }

  if (lower.includes('website') || lower.includes('web')) {
    return 'Hamare yahan custom business websites, e-commerce stores, portfolio aur landing pages develop kiye jate hain, starting from 5,250. Aap apne business ke baare me batayein, kaisi website plan kar rahe hain aap?';
  }

  if (lower.includes('kaisa hai') || lower.includes('kya haal')) {
    return 'Main badhiya hu ji, aap suniye kaise hain? Website ke regarding kaise help kar sakta hu aapki?';
  }

  // Default proactive helpful response (NEVER says 'samajh nahi aaya')
  return 'Hello ji! Hum exclusively professional Website Development services provide karte hain, starting from 5,250. Kahiye, aapko kis type ki website banwani hai?';
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

      // Check and save lead if they provided contact info or confirmed service
      const phoneMatch = combinedText.match(/\b([6-9]\d{9})\b/);
      const nameMatch = combinedText.match(/(?:naam|name)\s*(?:hai|is)?\s*([a-zA-Z\s]{2,25})/i);
      const isConfirmed = /(service done|done hai|final|deal|advance|kar do|bana do)/i.test(combinedText);

      if (phoneMatch || nameMatch || isConfirmed) {
        saveLead({
          name: nameMatch ? nameMatch[1].trim() : '',
          phone: phoneMatch ? phoneMatch[1] : senderPhone,
          senderPhone: senderPhone,
          status: isConfirmed ? 'Service Confirmed / Waiting Boss Verification' : 'Lead Inquired',
          notes: combinedText,
        });
      }

      // Check and save calendar event if meeting, class, gym, etc. is mentioned
      const eventKeywords = /(meeting|class|gym|workout|appointment|interview|call schedule|zoom|tuition|tution|doctor)/i;
      if (eventKeywords.test(combinedText)) {
        const typeMatch = combinedText.match(eventKeywords);
        const eventType = typeMatch ? typeMatch[1].toUpperCase() : 'MEETING';
        saveCalendarEvent({
          title: `${eventType} with +${senderPhone}`,
          type: eventType,
          timing: combinedText,
          senderPhone: senderPhone,
          notes: combinedText,
        });
      }

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

app.get('/api/leads', (req, res) => {
  res.json({
    total: leads.length,
    leads,
  });
});

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

    <!-- WhatsApp Calendar & Scheduled Events (Classes, Meetings, Gym) -->
    <div class="card p-3 mb-4 border-success">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-success mb-0"><i class="fa-solid fa-calendar-days me-2"></i>WhatsApp Scheduled Events (Classes, Meetings, Gym)</h6>
        <div>
          <a id="gcalSyncBtn" href="#" target="_blank" class="btn btn-sm btn-success fw-bold me-1"><i class="fa-brands fa-google me-1"></i> Sync Google Calendar</a>
          <button class="btn btn-sm btn-outline-light" onclick="copyIcsLink()"><i class="fa-solid fa-link me-1"></i> Copy iCal Link</button>
        </div>
      </div>
      <p class="text-secondary small mb-2">
        WhatsApp par aane wale sabhi meetings, classes aur gym schedules yahan note hote hain aur Google Calendar me 1-click se sync ho jaate hain.
      </p>
      <div id="eventsContainer" class="p-2 bg-dark rounded border border-secondary" style="max-height: 180px; overflow-y: auto;">
        <div class="text-muted small">No scheduled events yet. Messages mentioning meetings, classes, or gym will appear here.</div>
      </div>
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

    async function loadCalendarEvents() {
      try {
        const res = await fetch('/api/calendar');
        const data = await res.json();
        const gcalBtn = document.getElementById('gcalSyncBtn');
        if (gcalBtn && data.googleCalendarSubscribeUrl) {
          gcalBtn.href = data.googleCalendarSubscribeUrl;
        }
        window.currentIcsUrl = data.syncLink;
        const box = document.getElementById('eventsContainer');
        if (data.events && data.events.length > 0) {
          box.innerHTML = data.events.map(function(e) {
            return '<div class="d-flex justify-content-between align-items-center py-2 border-bottom border-secondary border-opacity-25">' +
              '<div><span class="badge bg-primary me-2">' + (e.type || 'EVENT') + '</span>' +
              '<strong class="text-light">' + e.title + '</strong>' +
              '<div class="small text-secondary">' + (e.timing || e.notes || '') + '</div></div>' +
              '<div><a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.title) + '&details=' + encodeURIComponent(e.timing || e.notes || '') + '" target="_blank" class="btn btn-sm btn-outline-success"><i class="fa-brands fa-google me-1"></i> Add to Calendar</a></div>' +
              '</div>';
          }).join('');
        }
      } catch {}
    }

    function copyIcsLink() {
      const url = window.currentIcsUrl || (window.location.origin + '/calendar.ics');
      navigator.clipboard.writeText(url).then(function() {
        alert('Copied Calendar iCal Link!\n\nTo connect Google Calendar on phone/PC:\n1. Open Google Calendar (calendar.google.com)\n2. Other Calendars (+) -> "From URL"\n3. Paste this link and save!');
      });
    }

    setInterval(updateStatus, 3000);
    updateStatus();
    setInterval(loadCalendarEvents, 5000);
    loadCalendarEvents();
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
