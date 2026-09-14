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

// ==================== TSC CALCULATION ENGINE ====================
const CATEGORIES_MAP = {
  fb:  ['fb','f.b','faridabad','fd','fs'],
  nfb: ['nfb','n.f.b','newfb','newfaridabad'],
  gb:  ['gb','g.b','ghaziabad','gzb','gd'],
  nd:  ['nd','n.d','gali'],
  pd:  ['pd','p.d','ds','d.s','desawar']
};
const CATEGORY_KEYS   = ['fb','nfb','gb','nd','pd'];
const TRIPLE_NUMBERS  = ['111','222','333','444','555','666','777','888','999','000'];

function parseTSCRow(raw, inherited) {
  const entries = [];
  if (!raw || !raw.trim()) return entries;
  let row = raw.trim();

  // Clean common prefixes
  row = row.replace(/^\[[^\]]+\]\s*[^:]+:\s*/,'').trim();

  let cat = null, alias = '';
  const s = row.toLowerCase().replace(/[\s\.\*#:,\-@"]/g,'');
  for (const k in CATEGORIES_MAP) {
    for (const a of CATEGORIES_MAP[k]) {
      if (s.includes(a.replace(/\./g,''))) { cat=k; alias=a; break; }
    }
    if (cat) break;
  }
  if (!cat) cat = inherited;
  if (!cat) return entries;

  const isDbl = /\b(ab|abc)\b/i.test(row);
  let area = row;
  if (alias) area = area.replace(new RegExp(alias,'gi'),' ');
  area = area.replace(/[\[\{]/g,'(').replace(/[\}\]]/g,')').replace(/["']/g,' ').trim();
  const parts = area.split(/(\(\d+\))/).map(p=>p.trim()).filter(p=>p.length>0);

  for (let i=0; i<parts.length; i++) {
    const na = parts[i];
    if (na.startsWith('(') && na.endsWith(')')) continue;
    const bp = parts[i+1];
    let bv = 1;
    if (bp && bp.startsWith('(') && bp.endsWith(')')) { 
      bv = parseInt(bp.slice(1,-1),10)||1; 
      i++; 
    }
    const nums = [];
    const rRx = /(\d{1,2})\s*[^\w\d]*to[^\w\d]*\s*(\d{1,2})/gi;
    let rm2;
    while ((rm2=rRx.exec(na))!==null) {
      const [,a,b] = rm2;
      const sa=parseInt(a,10),eb=parseInt(b,10);
      if (sa>=1&&eb<=100&&sa<=eb) for(let n=sa;n<=eb;n++) nums.push(String(n).padStart(2,'0'));
    }
    const stripped = na.replace(rRx,' ');
    for (const n of (stripped.match(/\b\d{1,3}\b/g)||[])) {
      const v=parseInt(n,10);
      if (n.length===2&&v>=0&&v<=99) nums.push(String(v).padStart(2,'0'));
      else if (n==='100'||v===100) nums.push('100');
      else if (n.length===3&&TRIPLE_NUMBERS.includes(n)) nums.push(n);
    }
    if (nums.length>0) entries.push({numbers:[...new Set(nums)],bracketValue:bv,category:cat,isDouble:isDbl});
  }
  return entries;
}

function calculateTSCTotal(text) {
  const res = {};
  for (const k of CATEGORY_KEYS) res[k]={total:0,jodiCount:0,harufCount:0};
  const rows = text.split('\n').map(r=>r.trim()).filter(r=>r.length>0);
  let curCat = null;
  for (let i=0; i<rows.length; i++) {
    const ents = parseTSCRow(rows[i], curCat);
    if (ents.length>0) curCat=ents[ents.length-1].category;
    for (const e of ents) {
      const c=e.category, mul=e.isDouble?2:1;
      let j=0,h=0;
      for (const n of e.numbers) {
        if (n.length===2||n==='100') j++;
        else if (n.length===3&&TRIPLE_NUMBERS.includes(n)) h++;
      }
      const tSale=(j+h)*e.bracketValue*mul;
      res[c].total += tSale;
      res[c].jodiCount += j;
      res[c].harufCount += h;
      res[c].passing = (res[c].passing || 0) + Math.round(tSale * 0.90);
      res[c].credit = (res[c].credit || 0) + (tSale - Math.round(tSale * 0.10));
    }
  }
  let gTotal=0, gPass=0, gCredit=0;
  const breakdown={};
  for (const k of CATEGORY_KEYS) {
    const r=res[k];
    gTotal+=r.total;
    gPass+=(r.passing || 0);
    gCredit+=(r.credit || 0);
    if (r.total>0) breakdown[k.toUpperCase()]={total:r.total, passing:r.passing, credit:r.credit, jodiCount:r.jodiCount, harufCount:r.harufCount};
  }
  return {grandTotal:gTotal, grandPassing:gPass, grandCredit:gCredit, breakdown};
}

let canvasModule = null;
try {
  canvasModule = require('@napi-rs/canvas');
} catch {}

function generateReportImageBuffer(data) {
  if (!canvasModule) return null;
  try {
    const { createCanvas } = canvasModule;
    const width = 800;
    const markets = Object.keys(data.breakdown || {});
    const rowHeight = 44;
    const height = Math.max(480, 360 + (markets.length * rowHeight));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background Gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#1e293b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Outer Border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    // Header Box
    ctx.fillStyle = 'rgba(45, 212, 191, 0.12)';
    ctx.fillRect(20, 20, width - 40, 65);
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 20, width - 40, 65);

    // Title
    ctx.fillStyle = '#2dd4bf';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('⚡ TSC PRO — PASSING REPORT', 35, 58);

    // Date & Sender
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.fillText(`Sender: +${data.sender || ''} | Time: ${data.time || ''}`, width - 360, 58);

    // Message Banner
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(20, 95, width - 40, 48);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('📝 Message:', 35, 124);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${data.rawMessage || ''}`, 130, 124);

    // Table Header
    const tableY = 155;
    ctx.fillStyle = '#14b8a6';
    ctx.fillRect(20, tableY, width - 40, 38);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('MARKET', 35, tableY + 24);
    ctx.fillText('COUNT', 180, tableY + 24);
    ctx.fillText('TOTAL SALE', 340, tableY + 24);
    ctx.fillText('PASSING (90/10)', 500, tableY + 24);
    ctx.fillText('NET CREDIT', 660, tableY + 24);

    // Table Rows
    let curY = tableY + 38;
    markets.forEach((market, idx) => {
      const item = data.breakdown[market];
      ctx.fillStyle = idx % 2 === 0 ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(20, curY, width - 40, rowHeight);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(market, 35, curY + 28);

      ctx.fillStyle = '#f8fafc';
      ctx.font = '14px sans-serif';
      ctx.fillText(`${item.jodiCount} Jodi${item.harufCount ? `, ${item.harufCount} H` : ''}`, 180, curY + 28);

      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`₹${item.total}`, 340, curY + 28);

      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`₹${item.passing || Math.round(item.total * 0.90)}`, 500, curY + 28);

      ctx.fillStyle = '#a855f7';
      ctx.fillText(`₹${item.credit || (item.total - Math.round(item.total * 0.10))}`, 660, curY + 28);

      curY += rowHeight;
    });

    // KPI Summary Boxes
    const kpiY = curY + 20;
    const boxW = (width - 60) / 3;

    // Total Sale
    ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
    ctx.fillRect(20, kpiY, boxW - 10, 80);
    ctx.strokeStyle = '#22c55e';
    ctx.strokeRect(20, kpiY, boxW - 10, 80);
    ctx.fillStyle = '#86efac';
    ctx.font = '13px sans-serif';
    ctx.fillText('TOTAL SALE', 35, kpiY + 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`₹${data.grandTotal}`, 35, kpiY + 60);

    // Passing
    const kpi2X = 20 + boxW + 5;
    ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
    ctx.fillRect(kpi2X, kpiY, boxW - 10, 80);
    ctx.strokeStyle = '#f59e0b';
    ctx.strokeRect(kpi2X, kpiY, boxW - 10, 80);
    ctx.fillStyle = '#fde68a';
    ctx.font = '13px sans-serif';
    ctx.fillText('TOTAL PASSING (90/10)', kpi2X + 15, kpiY + 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`₹${data.grandPassing || Math.round(data.grandTotal * 0.90)}`, kpi2X + 15, kpiY + 60);

    // Credit
    const kpi3X = 20 + (boxW * 2) + 10;
    ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
    ctx.fillRect(kpi3X, kpiY, boxW - 10, 80);
    ctx.strokeStyle = '#a855f7';
    ctx.strokeRect(kpi3X, kpiY, boxW - 10, 80);
    ctx.fillStyle = '#e9d5ff';
    ctx.font = '13px sans-serif';
    ctx.fillText('NET CREDIT', kpi3X + 15, kpiY + 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`₹${data.grandCredit || (data.grandTotal - Math.round(data.grandTotal * 0.10))}`, kpi3X + 15, kpiY + 60);

    // Footer
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.fillText('Generated automatically by TSC Manager Passing Bot', 240, height - 18);

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('Error generating report image:', err);
    return null;
  }
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

          // Specific Number (9785260088) -> Direct Instant Forward with TSC Total & Photo Report
          if (senderPhone.includes('9785260088')) {
            console.log(`🎯 Monitored Message from 9785260088 -> Calculating total & sending report...`);
            
            const calc = calculateTSCTotal(text);
            if (calc && calc.grandTotal > 0) {
              let calcInfo = `\n\n📊 *TSC Passing & Total Report:*\n💰 *Total Sale:* ₹${calc.grandTotal}\n⚡ *Total Passing:* ₹${calc.grandPassing}\n💳 *Net Credit:* ₹${calc.grandCredit}`;
              for (const cat in calc.breakdown) {
                const b = calc.breakdown[cat];
                calcInfo += `\n📍 *${cat}:* ₹${b.total} (${b.jodiCount} Jodi${b.harufCount ? `, ${b.harufCount} H` : ''}) | Pass: ₹${b.passing}`;
              }

              const caption = `📩 *New Message from 9785260088:*\n\n${text}${calcInfo}\n\n⏰ *Time:* ${timeString}`;
              const imgBuf = generateReportImageBuffer({
                rawMessage: text,
                sender: senderPhone,
                time: timeString,
                grandTotal: calc.grandTotal,
                grandPassing: calc.grandPassing,
                grandCredit: calc.grandCredit,
                breakdown: calc.breakdown
              });

              if (imgBuf) {
                await sendImage(sessionId, TARGET_PHONE, imgBuf, caption);
                console.log(`🖼️ Report Photo + Details forwarded to ${TARGET_PHONE}`);
              } else {
                await sendMessage(sessionId, TARGET_PHONE, caption);
              }
            } else {
              const forwardMsg = `📩 *New Message from 9785260088:*\n\n${text}\n\n⏰ *Time:* ${timeString}`;
              await sendMessage(sessionId, TARGET_PHONE, forwardMsg);
            }
            console.log(`🚀 Successfully forwarded 9785260088 message to ${TARGET_PHONE}`);
            console.log(`========================================`);
            return;
          }

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
            let calcInfo = '';
            // 2. Aapke number par message forward karein
            const calc = calculateTSCTotal(text);
            if (calc && calc.grandTotal > 0) {
              let calcInfo = `\n\n📊 *TSC Passing & Total Report:*\n💰 *Total Sale:* ₹${calc.grandTotal}\n⚡ *Total Passing:* ₹${calc.grandPassing}\n💳 *Net Credit:* ₹${calc.grandCredit}`;
              for (const cat in calc.breakdown) {
                const b = calc.breakdown[cat];
                calcInfo += `\n📍 *${cat}:* ₹${b.total} (${b.jodiCount} Jodi${b.harufCount ? `, ${b.harufCount} H` : ''}) | Pass: ₹${b.passing}`;
              }

              const followUpAlert = `💬 *Message from ${userName}* (+${senderPhone}):\n${text}${calcInfo}`;
              const imgBuf = generateReportImageBuffer({
                rawMessage: text,
                sender: senderPhone,
                time: timeString,
                grandTotal: calc.grandTotal,
                grandPassing: calc.grandPassing,
                grandCredit: calc.grandCredit,
                breakdown: calc.breakdown
              });

              if (imgBuf) {
                await sendImage(sessionId, TARGET_PHONE, imgBuf, followUpAlert);
                console.log(`🖼️ Forwarded Report Photo to ${TARGET_PHONE}`);
              } else {
                await sendMessage(sessionId, TARGET_PHONE, followUpAlert);
              }
            } else {
              const followUpAlert = `💬 *Message from ${userName}* (+${senderPhone}):\n${text}`;
              await sendMessage(sessionId, TARGET_PHONE, followUpAlert);
            }
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

async function sendImage(sessionId, chatId, imageBuffer, caption) {
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

  const url = `${OPENWA_API_URL}/api/sessions/${activeSessionId}/messages/send-image`;
  try {
    const base64Str = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': OPENWA_API_KEY,
      },
      body: JSON.stringify({
        chatId: chatId,
        base64: base64Str,
        mimetype: 'image/png',
        caption: caption,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`❌ Image send failed to ${chatId}:`, err);
      await sendMessage(activeSessionId, chatId, caption);
    }
  } catch (err) {
    console.error(`❌ Network error sending image to ${chatId}:`, err.message);
    await sendMessage(activeSessionId, chatId, caption);
  }
}

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

  // Auto-register webhook with OpenWA sessions
  async function autoRegisterWebhooks() {
    try {
      const sRes = await fetch(`${OPENWA_API_URL}/api/sessions`, {
        headers: { 'X-Api-Key': OPENWA_API_KEY },
      });
      if (!sRes.ok) return;
      const sessions = await sRes.json();
      if (!Array.isArray(sessions)) return;

      for (const session of sessions) {
        if (session.status === 'ready' || session.status === 'authenticated') {
          const wRes = await fetch(`${OPENWA_API_URL}/api/sessions/${session.id}/webhooks`, {
            headers: { 'X-Api-Key': OPENWA_API_KEY },
          });
          if (wRes.ok) {
            const webhooks = await wRes.json();
            const exists = Array.isArray(webhooks) && webhooks.some(w => w.url && w.url.includes('/webhook'));
            if (!exists) {
              console.log(`🔗 Auto-registering webhook for session "${session.id}"...`);
              await fetch(`${OPENWA_API_URL}/api/sessions/${session.id}/webhooks`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Api-Key': OPENWA_API_KEY,
                },
                body: JSON.stringify({
                  url: `http://localhost:${PORT}/webhook`,
                  events: ['message.received'],
                }),
              });
              console.log(`✅ Webhook auto-registered for session "${session.id}"!`);
            }
          }
        }
      }
    } catch {}
  }

  setInterval(autoRegisterWebhooks, 5000);
  setTimeout(autoRegisterWebhooks, 3000);
});
