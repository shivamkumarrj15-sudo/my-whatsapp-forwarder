const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'services_config.json');

let servicesConfig = null;

function loadServicesConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      servicesConfig = JSON.parse(data);
    } else {
      throw new Error('services_config.json not found');
    }
  } catch (err) {
    console.error('Error reading services_config.json:', err.message);
    // Safe default fallback
    servicesConfig = {
      system: {
        version: '2.0.0',
        name: 'AI Service Sales Agent',
        active_services: ['web_development', 'performance_marketing'],
        max_concurrent_services_pitch: 2,
        payment_info: {
          advance_percentage_min: 20,
          advance_percentage_max: 50,
          payment_number: '9785260088',
          payment_methods: ['GPay', 'PhonePe', 'Paytm', 'UPI'],
          verification_phone: '9785260088',
        },
      },
      services: [],
    };
  }
  return servicesConfig;
}

// Initial load
loadServicesConfig();

function getServices() {
  if (!servicesConfig) loadServicesConfig();
  return servicesConfig;
}

function saveServicesConfig(newConfig) {
  servicesConfig = newConfig;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
}

/**
 * Returns the short, genuine, professional initial menu
 */
function getInitialMenu(language = 'hinglish') {
  const cfg = getServices();
  if (language === 'english' && cfg.initial_menu?.english) {
    return cfg.initial_menu.english;
  }
  return cfg.initial_menu?.hinglish ||
    'Hello ji! Hum businesses ko grow karne ke liye do primary services provide karte hain:\n\n1. Web Development (Professional business website, mobile-friendly design, fast loading, WhatsApp integration)\n2. Performance Marketing (Google aur Meta ads campaign setup, targeted audience reach aur regular leads)\n\nAapko inme se kis cheez me zyada interest hai — Website ya Performance Marketing?';
}

/**
 * Dynamically builds the AI system prompt incorporating active services,
 * pricing rules, objection handling, qualification flow, and proposal templates.
 */
function buildSystemPrompt() {
  const cfg = getServices();
  const activeIds = cfg.system?.active_services || ['web_development', 'performance_marketing'];
  const activeServices = (cfg.services || []).filter(s => activeIds.includes(s.id));
  const payment = cfg.system?.payment_info || {
    advance_percentage_min: 20,
    advance_percentage_max: 50,
    payment_number: '9785260088',
    payment_methods: ['GPay', 'PhonePe', 'Paytm', 'UPI'],
    verification_phone: '9785260088',
  };

  const servicesDetailsText = activeServices.map((s, idx) => {
    const pricingTiers = Object.values(s.pricing_rules || {})
      .map(t => `     - ${t.label}: ${t.price_range} (${t.criteria})`)
      .join('\n');

    const objections = Object.entries(s.objection_handling || {})
      .map(([k, v]) => `     - When prospect says '${k}': ${v.angle}. Guidance: ${v.guidance}`)
      .join('\n');

    const questions = (s.qualification_questions || [])
      .map(q => `     - ${q}`)
      .join('\n');

    const steps = (s.process_steps || [])
      .map(st => `     - ${st}`)
      .join('\n');

    return `SERVICE ${idx + 1}: ${s.name} (${s.short_name})
- Tagline: ${s.tagline}
- Description: ${s.description}
- Key Deliverables & Features:
${(s.features || []).map(f => `  * ${f}`).join('\n')}
- Suitable For: ${(s.suitable_for || []).join(', ')}
- Starting Price: ₹${s.starting_price} | Max Example Price: ₹${s.max_example_price}
- Dynamic Pricing Tiers:
${pricingTiers}
- Qualification Questions (Ask only ONE at a time):
${questions}
- Objection Handling:
${objections}
- How It Works (Process):
${steps}`;
  }).join('\n\n');

  return `You are an AI-powered Service Sales Representative chatting 1-on-1 with prospects on WhatsApp.
Your goal is to build genuine trust, understand the prospect's needs, and guide them smoothly toward a customized plan and deal.

CRITICAL ARCHITECTURE & ACTIVE SERVICES:
We currently offer ONLY ${activeServices.length} SERVICES:
${activeServices.map((s, i) => `${i + 1}. ${s.name}`).join(' and ')}.
DO NOT introduce or pitch any other services (No apps, No logo design, No video editing, No standalone SEO, etc.).

============================================================
ACTIVE SERVICE CATALOG & PRICING RULES:
============================================================
${servicesDetailsText}

============================================================
BEHAVIOR & RESPONSE PIPELINE (UNDERSTAND -> THINK -> ADAPT):
============================================================
Whenever the prospect sends ANY message (question, greeting, objection, price inquiry, confirmation, etc.):

STEP 1 — UNDERSTAND:
Identify what the prospect actually said:
- Their requirement and business type (clinic, shop, consultancy, local service)
- Their interest (Website vs Performance Marketing)
- Their objections, questions, budget, or urgency.

STEP 2 — THINK:
Reason internally: What does this specific prospect need right now?
- Do they need a brief answer, a qualification question, pricing, or a customized proposal?
- Never give unnecessary fluff. Keep it genuine, professional, and helpful.

STEP 3 — ADAPT RESPONSE LENGTH:
- Simple question or short message: Give a concise, direct answer (2-3 sentences).
- Request for details: Give a clear, moderately detailed answer explaining benefits.
- Request for a plan / high interest: Give a structured, customized proposal.

============================================================
FIRST MESSAGE / MENU BEHAVIOR:
============================================================
When a new prospect greets ('Hi', 'Hello', 'Hey', 'Namaste') or is contacted for the first time:
- Send a short, professional, genuine greeting presenting the 2 services:
  "Hello ji! Hum businesses ko grow karne ke liye do primary services provide karte hain:
  1. Web Development (Professional business website, 100% mobile-friendly, WhatsApp/contact integration)
  2. Performance Marketing (Google aur Meta ads campaign setup, targeted audience reach aur quality leads)
  Aapko inme se kis cheez me zyada interest hai — Website ya Performance Marketing?"
- Do NOT dump prices or write long paragraphs on the first message.

============================================================
PRICING RULES & LOGIC:
============================================================
- Web Development: Starting ₹5,000 up to ₹10,000 (Simple 1-3 pages: ₹5,000–₹6,500; Medium business: ₹6,500–₹8,000; Advanced: ₹8,000–₹10,000).
- Performance Marketing (Meta & Google Ads Campaign Setup, Daily Optimization & Lead Generation):
  * Starting Price for 1 Month Management is ₹8,000 (Agency Management-only starting fee).
  * Daily Rate Formula: Daily Meta Ad Budget ₹1,000 + 20% Agency/Management Commission (₹200) = ₹1,200 per day total.
  * 1 Day / Daily Trial: ₹1,200/day (Ad budget ₹1,000 + ₹200 management/setup commission).
  * 10 Days Plan: ₹12,000 total (₹10,000 Meta ad budget + 20% agency commission ₹2,000).
  * 20 Days Plan: ₹23,500 total (₹20,000 ad budget + discounted agency commission ₹3,500).
  * 1 Month (30 Days) Full All-Inclusive Package: ₹36,000 total (₹30,000 Meta ad budget + 25% agency fee discounted to ₹36,000 total), OR Agency Management Only starting at ₹8,000/month.
  * Custom Ad Run Day Rule: If the prospect asks for a custom number of days (e.g. 5 days, 7 days, 15 days) or mentions "Custom add run day" / "custom ad", calculate:
    Total Amount = (Days * ₹1,000 Meta Ad Spend) + 20% Agency Commission (Days * ₹200) = Days * ₹1,200.
    Always explain this transparent breakdown so the client knows their daily ad budget and management commission!
- Prices are reasonable estimates based on project scope, NOT rigid fixed barriers.
- NEVER randomly quote the highest price first. Explain the daily ad spend and commission transparently.

============================================================
OBJECTION HANDLING (LOW PRESSURE & HIGH TRUST):
============================================================
1. "Website already hai":
   - Do NOT push a new website aggressively.
   - Ask if their current site is mobile-friendly and fast, OR offer Performance Marketing to drive targeted leads/customers to their existing website!
2. "Price zyada hai" / Low budget:
   - Politely explain what is included (clean mobile design, WhatsApp integration, hosting setup).
   - Offer a starter package within ₹5,000 without compromising quality.
3. "Abhi need nahi hai":
   - Reply warmly and politely: "Bilkul ji, koi issue nahi! Jab bhi aapko requirement ho, aap connect kar sakte hain." Leave the door open.
4. "Details bhejo":
   - Provide a concise customized summary for their specific business category instead of a generic huge brochure.

============================================================
LEAD QUALIFICATION RULE:
============================================================
- Ask ONLY ONE relevant question at a time.
- Gradually understand: Business name, business type, current website/marketing status, and desired timeline.

============================================================
CUSTOMIZED PLAN & FINAL PROPOSAL FORMAT:
============================================================
When the prospect shows clear interest or asks for a proposal/final quote, generate a clean, structured plan:

Recommended Service: [Web Development / Performance Marketing]
What we'll do:
- Deliverable 1
- Deliverable 2
- Deliverable 3
Timeline: [e.g. 3 to 5 days]
Estimated Price: [e.g. ₹5,000 – ₹6,500 based on requirements]
Process: Requirement → Design / Strategy → Setup / Development → Review → Launch
Next Step: Ask for basic business info to get started.

============================================================
ADVANCE PAYMENT & BOSS VERIFICATION CALL RULE:
============================================================
- When the deal is confirmed or user wants to start ('service done', 'deal done', 'final hai', 'kar do'):
  1. Ask for their Name and Contact Number so your boss can verify.
  2. Inform them that ${payment.advance_percentage_min}% to ${payment.advance_percentage_max}% advance payment is required to start work.
  3. Online payment number: ${payment.payment_number} (${payment.payment_methods.join(', ')}).
  4. Boss confirmation call available on: ${payment.verification_phone}.

============================================================
COMMUNICATION STYLE & FORMATTING:
============================================================
- Speak like a top-tier professional sales advisor: respectful ('aap', 'ji'), warm, and consultative.
- Match language: Hindi/Hinglish -> Hindi/Hinglish; English -> English.
- STRICTLY NO robot emojis spam, NO hashtags, NO aggressive countdowns, and NO fake guarantees.
- Clean text suitable for WhatsApp.`;
}

/**
 * Built-in Smart Fallback Engine:
 * Implements the exact same 2-service sales logic deterministically
 * if the AI model is offline or slow.
 */
function executeFallbackLogic(userMessage, history = []) {
  const lower = (userMessage || '').toLowerCase().trim();
  const cfg = getServices();
  const payment = cfg.system?.payment_info || {
    payment_number: '9785260088',
  };

  // 1. Greetings -> Send the 2-service menu
  if (/^(hi|hello|hey|hlo|helo|hy|namaste|good morning|good evening)\b/i.test(lower) || lower === 'hi' || lower === 'hello') {
    return getInitialMenu('hinglish');
  }

  // 2. Service Catalog query
  if (
    lower.includes('kya kya hai') ||
    lower.includes('kya service') ||
    lower.includes('konsi service') ||
    lower.includes('kya kaam') ||
    lower.includes('kya offer') ||
    lower.includes('services') ||
    lower.includes('what do you provide') ||
    lower.includes('what service')
  ) {
    return 'Hum businesses ko grow karne ke liye exclusively 2 services provide karte hain:\n\n1. Web Development: Professional business website (100% mobile-friendly, fast loading, WhatsApp integration) - Starting from ₹5,000.\n2. Performance Marketing: Google aur Meta ads campaign (targeted reach aur high-quality leads) - Starting from ₹8,000/month (ya ₹1,200/day plan).\n\nAapko inme se kis service me zyada interest hai?';
  }

  // 3. Objection: "Website already hai"
  if (
    /(already|pehle se|pahle se|hai mere paas|bani hui|already bani)/i.test(lower) &&
    /(website|site|web)/i.test(lower)
  ) {
    return 'Bahut badiya ji! Agar aapke paas website already bani hui hai, to aap humari Performance Marketing service consider kar sakte hain, jisse aapki existing website par Google aur Meta ads ke zariye genuine customers aur leads aana shuru ho sakein. Kya aap ads run karne ke baare me sochna chahenge?';
  }

  // 3b. Request for Plan / Proposal / Process
  if (
    lower.includes('plan') ||
    lower.includes('proposal') ||
    lower.includes('process kya hai') ||
    lower.includes('kaise kaam hoga') ||
    lower.includes('kaise hoga') ||
    lower.includes('step by step') ||
    lower.includes('customized plan')
  ) {
    if (lower.includes('marketing') || lower.includes('ad')) {
      return `Recommended Service: Performance Marketing\n\nWhat we will do:\n- Google aur Meta (Facebook & Instagram) ads campaign setup\n- Targeted audience aur local location targeting\n- Ad creative guidance aur high-converting copy\n- Daily budget aur lead cost optimization\n- Transparent weekly reporting\n\nTimeline: Campaign goes live in 2 to 3 days\nEstimated Price: Starting ₹8,000/month (Agency Management) | All-Inclusive Plans: 10 Days ₹12,000 | 20 Days ₹23,500 | 1 Month ₹36,000 (Daily ₹1,000 Meta ad budget + 20-25% commission)\n\nProcess:\nStep 1: Goal & target location discussion\nStep 2: Creative & copy preparation\nStep 3: Campaign & tracking setup\nStep 4: Launch\nStep 5: Daily optimization\nStep 6: Weekly review\n\nNext Step: Aapka target location aur daily leads goal kya hai?`;
    }
    return `Recommended Service: Web Development\n\nWhat we will do:\n- Professional business website\n- 100% mobile responsive layout\n- Direct WhatsApp chat aur call now button\n- Contact inquiry form aur services showcase\n- Basic SEO setup Google presence ke liye\n\nTimeline: 3 to 5 working days\nEstimated Price: ₹5,000 – ₹10,000 (Simple: ₹5,000–₹6,500; Medium: ₹6,500–₹8,000)\n\nProcess:\nStep 1: Requirement discussion\nStep 2: Website structure & design\nStep 3: Development & integration\nStep 4: Client review & feedback\nStep 5: Final changes\nStep 6: Official launch\n\nNext Step: Aapka business kis type ka hai (clinic, shop, consultancy ya local service)?`;
  }

  // 4. Objection: "Price zyada hai" / Low budget
  if (
    lower.includes('price zyada') ||
    lower.includes('rate jyada') ||
    lower.includes('expensive') ||
    lower.includes('budget kam') ||
    lower.includes('kam budget') ||
    /\b(1000|1500|2000|2500|3000|4000)\b/.test(lower)
  ) {
    return 'Main samajh sakta hu ji. Humari custom service me complete mobile responsive setup, WhatsApp integration aur basic SEO included hota hai, jiska standard rate ₹5,000 se start hota hai. Lekin agar aapka budget limited hai, to hum aapke liye ek basic starter package ₹5,000 me arrange kar sakte hain. Aapka estimated budget kitna hai?';
  }

  // 5. Objection: "Abhi need nahi hai" / "Not needed"
  if (
    lower.includes('need nahi') ||
    lower.includes('zaroorat nahi') ||
    lower.includes('not interested') ||
    lower.includes('abhi nahi') ||
    lower.includes('later') ||
    lower.includes('baad me')
  ) {
    return 'Bilkul ji, koi baat nahi! Jab bhi aapko future me apne business ke liye professional website ya ads ke through leads ki zaroorat ho, aap hume yahan contact kar sakte hain. Have a great day!';
  }

  // 6. Request for "Details bhejo"
  if (
    lower.includes('details bhejo') ||
    lower.includes('send details') ||
    lower.includes('bhejo details') ||
    lower.includes('share details') ||
    lower.includes('detail batao')
  ) {
    if (lower.includes('marketing') || lower.includes('ad')) {
      return 'Performance Marketing me hum aapke business ke liye Google aur Meta (Facebook/Instagram) par targeted ad campaigns setup karte hain. Isme audience targeting, ad copy, daily performance monitoring aur lead optimization included hota hai (Starting ₹5,000 – ₹8,000). Aapka business kis city/location ko target karna chahta hai?';
    }
    return 'Web Development me hum aapke business ke liye clean, modern aur mobile responsive website banate hain. Isme business services showcase, direct WhatsApp chat button, contact form, fast loading aur basic SEO setup included rehta hai (Starting ₹5,000 – ₹10,000). Aapka business kis category ka hai?';
  }

  // 7. Deal Confirmed / Service Done / Advance Payment
  if (
    lower.includes('service done') ||
    lower.includes('done hai') ||
    lower.includes('deal done') ||
    lower.includes('deal pakki') ||
    lower.includes('final hai') ||
    lower.includes('start kar do') ||
    lower.includes('shuru kar do') ||
    lower.includes('advance bhej') ||
    lower.includes('kar do start')
  ) {
    return `Deal done ji! Ek baar apna Name aur Contact Number yahan share kar dijiye taaki mere boss verify kar sakein. Kaam shuru karne ke liye 20% se 50% advance payment ${payment.payment_number} (GPay, PhonePe, Paytm, UPI) par bhej kar screenshot share kar dijiye. Confirmation ke liye aap direct ${payment.payment_number} par call bhi kar sakte hain!`;
  }

  // 8. Call confirmation / boss verification
  if (
    lower.includes('call karke') ||
    lower.includes('call karna') ||
    lower.includes('call pe') ||
    lower.includes('phone pe baat') ||
    lower.includes('calling')
  ) {
    return `Ji bilkul, aap ${payment.payment_number} par call karke confirm kar sakte hain. Bas pehle apna Name aur Contact Number yahan share kar dijiye taaki mere boss verify kar sakein.`;
  }

  // 9. Customer sharing Name or Phone
  if (
    /\b[6-9]\d{9}\b/.test(lower) ||
    lower.includes('mera naam') ||
    lower.includes('naam mera') ||
    lower.includes('my name is')
  ) {
    return `Thank you ji, aapka name aur contact number note kar liya hai! Mere boss verify karke aapse jald connect karenge. Confirmation ke liye aap ${payment.payment_number} par call bhi kar sakte hain.`;
  }

  // 9b. Custom Ad Run Day / Specific Days Query (e.g. "custom add run day", "10 din", "20 din", "7 days", "1 month")
  const isMarketingContext = lower.includes('marketing') || lower.includes('ad') || lower.includes('meta') || lower.includes('lead') || lower.includes('facebook') || lower.includes('google') || lower.includes('campaign');
  const dayMatch = lower.match(/\b(\d+)\s*(din|day|days|dino)\b/i);

  if (lower.includes('custom add run day') || lower.includes('custom ad run day') || lower.includes('custom ad') || lower.includes('custom day') || lower.includes('custom days') || lower.includes('custom add')) {
    if (dayMatch) {
      const days = parseInt(dayMatch[1], 10);
      if (days > 0 && days <= 365) {
        const adBudget = days * 1000;
        let commission = Math.round(adBudget * 0.20);
        let total = adBudget + commission;
        if (days >= 20 && days < 30) total = 23500;
        if (days >= 30) total = 36000;
        return `Aapke ${days} Din ke Custom Meta Ad Run ka calculation:\n- Daily Meta Ad Budget: ₹${adBudget.toLocaleString('en-IN')} (₹1,000/day)\n- Agency Setup & Management Commission (20%): ₹${commission.toLocaleString('en-IN')}\n- Total ${days} Days Package: ₹${total.toLocaleString('en-IN')}\n\nIsme targeted audience setup, ad copy, daily optimization aur direct WhatsApp leads included hain. Aapka business kis city/location ko target karega?`;
      }
    }
    return 'Aap jitne din chahein utne din ke liye custom Meta/Google ads run kar sakte hain! Per day Meta ad budget ₹1,000 rehta hai + 20% agency management commission, yaani total ₹1,200 per day. Aapko kitne din (jaise 5 din, 10 din, 15 din ya 20 din) ke liye ad chalana hai?';
  }

  // Days matched in marketing context (e.g. "10 din ka kitna", "20 din ka plan", "1 day", "5 days")
  if (dayMatch && (isMarketingContext || lower.includes('kitna') || lower.includes('cost') || lower.includes('plan') || lower.includes('chala') || lower.includes('price') || lower.includes('rate'))) {
    const days = parseInt(dayMatch[1], 10);
    if (days === 1) {
      return '1 Day Meta Ad Run ki cost ₹1,200 rehti hai (₹1,000 Meta ad budget + 20% management setup commission ₹200). Isme targeted audience setup aur ad running included hai. Aap kis product ya service ka ad chalana chahte hain?';
    } else if (days === 10) {
      return '10 Days Meta Ad Campaign ki total cost ₹12,000 aayegi:\n- Meta Ad Budget: ₹10,000 (₹1,000/day)\n- 20% Agency Commission: ₹2,000\n- Total: ₹12,000\n\nIsme audience targeting, creative copy aur daily lead optimization shamil hai. Aapka target location kya hai?';
    } else if (days === 20) {
      return '20 Days Meta Ad Campaign ki total cost discount ke sath ₹23,500 aayegi:\n- Meta Ad Budget: ₹20,000 (₹1,000/day)\n- Agency Commission (Discounted): ₹3,500\n- Total: ₹23,500\n\nIsme A/B testing, retargeting aur daily lead monitoring shamil hai. Aap daily kitni leads expect kar rahe hain?';
    } else if (days === 30 || days === 31) {
      return '1 Month (30 Days) Performance Marketing ke 2 options hain:\n1. Full All-Inclusive Package: ₹36,000 (₹30,000 Meta ad budget + 25% agency fee discount ke sath total ₹36,000).\n2. Agency Management Only: Starting ₹8,000/month (jisme complete campaign setup, daily optimization aur weekly reporting shamil hai, ad budget aap direct pay kar sakte hain).\n\nAapko inme se konsa plan zyada suit karega?';
    } else if (days > 1 && days <= 365) {
      const adBudget = days * 1000;
      const commission = Math.round(adBudget * 0.20);
      const total = days * 1200;
      return `${days} Days ke Meta Ad Run ka breakdown:\n- Daily Ad Budget: ₹${adBudget.toLocaleString('en-IN')} (₹1,000/day)\n- 20% Agency Management Commission: ₹${commission.toLocaleString('en-IN')}\n- Total ${days} Days Package: ₹${total.toLocaleString('en-IN')}\n\nIsme targeted audience research, creative copy aur direct WhatsApp lead generation shamil hai. Aapka primary goal kya hai — phone calls ya direct WhatsApp messages?`;
    }
  }

  // Monthly inquiry
  if ((lower.includes('month') || lower.includes('monthly') || lower.includes('mahine') || lower.includes('mahina') || lower.includes('ek mahina') || lower.includes('1 month')) && (isMarketingContext || lower.includes('cost') || lower.includes('price') || lower.includes('kitna') || lower.includes('add') || lower.includes('ad'))) {
    return '1 Month (30 Days) Performance Marketing ke 2 best options hain:\n\n1. Full All-Inclusive Package: ₹36,000 (₹30,000 Meta ad budget + 25% agency fee discount ke sath total ₹36,000).\n2. Agency Management Only: Starting ₹8,000/month (jisme complete campaign setup, audience targeting, daily optimization aur weekly reporting shamil hai, ad budget aap direct pay kar sakte hain).\n\nAapko inme se konsa option behtar lag raha hai?';
  }

  // 10. Performance Marketing Interest
  if (
    lower.includes('marketing') ||
    lower.includes('performance') ||
    lower.includes('ads') ||
    lower.includes('advertis') ||
    lower.includes('leads') ||
    lower.includes('google ad') ||
    lower.includes('facebook ad') ||
    lower.includes('meta ad')
  ) {
    if (lower.includes('price') || lower.includes('rate') || lower.includes('cost') || lower.includes('kitna') || lower.includes('charges')) {
      return 'Performance Marketing ka starting price 1 Month Management ke liye ₹8,000 se start hota hai, ya Daily Ad Run plan ₹1,200/day hai (₹1,000 Meta ad budget + 20% management commission). Humare paas 10 Days (₹12,000), 20 Days (₹23,500), 1 Month All-Inclusive (₹36,000), aur Custom Days ke plans hain. Aapko kitne din ke liye ads run karne hain?';
    }
    return 'Performance Marketing me hum Meta aur Google par targeted campaigns setup karte hain taaki aapko quality phone calls aur direct WhatsApp leads mil sakein. Humare paas Daily (₹1,200/day), 10 Days (₹12,000), 20 Days (₹23,500) aur Monthly (Starting ₹8,000) plans hain. Aapka target audience local city hai ya all-India?';
  }

  // 11. Web Development Interest
  if (
    lower.includes('website') ||
    lower.includes('web') ||
    lower.includes('site') ||
    lower.includes('portal')
  ) {
    if (lower.includes('price') || lower.includes('rate') || lower.includes('cost') || lower.includes('kitna') || lower.includes('starting')) {
      return 'Website development ka starting price ₹5,000 se ₹10,000 rehta hai project scope ke hisaab se (Simple 1-3 pages website ₹5,000–₹6,500; medium business site ₹6,500–₹8,000; advanced site ₹8,000–₹10,000). Aapko roughly kitne pages aur kis tarah ki website chahiye?';
    }
    return 'Web development me hum 100% mobile-friendly, fast loading business websites banate hain with WhatsApp integration aur basic SEO. Aapka business kis type ka hai (clinic, shop, consultancy ya local service)?';
  }

  // 12. General Price question
  if (lower.includes('price') || lower.includes('rate') || lower.includes('cost') || lower.includes('charges') || lower.includes('kitna lagega')) {
    return 'Humari services ka pricing:\n- Web Development: Starting ₹5,000 se ₹10,000 (scope aur pages ke hisaab se)\n- Performance Marketing: Starting ₹8,000/month (management fee) ya ₹1,200/day (₹1,000 ad budget + 20% commission; 10 days ₹12,000; 1 month ₹36,000 all-inclusive)\n\nAapko inme se kis service ke liye customized quote chahiye?';
  }

  // 13. Default consultative reply
  return 'Hum aapke business ke liye Web Development (starting ₹5,000) aur Performance Marketing (starting ₹8,000/month ya ₹1,200/day) provide karte hain. Aap apne business ke baare me batayein — aapko website banwani hai ya ads ke through leads chahiye?';
}

module.exports = {
  loadServicesConfig,
  getServices,
  saveServicesConfig,
  getInitialMenu,
  buildSystemPrompt,
  executeFallbackLogic,
};
