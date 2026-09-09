/**
 * OpenWA Auto-Forwarder Script
 * Automatically forwards incoming WhatsApp messages to your target phone number: 918005844014@c.us
 */

const http = require('http');

// ==================== CONFIGURATION ====================
const YOUR_TARGET_PHONE = '918005844014@c.us'; // Target phone number
const OPENWA_API_URL = 'http://localhost:2785';
const OPENWA_API_KEY = 'owa_k1_930acb556bf7389edc17aaaf28e502b71e995d0c976322ab7ce8b44617b14aa2';
const PORT = 3000;
const WEBHOOK_URL = `http://localhost:${PORT}/webhook`;
// =======================================================

// HTTP Webhook Receiver
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

        // Check if event is an incoming message
        if (event === 'message.received' || (!event && (payload.body || payload.text))) {
          const from = payload.from || payload.sender || '';
          const text = payload.body || payload.text || '';
          const isFromMe = payload.fromMe === true;
          const senderName = payload.notifyName || payload.pushname || from.replace('@c.us', '').replace('@s.whatsapp.net', '');
          const isGroup = from.includes('@g.us');
          const messageType = payload.type || 'text';

          // Ignore self-sent messages, status broadcasts, or loops
          if (isFromMe || from.includes('@broadcast') || !from) {
            return;
          }

          // Format incoming alert message
          const timeString = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
          let forwardText = `🔔 *New WhatsApp Message*\n`;
          forwardText += `👤 *From:* ${senderName} (+${from.replace('@c.us', '').replace('@s.whatsapp.net', '')})\n`;
          if (isGroup) {
            forwardText += `👥 *Group:* ${payload.chatName || from}\n`;
          }
          forwardText += `⏰ *Time:* ${timeString}\n`;
          if (messageType !== 'chat' && messageType !== 'text') {
            forwardText += `📎 *Attachment Type:* ${messageType}\n`;
          }
          forwardText += `💬 *Message:*\n${text || '[Media / Non-text Content]'}`;

          console.log(`\n========================================`);
          console.log(`📩 Incoming Message Received:`);
          console.log(`👤 From: ${senderName} (${from})`);
          console.log(`💬 Text: ${text || `[${messageType}]`}`);
          console.log(`========================================`);

          await forwardMessage(sessionId, forwardText);
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

async function forwardMessage(sessionId, messageText) {
  // Use session ID from webhook or fetch active session
  const targetSession = sessionId || 'default';
  const url = `${OPENWA_API_URL}/api/sessions/${targetSession}/messages/send-text`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': OPENWA_API_KEY,
      },
      body: JSON.stringify({
        chatId: YOUR_TARGET_PHONE,
        text: messageText,
      }),
    });

    if (response.ok) {
      console.log(`✅ Forwarded successfully to ${YOUR_TARGET_PHONE}`);
    } else {
      const errText = await response.text();
      console.error(`❌ Forward failed (Status ${response.status}):`, errText);
    }
  } catch (err) {
    console.error(`❌ Network error while forwarding:`, err.message);
  }
}

// Auto-register webhook on OpenWA if not registered
async function autoRegisterWebhook() {
  try {
    const sessionsRes = await fetch(`${OPENWA_API_URL}/api/sessions`, {
      headers: { 'X-Api-Key': OPENWA_API_KEY },
    });

    if (!sessionsRes.ok) return;
    const sessions = await sessionsRes.json();

    for (const session of sessions) {
      const sessionId = session.id || session.name;
      // Fetch existing webhooks
      const whRes = await fetch(`${OPENWA_API_URL}/api/sessions/${sessionId}/webhooks`, {
        headers: { 'X-Api-Key': OPENWA_API_KEY },
      });

      const existing = whRes.ok ? await whRes.json() : [];
      const alreadyRegistered = Array.isArray(existing) && existing.some(w => w.url === WEBHOOK_URL);

      if (!alreadyRegistered) {
        const createRes = await fetch(`${OPENWA_API_URL}/api/sessions/${sessionId}/webhooks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': OPENWA_API_KEY,
          },
          body: JSON.stringify({
            url: WEBHOOK_URL,
            events: ['message.received'],
          }),
        });

        if (createRes.ok) {
          console.log(`🔗 Webhook auto-registered for session: ${session.name || sessionId}`);
        }
      } else {
        console.log(`🔗 Webhook already active for session: ${session.name || sessionId}`);
      }
    }
  } catch (e) {
    console.warn(`⚠️ Could not auto-register webhook: ${e.message}`);
  }
}

server.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 OpenWA Auto-Forwarder is RUNNING on port ${PORT}`);
  console.log(`📍 Webhook Endpoint: ${WEBHOOK_URL}`);
  console.log(`📲 Forward Target:    ${YOUR_TARGET_PHONE}`);
  console.log(`======================================================\n`);

  await autoRegisterWebhook();
});
