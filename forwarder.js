/**
 * OpenWA Exact 1-to-1 Chat Forwarder
 * Source Number (9785060088) se aane wale kisi bhi message ko
 * Destination Number (8005844014) par exact "SAME TO SAME" direct send karega.
 */

const http = require('http');

// ==================== CONFIGURATION ====================
// 1. Source Phone (Jiske messages forward karne hain)
const SOURCE_PHONE = '9785060088'; // 9785060088

// 2. Destination Phone (Jahan exact same message send karna hai)
const TARGET_PHONE = '918005844014@c.us'; // 8005844014

// 3. OpenWA Server settings
const OPENWA_API_URL = 'http://localhost:2785';
const OPENWA_API_KEY = 'owa_k1_930acb556bf7389edc17aaaf28e502b71e995d0c976322ab7ce8b44617b14aa2';
const PORT = 3000;
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
          const senderPhone = (payload.author || payload.senderPhone || payload.phone || from).replace(/\D/g, '');
          const text = payload.body || payload.text || payload.caption || '';
          const isFromMe = payload.fromMe === true;

          // Apne khud ke messages ko ignore karein
          if (isFromMe || !text) {
            return;
          }

          // Check if message is from the specific SOURCE_PHONE (9785060088)
          const isFromSource = from.includes(SOURCE_PHONE) || senderPhone.includes(SOURCE_PHONE);

          if (!isFromSource) {
            return;
          }

          console.log(`\n========================================`);
          console.log(`📩 Message from 9785060088: "${text}"`);
          console.log(`🚀 Sending same to same to ${TARGET_PHONE}...`);
          console.log(`========================================`);

          // Exact same to same message text bina kisi extra detail ke forward karein
          await sendDirectMessage(sessionId, text);
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

async function sendDirectMessage(sessionId, messageText) {
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
        chatId: TARGET_PHONE,
        text: messageText, // Same to same direct text
      }),
    });

    if (response.ok) {
      console.log(`✅ Same to same message sent successfully to ${TARGET_PHONE}`);
    } else {
      const err = await response.text();
      console.error(`❌ Send failed:`, err);
    }
  } catch (err) {
    console.error(`❌ Network error:`, err.message);
  }
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 OpenWA Same-to-Same Forwarder Active on port ${PORT}`);
  console.log(`📥 Source Phone:      9785060088 (Sirf iske messages)`);
  console.log(`📤 Destination Phone: 8005844014 (Same to Same Receive hoga)`);
  console.log(`⚡ Mode:              EXACT SAME-TO-SAME COPY`);
  console.log(`======================================================\n`);
});
