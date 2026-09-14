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
    const tableWidth = cardWidth - (padding * 2); // 828
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

    // Outer Background
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

    // Top Teal Banner
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
