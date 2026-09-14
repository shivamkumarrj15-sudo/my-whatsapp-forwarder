/**
 * High-Performance Pure Baileys WhatsApp Bot & Web Dashboard with Live Passing & Group Result Monitor
 * - Auto-joins & listens to Result Group (https://chat.whatsapp.com/KNDH9Jx7PjiLM3cSB1yaKt)
 * - Captures Live Opening Numbers for FB, NFB, GB, ND, PD
 * - Calculates Live Passing & Net Credit
 * - Generates Exact HD Bill Photo Card matching user template
 * - Forwards all lead details & messages to +91 80058 44014
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
const GROUP_INVITE_CODE = 'KNDH9Jx7PjiLM3cSB1yaKt';

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

// Daily Winning Numbers / Results Memory File
const RESULTS_DB_FILE = path.join(__dirname, 'results_memory.json');
let resultsMemory = {};
if (fs.existsSync(RESULTS_DB_FILE)) {
  try {
    resultsMemory = JSON.parse(fs.readFileSync(RESULTS_DB_FILE, 'utf8'));
  } catch {}
}

function saveResults() {
  try {
    fs.writeFileSync(RESULTS_DB_FILE, JSON.stringify(resultsMemory, null, 2), 'utf8');
  } catch {}
}

function formatDateDDMMYYYY(d = new Date()) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

function getTodayResults(dateStr) {
  const d = dateStr || formatDateDDMMYYYY();
  return resultsMemory[d] || {};
}

function setResultForShift(dateStr, category, number) {
  const d = dateStr || formatDateDDMMYYYY();
  if (!resultsMemory[d]) resultsMemory[d] = {};
  resultsMemory[d][category.toLowerCase()] = String(number).padStart(2, '0');
  saveResults();
}

// Bot State
const botState = {
  status: 'connecting',
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

// ==================== TSC ENGINE & RESULT PARSER ====================
const CATEGORIES_MAP = {
  fb:  ['fb','f.b','faridabad','fd','fs'],
  nfb: ['nfb','n.f.b','newfb','newfaridabad'],
  gb:  ['gb','g.b','ghaziabad','gzb','gd'],
  nd:  ['nd','n.d','gali'],
  pd:  ['pd','p.d','ds','d.s','desawar']
};
const CATEGORY_KEYS   = ['fb','nfb','gb','nd','pd'];
const SHIFT_NAMES = {
  fb: 'FARIDABAD',
  nfb: 'NEW FB',
  gb: 'GAZIABAAD',
  nd: 'GALI',
  pd: 'DESHAWER'
};
const TRIPLE_NUMBERS  = ['111','222','333','444','555','666','777','888','999','000'];

function formatINR(val) {
  return Number(val || 0).toLocaleString('en-IN');
}

// Result / Find Message Parser
function parseResultMessage(text) {
  if (!text || typeof text !== 'string') return [];
  const results = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    line = line.replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '').trim();

    const cleanText = line.toLowerCase().replace(/[\s\.\*#:,-@=\_"]/g, '');
    let matchedCat = null;
    let matchedAlias = '';

    for (const k of CATEGORY_KEYS) {
      for (const a of CATEGORIES_MAP[k]) {
        if (cleanText.includes(a.replace(/\./g, ''))) {
          matchedCat = k;
          matchedAlias = a;
          break;
        }
      }
      if (matchedCat) break;
    }

    if (!matchedCat) continue;

    let numArea = line;
    if (matchedAlias) numArea = numArea.replace(new RegExp(matchedAlias, 'gi'), ' ');
    const digits = numArea.match(/\b\d{1,3}\b/g) || [];

    for (const d of digits) {
      const val = parseInt(d, 10);
      if (d.length === 2 && val >= 0 && val <= 99) {
        results.push({ category: matchedCat, number: String(val).padStart(2, '0') });
        break;
      } else if (d === '100' || val === 100) {
        results.push({ category: matchedCat, number: '00' });
        break;
      } else if (d.length === 1 && val >= 0 && val <= 9) {
        results.push({ category: matchedCat, number: String(val).padStart(2, '0') });
        break;
      }
    }
  }

  return results;
}

// Bet Row Parser
function parseTSCRow(raw, inherited) {
  const entries = [];
  if (!raw || !raw.trim()) return entries;
  let row = raw.trim();

  row = row.replace(/^\[[^\]]+\]\s*[^:]*:\s*/,'').trim();

  let cat = null, alias = '';
  const s = row.toLowerCase().replace(/[\s\.\*#:,-@"]/g,'');
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

// Complete Passing Calculation Engine matching tsc-pro
function calculatePassingReport(text, winningNumbers = {}, rateStr = '90/10') {
  const [payoutVal, commVal] = rateStr.split('/').map(Number);
  const jodiMultiplier = isNaN(payoutVal) ? 90 : payoutVal;
  const harufMultiplier = 9;
  const commPercent = (isNaN(commVal) ? 10 : commVal) / 100;

  const res = {};
  for (const k of CATEGORY_KEYS) {
    res[k] = {
      tSale: 0,
      dSale: 0,
      aSale: 0,
      oDara: 0,
      oAkhar: 0,
      debit: 0,
      comm: 0,
      credit: 0,
      jodiCount: 0,
      harufCount: 0,
      winningNumber: winningNumbers[k] || ''
    };
  }

  const rows = text.split('\n').map(r=>r.trim()).filter(r=>r.length>0);
  let curCat = null;

  for (let i = 0; i < rows.length; i++) {
    const ents = parseTSCRow(rows[i], curCat);
    if (ents.length > 0) curCat = ents[ents.length - 1].category;

    for (const e of ents) {
      const cat = e.category;
      const mul = e.isDouble ? 2 : 1;
      const bracket = e.bracketValue;
      const findStr = winningNumbers[cat] ? String(winningNumbers[cat]).padStart(2, '0') : '';

      let j = 0, h = 0;
      let winningJodiCount = 0;
      let winningAkharCount = 0;

      for (const n of e.numbers) {
        if (n.length === 2 || n === '100') {
          j++;
          if (findStr) {
            const normNum = n === '100' ? '00' : n;
            const normFindStr = findStr === '100' ? '00' : findStr;
            if (normNum === normFindStr) {
              winningJodiCount++;
            } else if (e.isDouble) {
              const reversedNum = normNum[1] + normNum[0];
              if (reversedNum === normFindStr) {
                winningJodiCount++;
              }
            }
          }
        } else if (n.length === 3 && TRIPLE_NUMBERS.includes(n)) {
          h++;
          if (findStr && findStr.length === 2) {
            const findLastDigit = parseInt(findStr[1], 10);
            const tripleDigit = parseInt(n[0], 10);
            if (tripleDigit === findLastDigit) {
              winningAkharCount++;
            }
          }
        }
      }

      res[cat].dSale += j * bracket * mul;
      res[cat].aSale += h * bracket * mul;
      res[cat].tSale += (j + h) * bracket * mul;
      res[cat].jodiCount += j;
      res[cat].harufCount += h;
      res[cat].oDara += winningJodiCount * bracket;
      res[cat].oAkhar += winningAkharCount * bracket;
    }
  }

  let grandTSale = 0, grandODara = 0, grandOAkhar = 0, grandDebit = 0, grandComm = 0, grandNetBalance = 0;
  const breakdown = {};

  for (const k of CATEGORY_KEYS) {
    const r = res[k];
    if (r.tSale > 0) {
      r.debit = (r.oDara * jodiMultiplier) + (r.oAkhar * harufMultiplier);
      r.comm = r.tSale - Math.round(r.tSale * commPercent);
      r.credit = r.comm - r.debit;

      grandTSale += r.tSale;
      grandODara += r.oDara;
      grandOAkhar += r.oAkhar;
      grandDebit += r.debit;
      grandComm += r.comm;
      grandNetBalance += r.credit;

      breakdown[k] = r;
    }
  }

  return {
    grandTSale,
    grandODara,
    grandOAkhar,
    grandDebit,
    grandComm,
    grandNetBalance,
    breakdown,
    rateLabel: `${rateStr}-9/10`
  };
}

let canvasModule = null;
try {
  canvasModule = require('@napi-rs/canvas');
} catch {}

function generateExactBillImageWithPassing(data) {
  if (!canvasModule) return null;
  try {
    const { createCanvas } = canvasModule;
    const dateStr = data.date || formatDateDDMMYYYY();
    const userName = data.userName || 'DEFAULT';
    const rateLabel = data.rateLabel || '90/10-9/10';

    const rows = [];
    const breakdown = data.breakdown || {};
    let sr = 1;

    for (const key of CATEGORY_KEYS) {
      if (breakdown[key] && breakdown[key].tSale > 0) {
        const item = breakdown[key];
        const shiftName = SHIFT_NAMES[key] || key.toUpperCase();
        const winNumSuffix = item.winningNumber ? ` (${item.winningNumber})` : '';

        rows.push({
          sr: sr++,
          shift: `${shiftName}${winNumSuffix}`,
          rate: rateLabel,
          tSale: item.tSale,
          oDara: item.oDara,
          oAkhar: item.oAkhar,
          debit: item.debit,
          comm: item.comm,
          credit: item.credit
        });
      }
    }

    if (rows.length === 0) {
      rows.push({
        sr: 1,
        shift: 'FARIDABAD',
        rate: rateLabel,
        tSale: data.grandTSale || 0,
        oDara: 0,
        oAkhar: 0,
        debit: 0,
        comm: data.grandComm || 0,
        credit: data.grandNetBalance || 0
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
        else if (cIdx === 8) { cellVal = String(r.credit); fontColor = r.credit >= 0 ? '#16a34a' : '#dc2626'; isBold = true; }

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
      { val: String(data.grandTSale || 0), color: '#000000', bold: true },
      { val: String(data.grandODara || 0), color: '#000000', bold: false },
      { val: String(data.grandOAkhar || 0), color: '#000000', bold: false },
      { val: String(data.grandDebit || 0), color: '#dc2626', bold: (data.grandDebit || 0) > 0 },
      { val: String(data.grandComm || 0), color: '#000000', bold: true },
      { val: String(data.grandNetBalance || 0), color: (data.grandNetBalance || 0) >= 0 ? '#16a34a' : '#dc2626', bold: true }
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

    const netBal = data.grandNetBalance || 0;
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 13px "Segoe UI", "Nirmala UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`कुल बकाया (Running Total): ₹${netBal < 0 ? '-' : ''}${Math.abs(netBal).toLocaleString('en-IN')}`, tableX + tableWidth - 10, curRowY + (footerRowHeight / 2));

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('Error generating exact bill image:', err);
    return null;
  }
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

      // Try joining result group
      try {
        await sock.groupAcceptInvite(GROUP_INVITE_CODE);
        console.log(`✅ Successfully joined Result WhatsApp Group (${GROUP_INVITE_CODE})!`);
      } catch {}
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid || '';
        const isGroup = remoteJid.endsWith('@g.us');

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

        const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
        const msgId = msg.key.id;

        if (isDuplicate(msgId, text, remoteJid)) continue;

        botState.totalMessagesProcessed++;
        const todayDate = formatDateDDMMYYYY();
        const timeString = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

        // 1. Group / Direct Result Detection
        const detectedResults = parseResultMessage(text);
        if (detectedResults.length > 0) {
          let updatedList = [];
          for (const r of detectedResults) {
            setResultForShift(todayDate, r.category, r.number);
            updatedList.push(`${SHIFT_NAMES[r.category]} = ${r.number}`);
            console.log(`🎯 [RESULT CAPTURED] ${SHIFT_NAMES[r.category]} (${r.category.toUpperCase()}) -> ${r.number} for Date: ${todayDate}`);
          }
          addLog('result', `Result Captured: ${updatedList.join(', ')}`);
          if (isGroup) return;
        }

        if (isGroup) continue;
        if (remoteJid.includes(TARGET_PHONE_RAW)) continue;

        console.log(`\n========================================`);
        console.log(`📩 Message from +${senderPhone}: "${text}"`);

        const todayResults = getTodayResults(todayDate);

        // Specific Number (9785260088) -> Direct Instant Passing Calculation & Bill Photo
        if (senderPhone.includes('9785260088')) {
          console.log(`🎯 Monitored Message from 9785260088 -> Calculating passing & forwarding...`);
          const calc = calculatePassingReport(text, todayResults, '90/10');
          if (calc && calc.grandTSale > 0) {
            let calcInfo = `\n\n📊 *TSC Passing & Total Report:*\n💰 *Total Sale:* ₹${calc.grandTSale}\n🎯 *Open Dara:* ₹${calc.grandODara}\n⚡ *Debit (Payout):* ₹${calc.grandDebit}\n💵 *Commission (90%):* ₹${calc.grandComm}\n💳 *Net Balance:* ₹${calc.grandNetBalance}`;
            for (const cat in calc.breakdown) {
              const b = calc.breakdown[cat];
              const winSuffix = b.winningNumber ? ` [Open: *${b.winningNumber}*]` : '';
              calcInfo += `\n📍 *${SHIFT_NAMES[cat] || cat.toUpperCase()}${winSuffix}:* Sale ₹${b.tSale} | Debit ₹${b.debit} | Net ₹${b.credit}`;
            }

            const caption = `📩 *New Message from 9785260088:*\n\n${text}${calcInfo}\n\n⏰ *Time:* ${timeString}`;
            const imgBuf = generateExactBillImageWithPassing({
              date: todayDate,
              userName: 'DEFAULT',
              rateLabel: calc.rateLabel,
              grandTSale: calc.grandTSale,
              grandODara: calc.grandODara,
              grandOAkhar: calc.grandOAkhar,
              grandDebit: calc.grandDebit,
              grandComm: calc.grandComm,
              grandNetBalance: calc.grandNetBalance,
              breakdown: calc.breakdown
            });

            if (imgBuf) {
              await sock.sendMessage(TARGET_JID, { image: imgBuf, caption });
              console.log(`🖼️ Bill Photo + Details forwarded to ${TARGET_PHONE_RAW}`);
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

          await sock.sendMessage(remoteJid, {
            text: `Namaste! 🙏\nKripya apna shubh *Naam (Name)* batayein?`
          });

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

          await sock.sendMessage(remoteJid, { text: `Ok` });

          const leadAlert = `✅ *Nayi Contact Detail Mil Gayi!*\n\n👤 *Naam:* ${userName}\n📱 *Phone:* +${senderPhone}\n💬 *First Message:* ${userStates[remoteJid].firstMsg}\n⏰ *Time:* ${timeString}`;
          await sock.sendMessage(TARGET_JID, { text: leadAlert });
          console.log(`🚀 Lead details forwarded to ${TARGET_PHONE_RAW}`);
        }
        // Step 3: Subsequent messages -> Reply "Ok" & Forward
        else if (userStates[remoteJid].stage === 'registered') {
          const userName = userStates[remoteJid].name || senderPhone;
          await sock.sendMessage(remoteJid, { text: `Ok` });
          console.log(`🤖 Replied "Ok" to ${userName}`);

          const calc = calculatePassingReport(text, todayResults, '90/10');
          if (calc && calc.grandTSale > 0) {
            let calcInfo = `\n\n📊 *TSC Passing & Total Report:*\n💰 *Total Sale:* ₹${calc.grandTSale}\n🎯 *Open Dara:* ₹${calc.grandODara}\n⚡ *Debit (Payout):* ₹${calc.grandDebit}\n💵 *Commission (90%):* ₹${calc.grandComm}\n💳 *Net Balance:* ₹${calc.grandNetBalance}`;
            for (const cat in calc.breakdown) {
              const b = calc.breakdown[cat];
              const winSuffix = b.winningNumber ? ` [Open: *${b.winningNumber}*]` : '';
              calcInfo += `\n📍 *${SHIFT_NAMES[cat] || cat.toUpperCase()}${winSuffix}:* Sale ₹${b.tSale} | Debit ₹${b.debit} | Net ₹${b.credit}`;
            }

            const followUpAlert = `💬 *Message from ${userName}* (+${senderPhone}):\n${text}${calcInfo}`;
            const imgBuf = generateExactBillImageWithPassing({
              date: todayDate,
              userName: userName || 'DEFAULT',
              rateLabel: calc.rateLabel,
              grandTSale: calc.grandTSale,
              grandODara: calc.grandODara,
              grandOAkhar: calc.grandOAkhar,
              grandDebit: calc.grandDebit,
              grandComm: calc.grandComm,
              grandNetBalance: calc.grandNetBalance,
              breakdown: calc.breakdown
            });

            if (imgBuf) {
              await sock.sendMessage(TARGET_JID, { image: imgBuf, caption: followUpAlert });
              console.log(`🖼️ Forwarded Bill Photo to ${TARGET_PHONE_RAW}`);
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
  res.json(botState);
});

app.get('/api/results', (req, res) => {
  res.json(resultsMemory);
});

app.post('/api/results', (req, res) => {
  const { date, category, number } = req.body;
  if (!category || number === undefined) {
    return res.status(400).json({ error: 'category and number required' });
  }
  const d = date || formatDateDDMMYYYY();
  setResultForShift(d, category, number);
  res.json({ success: true, results: getTodayResults(d) });
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TSC Pro Passing & Forwarder Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { background-color: #0b1329; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; }
    .badge-status { font-size: 0.9rem; padding: 6px 12px; }
  </style>
</head>
<body class="p-4">
  <div class="container" style="max-width: 900px;">
    <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom border-secondary">
      <div>
        <h3 class="fw-bold text-teal mb-0" style="color: #2dd4bf;"><i class="fa-solid fa-bolt me-2"></i>TSC Passing Bot Dashboard</h3>
        <p class="text-secondary small mb-0">Live WhatsApp Forwarder & Result Passing Engine</p>
      </div>
      <div>
        <span id="statusBadge" class="badge bg-secondary badge-status">Connecting...</span>
      </div>
    </div>
    
    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Connected As</div>
          <div id="connectedAs" class="fs-5 fw-bold text-light mt-1">Not Connected</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Messages Processed</div>
          <div id="msgCount" class="fs-5 fw-bold text-success mt-1">0</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Target Phone</div>
          <div class="fs-5 fw-bold text-info mt-1">+91 80058 44014</div>
        </div>
      </div>
    </div>

    <div class="card p-3 mb-4" id="qrContainer" style="display:none;">
      <h5 class="fw-bold text-warning text-center mb-3">📱 WhatsApp QR Code (Scan to Connect)</h5>
      <div class="text-center">
        <img id="qrImg" src="" alt="QR Code" class="img-fluid rounded shadow" style="max-width: 280px;">
      </div>
    </div>

    <div class="card p-3">
      <h5 class="fw-bold text-light mb-3"><i class="fa-solid fa-clock-rotate-left me-2"></i>Live Activity Logs</h5>
      <div id="logsContainer" style="max-height: 280px; overflow-y: auto; font-family: monospace; font-size: 13px;">
        <div class="text-muted">Listening for messages...</div>
      </div>
    </div>
  </div>

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
          document.getElementById('qrContainer').style.display = 'none';
        } else if (data.status === 'qr_ready') {
          badge.className = 'badge bg-warning text-dark badge-status';
          badge.innerHTML = '<i class="fa-solid fa-qrcode me-1"></i> Scan QR';
          if (data.qrDataUrl) {
            document.getElementById('qrImg').src = data.qrDataUrl;
            document.getElementById('qrContainer').style.display = 'block';
          }
        }
        document.getElementById('msgCount').innerText = data.totalMessagesProcessed || 0;
        
        if (data.recentLogs && data.recentLogs.length > 0) {
          document.getElementById('logsContainer').innerHTML = data.recentLogs.map(function(l) {
            return '<div class="py-1 border-bottom border-secondary border-opacity-25"><span class="text-secondary">[' + l.time + ']</span> ' + l.text + '</div>';
          }).join('');
        }
      } catch {}
    }
    setInterval(updateStatus, 2500);
    updateStatus();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`
======================================================`);
  console.log(`🌐 Web Dashboard: http://localhost:${PORT}`);
  console.log(`🎯 Target Phone:  +91 ${TARGET_PHONE_RAW}`);
  console.log(`======================================================
`);
  startWhatsAppBot();
});
