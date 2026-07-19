'use strict';
const { findAndOutreachUnregisteredVendors } = require('./unregistered_vendor');
let alinaAuto = null; try { alinaAuto = require('./alina_automation'); } catch(e) {}
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { Resend } = require('resend');
const { sendWA } = require('./whatsapp_notifications');
const crypto = require('crypto');
const { detectLocation, vendorServesLocation } = require('../utils/australia_locations');
const { detectGlobalLocation, vendorServesCity } = require('../utils/global_locations');
const { filterVendorsByRadius } = require('../utils/geo');
const { getSchedulingAdvice } = require('../utils/business_hours');
const { getCurrencyForCity, convertFromAUD } = require('../utils/currency');

const KEYWORDS = {
  AVIATION:    ['jet','fly','flight','plane','aircraft','aviation','helicopter','charter','airport'],
  TRANSPORT:   ['car','driver','chauffeur','transfer','limo','limousine','uber','transport','ride','pickup'],
  YACHT:       ['yacht','boat','sailing','cruise','vessel','charter','marine','harbour','harbor'],
  DINING:      ['restaurant','dinner','lunch','dining','table','reservation','chef','food','eat','cuisine'],
  HOTEL:       ['hotel','suite','room','accommodation','stay','resort','penthouse','villa','check in'],
  SECURITY:    ['security','bodyguard','protection','guard','escort','surveillance'],
  MEDICAL:     ['doctor','medical','health','hospital','appointment','specialist','clinic','dentist'],
  PROCUREMENT: ['buy','purchase','shopping','gift','flowers','cake','jewellery','jewelry','order','find'],
  EVENT:       ['event','party','concert','show','tickets','venue','celebration','wedding','birthday'],
  RELOCATION:  ['relocat','moving','move','visa','immigration','customs','shipping','removalist'],
  HOME:        ['plumber','electrician','cleaner','handyman','repair','maintenance','garden','pool'],
};

function genVendorToken(inquiryId, vendorId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET||'cipher')
    .update(inquiryId + ':' + vendorId).digest('hex').substring(0, 32);
}

async function classifyRequest(description, category) {
  const VALID = ['AVIATION','TRANSPORT','YACHT','DINING','HOTEL','SECURITY','MEDICAL','PROCUREMENT','EVENT','RELOCATION','HOME','OTHER'];

  // Map keywords to more specific categories
  const PROCUREMENT_KEYWORDS = {
    CAKE_SHOP: ['cake','cupcake','birthday cake','wedding cake','celebration cake','custom cake'],
    BAKERY: ['bakery','pastry','bread','croissant','baked goods','patisserie'],
    FLORIST: ['flower','bouquet','arrangement','florist','roses','lilies','floral','petal','bloom'],
    GIFT: ['gift','hamper','present','surprise','basket','gift box','gift set'],
    GROCERY: ['grocery','supermarket','food','vegetables','fruits','milk','eggs','organic'],
    PHARMACY: ['medicine','pharmacy','medication','drug','prescription','chemist'],
    STATIONERY: ['stationery','office','paper','pen','print'],
    FRUIT_BASKET: ['fruit','fruit basket','mango','apple','orange','fresh fruit'],
  };
  // Detect PROCUREMENT subcategory
  let procSubcategory = null;
  if (category === 'PROCUREMENT' || !category) {
    const descLower = (description||'').toLowerCase();
    for (const [sub, keywords] of Object.entries(PROCUREMENT_KEYWORDS)) {
      if (keywords.some(k => descLower.includes(k))) {
        procSubcategory = sub;
        console.log('[CLASSIFY] PROCUREMENT subcategory:', sub);
        break;
      }
    }
  }

  // Trust category from Alina if valid
  if (category && VALID.includes(category.toUpperCase())) {
    const KEY = process.env.ANTHROPIC_API_KEY;
    if (KEY) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 150, messages: [{ role: 'user', content: 'For this ' + category + ' concierge request: "' + description.substring(0,200) + '". Respond ONLY with JSON: {"urgency":"CRITICAL|URGENT|STANDARD","location":"city or Sydney","summary":"one sentence max 80 chars","estimatedValue":"AUD estimate e.g. $200-500"}' }] })
        });
        const data = await r.json();
        const parsed = JSON.parse(data.content[0].text.trim().replace(/```json|```/g,'').trim());
        return { category: category.toUpperCase(), subcategory: procSubcategory, ...parsed };
      } catch(e) {}
    }
    return { category: category.toUpperCase(), subcategory: procSubcategory, urgency: 'STANDARD', location: 'Sydney', summary: description.substring(0,120), estimatedValue: 'TBC' };
  }

  // No category — classify from keywords or AI
  const desc = (description + ' ' + (category||'')).toLowerCase();
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) {
    for (const [cat, words] of Object.entries(KEYWORDS)) {
      if (words.some(w => desc.includes(w))) return { category: cat, urgency: 'STANDARD', location: 'Sydney', summary: description.substring(0,200), estimatedValue: 'TBC' };
    }
    return { category: 'OTHER', urgency: 'STANDARD', location: 'Sydney', summary: description.substring(0,200), estimatedValue: 'TBC' };
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 200, messages: [{ role: 'user', content: 'Classify this luxury concierge request: "' + description.substring(0,300) + '". Respond ONLY with JSON: {"category":"AVIATION|TRANSPORT|YACHT|DINING|HOTEL|SECURITY|MEDICAL|PROCUREMENT|EVENT|RELOCATION|HOME|OTHER","urgency":"CRITICAL|URGENT|STANDARD","location":"city or Sydney","summary":"one sentence","estimatedValue":"AUD estimate"}' }] })
    });
    const data = await r.json();
    return JSON.parse(data.content[0].text.trim().replace(/```json|```/g,'').trim());
  } catch(e) {
    for (const [cat, words] of Object.entries(KEYWORDS)) {
      if (words.some(w => desc.includes(w))) return { category: cat, urgency: 'STANDARD', location: 'Sydney', summary: description.substring(0,200), estimatedValue: 'TBC' };
    }
    return { category: 'OTHER', urgency: 'STANDARD', location: 'Sydney', summary: description.substring(0,200), estimatedValue: 'TBC' };
  }
}

async function dispatchToVendors(requestId, description, category, userId, clientPhone) {
  try {
    const classified = await classifyRequest(description, category);
    // Safety: ensure location fields are strings not objects
    if (classified.location && typeof classified.location === 'object') {
      classified.location = classified.location.city || classified.location.name || JSON.stringify(classified.location);
    }
    console.log('[DISPATCH]', classified.category, '|', classified.urgency, '|', classified.location);

    // Match vendors by category with suburb-aware location matching
    const allVendors = await prisma.vendor.findMany({
      where: { isActive: true, category: classified.category }
      // Note: isActive:false vendors are suspended for unpaid commission
    }).catch(() => []);

    // Declare vendors early so international block can assign to it
    let vendors = [];

    // Check if this is an international request
    const request = await prisma.request.findUnique({ where: { id: requestId }, select: { isInternational: true, deliveryCountry: true, deliveryAddress: true, recipientName: true, recipientPhone: true, deliveryNotes: true, description: true } });
    
    if (request?.isInternational && request?.deliveryCountry) {
      // Map country code to city keywords
      const COUNTRY_CITIES = {
        CA: ['Toronto','Vancouver','Montreal','Calgary','Quebec','Ottawa','Edmonton','Winnipeg'],
        US: ['New York','Los Angeles','Miami','Chicago','Houston','Dallas','Las Vegas','San Francisco','Boston','Seattle','Atlanta','Denver','Phoenix','San Diego','Washington'],
        AE: ['Dubai','Abu Dhabi','Sharjah','Ajman','Ras Al Khaimah'],
        SG: ['Singapore'],
        IN: ['Mumbai','Delhi','Bangalore','Chennai','Hyderabad','Pune','Kolkata','Ahmedabad','Jaipur','Goa'],
        GB: ['London','Manchester','Edinburgh','Birmingham','Glasgow','Liverpool','Bristol','Leeds'],
        FR: ['Paris','Lyon','Marseille','Nice','Bordeaux','Cannes','Monaco'],
        DE: ['Berlin','Munich','Frankfurt','Hamburg','Cologne','Stuttgart','Dusseldorf'],
        JP: ['Tokyo','Osaka','Kyoto','Nagoya','Sapporo','Fukuoka'],
        HK: ['Hong Kong','Kowloon','New Territories'],
        NZ: ['Auckland','Wellington','Christchurch','Queenstown'],
        TH: ['Bangkok','Phuket','Chiang Mai','Pattaya','Koh Samui'],
        MY: ['Kuala Lumpur','Penang','Johor Bahru','Langkawi'],
        ID: ['Jakarta','Bali','Surabaya','Bandung'],
        PH: ['Manila','Cebu','Makati','Bonifacio'],
        KR: ['Seoul','Busan','Incheon','Jeju'],
        CN: ['Shanghai','Beijing','Guangzhou','Shenzhen','Chengdu','Hong Kong'],
        BR: ['Sao Paulo','Rio de Janeiro','Brasilia','Salvador'],
        MX: ['Mexico City','Cancun','Guadalajara','Monterrey'],
        ZA: ['Cape Town','Johannesburg','Durban','Pretoria'],
        KE: ['Nairobi','Mombasa'],
        NG: ['Lagos','Abuja'],
        TR: ['Istanbul','Ankara','Antalya','Bodrum'],
        SA: ['Riyadh','Jeddah','Mecca','Medina','NEOM'],
        QA: ['Doha','Lusail'],
        BH: ['Manama','Bahrain'],
        EG: ['Cairo','Alexandria','Hurghada','Sharm El Sheikh'],
        CH: ['Zurich','Geneva','Basel','Bern','Lausanne'],
        NL: ['Amsterdam','Rotterdam','The Hague','Utrecht'],
        IT: ['Rome','Milan','Florence','Venice','Naples','Amalfi'],
        ES: ['Madrid','Barcelona','Ibiza','Marbella','Seville'],
        PT: ['Lisbon','Porto','Algarve','Madeira'],
        GR: ['Athens','Mykonos','Santorini','Thessaloniki'],
        RU: ['Moscow','St Petersburg'],
      };
      const citiesForCountry = COUNTRY_CITIES[request.deliveryCountry] || [];
      const intlVendors = allVendors.filter(v => {
        const vCities = (v.cities || '').toLowerCase();
        return citiesForCountry.some(city => vCities.includes(city.toLowerCase()));
      });
      if (intlVendors.length > 0) {
        console.log('[DISPATCH] International vendors for', request.deliveryCountry, ':', intlVendors.map(v=>v.name).join(', '));
        vendors = intlVendors;
        // Fall through to main dispatch loop below
      } else {
        console.log('[DISPATCH] No vendors found for country:', request.deliveryCountry, '— outreaching unregistered vendors');
        // Auto-outreach unregistered vendors via Google Places
        const countryMap = { CA:'Canada', US:'United States', AE:'UAE', SG:'Singapore', IN:'India', GB:'United Kingdom', AU:'Australia' };
        const countryName = countryMap[request.deliveryCountry] || request.deliveryCountry;
        const cityForSearch = classified.location || request.deliveryCountry;
        findAndOutreachUnregisteredVendors(requestId, description, classified.category, cityForSearch, countryName, classified.subcategory)
          .catch(e => console.error('[DISPATCH UV]', e.message));
        return;
      }
    }

    // Detect location — check global first, then Australian suburbs
    const locationText = (description || '') + ' ' + (classified.location || '');
    const globalLoc = detectGlobalLocation(locationText);
    const auLoc = detectLocation(locationText);
    const detectedLocation = auLoc; // Keep for AU vendor filtering
    console.log('[DISPATCH] Global location:', globalLoc ? globalLoc.city + ',' + globalLoc.country : 'none');
    console.log('[DISPATCH] AU location:', detectedLocation ? JSON.stringify(detectedLocation) : 'none');

    // FIX: previously this block ran unconditionally and overwrote `vendors`
    // (set to intlVendors above) back to [] whenever filterVendorsByRadius
    // couldn't geocode an international address — which is effectively
    // always. Skip AU radius filtering entirely once international vendors
    // have already been matched.
    if (request?.isInternational && vendors.length) {
      console.log('[DISPATCH] Using', vendors.length, 'international vendor match(es) — skipping AU radius filter');
    } else {
      // Filter vendors by REAL DISTANCE from the requested location.
      // Parse an explicit radius from the message ("1km", "5 km"); default 15km.
      // FIX: was /(\\d+)\\s*km/i — the double-escaped backslash matched a
      // literal backslash+d, never an actual digit, so explicit radii typed
      // by the client (e.g. "within 5km") were silently ignored.
      const radiusMatch = /(\d+)\s*km/i.exec(description || '');
      const radiusKm = radiusMatch ? Number(radiusMatch[1]) : 15;
      // Prefer the member-confirmed delivery suburb over the classifier's default guess.
      const locText = (request && request.deliveryAddress && request.deliveryAddress.trim())
        ? request.deliveryAddress.trim()
        : ((classified.location && classified.location !== 'Sydney')
            ? classified.location
            : (detectedLocation && detectedLocation.suburb ? detectedLocation.suburb : (classified.location || 'Sydney')));
      if (request && request.deliveryAddress) console.log('[DISPATCH] Using confirmed delivery location:', request.deliveryAddress);
      const geoResult = await filterVendorsByRadius(locText, allVendors, radiusKm);
      if (geoResult.origin && geoResult.inRange.length) {
        vendors = geoResult.inRange;
        console.log('[DISPATCH] Radius-matched', vendors.length, 'vendors within', radiusKm, 'km of', locText,
                    '->', vendors.map(v => v.name + '(' + v._distanceKm + 'km)').join(', '));
      } else {
        // Nothing in range (or couldn't geocode) — DO NOT fall back to all vendors.
        // Leave empty so the Google Places discovery block below fires.
        vendors = [];
        console.log('[DISPATCH] No vendors within', radiusKm, 'km of', locText, '— triggering discovery');
      }
    }

    // NO fallback to wrong-city vendors — trigger Google Places for correct city
    if (!vendors.length) {
      console.log('[DISPATCH] No location-matched vendors — triggering Google Places for:', globalLoc?.city || detectedLocation?.city || classified.location);
      const { findAndOutreachUnregisteredVendors } = require('./unregistered_vendor');
      // detectedLocation is AU-only (see line 188) — it's always empty for an international
      // address, which previously made this silently fall back to the literal 'Australia'
      // even for e.g. a Mumbai request. globalLoc is the one that actually detects country.
      const city = globalLoc?.city || detectedLocation?.city || classified.location || 'Sydney';
      const country = globalLoc?.country || detectedLocation?.country || 'AU';
      console.log('[DISPATCH UV] Calling with subcategory:', classified.subcategory, 'city:', city, 'country:', country);
      findAndOutreachUnregisteredVendors(requestId, description, classified.category, String(city||'Sydney'), String(country||'AU'), classified.subcategory)
        .catch(e => console.error('[DISPATCH UV]', e.message));
      // Notify admin
      const { sendWA } = require('./whatsapp_notifications');
      sendWA('+61413536700',
        '\u{1F4CD} *No local vendor found*\n\nRequest: ' + description.substring(0,80) + '\nCategory: ' + classified.category + '\nCity: ' + city + '\n\nGoogle Places search triggered.'
      ).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
      return { dispatched: 0, total: 0, classified, googleSearchTriggered: true };
    } else {
      console.log('[DISPATCH] Location-matched vendors:', vendors.map(v=>v.name).join(', '));
    }

    // Score and rank vendors algorithmically
    if (vendors.length > 1 && alinaAuto?.scoreAndRankVendors) {
      try { vendors = await alinaAuto.scoreAndRankVendors(vendors, { description, category }); } catch(e) {}
    }
    // Filter by subcategory to avoid wrong-type vendors (e.g. florist for cake request)
    if (classified.subcategory && vendors.length > 0) {
      const SUB_KEYWORDS = {
        CAKE_SHOP: ['cake','cupcake','patisserie','bakery','sweet','dessert'],
        BAKERY:    ['bakery','bread','pastry','croissant','baked'],
        FLORIST:   ['flower','floral','florist','bouquet','bloom','petal','rose','lily'],
        GIFT:      ['gift','hamper','present','basket','luxury'],
        GROCERY:   ['grocery','supermarket','mart','fresh','organic'],
        PHARMACY:  ['pharmacy','chemist','drug','medical'],
        FRUIT_BASKET: ['fruit','fresh produce','organic'],
      };
      const subKw = SUB_KEYWORDS[classified.subcategory] || [];
      if (subKw.length > 0) {
        const refined = vendors.filter(v => {
          const vtext = (v.name + ' ' + (v.description||'')).toLowerCase();
          return subKw.some(k => vtext.includes(k));
        });
        if (refined.length > 0) {
          console.log('[DISPATCH] Subcategory ' + classified.subcategory + ' refined from', vendors.length, 'to', refined.length, 'vendors');
          vendors = refined;
        } else {
          // No matching subcategory vendors — trigger Google Places for correct type
          const city = globalLoc?.city || detectedLocation?.city || classified.location || 'Sydney';
          const country = globalLoc?.country || 'AU';
          // Map subcategory to human-readable Google search term
          const SUBCATEGORY_SEARCH_TERMS = {
            CAKE_SHOP:    'cake shop',
            BAKERY:       'bakery',
            FLORIST:      'florist flower shop',
            GIFT:         'gift shop hamper',
            GROCERY:      'grocery supermarket',
            PHARMACY:     'pharmacy chemist',
            FRUIT_BASKET: 'fruit shop fresh produce',
            STATIONERY:   'stationery shop',
          };
          const searchTerm = SUBCATEGORY_SEARCH_TERMS[classified.subcategory] || classified.subcategory.toLowerCase().replace(/_/g,' ');
          const searchQuery = searchTerm + ' ' + city;
          // Check if it's business hours in that city
          const bhAdvice = getSchedulingAdvice(city, classified.category, classified.subcategory);
          if (!bhAdvice.isOpen) {
            console.log('[DISPATCH] Outside business hours in', city, '—', bhAdvice.message);
            // Schedule for when they open — still outreach but note the timing
            const { sendWA } = require('./whatsapp_notifications');
            sendWA('+61413536700',
              '\u23F0 *Outside business hours — ' + city + '*\n\n' +
              'Request: ' + description.substring(0,60) + '\n' +
              bhAdvice.message + '\n\n' +
              'Vendors will still receive the request. Those with 24hr WhatsApp may respond now.'
            ).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
          }
          console.log('[DISPATCH] No ' + searchTerm + ' vendors in ' + city + ' — triggering Google Places: ' + searchQuery);
          const { findAndOutreachUnregisteredVendors } = require('./unregistered_vendor');
          findAndOutreachUnregisteredVendors(requestId, description, classified.category, String(city||'Sydney'), String(country||'AU'), classified.subcategory)
            .catch(e => console.error('[DISPATCH UV SUBCATEGORY]', e.message));
          // Notify admin
          const { sendWA } = require('./whatsapp_notifications');
          sendWA('+61413536700',
            '\u{1F4CD} *No registered ' + searchTerm + ' in ' + city + '*\n\nRequest: ' + description.substring(0,80) + '\n\nSearching Google for local ' + searchTerm + ' in ' + city + ' now. Vendors will receive registration invite.'
          ).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
          return { dispatched: 0, classified, googleSearchTriggered: true, subcategory: classified.subcategory, city };
        }
      }
    }

    if (!vendors.length) {
      console.log('[DISPATCH] No active vendors for', classified.category);
      return { dispatched: 0, classified };
    }

    // Business hours check for registered vendors
    const city4bh = String(globalLoc?.city || detectedLocation?.city || 'Sydney');
    const bhCheck = getSchedulingAdvice(city4bh, classified.category, classified.subcategory);
    if (!bhCheck.isOpen) {
      console.log('[DISPATCH] Outside business hours in', city4bh, 'but dispatching anyway — vendor may have 24hr service');
    }

    const RESEND_KEY = process.env.RESEND_API_KEY;
    let dispatched = 0;

    for (const vendor of vendors) {
      try {
        // Create inquiry record FIRST to get ID for response URL
        // Check if vendor already has an active inquiry for this request
      let existingInquiry = null;
      try {
        existingInquiry = await prisma.vendorInquiry.findFirst({
          where: { requestId, vendorId: vendor.id, status: { in: ['SENT','CHASED','QUOTED','ACCEPTED'] } }
        });
      } catch(dedupErr) { console.error('[DISPATCH] Dedup check failed:', dedupErr.message); }
      if (existingInquiry) {
        console.log('[DISPATCH] Skipping duplicate inquiry for vendor:', vendor.name);
        continue;
      }
      const inquiry = await prisma.vendorInquiry.create({
          data: { requestId, vendorId: vendor.id, status: 'PENDING' }
        }).catch(() => ({ id: 'temp-' + vendor.id }));

        // FIX: previously a DB failure here still went on to email/WhatsApp
        // the vendor a "Submit Your Quote" link built from a fake temp- id,
        // which is guaranteed to 404. Skip this vendor instead so it can be
        // retried on next dispatch rather than sending a broken link.
        if (String(inquiry.id).startsWith('temp-')) {
          console.error('[DISPATCH] Could not create inquiry record for vendor', vendor.name, '— skipping to avoid sending a broken quote link');
          continue;
        }

        const responseUrl = (process.env.CC_URL || 'https://consiere.com.au') +
          '/vendor-respond?token=' + genVendorToken(inquiry.id, vendor.id) + '&id=' + inquiry.id;

        const html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">' +
          '<div style="background:#1c1917;padding:20px 24px;text-align:center">' +
            '<div style="font-family:Georgia,serif;font-size:18px;color:#f0ede8;letter-spacing:2px">Cipher <span style="color:#b87333">Concierge</span></div>' +
            '<div style="font-size:9px;letter-spacing:4px;color:rgba(201,169,110,0.5);margin-top:4px;text-transform:uppercase">Vendor Partner Inquiry</div>' +
          '</div>' +
          '<div style="padding:24px">' +
            '<p style="font-size:14px;color:#1c1917">Dear ' + vendor.contactName + ',</p>' +
            '<p style="font-size:13px;color:#44403c;line-height:1.7;margin:12px 0">You have a new client inquiry from Consiere. Please review the brief and submit your quote.</p>' +
            '<div style="background:#faf8f5;border-left:3px solid #b87333;padding:16px 18px;margin:16px 0">' +
              '<div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b87333;margin-bottom:10px">Job Details</div>' +
              '<div style="font-size:13px;color:#44403c;line-height:2.0">' +
                '<strong>Category:</strong> ' + classified.category + '<br>' +
                '<strong>Request:</strong> ' + description + '<br>' +
                '<strong>Location:</strong> ' + (classified.location||'Sydney') + '<br>' +
                '<strong>Urgency:</strong> ' + classified.urgency + '<br>' +
                '<strong>Est. Value:</strong> ' + classified.estimatedValue + '<br>' +
                (globalLoc ? '<strong>Quote in:</strong> ' + (require('../utils/currency').getCurrencyForCity(globalLoc.city||'Sydney').symbol) + ' (' + (require('../utils/currency').getCurrencyForCity(globalLoc.city||'Sydney').code) + ')<br>' : '') +
                (request?.deliveryAddress ? '<br><strong style=\"color:#b87333\">📍 Delivery Address:</strong> ' + request.deliveryAddress + '<br>' : '') +
                (request?.recipientName   ? '<strong style=\"color:#b87333\">👤 Recipient Name:</strong> ' + request.recipientName + '<br>' : '') +
                (request?.recipientPhone  ? '<strong style=\"color:#b87333\">📱 Recipient Phone:</strong> ' + request.recipientPhone + '<br>' : '') +
                (request?.deliveryNotes   ? '<strong style=\"color:#b87333\">📝 Notes:</strong> ' + request.deliveryNotes + '<br>' : '') +
              '</div>' +
            '</div>' +
            '<div style="background:#fff8f0;border:1px solid rgba(184,115,51,0.2);padding:10px 14px;font-size:11px;color:#7a4f1a;margin:16px 0">' +
              '&#9888; Do not contact the client directly. Commission: <strong>' + vendor.commissionPct + '%</strong>' +
            '</div>' +
            '<div style="text-align:center;margin:24px 0">' +
              '<a href="' + responseUrl + '" style="display:inline-block;padding:13px 30px;background:linear-gradient(135deg,#b87333,#8a5a2e);color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:600;border-radius:6px">Submit Your Quote &rarr;</a>' +
            '</div>' +
            '<p style="font-size:11px;color:#78716c;text-align:center">Link valid 72 hours. Or reply directly to this email.</p>' +
            '<p style="font-size:13px;color:#44403c;margin-top:20px;line-height:1.8">Regards,<br><strong>Alina</strong> — AI Concierge<br><span style="color:#b87333">Consiere</span><br><span style="font-size:11px;color:#999">hello@consiere.com.au</span></p>' +
          '</div>' +
          '<div style="background:#1c1917;padding:14px 24px;text-align:center">' +
            '<div style="font-size:11px;color:rgba(255,255,255,0.3)">Consiere &nbsp;&middot;&nbsp; hello@consiere.com.au</div>' +
          '</div>' +
        '</div>';

        let sent = false;
        if (RESEND_KEY) {
          try {
            const resend = new Resend(RESEND_KEY);
            const result = await resend.emails.send({
              from: process.env.EMAIL_FROM || 'hello@consiere.com.au',
              to: [vendor.email],
                cc: ['hello@consiere.com.au'],
              replyTo: 'hello@consiere.com.au',
              subject: '[Consiere] ' + classified.category + ' Inquiry — ' + classified.location + ' — ' + classified.urgency,
              html
            });
            sent = !result.error;
            if(result.error) console.error('[DISPATCH] Email error for', vendor.email, ':', JSON.stringify(result.error));
          } catch(emailErr) {
            console.error('[DISPATCH] Email error:', emailErr.message);
          }
        } else {
          console.log('[DISPATCH] No Resend key — would email:', vendor.email);
          sent = true;
        }

        // Update inquiry status
        if (inquiry.id && !inquiry.id.startsWith('temp-')) {
          await prisma.vendorInquiry.update({
            where: { id: inquiry.id },
            data: { status: sent ? 'SENT' : 'FAILED' }
          }).catch(() => {});
        }

        if (sent) dispatched++;

        // AUTO VOICE CALL: Alina calls vendor 10 seconds after WA/email
        if (false && sent && vendor.phone) { // DISABLED: no auto-call to non-consented vendors
          setTimeout(function() {
            fetch((process.env.CC_URL||'https://consiere.com.au') + '/api/voice/call-vendor', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-call': process.env.JWT_SECRET||'fallback-change-me' },
              body: JSON.stringify({ vendorPhone: vendor.phone, vendorName: vendor.name, category: category||'SERVICE', requestDesc: description.substring(0,100), requestId: requestId })
            }).then(function(r){ return r.json(); }).then(function(d){
              if(d.callSid) console.log('[DISPATCH] Auto-call to:', vendor.name, 'SID:', d.callSid);
              else console.log('[DISPATCH] Auto-call skipped:', JSON.stringify(d).substring(0,60));
            }).catch(function(e){ console.error('[DISPATCH] Auto-call error:', e.message); });
          }, 10000);
        }
        console.log('[DISPATCH]', sent ? 'SENT' : 'FAILED', '→', vendor.name, '(' + vendor.email + ')');

        // ── Send WhatsApp to vendor if they have a phone number ──
        if (vendor.phone && sent) {
          try {
            const respondUrl = (process.env.CC_URL || 'https://consiere.com.au') + '/vendor-respond?token=' + genVendorToken(inquiry.id, vendor.id) + '&id=' + inquiry.id;
            const waMsg =
              '🔔 *New Consiere Request*\n\n' +
              '*Category:* ' + (category || '') + '\n' +
              '*Request:* ' + description + '\n\n' +
              // Add delivery details if available
              (request?.deliveryAddress ? '*📍 Address:* ' + request.deliveryAddress + '\n' : '') +
              (request?.recipientName   ? '*👤 Recipient:* ' + request.recipientName + '\n' : '') +
              (request?.recipientPhone  ? '*📱 Contact:* ' + request.recipientPhone + '\n' : '') +
              (request?.deliveryNotes   ? '*📝 Notes:* ' + request.deliveryNotes + '\n' : '') +
              ((request?.deliveryAddress || request?.recipientName) ? '\n' : '') +
              '*3 ways to respond:*\n' +
              '1️⃣ Reply here with your quote\n' +
              '   e.g. "$150 — available tonight 7pm"\n\n' +
              '2️⃣ Portal: consiere.com.au/vendor-portal\n\n' +
              '3️⃣ Direct link:\n' + respondUrl;
            // Try vendor template first (avoids 63016 outside-window errors)
          var waSent = false;
          if (process.env.TWILIO_VENDOR_TEMPLATE_SID) {
            try {
              var twClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
              await twClient.messages.create({
                contentSid: process.env.TWILIO_VENDOR_TEMPLATE_SID,
                contentVariables: JSON.stringify({"1": vendor.name, "2": description.substring(0,60), "3": (process.env.CC_URL||'https://consiere.com.au')+'/vendor_portal.html'}),
                messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
                to: 'whatsapp:' + vendor.phone
              });
              waSent = true;
              console.log('[DISPATCH] Vendor template sent to:', vendor.name, vendor.phone);
            } catch(tmplErr) {
              console.log('[DISPATCH] Template failed, trying free-form:', tmplErr.message);
              waSent = await sendWA(vendor.phone, waMsg).then(function(){return true;}).catch(function(){return false;});
              if(waSent) console.log('[DISPATCH] WhatsApp free-form sent to vendor:', vendor.name, vendor.phone);
            }
          } else {
            waSent = await sendWA(vendor.phone, waMsg).then(function(){return true;}).catch(function(){return false;});
            if(waSent) console.log('[DISPATCH] WhatsApp sent to vendor:', vendor.name, vendor.phone);
          }
          if(!waSent) {
              // SMS fallback for landlines or non-WhatsApp numbers
              try {
                // FIX: previously fell back to a hardcoded US number
                // (+18167931476) when TWILIO_SMS_NUMBER wasn't set, which
                // silently sent Australian vendors an SMS from a US number
                // (deliverability risk + unnecessary cost). Now skips SMS
                // and falls through to the existing email fallback below.
                if (!process.env.TWILIO_SMS_NUMBER) {
                  throw new Error('TWILIO_SMS_NUMBER not configured — skipping SMS fallback instead of using hardcoded US number');
                }
                var twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                var smsBody = 'New job from Consiere for ' + vendor.name + ': ' + description.substring(0,80) + '. Login: ' + (process.env.CC_URL||'https://consiere.com.au') + '/vendor_portal.html';
                await twilio.messages.create({ body: smsBody, from: process.env.TWILIO_SMS_NUMBER, to: vendor.phone });
                console.log('[DISPATCH] SMS fallback sent to vendor:', vendor.name, vendor.phone);
              } catch(smsErr) {
                console.error('[DISPATCH] SMS also failed:', smsErr.message);
                // Both WA and SMS failed - send email as last resort
                if (vendor.email) {
                  try {
                    const { Resend } = require('resend');
                    const rs = new Resend(process.env.RESEND_API_KEY);
                    await rs.emails.send({
                      from: 'Alina at Consiere <hello@consiere.com.au>',
                      to: vendor.email,
                      subject: 'New booking request — Consiere',
                      html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;padding:28px;border:1px solid #e8e0d4;border-radius:8px"><div style="text-align:center;margin-bottom:16px"><span style="font-size:11px;letter-spacing:4px;color:#b87333">CONSIERE</span></div><h2 style="font-family:Georgia;color:#1c1917;font-weight:400">New Booking Request</h2><p style="color:#44403c;font-size:14px">Hi ' + vendor.name + ',</p><p style="color:#44403c;font-size:14px;line-height:1.8">You have a new service request: <strong>' + description.substring(0,100) + '</strong></p><p style="color:#44403c;font-size:14px">Note: We could not reach you via WhatsApp or SMS. Please update your mobile number in the vendor portal.</p><div style="text-align:center;margin:24px 0"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/vendor_portal.html" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px">View Request</a></div></div>'
                    });
                    console.log('[DISPATCH] Email fallback sent to vendor:', vendor.name, vendor.email);
                  } catch(emailErr) { console.error('[DISPATCH] Email also failed:', emailErr.message); }
                }
              }
            }
          } catch(waErr) { console.error('[DISPATCH WA VENDOR]', waErr.message); }
        }
      } catch(vendorErr) {
        console.error('[DISPATCH] Vendor error:', vendorErr.message);
      }
    }

    // If no registered vendors dispatched — outreach to unregistered via Google Places
    if (dispatched === 0) {
      console.log('[DISPATCH] No registered vendors — triggering unregistered vendor outreach');
      // Same fix as above: detectedLocation is AU-only, and was also being passed here as
      // a whole object instead of its .city — same "Mumbai Australia" bug, plus a second one.
      const cityForSearch = globalLoc?.city || detectedLocation?.city || classified.location || 'Sydney';
      const countryForSearch = globalLoc?.country || detectedLocation?.country || 'AU';
      findAndOutreachUnregisteredVendors(requestId, description, classified.category, cityForSearch, countryForSearch, classified.subcategory)
        .catch(e => console.error('[DISPATCH UV LOCAL]', e.message));
    }

    console.log('[DISPATCH] Done:', dispatched, 'of', vendors.length, 'vendors contacted');
    return { dispatched, total: vendors.length, classified };
  } catch(e) {
    console.error('[DISPATCH] Error:', e.message);
    return { dispatched: 0, classified: { category: 'OTHER' } };
  }
}

module.exports = { dispatchToVendors, classifyRequest };
