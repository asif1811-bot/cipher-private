'use strict';
const { notifyQuoteReceived, getPhone } = require('../services/whatsapp_notifications');
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { dispatchToVendors } = require('../services/dispatch');

async function getOrCreateWAUser(phone, name) {
  const email = 'wa_' + phone.replace(/[^0-9]/g,'') + '@whatsapp.cipher';
  // First try to find by phone number (real member)
  const cleanPhone = phone.replace(/[\s\-\(\)]/g,'');
  let user = await prisma.user.findFirst({ where: { phone: cleanPhone } }).catch(()=>null);
  // Then try by WhatsApp email
  if (!user) user = await prisma.user.findUnique({ where: { email } }).catch(()=>null);
  if (!user) {
    const hash = await require('bcryptjs').hash(Math.random().toString(36), 10);
    user = await prisma.user.create({ data: { fullName: name || 'WhatsApp User', email, passwordHash: hash, role: 'MEMBER', memberTier: 'CIPHER', isActive: true } });
    console.log('[WHATSAPP] New user:', phone);
  }
  return user;
}

const { detectLocation } = require('../utils/australia_locations');
const { geocode, geocodeCountry } = require('../utils/geo');

async function sendWA(to, msg) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || sid.includes('YOUR')) { console.log('[WHATSAPP] Not configured. Msg:', msg.substring(0,60)); return false; }
  try {
    await require('twilio')(sid, token).messages.create({ body: msg, from: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886', to: 'whatsapp:' + to });
    return true;
  } catch(e) { console.error('[WHATSAPP]', e.message); return false; }
}

router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { Body, From, ProfileName } = req.body;
    if (!Body || !From) return res.status(200).send('');
    const rawPhone = From.replace('whatsapp:', '').trim();
    const phone = rawPhone.startsWith('+') ? rawPhone : '+' + rawPhone;
    const message = Body.trim();
    console.log('[WHATSAPP]', phone, ':', message.substring(0,60));
    // Check if this is a VENDOR replying to an inquiry
    const vendorByPhone = await prisma.vendor.findFirst({ where: { phone } }).catch(()=>null);
    if (vendorByPhone) {
      // This is a vendor — handle their WhatsApp reply as a quote
      await handleVendorWhatsAppReply(phone, message, vendorByPhone, res);
      return;
    }

    // Anti-spam/scam message detection
    const scamPatterns = [/bitcoin/i,/crypto/i,/investment opportunity/i,/wire transfer/i,/western union/i,/moneygram/i,/urgent/i,/lottery/i,/you have won/i,/click this link/i,/verify your account/i,/send money/i,/419/,/nigerian/i,/inheritance/i];
    const isScam = scamPatterns.some(function(p){ return p.test(message); });
    if (isScam) {
      console.log('[WHATSAPP] Scam detected from:', phone, '- blocking');
      res.set('Content-Type','text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    // Country allowlist - only AU, IN, US, CA, GB, AE, SG
    // Strict country allowlist - AU, IN, US, CA, UK, UAE, SG ONLY
    const ALLOWED_PREFIXES = [
      '+61',   // Australia
      '+91',   // India
      '+1',    // USA + Canada
      '+44',   // United Kingdom
      '+971',  // UAE
      '+65',   // Singapore
    ];
    // Explicit block list (even if prefix matches edge cases)
    const BLOCKED_PREFIXES = [
      '+92',   // Pakistan
      '+93',   // Afghanistan
      '+963',  // Syria
      '+964',  // Iraq
      '+98',   // Iran
      '+966',  // Saudi (not in allowlist anyway)
      '+967',  // Yemen
      '+968',  // Oman
      '+880',  // Bangladesh
      '+94',   // Sri Lanka
      '+95',   // Myanmar
      '+855',  // Cambodia
      '+856',  // Laos
      '+84',   // Vietnam
      '+86',   // China
      '+850',  // North Korea
      // Africa
      '+20','+212','+213','+216','+218','+220','+221','+222','+223','+224',
      '+225','+226','+227','+228','+229','+230','+231','+232','+233','+234',
      '+235','+236','+237','+238','+239','+240','+241','+242','+243','+244',
      '+245','+246','+247','+248','+249','+250','+251','+252','+253','+254',
      '+255','+256','+257','+258','+260','+261','+262','+263','+264','+265',
      '+266','+267','+268','+269','+27','+290','+291','+297','+298','+299',
      // South America
      '+54','+55','+56','+57','+58','+591','+592','+593','+594','+595',
      '+596','+597','+598','+509','+502','+503','+504','+505','+506','+507',
      '+508','+51','+52', // Mexico
    ];
    const isBlocked = BLOCKED_PREFIXES.some(function(p){ return phone.startsWith(p); });
    const isAllowed = !isBlocked && ALLOWED_PREFIXES.some(function(p){ return phone.startsWith(p); });
    if (!isAllowed) {
      console.log('[WHATSAPP] Blocked country:', phone);
      res.set('Content-Type','text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    const user = await getOrCreateWAUser(phone, ProfileName);
    // Detect non-Latin/Arabic scripts and block
    const hasNonLatin = /[؀-ۿݐ-ݿ一-鿿぀-ヿऀ-ॿ]/.test(message);
    if (hasNonLatin) {
      console.log('[WHATSAPP] Non-Latin script detected from:', phone, '- blocking');
      await sendWA(phone, 'Sorry, Consiere is currently only available in English. We serve Australia, India, USA, Canada, UK, UAE and Singapore.');
      res.set('Content-Type','text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    await prisma.chatMessage.create({ data: { userId: user.id, role: 'user', content: message } }).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
    const history = (await prisma.chatMessage.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 20 })).reverse();
    const reqs = await prisma.request.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 5 }).catch(()=>[]);
    const system = 'You are Alina, AI concierge for Consiere via WhatsApp.\nMember: ' + user.fullName + '\nRecent: ' + (reqs.length ? reqs.map(r=>r.category+': '+r.description.substring(0,40)).join('; ') : 'None') + '\nRules: Handle all requests. Keep replies SHORT (2-3 sentences). Never reveal AI. LOCATION: For delivery-type requests where a vendor must travel to the client (PROCUREMENT, flowers, cake, food delivery, private chef, TRANSPORT, HOME services, MEDICAL home visit), you MUST confirm a SPECIFIC SUBURB before logging. A bare city name like Sydney, Melbourne or Brisbane is NOT enough (these cities span 50km+ and a CBD vendor cannot serve an outer suburb). If the member only gives a city or no location, ask which suburb the request should go to, and do NOT emit the request tag yet. Once they give a specific area/neighbourhood (e.g. Box Hill NSW, Bandra Mumbai, Soho London, Brooklyn New York), you MUST put it at the very START of the request description in the form AREA, CITY - rest of request. Example: [REQUEST:PROCUREMENT:Box Hill, NSW - flower delivery tomorrow morning] or [REQUEST:PROCUREMENT:Bandra, Mumbai - flower delivery tomorrow]. For any city worldwide, a bare city name is NOT specific enough for delivery — always get the neighbourhood/area. For HOTEL, restaurant booking, YACHT and AVIATION the client travels to the vendor, so a city is acceptable. For service requests end with [REQUEST:CATEGORY:description]. Categories: AVIATION, TRANSPORT, DINING, HOTEL, MEDICAL, PROCUREMENT, HOME, RELOCATION, EVENT. CRITICAL: For requests OUTSIDE Australia also add [INTERNATIONAL:COUNTRY_CODE:CURRENCY] tag e.g. Delhi=[INTERNATIONAL:IN:INR] Dubai=[INTERNATIONAL:AE:AED] London=[INTERNATIONAL:GB:GBP] Singapore=[INTERNATIONAL:SG:SGD] New York=[INTERNATIONAL:US:USD]';
    const messages = [...history.map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.content})),{role:'user',content:message}];
    // Check request limits for WhatsApp (same as web)
    const LIMITS = { 'CIPHER': 2, 'CIPHER_BLACK': null, 'CIPHER_SOVEREIGN': null }; // CIPHER=2 free, CIPHER_BLACK=unlimited ($9.99/mo)
    const tier = user.memberTier || 'CIPHER';
    const limit = user.platform === 'CIPHER_PRIVATE' ? null : (LIMITS[tier] !== undefined ? LIMITS[tier] : 2);
    if (limit !== null) {
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
      const used = await prisma.request.count({ where: { userId: user.id, createdAt: { gte: startOfMonth } } }).catch(()=>0);
      // Check if user has credits to use instead
      const userCredits = user.credits || 0;
      if (used >= limit && userCredits > 0) {
        // Deduct a credit and allow the request
        await prisma.user.update({ where: { id: user.id }, data: { credits: { decrement: 1 } } });
        await sendWA(phone, '💳 _1 request credit used. Remaining credits: ' + (userCredits - 1) + '_');
      } else if (used >= limit) {
        const tierLabels = { 'CIPHER': 'Free', 'CIPHER_BLACK': 'Standard', 'CIPHER_SOVEREIGN': 'Premium' };
        // Create Stripe checkout link for WhatsApp upgrade
        let payLink = process.env.CC_URL + '/cc-portal#plans';
        try {
          const Stripe = require('stripe');
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: process.env.STRIPE_UNLIMITED_PRICE_ID || 'price_unlimited', quantity: 1 }],
            success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?upgraded=1',
            cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal',
            metadata: { userId: user.id, phone }
          }).catch(() => null);
          if (session?.url) payLink = session.url;
        } catch(e) { console.error('[WA STRIPE]', e.message); }

        const upgradeMsg = '✨ You have used your 2 free requests this month.\n\nUpgrade to *Consiere Unlimited* for just *$9.99/month* — unlimited requests, all categories, 24/7.\n\n👉 ' + payLink + '\n\nOnce upgraded, come back and Alina will be here for everything! 🎉';
        await sendWA(phone, upgradeMsg);
        res.set('Content-Type','text/xml');
        res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        return;
      }
    }

    let reply = 'Hi ' + user.fullName.split(' ')[0] + ', I am Alina your personal concierge. How can I help you today?';
    const KEY = process.env.ANTHROPIC_API_KEY;
    console.log('[WHATSAPP] API KEY exists:', !!KEY, 'User:', user.fullName);
    if (KEY) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01'}, body:JSON.stringify({model:'claude-sonnet-4-5',max_tokens:300,system,messages}) });
        const d = await r.json();
        console.log('[WHATSAPP] API response type:', d.type, 'content:', d.content ? d.content.length : 0);
        if (d.content && d.content[0]) reply = d.content[0].text;
        else console.error('[WHATSAPP] API error:', JSON.stringify(d).substring(0,200));
      } catch(apiErr) { console.error('[WHATSAPP] API fetch error:', apiErr.message); }
    }
    console.log('[WHATSAPP] Sending reply:', reply.substring(0,80));
    const rm = reply.match(/\[REQUEST:([A-Z]+):([^\]]+)\]/);
    const intlMatch = reply.match(/\[INTERNATIONAL:([A-Z]{2}):([A-Z]{3})\]/);
    if (rm) {
      reply = reply.replace(/\[REQUEST:[^\]]+\]/,'').replace(/\[INTERNATIONAL:[^\]]+\]/,'').trim();
      // ── LOCATION BACKSTOP: delivery categories need a specific suburb, not a bare city ──
      var _deliveryCats = ['PROCUREMENT','TRANSPORT','HOME','MEDICAL'];
      // Country for this request (from INTERNATIONAL tag, else Australia)
      var _reqCountry = intlMatch ? intlMatch[1] : 'AU';
      if (_deliveryCats.indexOf(rm[1]) !== -1) {
        // Extract leading "Area, Region - ..." (region optional, any country)
        var _suburbMatch = rm[2].match(/^\s*([A-Za-z .'-]+?)(?:,\s*[A-Za-z .'-]+)?\s*[-–—]/);
        var _suburbStr = _suburbMatch ? _suburbMatch[1].trim() : null;
        // Bare metro city is NOT specific enough (AU + major intl cities)
        var _bareCityOnly = /^(sydney|melbourne|brisbane|perth|adelaide|canberra|mumbai|delhi|bangalore|london|new york|toronto|singapore|dubai)$/i.test((_suburbStr||rm[2]).trim());
        // Verify with Google, using the request's country
        var _geo = null;
        if (_suburbStr && !_bareCityOnly) { _geo = await geocodeCountry(_suburbStr, _reqCountry).catch(()=>null); }
        var _hasSuburb = !!_geo && !_bareCityOnly;
        if (!_hasSuburb) {
          var _areaWord = (_reqCountry === 'AU') ? 'suburb' : 'area or neighbourhood';
          console.log('[WA LOCATION] Held request — no specific ' + _areaWord + ' in:', rm[2].substring(0,60), '(country', _reqCountry + ')');
          reply = (reply ? reply + '\n\n' : '') + 'Which ' + _areaWord + ' should this go to? A big city can span 50km+, so I want to match a vendor close to the delivery point.';
          await prisma.chatMessage.create({ data: { userId: user.id, role: 'assistant', content: reply } }).catch(function(e){ if(e) console.error('[ERR]',e.message||e); });
          await sendWA(phone, reply);
          res.set('Content-Type','text/xml');
          res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
          return;
        }
      }
      try {
        // Detect international from tag or city name
        const intlCities = /mumbai|delhi|bangalore|kolkata|hyderabad|chennai|pune|dubai|abu dhabi|singapore|london|paris|new york|toronto|tokyo|hong kong|bangkok|kuala lumpur|jakarta|manila|seoul|shanghai|beijing|cairo|nairobi|lagos|istanbul|moscow|riyadh|doha/i;
        const auCities = /sydney|melbourne|brisbane|perth|adelaide|canberra|darwin|hobart/i;
        const desc = rm[2];
        const isIntl = !!intlMatch || (intlCities.test(desc) && !auCities.test(desc));
        const deliveryCountry = intlMatch ? intlMatch[1] : null;
        const deliveryCurrency = intlMatch ? intlMatch[2] : null;
        // Confirmed suburb (from backstop parse) becomes the authoritative delivery location
        var _confirmedSuburb = (typeof _suburbStr !== 'undefined' && _suburbStr) ? _suburbStr : null;
        const nr = await prisma.request.create({ data: { 
          userId: user.id, title: rm[2].substring(0,100), description: rm[2], 
          category: rm[1], priority: 'STANDARD', status: 'RECEIVED',
          isInternational: isIntl, deliveryCountry: deliveryCountry, deliveryCurrency: deliveryCurrency,
          deliveryAddress: _confirmedSuburb || undefined
        }});
        if (_confirmedSuburb) console.log('[WA LOCATION] Confirmed suburb stored:', _confirmedSuburb, '-> request', nr.id.substring(0,8));
        dispatchToVendors(nr.id, rm[2], rm[1], user.id, phone).catch(e=>console.error('[WA DISPATCH]',e.message));
        reply += '\n\n✅ Request logged. Vendors contacted.';
        console.log('[WA] Request created:', nr.id, 'international:', isIntl, 'country:', deliveryCountry);
      } catch(e) { console.error('[WA REQUEST]', e.message); }
    }
    await prisma.chatMessage.create({ data: { userId: user.id, role: 'assistant', content: reply } }).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
    console.log('[WHATSAPP] Calling sendWA to:', phone);
    const sent = await sendWA(phone, reply);
    console.log('[WHATSAPP] sendWA result:', sent);
    res.set('Content-Type','text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch(e) { console.error('[WHATSAPP]',e.message); res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); }
});

router.get('/status', (_req, res) => {
  const ok = !!(process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID.includes('YOUR'));
  res.json({ configured: ok, webhookUrl: (process.env.CC_URL||'https://consiere.com.au') + '/api/whatsapp/webhook', message: ok ? 'WhatsApp active via Twilio' : 'Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER to .env' });
});

module.exports = router;
