/**
 * AI Stock Research Assistant - WhatsApp Bot & Live Market Dashboard
 * - Real-time Stock Market Quotes & Data (NSE, BSE, US Markets, Crypto, Commodities)
 * - Automated Technical Analysis: RSI (14), 50-day & 200-day Moving Averages
 * - Support & Resistance Levels, Trade Plan (Entry, Targets, Stop-loss)
 * - AI Powered Financial Analysis & Conversational Market Intelligence
 *   (OpenRouter AI [DeepSeek / Llama / Claude / Gemini] + Google Gemini + OpenAI + Groq + Built-in)
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
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterModel: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat',
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
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  botState.recentLogs.unshift({ type, text, time });
  if (botState.recentLogs.length > 50) botState.recentLogs.pop();
}

// Deduplication
const processedMessageIds = new Map();
function isDuplicate(msgId, text, sender) {
  const key = `${msgId}_${sender}_${text}`;
  const now = Date.now();
  if (processedMessageIds.has(key)) {
    if (now - processedMessageIds.get(key) < 15000) return true;
  }
  processedMessageIds.set(key, now);
  if (processedMessageIds.size > 200) {
    const cutoff = now - 60000;
    for (const [k, ts] of processedMessageIds.entries()) {
      if (ts < cutoff) processedMessageIds.delete(k);
    }
  }
  return false;
}

// ==================== POPULAR STOCK ALIASES ====================
const POPULAR_STOCKS = {
  'RELIANCE': 'RELIANCE.NS',
  'TATA MOTORS': 'TATAMOTORS.NS',
  'TATAMOTORS': 'TATAMOTORS.NS',
  'TATA POWER': 'TATAPOWER.NS',
  'TATAPOWER': 'TATAPOWER.NS',
  'TATA STEEL': 'TATASTEEL.NS',
  'TATASTEEL': 'TATASTEEL.NS',
  'TCS': 'TCS.NS',
  'INFY': 'INFY.NS',
  'INFOSYS': 'INFY.NS',
  'HDFC BANK': 'HDFCBANK.NS',
  'HDFCBANK': 'HDFCBANK.NS',
  'ICICI BANK': 'ICICIBANK.NS',
  'ICICIBANK': 'ICICIBANK.NS',
  'SBI': 'SBIN.NS',
  'SBIN': 'SBIN.NS',
  'STATE BANK': 'SBIN.NS',
  'SUZLON': 'SUZLON.NS',
  'SUZLON ENERGY': 'SUZLON.NS',
  'ZOMATO': 'ZOMATO.NS',
  'PAYTM': 'PAYTM.NS',
  'ITC': 'ITC.NS',
  'ADANI ENTERPRISES': 'ADANIENT.NS',
  'ADANIENT': 'ADANIENT.NS',
  'ADANI PORTS': 'ADANIPORTS.NS',
  'ADANIPORTS': 'ADANIPORTS.NS',
  'ADANI POWER': 'ADANIPOWER.NS',
  'ADANIPOWER': 'ADANIPOWER.NS',
  'ADANI GREEN': 'ADANIGREEN.NS',
  'ADANIGREEN': 'ADANIGREEN.NS',
  'WIPRO': 'WIPRO.NS',
  'HCLTECH': 'HCLTECH.NS',
  'HCL TECH': 'HCLTECH.NS',
  'BAJFINANCE': 'BAJFINANCE.NS',
  'BAJAJ FINANCE': 'BAJFINANCE.NS',
  'BAJAJ FINSERV': 'BAJAJFINSV.NS',
  'BAJAJ AUTO': 'BAJAJ-AUTO.NS',
  'MARUTI': 'MARUTI.NS',
  'MARUTI SUZUKI': 'MARUTI.NS',
  'M&M': 'M&M.NS',
  'MAHINDRA': 'M&M.NS',
  'BHARTI AIRTEL': 'BHARTIARTL.NS',
  'AIRTEL': 'BHARTIARTL.NS',
  'BHARTIARTL': 'BHARTIARTL.NS',
  'L&T': 'LT.NS',
  'LT': 'LT.NS',
  'LARSEN': 'LT.NS',
  'ASIAN PAINTS': 'ASIANPAINT.NS',
  'ASIANPAINT': 'ASIANPAINT.NS',
  'TITAN': 'TITAN.NS',
  'KOTAK BANK': 'KOTAKBANK.NS',
  'KOTAKBANK': 'KOTAKBANK.NS',
  'AXIS BANK': 'AXISBANK.NS',
  'AXISBANK': 'AXISBANK.NS',
  'SUN PHARMA': 'SUNPHARMA.NS',
  'SUNPHARMA': 'SUNPHARMA.NS',
  'CIPLA': 'CIPLA.NS',
  'DR REDDY': 'DRREDDY.NS',
  'NTPC': 'NTPC.NS',
  'ONGC': 'ONGC.NS',
  'COAL INDIA': 'COALINDIA.NS',
  'COALINDIA': 'COALINDIA.NS',
  'POWERGRID': 'POWERGRID.NS',
  'IOC': 'IOC.NS',
  'BPCL': 'BPCL.NS',
  'HAL': 'HAL.NS',
  'BEL': 'BEL.NS',
  'BHEL': 'BHEL.NS',
  'IREDA': 'IREDA.NS',
  'IRFC': 'IRFC.NS',
  'RVNL': 'RVNL.NS',
  'RAILTEL': 'RAILTEL.NS',
  'IRCTC': 'IRCTC.NS',
  'VEDANTA': 'VEDL.NS',
  'VEDL': 'VEDL.NS',
  'JIO FINANCIAL': 'JIOFIN.NS',
  'JIOFIN': 'JIOFIN.NS',
  'YES BANK': 'YESBANK.NS',
  'YESBANK': 'YESBANK.NS',
  'IDEA': 'IDEA.NS',
  'VODAFONE IDEA': 'IDEA.NS',
  'SWIGGY': 'SWIGGY.NS',
  'OLA ELECTRIC': 'OLAELEC.NS',
  'OLAELEC': 'OLAELEC.NS',
  'NIFTY': '^NSEI',
  'NIFTY50': '^NSEI',
  'NIFTY 50': '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'BANK NIFTY': '^NSEBANK',
  'FINNIFTY': 'NIFTY_FIN_SERVICE.NS',
  'MIDCPNIFTY': 'NIFTY_MIDCAP_100.NS',
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
  'META': 'META',
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
      sma50,
      sma200,
      rsi,
      trend,
      s1,
      r1,
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
    const ignoreSingle = ['hi', 'hello', 'hey', 'help', 'menu', 'kya', 'kaun', 'aaj', 'kal', 'ok', 'good', 'bye'];
    if (!ignoreSingle.includes(clean.toLowerCase())) {
      return clean;
    }
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
    /([A-Za-z0-9\.\-\&]+)\s+(?:ka|ki|ke|share|stock|price|target|analysis|report|kaisa|buy|sell|future|cmp)/i,
  ];

  for (const p of patterns) {
    const m = clean.match(p);
    if (m && m[1] && m[1].length >= 2 && m[1].length <= 15) {
      const candidate = m[1].trim();
      const ignoreWords = ['kya', 'kaun', 'aaj', 'kal', 'best', 'good', 'top', 'penny', 'option', 'call', 'put', 'live', 'hai', 'bhai', 'sir'];
      if (!ignoreWords.includes(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }

  return null;
}

// AI Financial Conversational Brain (OpenRouter AI / Gemini / OpenAI / Groq / Fallback)
async function generateAIAnswer(prompt, stockData = null) {
  let contextPrompt = `User Question / Topic: "${prompt}"`;
  if (stockData && stockData.rawMeta) {
    const meta = stockData.rawMeta;
    contextPrompt += `\n\nLive Real-Time Market Data for ${stockData.companyName} (${stockData.symbol}):
- Current Market Price: ${meta.currency || 'INR'} ${stockData.cmp} (Today: ${stockData.change >= 0 ? '+' : ''}${stockData.changePct.toFixed(2)}%)
- Day High / Low: ${meta.regularMarketDayHigh || 'N/A'} / ${meta.regularMarketDayLow || 'N/A'}
- 52-Week High / Low: ${meta.fiftyTwoWeekHigh || 'N/A'} / ${meta.fiftyTwoWeekLow || 'N/A'}
- 50-Day SMA: ${stockData.sma50?.toFixed(2) || 'N/A'} | 200-Day SMA: ${stockData.sma200?.toFixed(2) || 'N/A'}
- RSI (14): ${stockData.rsi?.toFixed(1) || 'N/A'}
- Trend Status: ${stockData.trend || 'N/A'}
- Support (S1): ${stockData.s1?.toFixed(2) || 'N/A'} | Resistance (R1): ${stockData.r1?.toFixed(2) || 'N/A'}

Please formulate an expert, well-structured financial research response in Hindi/Hinglish (or English if user asked in English). Use bolding, bullet points, emojis, and WhatsApp friendly formatting. Provide actionable insights, technical & fundamental view, entry/exit zones, and risk factors.`;
  } else {
    contextPrompt += `\n\nPlease answer as an expert Indian & Global Stock Market Research AI Assistant. Format the reply cleanly for WhatsApp with emojis, bullet points, and practical financial guidance in Hindi/Hinglish (or English).`;
  }

  // 1. OpenRouter AI (DeepSeek / Llama / Claude / Gemini / Auto)
  if (appConfig.openrouterApiKey) {
    const openrouterModels = [
      appConfig.openrouterModel || 'deepseek/deepseek-chat',
      'deepseek/deepseek-r1',
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'openai/gpt-4o-mini',
    ];

    for (const model of openrouterModels) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appConfig.openrouterApiKey}`,
            'HTTP-Referer': 'https://my-whatsapp-forwarder.onrender.com',
            'X-Title': 'WhatsApp AI Stock Research Assistant',
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                role: 'system',
                content: 'You are an elite Stock Market & Financial Research AI Assistant on WhatsApp. Provide insightful, structured research in Hinglish/English with WhatsApp bullet formatting and emojis.',
              },
              { role: 'user', content: contextPrompt },
            ],
          }),
        });
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text && text.trim().length > 0) return text.trim();
      } catch (e) {
        console.error(`OpenRouter (${model}) error:`, e.message);
      }
    }
  }

  // 2. Google Gemini API (Free & Fast)
  if (appConfig.geminiApiKey) {
    const geminiModels = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
    for (const model of geminiModels) {
      try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${appConfig.geminiApiKey}`;
        const res = await fetch(gUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: contextPrompt }],
              },
            ],
          }),
        });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) return text.trim();
      } catch (e) {
        console.error(`Gemini (${model}) error:`, e.message);
      }
    }
  }

  // 3. Groq API (Free & Fast Llama-3.3)
  if (appConfig.groqApiKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appConfig.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are an expert Stock Market & Financial Research AI Assistant on WhatsApp. Answer concisely and professionally in Hinglish/English with WhatsApp bullet formatting.',
            },
            { role: 'user', content: contextPrompt },
          ],
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.trim().length > 0) return text.trim();
    } catch (e) {
      console.error('Groq API error:', e.message);
    }
  }

  // 4. OpenAI API
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
            { role: 'user', content: contextPrompt },
          ],
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.trim().length > 0) return text.trim();
    } catch (e) {
      console.error('OpenAI API error:', e.message);
    }
  }

  // 5. Built-in Smart Financial Guidance Fallback
  if (stockData && stockData.report) {
    return `${stockData.report}\n\n🤖 *AI Research Note:* Technical signal: *${stockData.trend || 'Consolidation'}*. Follow proper risk management and stop-loss.`;
  }

  return `🤖 *AI FINANCIAL RESEARCH ASSISTANT*
━━━━━━━━━━━━━━━━━━━━━
Aapke sawal: *"${prompt}"*

💡 *Market Research & Key Guidelines:*
1. **Stock Analysis:** Kisi bhi specific share ka live data & technical report dekhne ke liye uska naam type karein (jaise: \`RELIANCE\`, \`TATAMOTORS\`, \`SUZLON\`, \`TCS\`, \`NIFTY\`).
2. **Moving Averages:** 50 SMA & 200 SMA ke upar bane rahne wale shares strong uptrend me mane jate hain.
3. **Risk Management:** Swing trading me 3% se 5% ka strict Stop-Loss zaroor follow karein.
4. **Diversification:** Apne portfolio ko leading blue-chip aur growth stocks me diversify karein.

✨ *Tip:* Deep AI Answers aur detailed Q&A ke liye Dashboard par apna OpenRouter ya Gemini API Key link karein!`;
}

// Help Menu Message
function getHelpMenu() {
  return `👋 *Namaste! Main hoon aapka AI Stock Research Assistant* 📈

Aap mujhse kisi bhi Stock ki **Live Price, Technical Indicators (RSI, 50/200 SMA), Support & Resistance** aur **AI Trade Plan** pooch sakte hain!

━━━━━━━━━━━━━━━━━━━━━
🔍 *Kaise Search Karein:*
• Stock Name / Ticker: \`RELIANCE\`, \`TATAMOTORS\`, \`SUZLON\`, \`TCS\`
• Sawal / Analysis: \`Tata Motors target\`, \`Reliance me invest karein ya nahi?\`
• Indices & Commodities: \`NIFTY 50\`, \`BANKNIFTY\`, \`GOLD\`, \`BITCOIN\`
• Q&A & Research: \`PE ratio kya hota hai?\`, \`Swing trading strategy in Hindi\`

💡 *Abhi kisi bhi stock ka naam ya sawal bhej kar check karein!*`;
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
        console.log(`📩 Stock / AI Query from +${senderPhone}: "${text}"`);
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

        // 2. Check if a stock is mentioned
        const stockQuery = extractStockQuery(text);
        let stockResult = null;

        if (stockQuery) {
          console.log(`🔍 Fetching live data for stock: "${stockQuery}"...`);
          stockResult = await fetchStockAnalysis(stockQuery);
        }

        const words = text.split(/\s+/);
        const hasLLMKey = !!(appConfig.openrouterApiKey || appConfig.geminiApiKey || appConfig.openaiApiKey || appConfig.groqApiKey);
        const isSimpleTicker = words.length <= 2 && stockResult && stockResult.report;

        // 3. Response Generation
        if (isSimpleTicker) {
          // Send crisp real-time technical analysis report
          await sock.sendMessage(remoteJid, { text: stockResult.report });
          console.log(`📊 Sent Technical Report for ${stockResult.symbol} to +${senderPhone}`);
          addLog('reply', `Report: ${stockResult.symbol} (CMP: ₹${stockResult.cmp}) -> +${senderPhone}`);
        } else {
          // Conversational question / financial Q&A / stock research question
          console.log(`🤖 Formulating AI Market Intelligence for: "${text}"...`);
          const aiResponse = await generateAIAnswer(text, stockResult);
          await sock.sendMessage(remoteJid, { text: aiResponse });
          console.log(`🤖 Sent AI Market Intelligence Answer to +${senderPhone}`);
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
    hasOpenrouterKey: !!appConfig.openrouterApiKey,
    openrouterModel: appConfig.openrouterModel || 'deepseek/deepseek-chat',
    hasGeminiKey: !!appConfig.geminiApiKey,
    hasOpenAiKey: !!appConfig.openaiApiKey,
    hasGroqKey: !!appConfig.groqApiKey,
  });
});

app.post('/api/config', (req, res) => {
  const { openrouterApiKey, openrouterModel, geminiApiKey, openaiApiKey, groqApiKey } = req.body;
  if (openrouterApiKey !== undefined) appConfig.openrouterApiKey = openrouterApiKey.trim();
  if (openrouterModel !== undefined) appConfig.openrouterModel = openrouterModel.trim();
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

app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question is required' });
  const stockQuery = extractStockQuery(question);
  let stockData = null;
  if (stockQuery) {
    stockData = await fetchStockAnalysis(stockQuery);
  }
  const answer = await generateAIAnswer(question, stockData);
  res.json({ success: true, answer, stockData });
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
        <p class="text-secondary small mb-0">OpenRouter AI (DeepSeek / Llama) & Real-Time Technical Market Intelligence</p>
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
          <div class="text-secondary small">AI Brain Model</div>
          <div id="aiEngineStatus" class="fs-6 fw-bold text-info mt-1">Loading...</div>
        </div>
      </div>
    </div>

    <!-- OpenRouter AI Settings -->
    <div class="card p-3 mb-4 border-primary">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-primary mb-0"><i class="fa-solid fa-network-wired me-2"></i>Connect OpenRouter AI (DeepSeek / Llama / Gemini / Claude)</h6>
        <a href="https://openrouter.ai/keys" target="_blank" class="btn btn-sm btn-outline-primary fw-bold">
          <i class="fa-solid fa-key me-1"></i> Get OpenRouter API Key
        </a>
      </div>
      <p class="text-secondary small mb-2">
        OpenRouter se aap DeepSeek V3, DeepSeek R1, Llama 3.3, ya Claude se WhatsApp par instant research karwa sakte hain.
      </p>
      <div class="row g-2 mb-2">
        <div class="col-md-7">
          <input type="password" id="openrouterKeyInput" class="form-control bg-dark text-light border-secondary" placeholder="Paste your OpenRouter API Key (sk-or-v1-...)...">
        </div>
        <div class="col-md-5">
          <select id="openrouterModelSelect" class="form-select bg-dark text-light border-secondary">
            <option value="deepseek/deepseek-chat">DeepSeek V3 (deepseek/deepseek-chat)</option>
            <option value="deepseek/deepseek-r1">DeepSeek R1 (deepseek/deepseek-r1)</option>
            <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</option>
            <option value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash (Free)</option>
            <option value="openai/gpt-4o-mini">OpenAI GPT-4o-mini</option>
            <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
          </select>
        </div>
      </div>
      <div class="d-flex justify-content-end">
        <button class="btn btn-primary fw-bold" onclick="saveOpenRouterKey()"><i class="fa-solid fa-floppy-disk me-1"></i> Save OpenRouter Key</button>
      </div>
      <div id="openrouterAlert" class="small mt-2" style="display:none;"></div>
    </div>

    <!-- Google Gemini AI Key Settings -->
    <div class="card p-3 mb-4 border-info">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-info mb-0"><i class="fa-solid fa-robot me-2"></i>Connect Google Gemini AI Key (Alternative)</h6>
        <a href="https://aistudio.google.com/app/apikey" target="_blank" class="btn btn-sm btn-outline-info fw-bold">
          <i class="fa-solid fa-key me-1"></i> Get Free Gemini Key
        </a>
      </div>
      <div class="input-group">
        <input type="password" id="geminiKeyInput" class="form-control bg-dark text-light border-secondary" placeholder="Paste your Google Gemini API Key here (AIzaSy...)...">
        <button class="btn btn-info fw-bold text-dark" onclick="saveGeminiKey()"><i class="fa-solid fa-floppy-disk me-1"></i> Save Gemini Key</button>
      </div>
      <div id="geminiAlert" class="small mt-2" style="display:none;"></div>
    </div>

    <!-- Live AI Q&A & Research Simulator -->
    <div class="card p-3 mb-4">
      <h6 class="fw-bold text-warning mb-2"><i class="fa-solid fa-comments me-2"></i>Ask AI Market Research Question (Live Web Test)</h6>
      <div class="input-group mb-2">
        <input type="text" id="aiQuestionInput" class="form-control bg-dark text-light border-secondary" placeholder="e.g. Reliance share buy karu ya sell?, PE ratio kya hai?, Best dividend stocks..." value="Reliance share me invest karna sahi rahega kya?">
        <button class="btn btn-warning fw-bold text-dark" onclick="askAiQuestion()"><i class="fa-solid fa-brain me-1"></i> Ask AI</button>
      </div>
      <div id="aiAnswerBox" class="p-3 bg-dark rounded border border-secondary" style="display:none; white-space: pre-wrap; font-family: monospace; font-size: 13px; max-height: 250px; overflow-y: auto;"></div>
    </div>

    <!-- Quick Stock Tickers -->
    <div class="card p-3 mb-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold text-success mb-0"><i class="fa-solid fa-bolt me-2"></i>Quick Stock Search & Live Technical Analysis</h6>
        <span class="text-secondary small">Click any stock</span>
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
        <span class="stock-tag" onclick="testStock('GOLD')">GOLD</span>
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
        
        const aiStatus = document.getElementById('aiEngineStatus');
        if (data.hasOpenrouterKey) {
          aiStatus.innerHTML = '<span class="text-success">🟢 OpenRouter AI Active (' + (data.openrouterModel || 'DeepSeek') + ')</span>';
        } else if (data.hasGeminiKey) {
          aiStatus.innerHTML = '<span class="text-success">🟢 Google Gemini AI Active</span>';
        } else if (data.hasOpenAiKey) {
          aiStatus.innerHTML = '<span class="text-success">🟢 OpenAI Active</span>';
        } else if (data.hasGroqKey) {
          aiStatus.innerHTML = '<span class="text-success">🟢 Groq AI Active</span>';
        } else {
          aiStatus.innerHTML = '<span class="text-warning">⚡ Built-in Market Intelligence</span>';
        }

        if (data.recentLogs && data.recentLogs.length > 0) {
          document.getElementById('logsContainer').innerHTML = data.recentLogs.map(function(l) {
            return '<div class="py-1 border-bottom border-secondary border-opacity-25"><span class="text-secondary">[' + l.time + ']</span> ' + l.text + '</div>';
          }).join('');
        }
      } catch {}
    }

    async function saveOpenRouterKey() {
      const key = document.getElementById('openrouterKeyInput').value.trim();
      const model = document.getElementById('openrouterModelSelect').value;
      const alertBox = document.getElementById('openrouterAlert');
      if (!key) {
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-danger';
        alertBox.innerText = 'Please paste a valid OpenRouter API Key (starts with sk-or-...).';
        return;
      }
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openrouterApiKey: key, openrouterModel: model })
        });
        const d = await res.json();
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-success';
        alertBox.innerText = '✅ OpenRouter Key (' + model + ') saved successfully! Live AI Research is active.';
        updateStatus();
      } catch (e) {
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-danger';
        alertBox.innerText = 'Error saving key: ' + e.message;
      }
    }

    async function saveGeminiKey() {
      const key = document.getElementById('geminiKeyInput').value.trim();
      const alertBox = document.getElementById('geminiAlert');
      if (!key) {
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-danger';
        alertBox.innerText = 'Please paste a valid Gemini API Key.';
        return;
      }
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geminiApiKey: key })
        });
        const d = await res.json();
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-success';
        alertBox.innerText = '✅ Gemini API Key saved successfully!';
        updateStatus();
      } catch (e) {
        alertBox.style.display = 'block';
        alertBox.className = 'small mt-2 text-danger';
        alertBox.innerText = 'Error saving key: ' + e.message;
      }
    }

    async function askAiQuestion() {
      const q = document.getElementById('aiQuestionInput').value.trim();
      if (!q) return;
      const box = document.getElementById('aiAnswerBox');
      box.style.display = 'block';
      box.innerText = '🤖 AI is analyzing market data and generating research response...';
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q })
        });
        const data = await res.json();
        if (data.answer) {
          box.innerText = data.answer;
        } else {
          box.innerText = 'No answer generated.';
        }
      } catch (e) {
        box.innerText = 'Error: ' + e.message;
      }
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
      out.innerText = '🔍 Fetching live AI technical report for ' + q + '...';
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
📈 Realtime Stock Analytics & OpenRouter AI Live!
======================================================
`);
  startWhatsAppBot();
});
