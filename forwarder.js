/**
 * OpenWA Group Filter Forwarder
 * WhatsApp Group "fii dii data" ke sabhi incoming messages ko
 * Destination Number (8005844014) par direct forward karega.
 */

const http = require('http');

// ==================== CONFIGURATION ====================
// 1. Group Name Filter (Sirf is group ke messages forward honge)
const TARGET_GROUP_NAME = 'fii dii data'; 

// 2. Destination Target Number (Jahan messages receive honge)
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
          const isGroup = from.includes('@g.us') || payload.isGroup === true;
          const text = payload.body || payload.text || '';
          const isFromMe = payload.fromMe === true;
          const senderPhone = (payload.author || payload.senderPhone || payload.phone || from).replace(/\D/g, '');
          const groupName = payload.chatName || payload.groupName || payload.name || '';
          const senderName = payload.notifyName || payload.pushname || senderPhone;

          // Apne khud ke messages ya loop ko ignore karein
          if (isFromMe || from.includes('8005844014') || !text) {
            return;
          }

          // Check if message is from the group "fii dii data"
          const normalizedTargetGroup = TARGET_GROUP_NAME.toLowerCase().trim();
          const normalizedGroupName = groupName.toLowerCase().trim();
          
          const isTargetGroup = isGroup && (
            normalizedGroupName.includes(normalizedTargetGroup) || 
            from.includes(normalizedTargetGroup)
          );

          if (!isTargetGroup) {
            return;
          }

          console.log(`\n========================================`);
          console.log(`📩 Group [${groupName || TARGET_GROUP_NAME}] - New Message:`);
          console.log(`👤 Sender: ${senderName}`);
          console.log(`💬 Text: ${text}`);
          console.log(`========================================`);

          // Forward message format (Group Name + Sender + Message Text)
          const forwardMessageText = `📊 *[${groupName || TARGET_GROUP_NAME}]*\n👤 *${senderName}:*\n\n${text}`;

          await sendDirectMessage(sessionId, forwardMessageText);
        }
      } catch (err) {
        console.error('⚠️ Error processing group message:', err.message);
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
        text: messageText,
      }),
    });

    if (response.ok) {
      console.log(`✅ Group message forwarded to ${TARGET_PHONE}`);
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
  console.log(`🚀 OpenWA Group Forwarder Active on port ${PORT}`);
  console.log(`👥 Target Group:      "fii dii data"`);
  console.log(`📤 Destination Phone: 8005844014`);
  console.log(`======================================================\n`);
});
