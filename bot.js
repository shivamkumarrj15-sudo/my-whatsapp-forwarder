/**
 * High-Performance Pure Baileys WhatsApp Bot & Web Dashboard with Live Passing & Group Result Monitor
 * - Auto-joins & listens to Result Group (https://chat.whatsapp.com/KNDH9Jx7PjiLM3cSB1yaKt)
 * - Captures Live Opening Numbers for FB, NFB, GB, ND, PD
 * - Calculates Live Passing & Net Credit
 * - Generates Exact HD Bill Photo Card matching user template
 * - Forwards strictly PURE raw message text to +91 80058 44014 (ZERO extra words)
 * Version: 2.1 (Pure Message Forwarding Mode)
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

// Held / Queued Messages Memory File (Pre-Booking Queue)
const HELD_DB_FILE = path.join(__dirname, 'held_messages.json');
let heldMessages = [];
if (fs.existsSync(HELD_DB_FILE)) {
  try {
    heldMessages = JSON.parse(fs.readFileSync(HELD_DB_FILE, 'utf8'));
    if (!Array.isArray(heldMessages)) heldMessages = [];
  } catch {}
}

function saveHeldMessages() {
  try {
    fs.writeFileSync(HELD_DB_FILE, JSON.stringify(heldMessages, null, 2), 'utf8');
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

// ==================== SHIFT TIMING & CUTOFF CONFIGURATION ====================
// Shift Time Windows (IST - Asia/Kolkata):
// FB: 3:00 PM (15:00) to 5:50 PM (17:50) -> At 5:51 PM is "Not ok" & NO forward
// GB: 6:30 PM (18:30) to 9:50 PM (21:50) -> At 9:51 PM is "Not ok" & NO forward
// ND: 10:00 PM (22:00) to 11:30 PM (23:30) -> At 11:31 PM is "Not ok" & NO forward
// PD: 11:00 PM (23:00) to 3:00 AM next day (03:00) -> At 3:01 AM is "Not ok" & NO forward
const SHIFT_TIME_WINDOWS = {
  fb: {
    name: 'FARIDABAD',
    startMin: 15 * 60 + 0,   // 3:00 PM (900 min)
    endMin: 17 * 60 + 50,    // 5:50 PM (1070 min) -> 5:51 PM is Not ok
    isOvernight: false,
    display: '3:00 PM - 5:50 PM'
  },
  nfb: {
    name: 'NEW FB',
    startMin: 15 * 60 + 0,   // 3:00 PM (900 min)
    endMin: 19 * 60 + 0,     // 7:00 PM (1140 min)
    isOvernight: false,
    display: '3:00 PM - 7:00 PM'
  },
  gb: {
    name: 'GAZIABAAD',
    startMin: 18 * 60 + 30,  // 6:30 PM (1110 min)
    endMin: 21 * 60 + 50,    // 9:50 PM (1310 min) -> 9:51 PM is Not ok
    isOvernight: false,
    display: '6:30 PM - 9:50 PM'
  },
  nd: {
    name: 'GALI',
    startMin: 22 * 60 + 0,   // 10:00 PM (1320 min)
    endMin: 23 * 60 + 30,    // 11:30 PM (1410 min) -> 11:31 PM is Not ok
    isOvernight: false,
    display: '10:00 PM - 11:30 PM'
  },
  pd: {
    name: 'DESHAWER',
    startMin: 23 * 60 + 0,   // 11:00 PM (1380 min)
    endMin: 3 * 60 + 0,      // 3:00 AM next morning (180 min) -> 3:01 AM is Not ok
    isOvernight: true,
    display: '11:00 PM - 3:00 AM'
  }
};

function getKolkataTime() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  let hour = 0, minute = 0, second = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
    if (p.type === 'second') second = parseInt(p.value, 10);
  }
  const totalMinutes = hour * 60 + minute;
  const timeFormatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { hour, minute, second, totalMinutes, timeFormatted };
}

function isShiftTimeOpen(catKey, totalMinutes) {
  const cfg = SHIFT_TIME_WINDOWS[catKey.toLowerCase()];
  if (!cfg) return true;
  if (cfg.isOvernight) {
    return totalMinutes >= cfg.startMin || totalMinutes <= cfg.endMin;
  } else {
    return totalMinutes >= cfg.startMin && totalMinutes <= cfg.endMin;
  }
}

function getShiftStatus(catKey, totalMinutes) {
  const key = catKey.toLowerCase();
  
  if (key === 'fb') {
    // Window: 15:00 (900) - 17:50 (1070)
    if (totalMinutes >= 900 && totalMinutes <= 1070) return 'OPEN';
    if (totalMinutes < 900 && totalMinutes >= 360) return 'FUTURE'; // 6 AM to 3 PM
    return 'EXPIRED'; // After 5:50 PM
  }
  
  if (key === 'gb') {
    // Window: 18:30 (1110) - 21:50 (1310)
    if (totalMinutes >= 1110 && totalMinutes <= 1310) return 'OPEN';
    if (totalMinutes < 1110 && totalMinutes >= 360) return 'FUTURE'; // before 6:30 PM (e.g. during FB)
    return 'EXPIRED'; // After 9:50 PM
  }
  
  if (key === 'nd') {
    // Window: 22:00 (1320) - 23:30 (1410)
    if (totalMinutes >= 1320 && totalMinutes <= 1410) return 'OPEN';
    if (totalMinutes < 1320 && totalMinutes >= 360) return 'FUTURE'; // before 10 PM (e.g. during FB or GB)
    return 'EXPIRED'; // After 11:30 PM
  }
  
  if (key === 'pd') {
    // Window: 23:00 (1380) - 3:00 AM (180)
    if (totalMinutes >= 1380 || totalMinutes <= 180) return 'OPEN';
    if (totalMinutes >= 600 && totalMinutes < 1380) return 'FUTURE'; // 10 AM to 11 PM (e.g. during FB, GB, ND)
    return 'EXPIRED'; // 3:01 AM to 10:00 AM
  }
  
  if (key === 'nfb') {
    if (totalMinutes >= 900 && totalMinutes <= 1140) return 'OPEN';
    if (totalMinutes < 900 && totalMinutes >= 360) return 'FUTURE';
    return 'EXPIRED';
  }
  
  return 'OPEN';
}

function getActiveShift(totalMinutes) {
  for (const k of ['fb', 'gb', 'nd', 'pd', 'nfb']) {
    if (isShiftTimeOpen(k, totalMinutes)) return k;
  }
  return null;
}

function isBetMessage(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  
  // Must contain numbers
  if (!/\d/.test(clean)) return false;

  // 1. Bracket containing numbers e.g. (20), (500), [100], {50}
  const hasBracketAmount = /[\(\[\{]\s*\d+\s*[\)\]\}]/.test(clean);
  // 2. Multiplier / into notation e.g. 12*50, 12 into 50, 12x50, 12=50, 12-50, 12/50
  const hasIntoAmount = /\b\d{1,3}\s*(?:into|int|in|x|\*|=|-|\/)\s*\d{1,6}\b/i.test(clean);
  // 3. Shift keyword present with numbers e.g. "12,12 fb", "12.45 gb", "25 nd"
  const hasShift = /\b(fb|f\.b|faridabad|fd|gb|g\.b|ghaziabad|gzb|gd|nd|n\.d|gali|pd|p\.d|ds|d\.s|desawar|nfb)\b/i.test(clean);
  // 4. Haruf / Andar-Bahar keywords e.g. "andar 1(100)", "bahar 2(50)"
  const hasHaruf = /\b(andar|bahar|a|b|ab|abc|all|cross|r|palti)\b/i.test(clean);

  if (hasBracketAmount || hasIntoAmount) return true;
  if (hasShift && /\d/.test(clean)) return true;
  if (hasHaruf && /\d/.test(clean)) return true;

  return false;
}

function detectShiftsInText(text) {
  if (!text || typeof text !== 'string') return [];
  const clean = text.toLowerCase();
  const matched = new Set();
  for (const k of CATEGORY_KEYS) {
    for (const a of CATEGORIES_MAP[k]) {
      const rx = new RegExp('\\b' + a.replace(/\./g, '\\.?') + '\\b', 'i');
      if (rx.test(clean)) {
        matched.add(k);
        break;
      }
    }
  }
  return Array.from(matched);
}

function checkMessageTimeValidity(text, calc) {
  const { hour, minute, totalMinutes, timeFormatted } = getKolkataTime();
  
  // 1. Check if it's a valid bet message
  if (!isBetMessage(text)) {
    return {
      isBet: false,
      valid: false,
      status: 'INVALID',
      reason: 'Not a valid bet message format',
      replyText: 'Not ok',
      shouldReply: true,
      shouldForward: false,
      shouldHold: false,
      timeFormatted
    };
  }

  // 2. Find shifts in text or calculation (breakdown is an Object: breakdown[k] = r)
  const shiftsFound = new Set(detectShiftsInText(text));
  if (calc && calc.breakdown) {
    for (const key of Object.keys(calc.breakdown)) {
      if (calc.breakdown[key] && calc.breakdown[key].tSale > 0) {
        shiftsFound.add(key.toLowerCase());
      }
    }
  }

  let shiftList = Array.from(shiftsFound);

  // If no explicit shift written (e.g. "12,12(20)"), check current active shift
  if (shiftList.length === 0) {
    const activeShift = getActiveShift(totalMinutes);
    if (activeShift) {
      shiftList = [activeShift];
    } else {
      return {
        isBet: true,
        valid: false,
        status: 'EXPIRED',
        reason: `No shift currently open at ${timeFormatted} IST`,
        replyText: 'Not ok',
        shouldReply: true,
        shouldForward: false,
        shouldHold: false,
        timeFormatted,
        closedShifts: []
      };
    }
  }

  // 3. Classify each shift status: OPEN, FUTURE, or EXPIRED
  const openShifts = [];
  const futureShifts = [];
  const expiredShifts = [];

  for (const s of shiftList) {
    const st = getShiftStatus(s, totalMinutes);
    if (st === 'OPEN') openShifts.push(s);
    else if (st === 'FUTURE') futureShifts.push(s);
    else expiredShifts.push(s);
  }

  // Case A: At least one shift is OPEN right now!
  if (openShifts.length > 0) {
    return {
      isBet: true,
      valid: true,
      status: 'OPEN',
      reason: `Open shift(s): ${openShifts.map(s => SHIFT_NAMES[s] || s.toUpperCase()).join(', ')}`,
      replyText: 'Ok',
      shouldReply: true,
      shouldForward: true,
      shouldHold: false,
      timeFormatted,
      openShifts,
      futureShifts,
      expiredShifts
    };
  }

  // Case B: No shifts open right now, but FUTURE shifts exist (e.g. GB or ND or PD sent in advance)
  // USER REQUIREMENT: "us time me gb wale msg aaye usko hold me rakh de... usme koi reply mat de jaise hi gb ka time aaye tab ok kar ke forward kar de"
  if (futureShifts.length > 0) {
    const targetShift = futureShifts[0]; // primary future shift
    return {
      isBet: true,
      valid: false,
      status: 'FUTURE',
      targetShift: targetShift,
      reason: `Held for future shift: ${SHIFT_NAMES[targetShift] || targetShift.toUpperCase()} (${SHIFT_TIME_WINDOWS[targetShift]?.display})`,
      replyText: null, // Silent hold
      shouldReply: false,
      shouldForward: false,
      shouldHold: true,
      timeFormatted,
      openShifts,
      futureShifts,
      expiredShifts
    };
  }

  // Case C: ALL shifts are EXPIRED (e.g. FB sent during GB at 8 PM)
  // USER REQUIREMENT: "gb ke time me fb ka msg aaaye toh not okk kar"
  const expiredNames = expiredShifts.map(s => SHIFT_NAMES[s] || s.toUpperCase()).join(', ');
  return {
    isBet: true,
    valid: false,
    status: 'EXPIRED',
    reason: `Time closed for shift(s): ${expiredNames} at ${timeFormatted} IST`,
    replyText: 'Not ok',
    shouldReply: true,
    shouldForward: false,
    shouldHold: false,
    timeFormatted,
    openShifts,
    futureShifts,
    expiredShifts
  };
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

// Robust Bet Row Parser
function parseTSCRow(raw, inherited) {
  const entries = [];
  if (!raw || !raw.trim()) return entries;
  let row = raw.trim();

  // Strip WhatsApp forwarding / timestamp prefixes
  row = row.replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '').trim();

  // Normalize delimiters & common amount patterns into (amount)
  let normalized = row
    .replace(/(?:into|int|in|x|\*|=|-|\/)\s*(\d{1,6})/gi, ' ($1) ')
    .replace(/[\[\{]/g, '(')
    .replace(/[\]\}]/g, ')')
    .replace(/["']/g, ' ')
    .trim();

  // Find all category occurrences
  const catMatches = [];
  for (const k of CATEGORY_KEYS) {
    for (const a of CATEGORIES_MAP[k]) {
      const rx = new RegExp('\\b' + a.replace(/\./g, '\\.?') + '\\b', 'gi');
      let m;
      while ((m = rx.exec(normalized)) !== null) {
        catMatches.push({ index: m.index, endIndex: m.index + m[0].length, cat: k, alias: m[0] });
      }
    }
  }

  catMatches.sort((a, b) => a.index - b.index);

  let segments = [];
  if (catMatches.length === 0) {
    if (inherited) segments.push({ text: normalized, cat: inherited, alias: '' });
  } else if (catMatches.length === 1) {
    segments.push({ text: normalized, cat: catMatches[0].cat, alias: catMatches[0].alias });
  } else {
    const hasDigitsBeforeFirstCat = /\d/.test(normalized.substring(0, catMatches[0].index));
    let prevCut = 0;
    if (hasDigitsBeforeFirstCat) {
      for (let i = 0; i < catMatches.length; i++) {
        const cur = catMatches[i];
        const cutEnd = (i === catMatches.length - 1) ? normalized.length : cur.endIndex;
        const segText = normalized.substring(prevCut, cutEnd);
        segments.push({ text: segText, cat: cur.cat, alias: cur.alias });
        prevCut = cur.endIndex;
      }
    } else {
      for (let i = 0; i < catMatches.length; i++) {
        const cur = catMatches[i];
        const cutEnd = (i + 1 < catMatches.length) ? catMatches[i + 1].index : normalized.length;
        const segText = normalized.substring(cur.index, cutEnd);
        segments.push({ text: segText, cat: cur.cat, alias: cur.alias });
      }
    }
  }

  for (const seg of segments) {
    let cat = seg.cat;
    if (!cat) continue;
    let area = seg.text;
    if (seg.alias) {
      area = area.replace(new RegExp('\\b' + seg.alias.replace(/\./g, '\\.?') + '\\b', 'gi'), ' ');
    }

    const isDbl = /\b(ab|abc)\b/i.test(area);
    const parts = area.split(/(\(\d+\))/).map(p => p.trim()).filter(p => p.length > 0);

    for (let i = 0; i < parts.length; i++) {
      const na = parts[i];
      if (na.startsWith('(') && na.endsWith(')')) continue;
      const bp = parts[i + 1];
      let bv = 1;
      if (bp && bp.startsWith('(') && bp.endsWith(')')) {
        bv = parseInt(bp.slice(1, -1), 10) || 1;
        i++;
      }

      const nums = [];
      const rRx = /(\d{1,2})\s*[^\w\d]*to[^\w\d]*\s*(\d{1,2})/gi;
      let rm2;
      while ((rm2 = rRx.exec(na)) !== null) {
        const [, a, b] = rm2;
        const sa = parseInt(a, 10), eb = parseInt(b, 10);
        if (sa >= 1 && eb <= 100 && sa <= eb) {
          for (let n = sa; n <= eb; n++) nums.push(String(n).padStart(2, '0'));
        }
      }

      const stripped = na.replace(rRx, ' ');
      for (const n of (stripped.match(/\b\d{1,3}\b/g) || [])) {
        const v = parseInt(n, 10);
        if (n.length === 2 && v >= 0 && v <= 99) nums.push(String(v).padStart(2, '0'));
        else if (n.length === 1 && v >= 0 && v <= 9) nums.push(String(v).padStart(2, '0'));
        else if (n === '100' || v === 100) nums.push('100');
        else if (n.length === 3 && TRIPLE_NUMBERS.includes(n)) nums.push(n);
      }

      if (nums.length > 0) {
        entries.push({ numbers: [...new Set(nums)], bracketValue: bv, category: cat, isDouble: isDbl });
      }
    }
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

    // Universal font stack with fallbacks for Windows, Linux, Docker
    const fontPrimary = '"Segoe UI", "DejaVu Sans", "Noto Sans", Arial, sans-serif';
    const fontDevanagari = '"Nirmala UI", "Noto Sans Devanagari", "DejaVu Sans", "Segoe UI", Arial, sans-serif';

    // Header Content
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 15px ${fontPrimary}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`BILL REPORT | ${dateStr}`, cardX + 16, cardY + (headerHeight / 2));

    const sendBadgeW = 56;
    const sendBadgeH = 24;
    const sendBadgeX = cardX + cardWidth - 16 - sendBadgeW;
    const sendBadgeY = cardY + ((headerHeight - sendBadgeH) / 2);

    ctx.fillStyle = '#059669';
    roundRect(sendBadgeX, sendBadgeY, sendBadgeW, sendBadgeH, 4, true, false);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 11px ${fontPrimary}`;
    ctx.textAlign = 'center';
    ctx.fillText('SEND', sendBadgeX + (sendBadgeW / 2), sendBadgeY + (sendBadgeH / 2) + 1);

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
      ctx.font = `bold 12px ${fontPrimary}`;
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
        ctx.font = isBold ? `bold 12px ${fontPrimary}` : `12px ${fontPrimary}`;
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
    ctx.font = `bold 12px ${fontPrimary}`;
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
      ctx.font = tCol.bold ? `bold 12px ${fontPrimary}` : `12px ${fontPrimary}`;
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
    ctx.font = `bold 13px ${fontDevanagari}`;
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
    ctx.font = `bold 13px ${fontDevanagari}`;
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
        const todayResults = getTodayResults(todayDate);
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

        // 2. Passing Calculation
        let calc = null;
        try {
          calc = calculatePassingReport(text, todayResults, '90/10');
        } catch (eCalc) {
          console.error('Passing report calc error:', eCalc.message);
        }

        // 3. Shift Timing & Format Validation (FB: 3pm-5:50pm, GB: 6:30pm-9:50pm, ND: 10pm-11:30pm, PD: 11pm-3am)
        const timeCheck = checkMessageTimeValidity(text, calc);
        const { timeFormatted } = getKolkataTime();

        console.log(`\n========================================`);
        console.log(`📩 Message from +${senderPhone}: "${text}"`);

        // Case A: FUTURE Shift -> HOLD Message silently in queue!
        // (e.g. GB or ND or PD sent early during FB or GB)
        if (timeCheck.shouldHold) {
          console.log(`⏳ [HOLD QUEUE] Message from +${senderPhone} saved for ${timeCheck.targetShift.toUpperCase()}.`);
          console.log(`ℹ️ Reason: ${timeCheck.reason} -> Will reply 'Ok' and forward when ${timeCheck.targetShift.toUpperCase()} starts.`);
          
          heldMessages.push({
            id: msgId || `${senderPhone}_${Date.now()}`,
            remoteJid: remoteJid,
            senderPhone: senderPhone,
            text: text,
            targetShift: timeCheck.targetShift,
            receivedAtIST: timeFormatted,
            receivedTimestamp: Date.now()
          });
          saveHeldMessages();

          addLog('hold', `Held msg "${text}" from +${senderPhone} for ${timeCheck.targetShift.toUpperCase()}`);
          console.log(`========================================`);
          continue;
        }

        // Case B: EXPIRED or INVALID -> Reply "Not ok" and STOP!
        if (!timeCheck.valid) {
          console.log(`⏱️ [NOT OK] Message from +${senderPhone} at ${timeFormatted} IST: "${text}"`);
          console.log(`❌ Reason: ${timeCheck.reason} -> Replying "${timeCheck.replyText || 'Not ok'}" and STOPPING forward.`);
          
          try {
            await sock.sendMessage(remoteJid, { text: timeCheck.replyText || 'Not ok' });
            console.log(`🤖 Auto "${timeCheck.replyText || 'Not ok'}" replied to +${senderPhone}`);
            addLog('reply', `Auto '${timeCheck.replyText || 'Not ok'}' -> +${senderPhone} (${timeCheck.reason})`);
          } catch (e) {
            console.error('Error sending Not ok reply:', e.message);
          }

          console.log(`🚫 Forward blocked (Invalid format or Shift closed).`);
          console.log(`========================================`);
          continue;
        }

        // Case C: OPEN Shift -> Reply "Ok" to Sender & Forward!
        try {
          await sock.sendMessage(remoteJid, { text: timeCheck.replyText || 'Ok' });
          console.log(`🤖 Auto "${timeCheck.replyText || 'Ok'}" replied to +${senderPhone}`);
          addLog('reply', `Auto '${timeCheck.replyText || 'Ok'}' -> +${senderPhone}`);
        } catch (e) {
          console.error('Error sending Ok reply:', e.message);
        }

        // Forward to TARGET (8005844014)
        await processAndForwardBet(text, senderPhone, todayDate, todayResults);
        console.log(`========================================`);
      } catch (err) {
        console.error('⚠️ Error processing incoming message:', err.message);
        addLog('error', `Process error: ${err.message}`);
      }
    }
  });

  // Background Checker for Held / Queued Messages (Runs every 15 seconds)
  setInterval(async () => {
    if (!sock || botState.status !== 'connected' || heldMessages.length === 0) return;
    
    const { totalMinutes, timeFormatted } = getKolkataTime();
    const curDate = formatDateDDMMYYYY();
    const curResults = getTodayResults(curDate);
    const remaining = [];

    for (const item of heldMessages) {
      const shiftKey = item.targetShift;
      const status = getShiftStatus(shiftKey, totalMinutes);

      if (status === 'OPEN') {
        console.log(`\n🎉 [HOLD RELEASE] Shift ${shiftKey.toUpperCase()} is NOW OPEN at ${timeFormatted} IST! Processing held msg from +${item.senderPhone}...`);
        
        // 1. Send "Ok" reply to sender
        try {
          await sock.sendMessage(item.remoteJid, { text: 'Ok' });
          console.log(`🤖 Auto 'Ok' replied to +${item.senderPhone} for released ${shiftKey.toUpperCase()} bet.`);
          addLog('reply', `Held released: Auto 'Ok' -> +${item.senderPhone} (${shiftKey.toUpperCase()})`);
        } catch (e) {
          console.error('Error replying Ok to held msg sender:', e.message);
        }

        // 2. Process Passing & Forward to Target (8005844014)
        try {
          await processAndForwardBet(item.text, item.senderPhone, curDate, curResults);
        } catch (eFwd) {
          console.error('Error forwarding released held msg:', eFwd.message);
        }
      } else if (status === 'EXPIRED') {
        console.log(`⚠️ [HOLD EXPIRED] Shift ${shiftKey.toUpperCase()} expired for held message from +${item.senderPhone}.`);
        try {
          await sock.sendMessage(item.remoteJid, { text: 'Not ok' });
          addLog('reply', `Held expired: Auto 'Not ok' -> +${item.senderPhone} (${shiftKey.toUpperCase()})`);
        } catch {}
      } else {
        // Still in FUTURE window -> keep in hold queue!
        remaining.push(item);
      }
    }

    if (remaining.length !== heldMessages.length) {
      heldMessages = remaining;
      saveHeldMessages();
    }
  }, 15000);
}

// Helper to calculate passing report & forward pure message / bill photo to target
async function processAndForwardBet(text, senderPhone, todayDate, todayResults) {
  let calc = null;
  try {
    calc = calculatePassingReport(text, todayResults || getTodayResults(todayDate), '90/10');
  } catch (e) {}

  if (calc && calc.grandTSale > 0) {
    console.log(`📊 Valid bet message -> Calculating passing & generating photo bill...`);
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
      await forwardToTarget({ image: imgBuf, caption: text });
      console.log(`🖼️ Forwarded Bill Photo + Pure Message to ${TARGET_PHONE_RAW}`);
      addLog('forward', `Bill Photo + "${text}" -> ${TARGET_PHONE_RAW}`);
    } else {
      await forwardToTarget({ text: text });
      console.log(`🚀 Forwarded Pure Message to ${TARGET_PHONE_RAW}: "${text}"`);
      addLog('forward', `Forwarded "${text}" -> ${TARGET_PHONE_RAW}`);
    }
  } else {
    // Bet message raw text forward ONLY (bina kisi name ya prefix ke)
    await forwardToTarget({ text: text });
    console.log(`🚀 Forwarded Pure Message to ${TARGET_PHONE_RAW}: "${text}"`);
    addLog('forward', `Forwarded "${text}" -> ${TARGET_PHONE_RAW}`);
  }
}

// Robust Forward Helper with Self-Chat Support & Fallbacks
async function forwardToTarget(payload) {
  const target = '918005844014@s.whatsapp.net';
  try {
    console.log(`📤 Forwarding message to ${target}...`);
    return await sock.sendMessage(target, payload);
  } catch (err) {
    console.error(`❌ Error forwarding to ${target}:`, err.message);
    addLog('warn', `Forward try 1 failed (${err.message}), retrying self JID...`);
    try {
      if (sock.user && sock.user.id) {
        const selfJid = sock.user.id.split(':')[0].replace(/\D/g, '') + '@s.whatsapp.net';
        console.log(`🔄 Retrying forward to self user JID: ${selfJid}...`);
        return await sock.sendMessage(selfJid, payload);
      }
    } catch (e2) {
      console.error(`❌ Retry forward failed:`, e2.message);
      addLog('error', `Forward retry failed: ${e2.message}`);
    }
  }
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
  const { hour, minute, totalMinutes, timeFormatted } = getKolkataTime();
  const shifts = Object.keys(SHIFT_TIME_WINDOWS).map(k => ({
    key: k,
    name: SHIFT_TIME_WINDOWS[k].name,
    display: SHIFT_TIME_WINDOWS[k].display,
    status: getShiftStatus(k, totalMinutes),
    isOpen: isShiftTimeOpen(k, totalMinutes)
  }));
  res.json({
    ...botState,
    kolkataTime: timeFormatted,
    shifts,
    heldCount: heldMessages.length,
    heldMessages: heldMessages.slice(0, 10)
  });
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
    .shift-badge-open { background: #059669; color: #fff; font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; }
    .shift-badge-future { background: #d97706; color: #fff; font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; }
    .shift-badge-closed { background: #dc2626; color: #fff; font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; }
  </style>
</head>
<body class="p-4">
  <div class="container" style="max-width: 900px;">
    <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom border-secondary">
      <div>
        <h3 class="fw-bold text-teal mb-0" style="color: #2dd4bf;"><i class="fa-solid fa-bolt me-2"></i>TSC Passing Bot Dashboard</h3>
        <p class="text-secondary small mb-0">Live WhatsApp Forwarder & Result Passing Engine</p>
      </div>
      <div class="text-end">
        <span id="statusBadge" class="badge bg-secondary badge-status">Connecting...</span>
        <div id="kolkataClock" class="text-info small mt-1 fw-bold">IST: --:--</div>
      </div>
    </div>
    
    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="card p-3">
          <div class="text-secondary small">Connected As</div>
          <div id="connectedAs" class="fs-6 fw-bold text-light mt-1">Not Connected</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card p-3">
          <div class="text-secondary small">Messages Processed</div>
          <div id="msgCount" class="fs-6 fw-bold text-success mt-1">0</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card p-3">
          <div class="text-secondary small">Held Queue (Future)</div>
          <div id="heldCount" class="fs-6 fw-bold text-warning mt-1">0</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card p-3">
          <div class="text-secondary small">Forward Target</div>
          <div class="fs-6 fw-bold text-info mt-1">+91 80058 44014</div>
        </div>
      </div>
    </div>

    <!-- Shift Timings Window Card -->
    <div class="card p-3 mb-4">
      <h6 class="fw-bold text-warning mb-2"><i class="fa-solid fa-clock me-2"></i>Shift Timing Validation & Cutoffs (IST)</h6>
      <div class="table-responsive">
        <table class="table table-dark table-sm table-bordered mb-0 align-middle text-center" style="font-size: 13px;">
          <thead>
            <tr class="table-secondary text-dark">
              <th>Shift</th>
              <th>Valid Window</th>
              <th>Advance Booking Rule</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="shiftTableBody">
            <tr><td><b>FB (Faridabad)</b></td><td>3:00 PM - 5:50 PM</td><td>5:50 PM tak Ok+Forward | 5:51 PM pe Not ok</td><td><span class="badge bg-secondary">Checking...</span></td></tr>
            <tr><td><b>GB (Ghaziabad)</b></td><td>6:30 PM - 9:50 PM</td><td>FB ke time Hold | 6:30 PM pe Ok+Forward</td><td><span class="badge bg-secondary">Checking...</span></td></tr>
            <tr><td><b>ND (Gali)</b></td><td>10:00 PM - 11:30 PM</td><td>GB ke time Hold | 10:00 PM pe Ok+Forward</td><td><span class="badge bg-secondary">Checking...</span></td></tr>
            <tr><td><b>PD (Desawar)</b></td><td>11:00 PM - 3:00 AM</td><td>Din me Hold | 11:00 PM pe Ok+Forward</td><td><span class="badge bg-secondary">Checking...</span></td></tr>
          </tbody>
        </table>
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
        document.getElementById('heldCount').innerText = data.heldCount || 0;
        if (data.kolkataTime) {
          document.getElementById('kolkataClock').innerText = 'IST: ' + data.kolkataTime;
        }

        if (data.shifts && data.shifts.length > 0) {
          const rowsHtml = data.shifts.map(function(s) {
            let statusHtml = '';
            if (s.status === 'OPEN') {
              statusHtml = '<span class="shift-badge-open"><i class="fa-solid fa-check me-1"></i>OPEN (Ok)</span>';
            } else if (s.status === 'FUTURE') {
              statusHtml = '<span class="shift-badge-future"><i class="fa-solid fa-hourglass-start me-1"></i>FUTURE (Hold)</span>';
            } else {
              statusHtml = '<span class="shift-badge-closed"><i class="fa-solid fa-ban me-1"></i>CLOSED (Not ok)</span>';
            }
            let ruleText = '';
            if (s.key === 'fb') ruleText = '5:50 PM tak Ok+Forward | 5:51 PM pe Not ok';
            else if (s.key === 'gb') ruleText = 'FB ke time Hold | 6:30 PM pe Ok+Forward';
            else if (s.key === 'nd') ruleText = 'GB ke time Hold | 10:00 PM pe Ok+Forward';
            else if (s.key === 'pd') ruleText = 'Din me Hold | 11:00 PM pe Ok+Forward';
            else ruleText = s.display + ' tak Ok+Forward';

            return '<tr><td><b>' + s.name + ' (' + s.key.toUpperCase() + ')</b></td><td>' + s.display + '</td><td>' + ruleText + '</td><td>' + statusHtml + '</td></tr>';
          }).join('');
          document.getElementById('shiftTableBody').innerHTML = rowsHtml;
        }
        
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
