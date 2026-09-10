/**
 * OpenWA Smart Name-Capture & Lead Forwarder Bot
 * 1. Jab koi naya person message karega -> Bot usse uska Naam (Name) poochhega.
 * 2. Jaise hi vo apna Naam batayega -> Uski puri detail (Naam, Phone No, Message) turant 8005844014 par forward ho jayegi.
 * 3. Aage ke sare messages bhi uske naam ke sath aapko aate rahenge.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== CONFIGURATION ====================
// Destination Phone Number (Aapka number jahan sabhi logo ki details aayengi)
const TARGET_PHONE = '918005844014@c.us'; // 8005844014

// OpenWA API Settings
const OPENWA_API_URL = 'http://localhost:2785';
const OPENWA_API_KEY = 'owa_k1_930acb556bf7389edc17aaaf28e502b71e995d0c976322ab7ce8b44617b14aa2';
const PORT = 3000;

// Contacts memory file (taaki server restart hone par bhi naam yaad rahe)
const DB_FILE = path.join(__dirname, 'contacts_memory.json');
let userStates = {};
if (fs.existsSync(DB_FILE)) {
  try {
    userStates = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {}
}

function saveStates() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(userStates, null, 2), 'utf8');
  } catch {}
}
// =======================================================

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));

      try {
        if (!body) return;
        const data = JSON.parse(body);
        const event = data.event;
        const payload = data.payload || data.data || data;
        const sessionId = data.sessionId || 'default';

        if (event === 'message.received' || (!event && (payload.body || payload.text))) {
          const from = (payload.from || payload.sender || '');
          const isGroup = from.includes('@g.us') || payload.isGroup === true;
          const text = (payload.body || payload.text || payload.caption || '').trim();
          const isFromMe = payload.fromMe === true;
          const senderPhone = (payload.author || payload.senderPhone || payload.phone || from).replace(/\D/g, '');
          const pushName = payload.notifyName || payload.pushname || '';

          // Ignore self messages, groups, status broadcasts, or empty text
          if (isFromMe || isGroup || from.includes('@broadcast') || !text || !from) {
            return;
          }

          // Don't auto-reply if target number itself messages
          if (from.includes('8005844014')) {
            return;
          }

          console.log(`\n📩 Incoming Message from +${senderPhone}: "${text}"`);

          const userKey = from.replace('@s.whatsapp.net', '@c.us');
          const timeString = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

          // State 1: Pehli baar message aaya hai (New User)
          if (!userStates[userKey] || userStates[userKey].stage === 'new') {
            userStates[userKey] = {
              stage: 'asked_name',
              firstMsg: text,
              phone: senderPhone,
              time: timeString,
            };
            saveStates();

            console.log(`🤖 Asking name from +${senderPhone}...`);

            // Saamne wale ko auto-reply karke uska naam poochhein
            await sendMessage(sessionId, userKey, `Namaste! 🙏\nKripya apna shubh *Naam (Name)* batayein?`);

            // Aapke number (8005844014) par notification bhejein
            const initialAlert = `🔔 *Naya WhatsApp Message Aaya!*\n📱 *Number:* +${senderPhone}\n💬 *Message:* ${text}\n⏰ *Time:* ${timeString}\n⏳ *Status:* Naam poochha gaya hai...`;
            await sendMessage(sessionId, TARGET_PHONE, initialAlert);
          }
          // State 2: Saamne wale ne apna Naam reply kiya hai
          else if (userStates[userKey].stage === 'asked_name') {
            const userName = text;
            userStates[userKey].name = userName;
            userStates[userKey].stage = 'registered';
            saveStates();

            console.log(`👤 User +${senderPhone} provided Name: "${userName}"`);

            // Saamne wale ko confirmation reply bhejein
            await sendMessage(
              sessionId,
              userKey,
              `Dhanyawad *${userName}* ji! 🙏\nAapka message hum tak pahunch gaya hai, hum jald hi aapse baat karenge.`
            );

            // Aapke number (8005844014) par complete details forward karein
            const leadAlert = `✅ *Nayi Contact Details Mil Gayi!*\n\n👤 *Naam:* ${userName}\n📱 *Phone:* +${senderPhone}\n💬 *First Message:* ${userStates[userKey].firstMsg}\n⏰ *Time:* ${timeString}`;
            await sendMessage(sessionId, TARGET_PHONE, leadAlert);
            console.log(`🚀 Details sent to ${TARGET_PHONE}`);
          }
          // State 3: User pehle se registered hai aur aage ka message bhej raha hai
          else if (userStates[userKey].stage === 'registered') {
            const userName = userStates[userKey].name || pushName || senderPhone;
            const followUpAlert = `💬 *Message from ${userName}* (+${senderPhone}):\n${text}`;
            await sendMessage(sessionId, TARGET_PHONE, followUpAlert);
            console.log(`🚀 Follow-up message from ${userName} forwarded to ${TARGET_PHONE}`);
          }
        }
      } catch (err) {
        console.error('⚠️ Error processing webhook event:', err.message);
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

async function sendMessage(sessionId, chatId, messageText) {
  let activeSessionId = sessionId;
  if (!activeSessionId || activeSessionId === 'default') {
    try {
      const sRes = await fetch(`${OPENWA_API_URL}/api/sessions`, {
        headers: { 'X-Api-Key': OPENWA_API_KEY },
      });
      if (sRes.ok) {
        const sessions = await sRes.json();
        const active = sessions.find(s => s.status === 'ready' || s.status === 'authenticated');
        if (active) activeSessionId = active.id;
      }
    } catch {}
  }

  const url = `${OPENWA_API_URL}/api/sessions/${activeSessionId}/messages/send-text`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': OPENWA_API_KEY,
      },
      body: JSON.stringify({
        chatId: chatId,
        text: messageText,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`❌ Send failed to ${chatId}:`, err);
    }
  } catch (err) {
    console.error(`❌ Network error sending to ${chatId}:`, err.message);
  }
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🤖 OpenWA Smart Name-Capture & Lead Bot is ACTIVE`);
  console.log(`📍 Webhook:           http://localhost:${PORT}/webhook`);
  console.log(`📤 Destination Phone: ${TARGET_PHONE}`);
  console.log(`======================================================\n`);
});
