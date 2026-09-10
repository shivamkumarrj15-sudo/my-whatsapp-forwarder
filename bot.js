/**
 * High-Performance Pure Baileys WhatsApp Bot & Web Dashboard
 * - Ultra lightweight (30MB RAM, zero Chromium/Puppeteer)
 * - Built-in Web UI with live auto-refreshing QR Code
 * - Smart Lead Capture: Asks name on first message, replies "Ok" to subsequent messages
 * - Forwards all lead details & messages to +91 80058 44014
 * - UptimeRobot compatible (/api/health)
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
const TARGET_PHONE_RAW = '8005844014';
const TARGET_JID = '918005844014@s.whatsapp.net';
const PORT = process.env.PORT || 2785;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const DB_FILE = path.join(__dirname, 'contacts_memory.json');

// Memory Persistence
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

// Bot State
const botState = {
  status: 'connecting', // 'connecting' | 'qr_ready' | 'connected' | 'error'
  qrDataUrl: null,
  qrRaw: null,
  connectedNumber: null,
  startTime: new Date().toISOString(),
  totalMessagesProcessed: 0,
  leadsCaptured: 0,
  recentLogs: [],
};

function addLog(type, text) {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  botState.recentLogs.unshift({ time, type, text });
  if (botState.recentLogs.length > 50) botState.recentLogs.pop();
}

// Message Deduplication
const processedMessages = new Set();
function isDuplicate(msgId, text, from) {
  const key = msgId || `${from}_${text}`;
  if (processedMessages.has(key)) return true;
  processedMessages.add(key);
  setTimeout(() => processedMessages.delete(key), 15000);
  return false;
}

let sock = null;

// ==================== BAILEYS BOT CORE ====================
async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 Initializing WhatsApp Socket (Baileys v${version.join('.')})...`);
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
        console.log('📱 New QR Code generated! Open Web Dashboard to scan.');
        addLog('info', 'New QR Code generated. Ready to scan.');
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
      const userJid = sock.user.id;
      const userPhone = userJid.split(':')[0].replace(/\D/g, '');
      botState.connectedNumber = `+${userPhone}`;
      console.log(`\n✅ WhatsApp Connected Successfully as +${userPhone}!`);
      console.log(`🎯 Messages will be forwarded to +${TARGET_PHONE_RAW}\n`);
      addLog('success', `WhatsApp Connected as +${userPhone}`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid || '';
        
        // Ignore groups, broadcasts, channels/newsletters
        if (
          remoteJid.endsWith('@g.us') ||
          remoteJid.endsWith('@broadcast') ||
          remoteJid.endsWith('@newsletter') ||
          remoteJid === 'status@broadcast'
        ) {
          continue;
        }

        // Ignore messages from the destination target number
        if (remoteJid.includes(TARGET_PHONE_RAW)) {
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

        const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
        const msgId = msg.key.id;

        if (isDuplicate(msgId, text, remoteJid)) continue;

        botState.totalMessagesProcessed++;
        const timeString = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

        console.log(`\n========================================`);
        console.log(`📩 Message from +${senderPhone}: "${text}"`);

        // Step 1: New User -> Ask Name
        if (!userStates[remoteJid] || userStates[remoteJid].stage === 'new') {
          userStates[remoteJid] = {
            stage: 'asked_name',
            firstMsg: text,
            phone: senderPhone,
            time: timeString,
          };
          saveStates();

          console.log(`🤖 Asking name from +${senderPhone}...`);
          addLog('lead', `New contact +${senderPhone}: "${text}" -> Asking Name`);

          // Reply to user
          await sock.sendMessage(remoteJid, {
            text: `Namaste! 🙏\nKripya apna shubh *Naam (Name)* batayein?`
          });

          // Forward alert to Target Number (8005844014)
          const initialAlert = `🔔 *Naya WhatsApp Message Aaya!*\n📱 *Number:* +${senderPhone}\n💬 *Message:* ${text}\n⏰ *Time:* ${timeString}\n⏳ *Status:* Naam poochha gaya hai...`;
          await sock.sendMessage(TARGET_JID, { text: initialAlert });
        }
        // Step 2: User replied with their Name
        else if (userStates[remoteJid].stage === 'asked_name') {
          const userName = text;
          userStates[remoteJid].name = userName;
          userStates[remoteJid].stage = 'registered';
          saveStates();
          botState.leadsCaptured++;

          console.log(`👤 Name captured: "${userName}" (+${senderPhone})`);
          addLog('lead', `Lead Name Saved: "${userName}" (+${senderPhone})`);

          // Reply "Ok" to user
          await sock.sendMessage(remoteJid, { text: `Ok` });

          // Forward complete lead to Target Number
          const leadAlert = `✅ *Nayi Contact Detail Mil Gayi!*\n\n👤 *Naam:* ${userName}\n📱 *Phone:* +${senderPhone}\n💬 *First Message:* ${userStates[remoteJid].firstMsg}\n⏰ *Time:* ${timeString}`;
          await sock.sendMessage(TARGET_JID, { text: leadAlert });
          console.log(`🚀 Lead details forwarded to ${TARGET_PHONE_RAW}`);
        }
        // Step 3: Subsequent messages -> Reply "Ok" & Forward to Target Number
        else if (userStates[remoteJid].stage === 'registered') {
          const userName = userStates[remoteJid].name || senderPhone;

          // 1. Reply "Ok" to user
          await sock.sendMessage(remoteJid, { text: `Ok` });
          console.log(`🤖 Replied "Ok" to ${userName}`);

          // 2. Forward message to Target Number
          const followUpAlert = `💬 *Message from ${userName}* (+${senderPhone}):\n${text}`;
          await sock.sendMessage(TARGET_JID, { text: followUpAlert });
          console.log(`🚀 Forwarded message to ${TARGET_PHONE_RAW}`);
          addLog('msg', `From ${userName} (+${senderPhone}): "${text}" -> Forwarded`);
        }
        console.log(`========================================`);
      } catch (err) {
        console.error('⚠️ Error processing incoming message:', err.message);
      }
    }
  });
}

// ==================== EXPRESS WEB DASHBOARD ====================
const app = express();
app.use(express.json());

// UptimeRobot Keep-Alive Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    botStatus: botState.status,
    connectedAs: botState.connectedNumber,
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// JSON Status API for Dashboard Polling
app.get('/api/status', (req, res) => {
  res.json(botState);
});

// HTML Dashboard UI
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Bot Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --accent: #25D366;
      --accent-hover: #1eb857;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
    body { background-color: var(--bg); color: var(--text); min-height: 100vh; padding: 24px; display: flex; flex-direction: column; align-items: center; }
    .container { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 24px; }
    .header { text-align: center; padding: 16px 0; }
    .header h1 { font-size: 28px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .header p { color: var(--text-muted); margin-top: 6px; font-size: 15px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 9999px; font-weight: 600; font-size: 14px; }
    .status-connected { background: rgba(37, 211, 102, 0.15); color: #25D366; border: 1px solid rgba(37, 211, 102, 0.3); }
    .status-qr { background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
    .status-connecting { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
    .qr-container { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; text-align: center; }
    .qr-image { background: white; padding: 16px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); margin-bottom: 16px; }
    .qr-image img { display: block; border-radius: 8px; width: 260px; height: 260px; }
    .instruction-box { background: #0f172a; border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-align: left; max-width: 420px; margin-top: 12px; }
    .instruction-box ol { padding-left: 20px; color: var(--text-muted); font-size: 14px; line-height: 1.6; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 16px; }
    .stat-item { background: #0f172a; border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .stat-label { color: var(--text-muted); font-size: 13px; font-weight: 500; }
    .stat-val { font-size: 22px; font-weight: 700; margin-top: 6px; color: #fff; }
    .logs-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    .logs-table th { text-align: left; padding: 10px; color: var(--text-muted); border-bottom: 1px solid var(--border); }
    .logs-table td { padding: 10px; border-bottom: 1px solid #243247; word-break: break-word; }
    .pulse { width: 10px; height: 10px; border-radius: 50%; background: currentColor; display: inline-block; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚡ WhatsApp Auto Lead & Forwarder Bot</h1>
      <p>Target Destination: <strong>+91 ${TARGET_PHONE_RAW}</strong> | 24/7 Cloud Engine</p>
    </div>

    <!-- Live Status Section -->
    <div class="card" id="statusCard">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="font-size: 18px;">Bot Status</h2>
        <div id="statusBadge" class="status-badge status-connecting">
          <span class="pulse"></span> <span id="statusText">Connecting...</span>
        </div>
      </div>

      <div id="qrSection" class="qr-container" style="display: none;">
        <h3 style="margin-bottom: 12px; font-size: 17px;">📱 Scan QR Code to Connect WhatsApp</h3>
        <div class="qr-image">
          <img id="qrImg" src="" alt="WhatsApp QR Code">
        </div>
        <div class="instruction-box">
          <strong style="color: #fff; display: block; margin-bottom: 6px;">How to link:</strong>
          <ol>
            <li>Apne Phone mein <strong>WhatsApp</strong> kholein</li>
            <li><strong>Linked Devices</strong> (लिंक्ड डिवाइसेज़) par jayein</li>
            <li><strong>Link a Device</strong> par click karein aur is QR ko scan karein</li>
          </ol>
        </div>
      </div>

      <div id="connectedSection" style="display: none; padding: 20px 0; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 8px;">🎉</div>
        <h3 style="color: #25D366; font-size: 22px;">WhatsApp Successfully Connected!</h3>
        <p style="color: var(--text-muted); margin-top: 6px;">Connected as: <strong id="connectedNum" style="color: #fff;"></strong></p>
        <p style="color: #60a5fa; margin-top: 4px; font-size: 14px;">Bot is actively capturing names, replying "Ok", and forwarding to +91 ${TARGET_PHONE_RAW}</p>
      </div>

      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">Messages Processed</div>
          <div class="stat-val" id="statMsgs">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Leads Captured</div>
          <div class="stat-val" id="statLeads">0</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Destination Forwarder</div>
          <div class="stat-val">+91 ${TARGET_PHONE_RAW}</div>
        </div>
      </div>
    </div>

    <!-- Live Logs Section -->
    <div class="card">
      <h2 style="font-size: 18px; margin-bottom: 12px;">📋 Live Activity Logs</h2>
      <div style="max-height: 280px; overflow-y: auto;">
        <table class="logs-table">
          <thead>
            <tr>
              <th style="width: 100px;">Time</th>
              <th style="width: 80px;">Type</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody id="logsBody">
            <tr><td colspan="3" style="text-align: center; color: var(--text-muted);">Waiting for activity...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    async function refreshStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const badge = document.getElementById('statusBadge');
        const statusText = document.getElementById('statusText');
        const qrSection = document.getElementById('qrSection');
        const connectedSection = document.getElementById('connectedSection');
        const qrImg = document.getElementById('qrImg');
        const connectedNum = document.getElementById('connectedNum');
        const statMsgs = document.getElementById('statMsgs');
        const statLeads = document.getElementById('statLeads');
        const logsBody = document.getElementById('logsBody');

        statMsgs.innerText = data.totalMessagesProcessed || 0;
        statLeads.innerText = data.leadsCaptured || 0;

        if (data.status === 'connected') {
          badge.className = 'status-badge status-connected';
          statusText.innerText = 'Online & Ready 🟢';
          qrSection.style.display = 'none';
          connectedSection.style.display = 'block';
          connectedNum.innerText = data.connectedNumber || 'Active';
        } else if (data.status === 'qr_ready' && data.qrDataUrl) {
          badge.className = 'status-badge status-qr';
          statusText.innerText = 'Scan QR Code 🟡';
          qrSection.style.display = 'flex';
          connectedSection.style.display = 'none';
          qrImg.src = data.qrDataUrl;
        } else {
          badge.className = 'status-badge status-connecting';
          statusText.innerText = 'Connecting... ⚪';
          qrSection.style.display = 'none';
          connectedSection.style.display = 'none';
        }

        if (data.recentLogs && data.recentLogs.length > 0) {
          logsBody.innerHTML = data.recentLogs.map(l => \`
            <tr>
              <td style="color: var(--text-muted); font-size: 12px;">\${l.time}</td>
              <td><span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #334155;">\${l.type}</span></td>
              <td>\${l.text}</td>
            </tr>
          \`).join('');
        }
      } catch (err) {}
    }

    setInterval(refreshStatus, 2000);
    refreshStatus();
  </script>
</body>
</html>`);
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ WhatsApp Bot Web Dashboard: http://localhost:${PORT}`);
  console.log(`🎯 Forward Target:            +91 ${TARGET_PHONE_RAW}`);
  console.log(`======================================================\n`);
  
  // Start WhatsApp Socket
  startWhatsAppBot();
});
