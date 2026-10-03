/**
 * AI Stock Research Assistant - WhatsApp Bot & Live Market Dashboard
 * - Real-time Stock Market Quotes & Data (NSE, BSE, US Markets, Crypto, Commodities)
 * - Automated Technical Analysis: RSI (14), 50-day & 200-day Moving Averages
 * - Support & Resistance Levels, Trade Plan (Entry, Targets, Stop-loss)
 * - AI Powered Financial Analysis & Conversational Market Intelligence
 * - Zero betting/lottery code, pure 100% Stock Market & Investment AI
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
const PORT = process.env.PORT || 2785;
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const CONFIG_FILE = path.join(__dirname, 'ai_stock_config.json');

// Memory Persistence for AI settings
let appConfig = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    appConfig = { ...appConfig, ...saved };
  } catch {}
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf8');
  } catch {}
}

// Bot State
const botState = {
  status: 'connecting',
  qrDataUrl: null,
  qrRaw: null,
  connectedNumber: null,
  startTime: new Date().toISOString(),
  totalQueriesProcessed: 0,
  recentLogs: [],
};

function addLog(type, text) {
  const time = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  botState.recentLogs.unshift({ time, type, text });
  if (botState.recentLogs.length > 50) botState.recentLogs.pop();
}

// Message Deduplication
const processedMessages = new Set();
function isDuplicate(msgId, text, from) {
  const key = msgId || `${from}_${text}`;
  if (processedMessages.has(key)) return true;
  processedMessages.add(key);
  setTimeout(() => processedMessages.delete(key), 12000);
  return false;
}

// ==================== STOCK TICKER DICTIONARY & ALIASES ====================
const POPULAR_STOCKS = {
  'RELIANCE': 'RELIANCE.NS',
  'TATA MOTORS': 'TMPV.NS',
  'TATAMOTORS': 'TMPV.NS',
  'TMCV': 'TMCV.NS',
  'TMPV': 'TMPV.NS',
  'TATA STEEL': 'TATASTEEL.NS',
  'TATASTEEL': 'TATASTEEL.NS',
  'TCS': 'TCS.NS',
  'INFY': 'INFY.NS',
  'INFOSYS': 'INFY.NS',
  'HDFC': 'HDFCBANK.NS',
  'HDFCBANK': 'HDFCBANK.NS',
  'ICICI': 'ICICIBANK.NS',
  'ICICIBANK': 'ICICIBANK.NS',
  'SBIN': 'SBIN.NS',
  'SBI': 'SBIN.NS',
  'SUZLON': 'SUZLON.NS',
  'ZOMATO': 'ZOMATO.NS',
  'ITC': 'ITC.NS',
  'WIPRO': 'WIPRO.NS',
  'ADANIENT': 'ADANIENT.NS',
  'ADANI PORTS': 'ADANIPORTS.NS',
  'ADANIPORTS': 'ADANIPORTS.NS',
  'ADANIPOWER': 'ADANIPOWER.NS',
  'BAJFINANCE': 'BAJFINANCE.NS',
  'BAJAJ FINANCE': 'BAJFINANCE.NS',
  'BAJAJ AUTO': 'BAJAJ-AUTO.NS',
  'BHARTI AIRTEL': 'BHARTIARTL.NS',
  'AIRTEL': 'BHARTIARTL.NS',
  'L&T': 'LT.NS',
  'LT': 'LT.NS',
  'LARSEN': 'LT.NS',
  'MARUTI': 'MARUTI.NS',
  'M&M': 'M&M.NS',
  'MAHINDRA': 'M&M.NS',
  'HINDUNILVR': 'HINDUNILVR.NS',
  'HUL': 'HINDUNILVR.NS',
  'KOTAKBANK': 'KOTAKBANK.NS',
  'KOTAK': 'KOTAKBANK.NS',
  'AXISBANK': 'AXISBANK.NS',
  'AXIS': 'AXISBANK.NS',
  'TITAN': 'TITAN.NS',
  'ASIANPAINTS': 'ASIANPAINT.NS',
  'ASIAN PAINT': 'ASIANPAINT.NS',
  'HAL': 'HAL.NS',
  'BEL': 'BEL.NS',
  'BHEL': 'BHEL.NS',
  'IREDA': 'IREDA.NS',
  'IRFC': 'IRFC.NS',
  'RVNL': 'RVNL.NS',
  'NHPC': 'NHPC.NS',
  'TRENT': 'TRENT.NS',
  'VEDANTA': 'VEDL.NS',
  'VEDL': 'VEDL.NS',
  'COAL INDIA': 'COALINDIA.NS',
  'COALINDIA': 'COALINDIA.NS',
  'ONGC': 'ONGC.NS',
  'NTPC': 'NTPC.NS',
  'POWERGRID': 'POWERGRID.NS',
  'IOC': 'IOC.NS',
  'BPCL': 'BPCL.NS',
  'YES BANK': 'YESBANK.NS',
  'YESBANK': 'YESBANK.NS',
  'IDEA': 'IDEA.NS',
  'VODAFONE IDEA': 'IDEA.NS',
  'PAYTM': 'PAYTM.NS',
  'NYKAA': 'NYKAA.NS',
  'POLICYBAZAAR': 'POLICYBZR.NS',
  'NIFTY': '^NSEI',
  'NIFTY50': '^NSEI',
  'NIFTY 50': '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'BANK NIFTY': '^NSEBANK',
  'SENSEX': '^BSESN',
  'GOLD': 'GC=F',
  'SILVER': 'SI=F',
  'CRUDE': 'CL=F',
  'CRUDE OIL': 'CL=F',
  'BITCOIN': 'BTC-USD',
  'BTC': 'BTC-USD',
  'ETH': 'ETH-USD',
  'ETHEREUM': 'ETH-USD',
  'APPLE': 'AAPL',
  'TESLA': 'TSLA',
  'MICROSOFT': 'MSFT',
  'NVIDIA': 'NVDA',
  'GOOGLE': 'GOOGL',
  'AMAZON': 'AMZN',
  'META': 'META'
};

// ==================== STOCK DATA & TECHNICAL ENGINE ====================
async function resolveSymbol(rawQuery) {
  const clean = rawQuery.trim();
  const upper = clean.toUpperCase();

  // Check alias map
  if (POPULAR_STOCKS[upper]) return POPULAR_STOCKS[upper];

  // If ends with .NS, .BO, .US, or starts with ^, use directly
  if (upper.includes('.') || upper.startsWith('^') || upper.includes('-') || upper.includes('=')) {
    return upper;
  }

  // Try Yahoo Search
  try {
    const sUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=3&newsCount=0`;
    const sRes = await fetch(sUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const sData = await sRes.json();
    if (sData?.quotes?.length > 0) {
      return sData.quotes[0].symbol;
    }
  } catch {}

  // Default to NSE
  return `${upper}.NS`;
}

async function fetchStockAnalysis(query) {
  try {
    const symbol = await resolveSymbol(query);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const json = await res.json();
    const res0 = json?.chart?.result?.[0];
    if (!res0) return null;

    const meta = res0.meta;
    const quotes = res0.indicators?.quote?.[0];
    const rawCloses = quotes?.close?.filter((c) => c !== null && !isNaN(c)) || [];
    const rawHighs = quotes?.high?.filter((c) => c !== null && !isNaN(c)) || [];
    const rawLows = quotes?.low?.filter((c) => c !== null && !isNaN(c)) || [];
    const rawVolumes = quotes?.volume?.filter((c) => c !== null && !isNaN(c)) || [];

    if (rawCloses.length === 0) return null;

    const cmp = meta.regularMarketPrice || rawCloses[rawCloses.length - 1];
    const prevClose = meta.chartPreviousClose || rawCloses[rawCloses.length - 2] || cmp;
    const change = cmp - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    const isPositive = change >= 0;

    // Technical SMA 50 & SMA 200
    const sma50Closes = rawCloses.slice(-50);
    const sma50 = sma50Closes.reduce((a, b) => a + b, 0) / (sma50Closes.length || 1);

    const sma200Closes = rawCloses.slice(-200);
    const sma200 = sma200Closes.reduce((a, b) => a + b, 0) / (sma200Closes.length || 1);

    // RSI (14-period)
    let rsi = 50;
    if (rawCloses.length >= 15) {
      let gains = 0, losses = 0;
      for (let i = rawCloses.length - 14; i < rawCloses.length; i++) {
        const diff = rawCloses[i] - rawCloses[i - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
      }
      const avgGain = gains / 14;
      const avgLoss = losses / 14;
      if (avgLoss === 0) rsi = 100;
      else {
        const rs = avgGain / avgLoss;
        rsi = 100 - (100 / (1 + rs));
      }
    }

    // Support and Resistance (Swing high/low of last 30 days)
    const recent30Lows = rawLows.slice(-30);
    const recent30Highs = rawHighs.slice(-30);
    const s1 = recent30Lows.length > 0 ? Math.min(...recent30Lows) : cmp * 0.95;
    const r1 = recent30Highs.length > 0 ? Math.max(...recent30Highs) : cmp * 1.05;
    const s2 = s1 * 0.96;
    const r2 = r1 * 1.04;

    // Trend determination
    let trend = '🟡 NEUTRAL / CONSOLIDATION';
    let trendSignal = 'ACCUMULATE ON DIPS';
    if (cmp > sma50 && sma50 > sma200) {
      trend = '🟢 STRONG BULLISH (Up-Trend)';
      trendSignal = 'BUY ON DIPS (Strong Trend)';
    } else if (cmp > sma200) {
      trend = '🟢 MODERATE BULLISH (Above 200 SMA)';
      trendSignal = 'BUY WITH STRICT STOP-LOSS';
    } else if (cmp < sma50 && cmp < sma200) {
      trend = '🔴 BEARISH (Down-Trend)';
      trendSignal = 'CAUTION / WAIT FOR REVERSAL';
    } else if (cmp < sma50 && cmp > sma200) {
      trend = '🟡 PULLBACK / CORRECTION';
      trendSignal = 'WATCH SUPPORT AT 200 SMA';
    }

    // RSI Interpretation
    let rsiZone = 'Neutral Zone (40-60)';
    if (rsi >= 70) rsiZone = '⚠️ Overbought (>70) - Watch for Profit Booking';
    else if (rsi <= 30) rsiZone = '🔥 Oversold (<30) - Potential Rebound / Value Buying';
    else if (rsi > 60) rsiZone = 'Bullish Momentum (60-70)';
    else if (rsi < 40) rsiZone = 'Weak Momentum (30-40)';

    const curr = meta.currency === 'INR' ? '₹' : (meta.currency === 'USD' ? '$' : `${meta.currency} `);
    const companyName = meta.longName || meta.shortName || symbol;

    // Target Projections
    const shortTermTarget = (cmp * 1.05).toFixed(2);
    const mediumTermTarget = (cmp * 1.12).toFixed(2);
    const stopLoss = (cmp * 0.95).toFixed(2);

    const report = `📊 *AI STOCK RESEARCH REPORT* 📊
━━━━━━━━━━━━━━━━━━━━━
🏢 *${companyName}*
📌 *Ticker:* \`${symbol}\` | *Exchange:* ${meta.exchangeName || meta.fullExchangeName || 'NSE'}

💰 *Current Market Price (CMP):* ${curr}${cmp.toFixed(2)}
📈 *Today's Change:* ${isPositive ? '🟢 +' : '🔴 '}${change.toFixed(2)} (${isPositive ? '+' : ''}${changePct.toFixed(2)}%)
📊 *Day's Range:* ${curr}${meta.regularMarketDayLow || 'N/A'} - ${curr}${meta.regularMarketDayHigh || 'N/A'}
🏔️ *52-Week Range:* ${curr}${meta.fiftyTwoWeekLow || 'N/A'} - ${curr}${meta.fiftyTwoWeekHigh || 'N/A'}
📦 *Volume:* ${Number(meta.regularMarketVolume || 0).toLocaleString('en-IN')}

━━━━━━━━━━━━━━━━━━━━━
📈 *TECHNICAL ANALYSIS & INDICATORS*
• *Trend:* ${trend}
• *RSI (14):* ${rsi.toFixed(1)} (${rsiZone})
• *50-Day SMA:* ${curr}${sma50.toFixed(2)} (${cmp > sma50 ? 'Above 50 SMA 🟢' : 'Below 50 SMA 🔴'})
• *200-Day SMA:* ${curr}${sma200.toFixed(2)} (${cmp > sma200 ? 'Above 200 SMA 🟢' : 'Below 200 SMA 🔴'})

🎯 *KEY SUPPORT & RESISTANCE LEVELS*
• *Immediate Resistance (R1):* ${curr}${r1.toFixed(2)}
• *Major Resistance (R2):* ${curr}${r2.toFixed(2)}
• *Immediate Support (S1):* ${curr}${s1.toFixed(2)}
• *Strong Support (S2):* ${curr}${s2.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━
🤖 *AI PERSPECTIVE & TRADE PLAN*
• *Signal:* *${trendSignal}*
• *Suggested Entry Zone:* ${curr}${(cmp * 0.985).toFixed(2)} - ${curr}${cmp.toFixed(2)}
• *Target 1 (Short-Term):* ${curr}${shortTermTarget} (+5%)
• *Target 2 (Swing/Medium):* ${curr}${mediumTermTarget} (+12%)
• *Strict Stop-Loss:* ${curr}${stopLoss} (-5%)

💡 *Tip:* Stock Market me trade karne se pehle apna risk management aur stop-loss zaroor lagayein.`;

    return {
      symbol,
      companyName,
      cmp,
      change,
      changePct,
      report,
      rawMeta: meta,
    };
  } catch (err) {
    console.error('Error fetching stock analysis:', err.message);
    return null;
  }
}

// Extract potential stock name or ticker from message
function extractStockQuery(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();

  // Remove common filler words
  const words = clean.split(/\s+/);
  if (words.length === 1 && clean.length >= 2 && clean.length <= 15) {
    return clean;
  }

  // Check if query mentions known stock aliases
  const upper = clean.toUpperCase();
  for (const alias of Object.keys(POPULAR_STOCKS)) {
    const rx = new RegExp(`\\b${alias.replace(/[\^\.\=]/g, '')}\\b`, 'i');
    if (rx.test(upper)) {
      return alias;
    }
  }

  // Check phrases like "analysis of RELIANCE", "TCS share price", "Tata motors buy karein"
  const patterns = [
    /(?:share|stock|price|target|analysis|view|report|buy|sell|cmp|future|chart|news)\s+(?:of|for|on|in)?\s*([A-Za-z0-9\.\-\&]+)/i,
    /([A-Za-z0-9\.\-\&]+)\s+(?:ka|ki|ke|share|stock|price|target|analysis|report|kaisa|buy|sell|future)/i,
  ];

  for (const p of patterns) {
    const m = clean.match(p);
    if (m && m[1] && m[1].length >= 2 && m[1].length <= 15) {
      const candidate = m[1].trim();
      const ignoreWords = ['kya', 'kaun', 'aaj', 'kal', 'best', 'good', 'top', 'penny', 'option', 'call', 'put', 'live', 'hai'];
      if (!ignoreWords.includes(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }

  return null;
}

// AI Financial Conversational Brain (Gemini / OpenAI / Built-in Smart Fallback)
async function generateAIAnswer(prompt) {
  // 1. If Gemini API key is configured
  if (appConfig.geminiApiKey) {
    try {
      const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${appConfig.geminiApiKey}`;
      const res = await fetch(gUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `You are an expert Indian Stock Market and Global Financial Research AI Assistant on WhatsApp. Answer the user's question clearly, professionally, and concisely in Hindi/Hinglish (or English if asked in English). Use bullet points, emojis, bold text, and crisp formatting suitable for WhatsApp. Never give reckless financial advice, always provide balanced analysis with risks. Question: ${prompt}`,
                },
              ],
            },
          ],
        }),
      });
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
    } catch (e) {
      console.error('Gemini API error:', e.message);
    }
  }

  // 2. If OpenAI API key is configured
  if (appConfig.openaiApiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appConfig.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert Stock Market AI Assistant on WhatsApp. Provide concise, high-value financial research in Hinglish/English with WhatsApp bullet formatting.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) return text.trim();
    } catch (e) {
      console.error('OpenAI API error:', e.message);
    }
  }

  // 3. Built-in Smart Financial Guidance Fallback
  return `🤖 *AI FINANCIAL RESEARCH ASSISTANT*
━━━━━━━━━━━━━━━━━━━━━
Aapke sawal: *"${prompt}"*

💡 *Market & Investment Guidelines:*
1. **Stock Research:** Kisi bhi specific stock ka live data & technical report dekhne ke liye seedha uska naam bhejein (jaise: \`RELIANCE\`, \`TATAMOTORS\`, \`SUZLON\`, \`TCS\`, \`NIFTY\`).
2. **Diversification:** Apne portfolio ko 10-15 alag-alag strong sectors me divide karein.
3. **Risk Management:** Short-term trades me hamesha 3% se 5% ka strict Stop-Loss follow karein.
4. **Long Term Compounding:** Quality large-cap & fundamentally sound mid-cap stocks me SIP/Dips par accumulate karna long-term wealth banata hai.

📌 *Try asking:*
• \`TATA MOTORS analysis\`
• \`SUZLON price target\`
• \`NIFTY 50\`
• \`RELIANCE\``;
}

// Help Menu Message
function getHelpMenu() {
  return `👋 *Namaste! Main hoon aapka AI Stock Research Assistant* 📈

Aap mujhse kisi bhi Stock ki **Live Price, Technical Indicators (RSI, 50/200 SMA), Support & Resistance** aur **Target Plan** pooch sakte hain!

━━━━━━━━━━━━━━━━━━━━━
🔍 *Kaise Search Karein:*
• Type karein stock ka naam: \`RELIANCE\`, \`TATAMOTORS\`, \`SUZLON\`
• Ya sawal poochein: \`Tata Motors target\`, \`HDFC Bank analysis\`
• Major Indices: \`NIFTY\`, \`BANKNIFTY\`, \`SENSEX\`, \`GOLD\`, \`BTC\`
• Financial Questions: \`PE ratio kya hota hai?\`, \`Best dividend strategy\`

💡 *Abhi kisi bhi stock ka naam type karke bhejiye!*`;
}

// ==================== BAILEYS WHATSAPP BOT ====================
let sock = null;

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🚀 Initializing WhatsApp AI Stock Research Assistant (Baileys v${version.join('.')})...`);
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
      console.log(`\n✅ WhatsApp AI Stock Assistant Connected Successfully as +${userPhone}!\n`);
      addLog('success', `WhatsApp Connected as +${userPhone}`);
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

        const cleanJid = (remoteJid || '').split('@')[0].split(':')[0];
        const senderPhone = cleanJid.replace(/\D/g, '');
        const msgId = msg.key.id;

        if (isDuplicate(msgId, text, remoteJid)) continue;

        botState.totalQueriesProcessed++;
        console.log(`\n========================================`);
        console.log(`📩 Stock Query from +${senderPhone}: "${text}"`);
        addLog('query', `From +${senderPhone}: "${text}"`);

        const lower = text.toLowerCase();

        // 1. Welcome / Help Greetings
        if (['hi', 'hello', 'hey', 'help', 'menu', 'start', 'namaste', 'kaise ho', 'guide'].includes(lower)) {
          const helpMsg = getHelpMenu();
          await sock.sendMessage(remoteJid, { text: helpMsg });
          console.log(`🤖 Sent Help Menu to +${senderPhone}`);
          addLog('reply', `Sent Help Menu -> +${senderPhone}`);
          console.log(`========================================`);
          continue;
        }

        // 2. Try Extracting Stock Symbol for Realtime Analysis
        const stockQuery = extractStockQuery(text);
        let stockResult = null;

        if (stockQuery) {
          console.log(`🔍 Detected Stock Ticker / Name: "${stockQuery}"... Fetching live research data...`);
          stockResult = await fetchStockAnalysis(stockQuery);
        }

        if (stockResult && stockResult.report) {
          await sock.sendMessage(remoteJid, { text: stockResult.report });
          console.log(`📊 Sent AI Stock Research Report for ${stockResult.symbol} to +${senderPhone}`);
          addLog('reply', `Report: ${stockResult.symbol} (CMP: ₹${stockResult.cmp}) -> +${senderPhone}`);
        } else {
          // 3. Fallback to AI Conversational Market Intelligence
          console.log(`🤖 Generating AI Market Response for: "${text}"...`);
          const aiResponse = await generateAIAnswer(text);
          await sock.sendMessage(remoteJid, { text: aiResponse });
          console.log(`🤖 Sent AI Market Intelligence Response to +${senderPhone}`);
          addLog('reply', `AI Answer -> +${senderPhone}`);
        }

        console.log(`========================================`);
      } catch (err) {
        console.error('⚠️ Error processing stock research message:', err.message);
        addLog('error', `Process error: ${err.message}`);
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
  res.json({
    ...botState,
    hasGeminiKey: !!appConfig.geminiApiKey,
    hasOpenAiKey: !!appConfig.openaiApiKey,
    hasGroqKey: !!appConfig.groqApiKey,
  });
});

app.post('/api/config', (req, res) => {
  const { geminiApiKey, openaiApiKey, groqApiKey } = req.body;
  if (geminiApiKey !== undefined) appConfig.geminiApiKey = geminiApiKey.trim();
  if (openaiApiKey !== undefined) appConfig.openaiApiKey = openaiApiKey.trim();
  if (groqApiKey !== undefined) appConfig.groqApiKey = groqApiKey.trim();
  saveConfig();
  res.json({ success: true, message: 'AI Configuration updated successfully!' });
});

app.get('/api/stock', async (req, res) => {
  const query = req.query.q || 'RELIANCE';
  const data = await fetchStockAnalysis(query);
  if (!data) return res.status(404).json({ error: 'Stock not found' });
  res.json(data);
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Stock Research Assistant - WhatsApp Bot Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { background-color: #0b1329; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; }
    .badge-status { font-size: 0.9rem; padding: 6px 12px; }
    .stock-tag { background: #0f172a; border: 1px solid #38bdf8; color: #38bdf8; border-radius: 20px; padding: 4px 12px; font-size: 12px; cursor: pointer; display: inline-block; margin: 2px; }
    .stock-tag:hover { background: #38bdf8; color: #0f172a; }
  </style>
</head>
<body class="p-4">
  <div class="container" style="max-width: 950px;">
    <!-- Top Header -->
    <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom border-secondary">
      <div>
        <h3 class="fw-bold mb-0" style="color: #38bdf8;"><i class="fa-solid fa-chart-line me-2"></i>AI Stock Research WhatsApp Bot</h3>
        <p class="text-secondary small mb-0">Realtime Technical Analysis, Indicators & AI Market Intelligence</p>
      </div>
      <div class="text-end">
        <span id="statusBadge" class="badge bg-secondary badge-status">Connecting...</span>
        <div class="text-success small mt-1 fw-bold"><i class="fa-solid fa-circle me-1" style="font-size: 8px;"></i>Live AI Engine</div>
      </div>
    </div>
    
    <!-- Status Metrics -->
    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Connected WhatsApp</div>
          <div id="connectedAs" class="fs-6 fw-bold text-light mt-1">Not Connected</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">Stock Queries Processed</div>
          <div id="queryCount" class="fs-6 fw-bold text-success mt-1">0</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card p-3">
          <div class="text-secondary small">AI Engine Status</div>
          <div id="aiEngineStatus" class="fs-6 fw-bold text-info mt-1">Realtime Smart Analytics</div>
        </div>
      </div>
    </div>

    <!-- Quick Stock Tickers -->
    <div class="card p-3 mb-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-warning mb-0"><i class="fa-solid fa-bolt me-2"></i>Quick Stock Search & Live Test</h6>
        <span class="text-secondary small">Click any stock to test</span>
      </div>
      <div class="mb-3">
        <span class="stock-tag" onclick="testStock('RELIANCE')">RELIANCE</span>
        <span class="stock-tag" onclick="testStock('TATAMOTORS')">TATA MOTORS</span>
        <span class="stock-tag" onclick="testStock('TCS')">TCS</span>
        <span class="stock-tag" onclick="testStock('HDFCBANK')">HDFC BANK</span>
        <span class="stock-tag" onclick="testStock('SUZLON')">SUZLON</span>
        <span class="stock-tag" onclick="testStock('ZOMATO')">ZOMATO</span>
        <span class="stock-tag" onclick="testStock('INFY')">INFOSYS</span>
        <span class="stock-tag" onclick="testStock('ITC')">ITC</span>
        <span class="stock-tag" onclick="testStock('NIFTY 50')">NIFTY 50</span>
        <span class="stock-tag" onclick="testStock('BANKNIFTY')">BANK NIFTY</span>
        <span class="stock-tag" onclick="testStock('AAPL')">APPLE</span>
        <span class="stock-tag" onclick="testStock('BTC')">BITCOIN</span>
      </div>
      <div class="input-group">
        <input type="text" id="testInput" class="form-control bg-dark text-light border-secondary" placeholder="Enter stock symbol (e.g. SBIN, TATASTEEL, MARUTI, AAPL)..." value="RELIANCE">
        <button class="btn btn-info fw-bold" onclick="runTest()"><i class="fa-solid fa-magnifying-glass me-1"></i> Analyze Stock</button>
      </div>
      <div id="stockOutput" class="mt-3 p-3 bg-dark rounded border border-secondary" style="display:none; white-space: pre-wrap; font-family: monospace; font-size: 13px; max-height: 260px; overflow-y: auto;"></div>
    </div>

    <!-- WhatsApp QR Code (when disconnected) -->
    <div class="card p-3 mb-4" id="qrContainer" style="display:none;">
      <h5 class="fw-bold text-warning text-center mb-3">📱 WhatsApp QR Code (Scan to Connect)</h5>
      <div class="text-center">
        <img id="qrImg" src="" alt="QR Code" class="img-fluid rounded shadow" style="max-width: 280px;">
      </div>
    </div>

    <!-- Live Activity Logs -->
    <div class="card p-3">
      <h5 class="fw-bold text-light mb-3"><i class="fa-solid fa-clock-rotate-left me-2"></i>Live Activity Logs</h5>
      <div id="logsContainer" style="max-height: 250px; overflow-y: auto; font-family: monospace; font-size: 13px;">
        <div class="text-muted">Listening for incoming stock queries...</div>
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
        document.getElementById('queryCount').innerText = data.totalQueriesProcessed || 0;
        
        if (data.recentLogs && data.recentLogs.length > 0) {
          document.getElementById('logsContainer').innerHTML = data.recentLogs.map(function(l) {
            return '<div class="py-1 border-bottom border-secondary border-opacity-25"><span class="text-secondary">[' + l.time + ']</span> ' + l.text + '</div>';
          }).join('');
        }
      } catch {}
    }
    
    async function testStock(sym) {
      document.getElementById('testInput').value = sym;
      runTest();
    }

    async function runTest() {
      const q = document.getElementById('testInput').value.trim();
      if (!q) return;
      const out = document.getElementById('stockOutput');
      out.style.display = 'block';
      out.innerText = '🔍 Fetching live AI technical & fundamental report for ' + q + '...';
      try {
        const res = await fetch('/api/stock?q=' + encodeURIComponent(q));
        const data = await res.json();
        if (data.report) {
          out.innerText = data.report;
        } else {
          out.innerText = '❌ Stock not found or data unavailable for ' + q;
        }
      } catch (e) {
        out.innerText = '⚠️ Error: ' + e.message;
      }
    }

    setInterval(updateStatus, 3000);
    updateStatus();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`
======================================================
🌐 AI Stock Research Dashboard: http://localhost:${PORT}
📈 Realtime Stock Analytics & AI WhatsApp Assistant Live!
======================================================
`);
  startWhatsAppBot();
});
