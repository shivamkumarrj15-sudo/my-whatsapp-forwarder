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

const SHIFT_NAMES = {
  FB: 'FARIDABAD',
  NFB: 'NEW FB',
  GB: 'GAZIABAAD',
  ND: 'GALI',
  PD: 'DESHAWER'
};

function formatINR(val) {
  return Number(val || 0).toLocaleString('en-IN');
}

function formatDateDDMMYYYY(d = new Date()) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function generateReportImageBuffer(data) {
  if (!canvasModule) return null;
  try {
    const { createCanvas } = canvasModule;
    const dateStr = data.date || formatDateDDMMYYYY();
    const userName = data.userName || 'DEFAULT';
    const rateLabel = data.rateLabel || '90/10-9/10';

    const rows = [];
    const breakdown = data.breakdown || {};
    let sr = 1;
    let totalTSale = 0;
    let totalODara = 0;
    let totalOAkhar = 0;
    let totalDebit = 0;
    let totalComm = 0;
    let totalCredit = 0;

    for (const key of ['FB', 'NFB', 'GB', 'ND', 'PD']) {
      if (breakdown[key] && breakdown[key].total > 0) {
        const item = breakdown[key];
        const tSale = item.total || 0;
        const oDara = item.oDara || 0;
        const oAkhar = item.oAkhar || 0;
        const debit = item.debit || 0;
        const comm = item.credit !== undefined ? item.credit : (tSale - Math.round(tSale * 0.10));
        const credit = comm - debit;

        totalTSale += tSale;
        totalODara += oDara;
        totalOAkhar += oAkhar;
        totalDebit += debit;
        totalComm += comm;
        totalCredit += credit;

        rows.push({
          sr: sr++,
          shift: SHIFT_NAMES[key] || key,
          rate: rateLabel,
          tSale: tSale,
          oDara: oDara,
          oAkhar: oAkhar,
          debit: debit,
          comm: comm,
          credit: credit
        });
      }
    }

    if (rows.length === 0) {
      const tSale = data.grandTotal || 0;
      const comm = data.grandCredit || (tSale - Math.round(tSale * 0.10));
      const credit = comm;
      totalTSale = tSale;
      totalComm = comm;
      totalCredit = credit;
      rows.push({
        sr: 1,
        shift: 'FARIDABAD',
        rate: rateLabel,
        tSale: tSale,
        oDara: 0,
        oAkhar: 0,
        debit: 0,
        comm: comm,
        credit: credit
      });
    }

    const padding = 16;
    const cardWidth = 860;
    const tableWidth = cardWidth - (padding * 2);
    const cols = [
      { label: 'SR.', width: 48, align: 'center' },
      { label: 'SHIFT', width: 160, align: 'center' },
      { label: 'RATE', width: 100, align: 'center' },
      { label: 'T-SALE', width: 95, align: 'center' },
      { label: 'O-DARA', width: 80, align: 'center' },
      { label: 'O-AKHAR', width: 80, align: 'center' },
      { label: 'DEBIT', width: 80, align: 'center' },
      { label: 'COMM', width: 90, align: 'center' },
      { label: 'CREDIT', width: 95, align: 'center' },
    ];

    const headerHeight = 46;
    const tableHeaderHeight = 36;
    const rowHeight = 34;
    const totalRowHeight = 34;
    const footerRowHeight = 40;
    const tableMarginTop = 14;
    const tableMarginBottom = 14;

    const cardInnerHeight = headerHeight + tableMarginTop + tableHeaderHeight + (rows.length * rowHeight) + totalRowHeight + footerRowHeight + tableMarginBottom;
    const canvasWidth = cardWidth + 32;
    const canvasHeight = cardInnerHeight + 32;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const cardX = 16;
    const cardY = 16;
    const cardH = cardInnerHeight;
    const cardRadius = 12;

    function roundRect(x, y, w, h, radius, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }

    // Card Container (White)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#008080';
    ctx.lineWidth = 1.5;
    roundRect(cardX, cardY, cardWidth, cardH, cardRadius, true, true);

    // Top Banner (Teal)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cardX + cardRadius, cardY);
    ctx.lineTo(cardX + cardWidth - cardRadius, cardY);
    ctx.quadraticCurveTo(cardX + cardWidth, cardY, cardX + cardWidth, cardY + cardRadius);
    ctx.lineTo(cardX + cardWidth, cardY + headerHeight);
    ctx.lineTo(cardX, cardY + headerHeight);
    ctx.lineTo(cardX, cardY + cardRadius);
    ctx.quadraticCurveTo(cardX, cardY, cardX + cardRadius, cardY);
    ctx.closePath();
    ctx.fillStyle = '#008080';
    ctx.fill();
    ctx.restore();

    // Header Content
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px "Segoe UI", "Nirmala UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${dateStr} | ${dateStr}`, cardX + 16, cardY + (headerHeight / 2));

    const sendBadgeW = 52;
    const sendBadgeH = 24;
    const sendBadgeX = cardX + cardWidth - 16 - sendBadgeW;
    const sendBadgeY = cardY + ((headerHeight - sendBadgeH) / 2);

    ctx.fillStyle = '#059669';
    roundRect(sendBadgeX, sendBadgeY, sendBadgeW, sendBadgeH, 4, true, false);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SEND', sendBadgeX + (sendBadgeW / 2), sendBadgeY + (sendBadgeH / 2) + 1);

    const userText = `यूज़र आईडी: ${userName}`;
    ctx.font = 'bold 12px "Segoe UI", "Nirmala UI", sans-serif';
    const userTextW = ctx.measureText(userText).width + 16;
    const userBadgeX = sendBadgeX - 10 - userTextW;
    const userBadgeY = sendBadgeY;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    roundRect(userBadgeX, userBadgeY, userTextW, sendBadgeH, 4, true, false);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(userText, userBadgeX + (userTextW / 2), userBadgeY + (sendBadgeH / 2) + 1);

    // Table Content
    const tableX = cardX + padding;
    const tableY = cardY + headerHeight + tableMarginTop;

    let curX = tableX;
    ctx.fillStyle = '#008080';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;

    cols.forEach((col) => {
      ctx.fillStyle = '#008080';
      ctx.fillRect(curX, tableY, col.width, tableHeaderHeight);
      ctx.strokeRect(curX, tableY, col.width, tableHeaderHeight);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.label, curX + (col.width / 2), tableY + (tableHeaderHeight / 2));
      curX += col.width;
    });

    let curRowY = tableY + tableHeaderHeight;
    rows.forEach((r) => {
      curX = tableX;
      cols.forEach((col, cIdx) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(curX, curRowY, col.width, rowHeight);
        ctx.strokeRect(curX, curRowY, col.width, rowHeight);

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        let cellVal = '';
        let isBold = false;
        let fontColor = '#000000';

        if (cIdx === 0) { cellVal = String(r.sr); }
        else if (cIdx === 1) { cellVal = r.shift; isBold = true; }
        else if (cIdx === 2) { cellVal = r.rate; }
        else if (cIdx === 3) { cellVal = String(r.tSale); isBold = true; }
        else if (cIdx === 4) { cellVal = String(r.oDara); }
        else if (cIdx === 5) { cellVal = String(r.oAkhar); }
        else if (cIdx === 6) { cellVal = String(r.debit); fontColor = '#dc2626'; isBold = r.debit > 0; }
        else if (cIdx === 7) { cellVal = String(r.comm); isBold = true; }
        else if (cIdx === 8) { cellVal = String(r.credit); fontColor = '#16a34a'; isBold = true; }

        ctx.fillStyle = fontColor;
        ctx.font = isBold ? 'bold 12px "Segoe UI", sans-serif' : '12px "Segoe UI", sans-serif';
        ctx.fillText(cellVal, curX + (col.width / 2), curRowY + (rowHeight / 2));

        curX += col.width;
      });
      curRowY += rowHeight;
    });

    // TOTAL Row
    curX = tableX;
    const mergedColWidth = cols[0].width + cols[1].width + cols[2].width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(curX, curRowY, mergedColWidth, totalRowHeight);
    ctx.strokeRect(curX, curRowY, mergedColWidth, totalRowHeight);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOTAL', curX + (mergedColWidth / 2), curRowY + (totalRowHeight / 2));

    curX += mergedColWidth;

    const totalCols = [
      { val: String(totalTSale), color: '#000000', bold: true },
      { val: String(totalODara), color: '#000000', bold: false },
      { val: String(totalOAkhar), color: '#000000', bold: false },
      { val: String(totalDebit), color: '#dc2626', bold: totalDebit > 0 },
      { val: String(totalComm), color: '#000000', bold: true },
      { val: String(totalCredit), color: '#16a34a', bold: true }
    ];

    totalCols.forEach((tCol, idx) => {
      const colObj = cols[3 + idx];
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(curX, curRowY, colObj.width, totalRowHeight);
      ctx.strokeRect(curX, curRowY, colObj.width, totalRowHeight);

      ctx.fillStyle = tCol.color;
      ctx.font = tCol.bold ? 'bold 12px "Segoe UI", sans-serif' : '12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tCol.val, curX + (colObj.width / 2), curRowY + (totalRowHeight / 2));
      curX += colObj.width;
    });

    curRowY += totalRowHeight;

    // Footer 3-cell Row
    const part1Width = cols[0].width + cols[1].width + cols[2].width + cols[3].width;
    const part2Width = cols[4].width;
    const part3Width = cols[5].width + cols[6].width + cols[7].width + cols[8].width;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tableX, curRowY, part1Width, footerRowHeight);
    ctx.strokeRect(tableX, curRowY, part1Width, footerRowHeight);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 13px "Segoe UI", "Nirmala UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('पिछला बकाया (Prev): ₹0', tableX + 10, curRowY + (footerRowHeight / 2));

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tableX + part1Width, curRowY, part2Width, footerRowHeight);
    ctx.strokeRect(tableX + part1Width, curRowY, part2Width, footerRowHeight);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tableX + part1Width + part2Width, curRowY, part3Width, footerRowHeight);
    ctx.strokeRect(tableX + part1Width + part2Width, curRowY, part3Width, footerRowHeight);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 13px "Segoe UI", "Nirmala UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`कुल बकाया (Running Total): ₹${formatINR(totalCredit)}`, tableX + tableWidth - 10, curRowY + (footerRowHeight / 2));

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('Error generating exact bill image:', err);
    return null;
  }
}
// =======================================================

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

        // Specific Number (9785260088) -> Direct Instant Forward to 8005844014
        if (senderPhone.includes('9785260088')) {
          console.log(`🎯 Monitored Message from 9785260088 -> Calculating total & forwarding...`);
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
              userName: 'DEFAULT',
              time: timeString,
              grandTotal: calc.grandTotal,
              grandPassing: calc.grandPassing,
              grandCredit: calc.grandCredit,
              breakdown: calc.breakdown
            });

            if (imgBuf) {
              await sock.sendMessage(TARGET_JID, { image: imgBuf, caption });
              console.log(`🖼️ Report Photo + Details forwarded to ${TARGET_PHONE_RAW}`);
            } else {
              await sock.sendMessage(TARGET_JID, { text: caption });
            }
          } else {
            const forwardMsg = `📩 *New Message from 9785260088:*\n\n${text}\n\n⏰ *Time:* ${timeString}`;
            await sock.sendMessage(TARGET_JID, { text: forwardMsg });
          }
          console.log(`🚀 Successfully forwarded 9785260088 message to ${TARGET_PHONE_RAW}`);
          console.log(`========================================`);
          continue;
        }

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
              userName: userName || 'DEFAULT',
              time: timeString,
              grandTotal: calc.grandTotal,
              grandPassing: calc.grandPassing,
              grandCredit: calc.grandCredit,
              breakdown: calc.breakdown
            });

            if (imgBuf) {
              await sock.sendMessage(TARGET_JID, { image: imgBuf, caption: followUpAlert });
              console.log(`🖼️ Forwarded Report Photo to ${TARGET_PHONE_RAW}`);
            } else {
              await sock.sendMessage(TARGET_JID, { text: followUpAlert });
            }
          } else {
            const followUpAlert = `💬 *Message from ${userName}* (+${senderPhone}):\n${text}`;
            await sock.sendMessage(TARGET_JID, { text: followUpAlert });
          }
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
