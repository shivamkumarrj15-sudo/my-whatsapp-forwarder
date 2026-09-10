/**
 * OpenWA Smart Name-Capture & Auto "Ok" Reply + Deduplicated Forwarder Bot
 * 1. Naye user se uska Naam poochhega.
 * 2. Naam milne par details 8005844014 par forward karega.
 * 3. Uske HAR agle message par "Ok" reply karega aur wahi message aapko (8005844014) forward karega.
 * 4. Deduplication: Ek message ko 2 baar process hone se rokega.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== CONFIGURATION ====================
// Destination Target Number (Aapka number jahan sabhi messages aayenge)
const TARGET_PHONE = '918005844014@c.us'; // 8005844014

// OpenWA Server settings
const OPENWA_API_URL = 'http://localhost:2785';
const OPENWA_API_KEY = 'owa_k1_930acb556bf7389edc17aaaf28e502b71e995d0c976322ab7ce8b44617b14aa2';
const PORT = 3000;

// Contacts memory file (taaki naam hamesha yaad rahein)
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

// Recent processed messages set to prevent duplicate handling
const processedMessages = new Set();
function isDuplicate(msgId, text, from) {
  const key = msgId || `${from}_${text}`;
  if (processedMessages.has(key)) return true;
  processedMessages.add(key);
  setTimeout(() => processedMessages.delete(key), 10000); // clear after 10s
  return false;
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
          const msgId = payload.id || payload.messageId || '';
          const isGroup = from.includes('@g.us') || payload.isGroup === true;
          const text = (payload.body || payload.text || payload.caption || '').trim();
          const isFromMe = payload.fromMe === true;
          const senderPhone = (payload.author || payload.senderPhone || payload.phone || from).replace(/\D/g, '');
          const pushName = payload.notifyName || payload.pushname || '';

          // Self messages, groups, channels/newsletters, status broadcasts, or empty text ignore karein
          if (isFromMe || isGroup || from.includes('@broadcast') || from.includes('@newsletter') || !text || !from) {
            return;
          }

          // Target number khud message kare toh bot reply na kare
          if (from.includes('8005844014')) {
            return;
          }

          // Duplicate event check (webhook multiple time fire hone par bhi 1 hi baar chalega)
          if (isDuplicate(msgId, text, from)) {
            return;
          }

          console.log(`\n========================================`);
          console.log(`📩 Message from +${senderPhone}: "${text}"`);

          const userKey = from.replace('@s.whatsapp.net', '@c.us');
          const timeString = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

          // Step 1: Naya User (Pehli baar aaya) -> Naam poochhein
          if (!userStates[userKey] || userStates[userKey].stage === 'new') {
            userStates[userKey] = {
              stage: 'asked_name',
              firstMsg: text,
              phone: senderPhone,
              time: timeString,
            };
            saveStates();

            console.log(`🤖 Asking name from +${senderPhone}...`);

            // Saamne wale ko auto-reply
            await sendMessage(sessionId, userKey, `Namaste! 🙏\nKripya apna shubh *Naam (Name)* batayein?`);

            // Aapke number (8005844014) par alert
            const initialAlert = `🔔 *Naya WhatsApp Message Aaya!*\n📱 *Number:* +${senderPhone}\n💬 *Message:* ${text}\n⏰ *Time:* ${timeString}\n⏳ *Status:* Naam poochha gaya hai...`;
            await sendMessage(sessionId, TARGET_PHONE, initialAlert);
          }
          // Step 2: Saamne wale ne apna Naam bataya
          else if (userStates[userKey].stage === 'asked_name') {
            const userName = text;
            userStates[userKey].name = userName;
            userStates[userKey].stage = 'registered';
            saveStates();

            console.log(`👤 Name saved: "${userName}" (+${senderPhone})`);

            // Saamne wale ko "Ok" reply
            await sendMessage(sessionId, userKey, `Ok`);

            // Aapke number par complete lead forward karein
            const leadAlert = `✅ *Nayi Contact Detail Mil Gayi!*\n\n👤 *Naam:* ${userName}\n📱 *Phone:* +${senderPhone}\n💬 *First Message:* ${userStates[userKey].firstMsg}\n⏰ *Time:* ${timeString}`;
            await sendMessage(sessionId, TARGET_PHONE, leadAlert);
            console.log(`🚀 Details sent to ${TARGET_PHONE}`);
          }
          // Step 3: Saamne wale ka HAR agla message -> Use "Ok" reply karein aur aapko forward karein
          else if (userStates[userKey].stage === 'registered') {
            const userName = userStates[userKey].name || pushName || senderPhone;

            // 1. Saamne wale ko har message par "Ok" bhejega
            await sendMessage(sessionId, userKey, `Ok`);
            console.log(`🤖 Sent "Ok" to ${userName}`);

            // 2. Aapke number par message forward karein
            const followUpAlert = `💬 *Message from ${userName}* (+${senderPhone}):\n${text}`;
            await sendMessage(sessionId, TARGET_PHONE, followUpAlert);
            console.log(`🚀 Forwarded message to ${TARGET_PHONE}`);
          }
          console.log(`========================================`);
        }
      } catch (err) {
        console.error('⚠️ Error processing message:', err.message);
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
  console.log(`🤖 OpenWA Smart Bot: Ask Name -> Auto "Ok" Reply -> Forward to 8005844014`);
  console.log(`📍 Webhook:           http://localhost:${PORT}/webhook`);
  console.log(`📤 Destination Phone: ${TARGET_PHONE}`);
  console.log(`======================================================\n`);
});
