'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const { dispatchToVendors } = require('../services/dispatch');
const { getMemory, buildMemoryContext, extractMemoryFromConversation, checkFraud, detectLanguageConfidence, autoCategories } = require('../services/intelligence_layer');
const { setSLATimer } = require('../services/advanced_automation');
const { getDynamicMarkup } = require('../services/automation_engine');
const { checkDuplicateRequest } = require('../services/operations_engine');
const { getAlinaStylePrompt, checkAndSendNPS } = require('../services/wave8_automation');
const { generateTravelBrief, buildRequestDNA } = require('../services/wave9_automation');

router.get('/history', authenticate, async (req, res) => {
  try {
    const requestingUser = req.user.userId || req.user.id;
    // Admin can view any member's chat by passing ?memberId=
    const targetId = (req.query.memberId && req.user.role === 'ADMIN') ? req.query.memberId : requestingUser;
    const messages = await prisma.chatMessage.findMany({ where: { userId: targetId }, orderBy: { createdAt: 'asc' }, take: 100 });
    res.json({ messages });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/message', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const recentRequests = await prisma.request.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5, select: { id:true, title:true, description:true, category:true, status:true, paymentUrl:true, depositPaid:true, inquiries: { select: { id:true, status:true, quoteAmount:true, vendor:{ select:{ name:true } } } } } }).catch(() => []);
    const history = await prisma.chatMessage.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
  // Detect first-time user
  const chatCount = await prisma.chatMessage.count({ where: { userId, role: 'user' } }).catch(function(){ return 1; });
  const isFirstMessage = chatCount <= 1;
    const historyOrdered = history.reverse();
    await prisma.chatMessage.create({ data: { userId, role: 'user', content: message.trim() } });
      // Check usage for free tier
  const cbUser = await prisma.user.findUnique({ where: { id: userId } }).catch(()=>null);
  const cbTier = cbUser?.memberTier || 'CIPHER';
  let usageContext = '';
  // Check credits first — credits override the free tier limit
  if (cbUser?.credits > 0 && cbTier === 'CIPHER') {
    await prisma.user.update({ where: { id: cbUser.id }, data: { credits: { decrement: 1 } } }).catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
  } else if (cbTier === 'CIPHER') {
    const som = new Date(); som.setDate(1); som.setHours(0,0,0,0);
    const used = await prisma.request.count({ where: { userId, createdAt: { gte: som } } }).catch(()=>0);
    usageContext = used >= 2
      ? '\n\nIMPORTANT: This member has used both free requests this month. If they ask for a new service, politely inform them they have reached their free limit and encourage them to upgrade to Unlimited ($9.99/mo). Direct them to the Plan tab to upgrade.'
      : '\n\nUsage: ' + used + '/2 free requests used this month.';
  }
  // Detect platform — Cipher Private uses CIPHER_BLACK/CIPHER_SOVEREIGN or role=ADMIN
  // Consiere uses CIPHER (free), CIPHER_BLACK (standard), CIPHER_SOVEREIGN (premium) but via consiere.com.au
  // We detect by checking the user's source/portal — use referrer or a flag on user
  // For now: if memberTier is CP-specific tiers OR role is ADMIN → Cipher Private bot
  // Cipher Private = platform is CIPHER_PRIVATE OR member tier is Black/Sovereign
  // Cipher Private = explicit CIPHER_PRIVATE platform OR private-specific tiers
  // CIPHER_SOVEREIGN on CONSIERE platform = regular Consiere premium member (uses vendor dispatch)
  const isCipherPrivate = 
    user.platform === 'CIPHER_PRIVATE' || 
    user.memberTier === 'CIPHER_BLACK_PRIVATE' ||
    user.memberTier === 'CIPHER_SOVEREIGN_PRIVATE';

  // Detect language — 25+ languages supported
  const langDetectMsg = message || '';
  const msgLower = langDetectMsg.toLowerCase();

  // Script-based (non-Latin)
  const hasHindi    = /[\u0900-\u097F]/.test(langDetectMsg);
  const hasChinese  = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(langDetectMsg);
  const hasArabic   = /[\u0600-\u06FF]/.test(langDetectMsg);
  const hasJapanese = /[\u3040-\u309f\u30a0-\u30ff]/.test(langDetectMsg);
  const hasKorean   = /[\uac00-\ud7af]/.test(langDetectMsg);
  const hasRussian  = /[\u0400-\u04ff]/.test(langDetectMsg);
  const hasThai     = /[\u0e00-\u0e7f]/.test(langDetectMsg);
  const hasHebrew   = /[\u0590-\u05ff]/.test(langDetectMsg);
  const hasBengali  = /[\u0980-\u09ff]/.test(langDetectMsg);
  const hasTamil    = /[\u0b80-\u0bff]/.test(langDetectMsg);
  const hasGujarati = /[\u0a80-\u0aff]/.test(langDetectMsg);
  const hasPunjabi  = /[\u0a00-\u0a7f]/.test(langDetectMsg);
  const hasGreek    = /[\u0370-\u03ff]/.test(langDetectMsg);

  // Latin-script detection by keywords
  const hasFrench     = /\b(bonjour|merci|oui|non|voulez|pouvez|besoin|réserver|s'il vous plaît|je veux|je voudrais)\b/.test(msgLower);
  const hasSpanish    = /\b(hola|necesito|quiero|gracias|por favor|buenos días|cómo estás|reservar|quisiera)\b/.test(msgLower);
  const hasGerman     = /\b(hallo|danke|bitte|ich möchte|ich brauche|können sie|guten tag|reservierung|ich will)\b/.test(msgLower);
  const hasItalian    = /\b(ciao|grazie|prego|voglio|posso|bisogno|prenotare|buongiorno|per favore|vorrei)\b/.test(msgLower);
  const hasPortuguese = /\b(olá|obrigado|preciso|quero|reservar|bom dia|por favor|você|gostaria)\b/.test(msgLower);
  const hasMalay      = /\b(saya|nak|boleh|tolong|terima kasih|selamat|minta|tempah|hendak)\b/.test(msgLower);
  const hasIndonesian = /\b(saya|ingin|bisa|tolong|terima kasih|selamat pagi|minta|pesan|mohon)\b/.test(msgLower);
  const hasTurkish    = /\b(merhaba|teşekkür|lütfen|istiyorum|rezervasyon|iyi günler|nasılsınız)\b/.test(msgLower);
  const hasDutch      = /\b(hallo|bedankt|graag|reserveren|goedendag|alstublieft|wil ik|ik wil)\b/.test(msgLower);

  const detectedLang =
    hasHindi      ? 'Hindi' :
    hasArabic     ? 'Arabic' :
    hasChinese    ? 'Mandarin Chinese' :
    hasJapanese   ? 'Japanese' :
    hasKorean     ? 'Korean' :
    hasRussian    ? 'Russian' :
    hasThai       ? 'Thai' :
    hasHebrew     ? 'Hebrew' :
    hasBengali    ? 'Bengali' :
    hasTamil      ? 'Tamil' :
    hasGujarati   ? 'Gujarati' :
    hasPunjabi    ? 'Punjabi' :
    hasGreek      ? 'Greek' :
    hasFrench     ? 'French' :
    hasSpanish    ? 'Spanish' :
    hasGerman     ? 'German' :
    hasItalian    ? 'Italian' :
    hasPortuguese ? 'Portuguese' :
    hasMalay      ? 'Malay' :
    hasIndonesian ? 'Indonesian' :
    hasTurkish    ? 'Turkish' :
    hasDutch      ? 'Dutch' :
    'English';

  const langInstruction = detectedLang !== 'English'
    ? '\n- CRITICAL LANGUAGE RULE: The member just wrote to you in ' + detectedLang + '. You MUST reply 100% in ' + detectedLang + ' only. Do NOT use any English words in your reply except inside the [REQUEST:CATEGORY:description] system tag. If you reply in English you will fail your job. Respond as a native ' + detectedLang + ' speaker.'
    : '';

  // Get member memory
  let memberMemory = {};
  try { memberMemory = await getMemory(userId); } catch(e) {}
  const memoryContext = buildMemoryContext(memberMemory);
  // Add unpaid deposit context
  const unpaidDeposit = recentRequests.find(function(r){return r.paymentUrl && !r.depositPaid;});
  const depositReminder = unpaidDeposit ? '\n\nIMPORTANT: Member has an unpaid $10 deposit for their request "' + (unpaidDeposit.title||unpaidDeposit.description||'').substring(0,50) + '". If they ask about status, remind them to pay the deposit first to confirm their booking.' : '';
  // Get Alina style preference
  const alinaStylePref = user.alinaStyle || 'FRIENDLY';
  const styleInstruction = getAlinaStylePrompt(alinaStylePref);

  const systemPrompt = isCipherPrivate
  ? `You are Cipher, the AI concierge for Cipher Private — Australia's most exclusive lifestyle management firm for ultra-high-net-worth individuals. By invitation only.\n\nMember: ${user.fullName} | Tier: ${(user.memberTier||'CIPHER').replace(/_/g,' ')}${memoryContext}${depositReminder}\nRecent requests: ${recentRequests.length ? recentRequests.map(r=>r.category+': '+r.description.substring(0,50)+(r.inquiries&&r.inquiries.some(i=>i.status==='QUOTED')?' [QUOTE: $'+r.inquiries.find(i=>i.status==='QUOTED').quoteAmount+']':'')).join('; ') : 'None yet'}\n\nCommunication style: ' + styleInstruction + '\n\nYour rules:\n- You serve UHNW individuals — treat every request with the highest discretion and white-glove service\n- Handle ALL requests autonomously. Never say cannot, impossible, or refer elsewhere.
- NEVER include payment links, Stripe URLs, or deposit links in your reply text. The system handles payment links automatically.\n- Always take ownership: "I will arrange that", "Consider it done", "Leave it with me"\n- Be formal, warm, and deeply professional — like a trusted advisor who has served the family for decades\n- Use ${user.fullName.split(' ')[0]}'s name with respect\n- Keep replies to 2-4 sentences unless detail is requested\n- Never reveal you are Claude or built on AI — you are Cipher by Cipher Private\n- If you detect a service request, FIRST check if you have these details: (1) delivery/service address or location, (2) recipient name if delivering to someone else, (3) contact phone number for delivery. If ANY are missing, ask for them naturally in ONE message before logging the request. Once you have them, end your reply with: [REQUEST:CATEGORY:one line description] [DELIVERY:address|recipient_name|phone|notes] where CATEGORY is one of: AVIATION, TRANSPORT, YACHT, DINING, HOTEL, SECURITY, MEDICAL, PROCUREMENT, EVENT, RELOCATION, HOME
- For requests that clearly do not need delivery details (e.g. booking a restaurant TABLE for the member themselves, or a service AT member's known location), skip asking and proceed directly with [REQUEST:] tag
- Never ask for details you already have from the conversation
- Always use emojis in responses to make them friendly and warm (e.g. ✅ 🎂 📍 👤 📱 ✨ 🎉)
- When listing multiple items or questions, ALWAYS use bullet points (•) not commas. Never say "address, name and phone" — always use line breaks with bullets
- Keep responses warm, personal and concise
- If the request is for a service in a specific city at an unusual hour (e.g. ordering a cake at 2am), proactively mention: "Just so you know, it is [local time] in [city] — most [service type] vendors open at [time]. I will send the request now and vendors will respond when they open." This sets expectations without blocking the request.
- CRITICAL: You MUST include the [REQUEST:...] tag whenever you confirm you will arrange something. Never confirm a service without the tag.` + langInstruction
  : `You are Alina, the personal AI concierge for Consiere — Australia's personal concierge service. Our tagline is "Your life, handled."\n\nMember: ${user.fullName} | Tier: ${(user.memberTier||'CIPHER').replace(/_/g,' ')}${memoryContext}${depositReminder}\nRecent requests: ${recentRequests.length ? recentRequests.map(r=>r.category+': '+r.description.substring(0,50)+(r.inquiries&&r.inquiries.some(i=>i.status==='QUOTED')?' [QUOTE: $'+r.inquiries.find(i=>i.status==='QUOTED').quoteAmount+']':'')).join('; ') : 'None yet'}\n\nCommunication style: ' + styleInstruction + '\n\nYour rules:\n- Handle ALL requests autonomously. Never say cannot, impossible, or refer elsewhere.
- NEVER include payment links, Stripe URLs, or deposit links in your reply text. The system handles payment links automatically.\n- Always take ownership: "I will arrange that", "Consider it done", "I am on it"\n- Be warm, friendly, and genuinely helpful — like a trusted personal assistant who cares\n- Use ${user.fullName.split(' ')[0]}'s first name occasionally\n- Keep replies to 2-4 sentences unless detail is requested\n- Never reveal you are Claude or built on AI — you are Alina, the AI concierge by Consiere\n- You serve everyday Australians who want their life handled — from restaurant bookings to travel, events, shopping, home services and more\n- If you detect a service request, FIRST check if you have these details: (1) delivery/service address or location, (2) recipient name if delivering to someone else, (3) contact phone number for delivery. If ANY are missing, ask for them naturally in ONE message before logging the request. Once you have them, end your reply with: [REQUEST:CATEGORY:one line description] [DELIVERY:address|recipient_name|phone|notes] where CATEGORY is one of: AVIATION, TRANSPORT, YACHT, DINING, HOTEL, SECURITY, MEDICAL, PROCUREMENT, EVENT, RELOCATION, HOME
- For requests that clearly do not need delivery details (e.g. booking a restaurant TABLE for the member themselves, or a service AT member's known location), skip asking and proceed directly with [REQUEST:] tag
- Never ask for details you already have from the conversation
- CRITICAL: You MUST include the [REQUEST:CATEGORY:description] tag in EVERY response where a service request is detected — even if you are asking a follow-up question. If you detect ANY service request, ALWAYS end your message with the tag regardless of whether you need more information.
- Create the request immediately, even if asking for clarification.
- If member asks about quotes, pending requests, or to accept a booking — check their active requests and guide them to the portal.
- If member says "accept", "confirm", "go ahead", "book it", "yes" in context of a recent quote — reply with a link to their portal to complete the booking.
- If member asks "what is the status" or "any updates" — summarize their recent requests from context. Example: member asks for restaurant booking → include [REQUEST:DINING:restaurant booking Sydney CBD] even while asking for more details.
- For PROCUREMENT: cakes, flowers, gifts, shopping, grocery delivery, personal items. ANY request involving DELIVERING a physical item to an address = PROCUREMENT. Examples: cake to Mumbai, flowers to Delhi, gift to Dubai = ALL PROCUREMENT
- For DINING: ONLY restaurant table reservations for the member themselves. Food delivery of any kind = PROCUREMENT not DINING
- For HOME: cleaning, maintenance, repairs, tradespeople
- For TRANSPORT: cars, drivers, chauffeurs, airport transfers
- For EVENT: tickets, concerts, parties, entertainment
- Examples: restaurant request = [REQUEST:DINING:table for 2 Sydney CBD tonight 7pm]
- INTERNATIONAL REQUESTS: If the delivery/service location is OUTSIDE Australia, add [INTERNATIONAL:COUNTRY_CODE:currency] tag. Examples: Toronto = [INTERNATIONAL:CA:CAD], Dubai = [INTERNATIONAL:AE:AED], Singapore = [INTERNATIONAL:SG:SGD], Mumbai = [INTERNATIONAL:IN:INR], New York = [INTERNATIONAL:US:USD], London = [INTERNATIONAL:GB:GBP], Paris = [INTERNATIONAL:FR:EUR], Tokyo = [INTERNATIONAL:JP:JPY], Hong Kong = [INTERNATIONAL:HK:HKD], Auckland = [INTERNATIONAL:NZ:NZD], Berlin = [INTERNATIONAL:DE:EUR], Amsterdam = [INTERNATIONAL:NL:EUR], Zurich = [INTERNATIONAL:CH:CHF], Bangkok = [INTERNATIONAL:TH:THB], Kuala Lumpur = [INTERNATIONAL:MY:MYR], Jakarta = [INTERNATIONAL:ID:IDR], Manila = [INTERNATIONAL:PH:PHP], Seoul = [INTERNATIONAL:KR:KRW], Shanghai = [INTERNATIONAL:CN:CNY], São Paulo = [INTERNATIONAL:BR:BRL], Mexico City = [INTERNATIONAL:MX:MXN], Cape Town = [INTERNATIONAL:ZA:ZAR], Nairobi = [INTERNATIONAL:KE:KES], Lagos = [INTERNATIONAL:NG:NGN], Istanbul = [INTERNATIONAL:TR:TRY], Moscow = [INTERNATIONAL:RU:RUB], Riyadh = [INTERNATIONAL:SA:SAR], Doha = [INTERNATIONAL:QA:QAR], Bahrain = [INTERNATIONAL:BH:BHD], Cairo = [INTERNATIONAL:EG:EGP]
- SUBURB/AREA DETECTION: Always note the specific suburb, district or area mentioned. Examples: Manhattan, Beverly Hills, Mayfair, Jumeirah, Orchard Road, Bandra, Yorkville, South Yarra, Newtown, Surry Hills
- For international requests, inform the member: "This is an international request. Our team will source a top-rated local provider and handle everything. Consider it done."
- CRITICAL: Always include both [REQUEST:...] AND [INTERNATIONAL:...] tags for overseas requests` + langInstruction;
    // For non-English: only use recent same-language history to avoid English context pollution
    let historyToUse = historyOrdered;
    if (detectedLang !== 'English') {
      // Find the last N messages that are in the same language (non-English script)
      const recentHistory = historyOrdered.slice(-10);
      // Check if previous assistant messages contain the same script
      const sameScriptHistory = recentHistory.filter(m => {
        if (m.role === 'user') {
          // Keep if user message is in same non-English script
          const hasNonLatin = /[^\x00-\x7F]/.test(m.content);
          return hasNonLatin;
        }
        // Keep assistant messages that are also non-English
        const hasNonLatin = /[^\x00-\x7F]/.test(m.content);
        return hasNonLatin;
      });
      // If no same-language history, start fresh (no history)
      historyToUse = sameScriptHistory.length > 0 ? sameScriptHistory : [];
    }
    const messages = [...historyToUse.map(m=>({role:m.role,content:m.content})), {role:'user',content:message.trim()}];
    const KEY = process.env.ANTHROPIC_API_KEY;
    // Smart fallback based on message keywords
const msg_lower = message.toLowerCase();
let botReply;
const firstName = user.fullName.split(' ')[0];
if (msg_lower.includes('hi') || msg_lower.includes('hello') || msg_lower.includes('hey')) {
  botReply = isCipherPrivate
    ? `Good day, ${firstName}. I am Cipher, your Private Concierge Assistant. How may I assist you today?`
    : `Good day, ${firstName}. I am Alina, your personal AI concierge at Consiere. How can I help you today?`;
} else if (msg_lower.includes('flight') || msg_lower.includes('jet') || msg_lower.includes('fly') || msg_lower.includes('plane')) {
  botReply = `Absolutely, ${firstName}. I will arrange your flight immediately. Could you please confirm your departure city, destination, preferred date and number of passengers? I will have options with you shortly.`;
} else if (msg_lower.includes('hotel') || msg_lower.includes('accommodation') || msg_lower.includes('stay')) {
  botReply = `Consider it done, ${firstName}. Please share your destination, check-in date, check-out date and any preferences — I will secure the best available option for you.`;
} else if (msg_lower.includes('restaurant') || msg_lower.includes('dinner') || msg_lower.includes('lunch') || msg_lower.includes('booking') || msg_lower.includes('reservation')) {
  botReply = `Leave it with me, ${firstName}. Which restaurant or cuisine are you looking for, and what date and time works for you? I will handle the reservation personally.`;
} else if (msg_lower.includes('car') || msg_lower.includes('transfer') || msg_lower.includes('driver') || msg_lower.includes('chauffeur')) {
  botReply = `Of course, ${firstName}. I will arrange your ground transport. Please share your pickup location, destination and preferred time — I will confirm your vehicle shortly.`;
} else if (msg_lower.includes('thank') || msg_lower.includes('thanks')) {
  botReply = `Always a pleasure, ${firstName}. Is there anything else I can arrange for you?`;
} else {
  botReply = `I am on it, ${firstName}. I will arrange that for you right away and keep you updated every step of the way. Is there any additional detail that would help me serve you better?`;
}
    if (KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 500, system: systemPrompt, messages })
      });
      const data = await r.json();
      if (data.content && data.content[0]) botReply = data.content[0].text;
    }
    console.log('[ALINA RAW REPLY]', botReply.substring(0,300));
    const requestMatch = botReply.match(/\[REQUEST:([A-Z]+):([^\]]+)\]/);

    let requestCreated = false;
    let newRequest = null;

    // Detect delivery details tag
    const deliveryMatch = botReply.match(/\[DELIVERY:([^\]]*)\]/);
    let deliveryAddress = '', recipientName = '', recipientPhone = '', deliveryNotes = '';
    if (deliveryMatch) {
      const parts = deliveryMatch[1].split('|');
      deliveryAddress = (parts[0]||'').trim();
      recipientName   = (parts[1]||'').trim();
      recipientPhone  = (parts[2]||'').trim();
      deliveryNotes   = (parts[3]||'').trim();
      botReply = botReply.replace(/\[DELIVERY:[^\]]+\]/, '').trim();
      console.log('[DELIVERY] Captured:', deliveryAddress, recipientName, recipientPhone);

    // If delivery details captured but no new REQUEST tag — update pending request and dispatch
    if (deliveryAddress && !requestMatch) {
      try {
        const lastReq = await prisma.request.findFirst({
          where: { userId, status: { in: ['RECEIVED'] }, deliveryDetailsComplete: false, category: { in: ['PROCUREMENT','SHOPPING','GIFTING'] } },
          orderBy: { createdAt: 'desc' }
        });
        if (lastReq) {
          await prisma.request.update({
            where: { id: lastReq.id },
            data: {
              deliveryAddress,
              recipientName: recipientName || null,
              recipientPhone: recipientPhone || null,
              deliveryNotes: deliveryNotes || null,
              deliveryDetailsComplete: true,
              status: 'RECEIVED'
            }
          });
          console.log('[DELIVERY] Saved to request:', lastReq.id, '— triggering dispatch');
          dispatchToVendors(
            lastReq.id,
            lastReq.description + '. Deliver to: ' + deliveryAddress + (recipientName ? '. Recipient: ' + recipientName : ''),
            lastReq.category,
            userId
          ).catch(e => console.error('[DELIVERY DISPATCH]', e.message));
        }
      } catch(e) { console.error('[DELIVERY UPDATE]', e.message); }
    }
    }

    // Detect international request tag
    const intlMatch = botReply.match(/\[INTERNATIONAL:([A-Z]{2}):([A-Z]{3})\]/);
    // Also detect from message text for timer even when Alina forgets the tag
    const intlCityRe = /mumbai|delhi|bangalore|kolkata|hyderabad|chennai|pune|dubai|abu dhabi|singapore|london|paris|new york|toronto|tokyo|hong kong|bangkok|kuala lumpur|jakarta|manila|seoul|shanghai|beijing|cairo|nairobi|lagos|istanbul|moscow|riyadh|doha/i;
    const auCities = /sydney|melbourne|brisbane|perth|adelaide|canberra|darwin|hobart/i;
    const isIntlByCity = !auCities.test(message) && intlCityRe.test(message);
    const isIntlFinal = !!intlMatch || isIntlByCity;
    if (intlMatch) {
      botReply = botReply.replace(/\[INTERNATIONAL:[^\]]+\]/, '').trim();
    }

    // Fallback: auto-detect service request if Alina forgot the tag
    // Only trigger if Alina confirmed action but forgot the [REQUEST:] tag
    const alinaConfirmed = botReply && /\b(i will|i am on it|consider it done|arranging|booking|i'll arrange|i'll book|on it|handling|sorted)/i.test(botReply);
    if (!requestMatch && alinaConfirmed) {
      const msg = message.toLowerCase();
      const CATS = {
        DINING: ['restaurant','book a table','dinner','lunch','reservation','dining','eat','cuisine'],
        TRANSPORT: ['car','driver','chauffeur','transfer','limo','airport','pickup','ride','uber'],
        PROCUREMENT: ['cake','flowers','gift','shopping','buy','order','purchase','hamper','bouquet'],
        HOTEL: ['hotel','accommodation','room','suite','stay','check in'],
        AVIATION: ['jet','flight','plane','fly','charter','helicopter'],
        MEDICAL: ['doctor','medical','appointment','clinic','specialist','dentist'],
        RELOCATION: ['relocat','moving','move','visa','immigration'],
        HOME: ['plumber','cleaner','electrician','handyman','repair','maintenance'],
        EVENT: ['tickets','concert','event','party','show','venue'],
        SECURITY: ['security','bodyguard','protection','guard'],
        YACHT: ['yacht','boat','sailing','cruise','charter'],
      };
      let detectedCat = null;
      for (const [cat, keywords] of Object.entries(CATS)) {
        if (keywords.some(k => msg.includes(k))) { detectedCat = cat; break; }
      }
      if (detectedCat) {
        const autoDesc = message.substring(0, 150);
        try {
          const autoRequest = await prisma.request.create({ data: {
            userId, title: autoDesc.substring(0,100), description: autoDesc,
            category: detectedCat, priority: isIntlFinal ? 'CRITICAL' : 'STANDARD',
            status: 'RECEIVED', isInternational: isIntlFinal
          }});
          dispatchToVendors(autoRequest.id, autoDesc, detectedCat, userId).catch(e => console.error('[AUTO-DISPATCH]', e.message));
          console.log('[CIPHERBOT] Auto-created request:', autoRequest.id, detectedCat);
          // Store the autoRequest id for use in final response
          newRequest = autoRequest;
          requestCreated = true;
        } catch(e) { console.error('[AUTO-REQUEST]', e.message); }
      }
    }

    if (requestMatch) {
      const [, category, description] = requestMatch;
      botReply = botReply.replace(/\[REQUEST:[^\]]+\]/, '').trim();
      try {
        // Primary: use Alina's tag. Fallback: detect international cities in message OR description
        const intlCities = /mumbai|delhi|bangalore|kolkata|hyderabad|chennai|pune|dubai|abu dhabi|singapore|london|paris|new york|toronto|tokyo|hong kong|bangkok|kuala lumpur|jakarta|manila|seoul|shanghai|beijing|cairo|nairobi|lagos|istanbul|moscow|riyadh|doha|berlin|amsterdam|zurich|sydney(?!.*australia)|\bIN\b|\bAE\b|\bSG\b/i;
        const searchText = message + ' ' + (description||'') + ' ' + (deliveryAddress||'');
        const isIntl = !!intlMatch || (!searchText.toLowerCase().includes('sydney') && !searchText.toLowerCase().includes('melbourne') && !searchText.toLowerCase().includes('brisbane') && !searchText.toLowerCase().includes('perth') && !searchText.toLowerCase().includes('adelaide') && intlCities.test(searchText));
        const deliveryCountry = intlMatch ? intlMatch[1] : null;
        const deliveryCurrency = intlMatch ? intlMatch[2] : null;
                // Check for duplicate request — skip if message has delivery details (always a follow-up)
        const skipDedup = !!(deliveryAddress || recipientName || recipientPhone);
        const dupCheck = !skipDedup ? await checkDuplicateRequest(userId, description, category).catch(()=>({isDuplicate:false})) : {isDuplicate:false};
        if (dupCheck.isDuplicate) {
          console.log('[DEDUP] Duplicate request blocked for user:', userId);
          const dedupNote = '\n\n_(Note: this looks similar to a recent request — kept just one to avoid confusion.)_';
          botReply = botReply + dedupNote;
          res.json({ reply: botReply, isDuplicate: true });
          return;
        }
        newRequest = await prisma.request.create({ data: {
          userId, title: description.substring(0,100), description, category,
          priority: isIntlFinal ? 'CRITICAL' : 'STANDARD', status: 'RECEIVED',
          isInternational: isIntlFinal, deliveryCountry, deliveryCurrency,
          deliveryAddress: deliveryAddress || null,
          recipientName: recipientName || null,
          recipientPhone: recipientPhone || null,
          deliveryNotes: deliveryNotes || null,
          deliveryDetailsComplete: !!(deliveryAddress)
        }});
        if (isCipherPrivate) {
          // ── CIPHER PRIVATE: notify founder directly — NO vendor dispatch ────
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          const cpUser = await prisma.user.findUnique({ where:{ id: userId }, select:{ fullName:true, email:true, phone:true, memberTier:true } });
          const tierLabel = cpUser?.memberTier?.replace(/_/g,' ') || 'CIPHER';
          const reqDetails = '\n\nMember: ' + (cpUser?.fullName||userId) + ' (' + tierLabel + ')' +
            '\nEmail: ' + (cpUser?.email||'—') +
            '\nPhone: ' + (cpUser?.phone||'—') +
            '\n\nRequest: ' + description +
            '\nCategory: ' + category +
            '\nRequest ID: ' + newRequest.id;
          // WhatsApp to founder
          const { sendWA } = require('../services/whatsapp_notifications');
          await sendWA('+61413536700',
            '🔐 *New Cipher Private Request*' + reqDetails +
            '\n\nReply to handle or log in to cc-admin to assign.'
          ).catch(e => console.error('[CP WA]', e.message));
          // Email to hello@cipherprivate.com
          await resend.emails.send({
            from: 'Cipher Private <hello@cipherprivate.com>',
            to: 'hello@cipherprivate.com',
            subject: '[CIPHER REQUEST] ' + category + ' — ' + (cpUser?.fullName||'Member'),
            html: '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px;background:#0f0e0c;color:#fff">' +
              '<h2 style="color:#c9a96e;font-size:18px;margin-bottom:4px">New Cipher Private Request</h2>' +
              '<p style="color:#999;font-size:12px;margin-bottom:24px">Received: ' + new Date().toLocaleString('en-AU') + '</p>' +
              '<table style="width:100%;border-collapse:collapse">' +
              '<tr><td style="padding:8px 0;color:#c9a96e;font-size:12px;letter-spacing:2px">MEMBER</td><td style="padding:8px 0;color:#fff">' + (cpUser?.fullName||'—') + '</td></tr>' +
              '<tr><td style="padding:8px 0;color:#c9a96e;font-size:12px;letter-spacing:2px">TIER</td><td style="padding:8px 0;color:#fff">' + tierLabel + '</td></tr>' +
              '<tr><td style="padding:8px 0;color:#c9a96e;font-size:12px;letter-spacing:2px">EMAIL</td><td style="padding:8px 0;color:#fff">' + (cpUser?.email||'—') + '</td></tr>' +
              '<tr><td style="padding:8px 0;color:#c9a96e;font-size:12px;letter-spacing:2px">PHONE</td><td style="padding:8px 0;color:#fff">' + (cpUser?.phone||'—') + '</td></tr>' +
              '<tr><td style="padding:8px 0;color:#c9a96e;font-size:12px;letter-spacing:2px">CATEGORY</td><td style="padding:8px 0;color:#fff">' + category + '</td></tr>' +
              '<tr><td style="padding:8px 0;color:#c9a96e;font-size:12px;letter-spacing:2px;vertical-align:top">REQUEST</td><td style="padding:8px 0;color:#fff">' + description + '</td></tr>' +
              '<tr><td style="padding:8px 0;color:#c9a96e;font-size:12px;letter-spacing:2px">REF</td><td style="padding:8px 0;color:#999;font-size:11px">' + newRequest.id + '</td></tr>' +
              '</table>' +
              '<div style="margin-top:32px;padding-top:24px;border-top:1px solid #333">' +
              '<a href="https://consiere.com.au/cc-admin" style="display:inline-block;background:#c9a96e;color:#0f0e0c;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:13px">Open Admin Panel</a>' +
              '</div>' +
              '<p style="color:#444;font-size:11px;margin-top:24px">Cipher Private — By referral only. Australia. Est. 2024.</p>' +
              '</div>'
          }).catch(e => console.error('[CP EMAIL]', e.message));
          // Update request status to RECEIVED (waiting for director)
          await prisma.request.update({ where:{ id: newRequest.id }, data:{ status: 'RECEIVED' } });
          console.log('[CIPHER PRIVATE] Request notified to founder:', newRequest.id);
          setSLATimer(newRequest.id, user.memberTier||'CIPHER').catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
          // Travel brief for CP members
          if (isCipherPrivate && ['TRAVEL','AVIATION'].includes(category)) {
            const dest = description.match(/to ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/)?.[1] || description.substr(0,30);
            setTimeout(() => generateTravelBrief(newRequest.id, userId, dest).catch(function(e){ if(e) console.error("[ERROR]",e.message||e); }), 60000);
          }
          // Build DNA after every request
          buildRequestDNA(userId).catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
        } else {
          // Non-Cipher-Private: dispatch to vendors + SLA
          dispatchToVendors(newRequest.id, description, category, userId).catch(e => console.error('[ALINA] Dispatch:', e.message));
          // Notify admin of new request
          try {
            const { Resend } = require('resend');
            new Resend(process.env.RESEND_API_KEY).emails.send({
              from: 'Alina at Consiere <hello@consiere.com.au>',
              to: 'hello@consiere.com.au',
              subject: '[New Request] ' + category + ' — ' + description.substring(0,60),
              html: '<p><b>New request created</b></p><p><b>Member:</b> ' + (user.fullName||user.email) + '</p><p><b>Category:</b> ' + category + '</p><p><b>Request:</b> ' + description + '</p><p><a href="https://consiere.com.au/cc-admin">View in Admin</a></p>'
            }).catch(function(){});
          } catch(e) {}
          setSLATimer(newRequest.id, user.memberTier||'CIPHER').catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
          if (['TRAVEL','AVIATION'].includes(category)) {
            const dest = description.match(/to ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/)?.[1] || description.substr(0,30);
            setTimeout(() => generateTravelBrief(newRequest.id, userId, dest).catch(function(e){ if(e) console.error("[ERROR]",e.message||e); }), 60000);
          }
          buildRequestDNA(userId).catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
        }

        // For non-procurement: create Stripe deposit session and store on request
        const PROCUREMENT_CATS = ['PROCUREMENT'];
        if (!PROCUREMENT_CATS.includes(category)) {
          try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            const memberUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } });
            const session = await stripe.checkout.sessions.create({
              payment_method_types: ['card'],
              mode: 'payment',
              customer_email: memberUser?.email,
              line_items: [{
                price_data: {
                  currency: 'aud',
                  product_data: { name: 'Consiere Booking Deposit — ' + category, description: 'Refundable booking deposit for: ' + description.substring(0,80) },
                  unit_amount: 1000, // $10 AUD
                },
                quantity: 1,
              }],
              metadata: { requestId: newRequest.id, userId, type: 'deposit' },
              success_url: (process.env.CC_URL||'https://consiere.com.au') + '/pay/success?requestId=' + newRequest.id,
              cancel_url: (process.env.CC_URL||'https://consiere.com.au') + '/cc-portal',
            });
            // Store payment URL on request — portal renders as button
            await prisma.request.update({ where: { id: newRequest.id }, data: { paymentUrl: session.url } });
            console.log('[DEPOSIT LINK] Created for request:', newRequest.id);
          } catch(stripeErr) { console.error('[DEPOSIT LINK]', stripeErr.message); }
        }
        requestCreated = true;
      } catch(e) { console.error('[ALINA] Request error:', e.message); }
    }
    // Personalise first message
    if (isFirstMessage && !requestCreated) {
      const fn2 = (user.fullName||'there').split(' ')[0];
      botReply = 'Hi ' + fn2 + '! I am Alina, your personal concierge. I am here to handle everything for you — restaurant bookings, travel, events, shopping, home services and more. Just tell me what you need and I will take care of it. What can I arrange for you today?';
    }
        await prisma.chatMessage.create({ data: { userId, role: 'assistant', content: botReply } });
    // Fetch paymentUrl if request was created
let paymentUrl = null;
if(requestCreated && newRequest?.id) {
  try {
    const reqData = await prisma.request.findUnique({where:{id:newRequest.id},select:{paymentUrl:true}});
    paymentUrl = reqData?.paymentUrl || null;
  } catch(e) {}
}
res.json({ reply: botReply, requestCreated, requestId: requestCreated ? newRequest?.id : undefined, isInternational: requestCreated ? !!newRequest?.isInternational : isIntlFinal, paymentUrl });
  } catch(e) {
    console.error('[ALINA ERROR]', e.message, e.stack?.split('\n')[1]);
    res.status(500).json({ error: 'Alina is temporarily unavailable.' });
  }
});

router.delete('/history', authenticate, async (req, res) => {
  try {
    await prisma.chatMessage.deleteMany({ where: { userId: req.user.userId || req.user.id } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
