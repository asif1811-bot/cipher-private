'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWA } = require('./whatsapp_notifications');
const { startVendorOnboarding, recordTermsAcceptance } = require('./compliance_engine');
const { Resend } = require('resend');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';
function getResend() { return new Resend(process.env.RESEND_API_KEY); }
const REGISTRATION_WINDOW_MINUTES = 30; // Vendor has 30 mins to register
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

// Best-effort email scrape from a vendor website. Returns first sensible email or null.
async function scrapeVendorEmail(website) {
  if (!website) return null;
  let base;
  try { base = new URL(website); } catch(e) { return null; }
  const pages = [website, base.origin + '/contact', base.origin + '/contact-us', base.origin + '/about'];
  const seen = new Set();
  const reject = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;
  const role = /^(info|hello|contact|enquir|enquiries|bookings|booking|events|reservations|sales|admin|office)@/i;
  for (const u of pages) {
    if (seen.has(u)) continue; seen.add(u);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 ConsiereBot' } }).catch(()=>null);
      clearTimeout(t);
      if (!r || !r.ok) continue;
      const html = (await r.text().catch(()=>'')) || '';
      const found = (html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
        .map(e => e.toLowerCase())
        .filter(e => !reject.test(e) && !e.includes('@sentry') && !e.includes('example.com') && !e.includes('@2x'));
      if (found.length) {
        const preferred = found.find(e => role.test(e));
        return preferred || found[0];
      }
    } catch(e) { /* ignore this page */ }
  }
  return null;
}

// ── FIND & OUTREACH UNREGISTERED VENDORS ─────────────────────────────────
async function findAndOutreachUnregisteredVendors(requestId, description, category, city, country, subcategory) {
  try {
    console.log('[UNREGISTERED] Searching Google Places for:', category, city, country);
    // Build intelligent search query
  const SEARCH_TERMS = {
    CAKE_SHOP: 'cake shop bakery', BAKERY: 'bakery patisserie',
    FLORIST: 'florist flower shop', GIFT: 'gift shop hamper store',
    GROCERY: 'grocery supermarket', PHARMACY: 'pharmacy chemist',
    FRUIT_BASKET: 'fruit shop fresh produce',
  };
  const searchTerm = SEARCH_TERMS[subcategory] || (subcategory || category).toLowerCase().replace(/_/g,' ');
  // Map country code to proper name for better search results
  const countryNames = {'IN':'India','AE':'UAE','SG':'Singapore','GB':'UK','US':'USA','CA':'Canada','JP':'Japan','FR':'France','DE':'Germany','NZ':'New Zealand','ZA':'South Africa','KE':'Kenya','NG':'Nigeria','TH':'Thailand','MY':'Malaysia','ID':'Indonesia','PH':'Philippines','KR':'South Korea','CN':'China','BR':'Brazil','MX':'Mexico','QA':'Qatar','BH':'Bahrain','SA':'Saudi Arabia','EG':'Egypt','TR':'Turkey','RU':'Russia'};
  const countryName = countryNames[country] || country || 'Australia';
  const searchQuery = searchTerm + ' ' + (city||'Sydney') + ' ' + countryName;
    const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?query=' +
      encodeURIComponent(searchQuery) + '&key=' + GOOGLE_PLACES_KEY;
    const r = await fetch(url);
    const d = await r.json();
    if (!d.results || !d.results.length) {
      console.log('[UNREGISTERED] No Google results for:', searchQuery);
      return 0;
    }
    // Sort by rating descending — 5 star first
    const sorted = d.results
      .filter(p => (p.rating||0) >= 3.5)
      .sort((a, b) => (b.rating||0) - (a.rating||0))
      .slice(0, 5);
    let outreached = 0;
    for (const place of sorted) {
      // Get phone number via Place Details
      let phone = null;
      let email = null;
      try {
        const detailUrl = 'https://maps.googleapis.com/maps/api/place/details/json?place_id=' +
          place.place_id + '&fields=formatted_phone_number,international_phone_number,website,business_status&key=' + GOOGLE_PLACES_KEY;
        const dr = await fetch(detailUrl);
        const dd = await dr.json();
        // Skip permanently or temporarily closed businesses
        const bizStatus = dd.result?.business_status;
        if (bizStatus === 'CLOSED_PERMANENTLY') {
          console.log('[UNREGISTERED] Skipping permanently closed:', place.name);
          continue;
        }
        if (bizStatus === 'CLOSED_TEMPORARILY') {
          console.log('[UNREGISTERED] Skipping temporarily closed:', place.name);
          continue;
        }
        phone = dd.result?.international_phone_number || dd.result?.formatted_phone_number || null;
        var _website = dd.result?.website || null;
        // Clean phone for WhatsApp
        if (phone) phone = phone.replace(/[^0-9+]/g, '');
        // Validate phone matches expected country — skip if Australian number for non-AU city
        const expectedPrefixes = {'IN':['+91'],'AE':['+971'],'SG':['+65'],'GB':['+44'],'US':['+1'],'CA':['+1'],'JP':['+81'],'FR':['+33'],'DE':['+49'],'NZ':['+64'],'ZA':['+27'],'KE':['+254'],'NG':['+234'],'TH':['+66'],'MY':['+60'],'ID':['+62'],'PH':['+63'],'KR':['+82'],'CN':['+86'],'QA':['+974'],'BH':['+973'],'SA':['+966'],'EG':['+20'],'TR':['+90'],'AU':['+61']};
        if (phone && country && country !== 'AU' && expectedPrefixes[country]) {
          const validPrefix = expectedPrefixes[country].some(p => phone.startsWith(p));
          if (!validPrefix) {
            console.log('[UV] Skipping wrong-country phone:', place.name, phone, '(expected', country, ')');
            phone = null; // Will still outreach via registration link but no WhatsApp
          }
        }
      } catch(e) {}
      // Best-effort: scrape an email from the vendor website (email-first outreach)
      try {
        if (!email && typeof _website !== 'undefined' && _website) {
          email = await scrapeVendorEmail(_website);
          if (email) console.log('[UNREGISTERED] Scraped email for', place.name, ':', email);
        }
      } catch(e) { console.error('[UNREGISTERED] email scrape error:', e.message); }
      // Skip if this vendor was already contacted for this request
      const alreadyContacted = await prisma.unregisteredVendorRequest.findFirst({
        where: { requestId, vendorPhone: phone || undefined, vendorName: place.name }
      });
      if (alreadyContacted) {
        console.log('[UV] Skipping duplicate outreach to:', place.name);
        continue;
      }
      // Create unregistered vendor request record
      const expiresAt = new Date(Date.now() + REGISTRATION_WINDOW_MINUTES * 60 * 1000);
      const uvr = await prisma.unregisteredVendorRequest.create({
        data: {
          requestId,
          vendorName: place.name,
          vendorPhone: phone,
          vendorEmail: email,
          googlePlaceId: place.place_id,
          googleRating: place.rating || 0,
          category,
          city: city || 'Sydney',
          expiresAt,
          vendorAddress: place.formatted_address || place.vicinity || null,
          vendorWebsite: (typeof _website !== 'undefined' ? _website : null),
          status: 'OUTREACHED'
        }
      });
      // Send outreach
      // Auto-outreach disabled: leads are logged for admin review.
      // Outreach (email/WhatsApp) is initiated manually from the admin panel.
      try { await outreachUnregisteredVendor(uvr, description, category); console.log('[UNREGISTERED] Outreach sent to:', place.name); }
      catch(e) { console.error('[UNREGISTERED] Outreach failed for', place.name, ':', e.message); }
      outreached++;
      await new Promise(r => setTimeout(r, 500));
    }
    console.log('[UNREGISTERED] Outreached to', outreached, 'unregistered vendors');
    // Schedule auto-escalation after window expires
    setTimeout(() => escalateExpiredRequests(requestId), (REGISTRATION_WINDOW_MINUTES + 1) * 60 * 1000);
    return outreached;
  } catch(e) {
    console.error('[UNREGISTERED]', e.message);
    return 0;
  }
}

// ── OUTREACH MESSAGE ──────────────────────────────────────────────────────
async function sendOutreachEmail(uvr, requestDescription, category, regLink) {
  const resend = getResend();
  if (!regLink) regLink = CC_URL + '/vendor-register?token=' + uvr.registrationToken + '&request=' + uvr.requestId;
  const toEmail = uvr.vendorEmail || null;
  if (!toEmail) throw new Error('no email');
  const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1612;background:#f8f4ef}
.card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;font-weight:700;margin-bottom:4px}
h2{color:#1a1612;margin:0 0 8px;font-size:24px}
.highlight{background:#f8f4ef;border-radius:12px;padding:20px;margin:20px 0}
.request-box{background:#1a1612;color:#fff;border-radius:12px;padding:20px;margin:20px 0}
.request-label{font-size:11px;letter-spacing:2px;color:#c9a96e;margin-bottom:8px}
.timer{background:#fff3cd;border:1px solid #c9a96e;border-radius:8px;padding:12px;margin:16px 0;font-size:13px;color:#856404}
.btn{display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:16px 24px;border-radius:100px;text-decoration:none;font-weight:700;font-size:16px;margin:24px 0}
.footer{font-size:11px;color:#78716c;margin-top:24px;text-align:center}
</style>
</head>
<body>
<div class="card">
  <div class="logo">CONSIERE</div>
  <h2>New Job Request from Consiere</h2>
  <p style="font-size:14px;color:#44403c;line-height:1.7">Hi <strong>${uvr.vendorName}</strong>,</p>
  <p style="font-size:14px;color:#44403c;line-height:1.7">I am Alina from <strong>Consiere</strong> — an AI-powered personal concierge platform based in Sydney, Australia. We help high-value clients arrange on-demand services, and we found your business on Google Maps with an impressive <strong>${uvr.googleRating}★ rating</strong>.</p>
  <p style="font-size:14px;color:#44403c;line-height:1.7">We'd love to send you a new client job:</p>
  <div class="request-box">
    <div class="request-label">JOB REQUEST</div>
    <strong>${category}</strong><br>
    <span style="color:#ccc;font-size:14px">${(requestDescription||'').substr(0,150)}</span>
  </div>
  <div class="highlight">
    <strong>How it works:</strong><br>
    1. Register your business free (2 minutes)<br>
    2. View and accept the pending job<br>
    3. Quote the client directly<br>
    4. Complete the job — we release payment<br>
    <strong>We only take 10% on completion. No upfront fees.</strong>
  </div>
  <div class="timer">
    ⏰ <strong>You have ${REGISTRATION_WINDOW_MINUTES} minutes to register</strong> before we move to the next vendor.
  </div>
  <a class="btn" href="${regLink}">Register & Accept Job →</a>
  <div class="footer">
    Consiere — Cipher Concierge Group Pty Ltd | Sydney, Australia<br>
    You received this because your business was selected from Google Maps.<br>
    <a href="${CC_URL}/vendor-unsubscribe?token=${uvr.registrationToken}">Unsubscribe</a>
  </div>
</div>
</body>
</html>`;
  await resend.emails.send({
    from: 'Consiere Vendors <vendors@consiere.com.au>',
    to: toEmail,
    cc: ['hello@consiere.com.au'],
    subject: '🌟 New ' + category.replace('_',' ').toLowerCase() + ' job from Consiere — accept in 2 minutes',
    html: emailHtml
  });
}

async function outreachUnregisteredVendor(uvr, requestDescription, category) {
  try {
    const regLink = CC_URL + '/vendor-register?token=' + uvr.registrationToken + '&request=' + uvr.requestId;
    const timeWindow = REGISTRATION_WINDOW_MINUTES + ' minutes';

    // ── EMAIL FIRST (lowest-risk channel for cold contacts) ──
    if (uvr.vendorEmail) {
      try {
        await sendOutreachEmail(uvr, requestDescription, category, regLink);
        await prisma.unregisteredVendorRequest.update({ where: { id: uvr.id }, data: { status: 'OUTREACHED' } }).catch(()=>{});
        console.log('[UNREGISTERED] Email-first sent to:', uvr.vendorName, uvr.vendorEmail, '— skipping WhatsApp/SMS');
        return; // email succeeded; do not also cold-WhatsApp
      } catch(emailErr) {
        console.error('[UNREGISTERED] Email-first failed, falling back to WhatsApp:', emailErr.message);
      }
    }

    // WhatsApp outreach (fallback when no email found)
    if (uvr.vendorPhone) {
      const waMsg =
        '🌟 Hi *' + uvr.vendorName + '*!\n\n' +
        'I\'m Alina from *Consiere* — an AI-powered personal concierge platform based in Sydney, Australia. We connect high-value clients with top local businesses for on-demand services.\n\n' +
        'We found your business on Google Maps and your *' + uvr.googleRating + '★ rating* made you our top choice for a new client request.\n\n' +
        '📋 *New Job Request:*\n' + (requestDescription||'').substr(0, 120) + '\n\n' +
        '💰 *How it works:*\n' +
        '• Client pays through our platform\n' +
        '• We pay you directly (minus 10% commission)\n' +
        '• No lock-in — accept only jobs you want\n' +
        '• Free to register — takes 2 minutes\n\n' +
        '✅ *Register free to accept this job:*\n' +
        '👉 ' + regLink + '\n\n' +
        '⏰ *You have ' + timeWindow + ' to respond before we contact the next vendor.*\n\n' +
        'Questions? Just reply to this message.\n\n' +
        '— Alina, AI Concierge\n' +
        'Consiere | hello@consiere.com.au | consiere.com.au';
      try {
        // Use approved template for vendor outreach (they have not messaged us first)
    const vendorTemplateSid = process.env.TWILIO_VENDOR_TEMPLATE_SID;
    if (vendorTemplateSid) {
      // Use content template with variables
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
      try {
        const client = require('twilio')(sid, token);
        const msgServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID || null;
        const createParams = {
          contentSid: vendorTemplateSid,
          contentVariables: JSON.stringify({
            "1": uvr.vendorName,
            "2": (requestDescription||'').substring(0,60),
            "3": regLink
          }),
          to: 'whatsapp:' + uvr.vendorPhone
        };
        if (msgServiceSid) {
          createParams.messagingServiceSid = msgServiceSid;
        } else {
          createParams.from = from;
        }
        await client.messages.create(createParams);
        console.log('[UNREGISTERED] WhatsApp template sent to:', uvr.vendorName, uvr.vendorPhone);
      // Also send SMS for better delivery to new contacts
      try {
        const smsClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const smsFrom = process.env.TWILIO_SMS_NUMBER || '+18167931476';
        const smsMsg = 'New job from Consiere for ' + uvr.vendorName + ': ' + (requestDescription||'').substring(0,60) + '. Register free: ' + regLink;
        await smsClient.messages.create({ body: smsMsg, from: smsFrom, to: uvr.vendorPhone });
        console.log('[UNREGISTERED] SMS also sent to:', uvr.vendorPhone);
      } catch(smsErr) { console.log('[UNREGISTERED] SMS skipped:', smsErr.message); }
      } catch(e) {
        console.error('[UNREGISTERED] Template failed, trying free-form:', e.message);
        // Try free-form WhatsApp
        const waResult = await sendWA(uvr.vendorPhone, waMsg).catch(()=>false);
        if(!waResult) {
          // WhatsApp failed - try SMS as fallback
          try {
            const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            const smsMsg = 'New job from Consiere for ' + uvr.vendorName + ': ' + (requestDescription||'').substring(0,80) + '. Register free: ' + regLink;
            await client.messages.create({ body: smsMsg, from: '+18167931476', to: uvr.vendorPhone });
            console.log('[UNREGISTERED] SMS fallback sent to:', uvr.vendorPhone);
          } catch(smsErr) {
            console.error('[UNREGISTERED] SMS also failed:', smsErr.message);
          }
        }
      }
    } else {
      await sendWA(uvr.vendorPhone, waMsg);
    }
        console.log('[UNREGISTERED] WhatsApp sent to:', uvr.vendorName, uvr.vendorPhone);
      } catch(e) {
        console.error('[UNREGISTERED WA]', e.message);
      }
    }
    // Email outreach
    const resend = getResend();
    const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1612;background:#f8f4ef}
.card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;font-weight:700;margin-bottom:4px}
h2{color:#1a1612;margin:0 0 8px;font-size:24px}
.highlight{background:#f8f4ef;border-radius:12px;padding:20px;margin:20px 0}
.request-box{background:#1a1612;color:#fff;border-radius:12px;padding:20px;margin:20px 0}
.request-label{font-size:11px;letter-spacing:2px;color:#c9a96e;margin-bottom:8px}
.timer{background:#fff3cd;border:1px solid #c9a96e;border-radius:8px;padding:12px;margin:16px 0;font-size:13px;color:#856404}
.btn{display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:16px 24px;border-radius:100px;text-decoration:none;font-weight:700;font-size:16px;margin:24px 0}
.footer{font-size:11px;color:#78716c;margin-top:24px;text-align:center}
</style>
</head>
<body>
<div class="card">
  <div class="logo">CONSIERE</div>
  <h2>New Job Request from Consiere</h2>
  <p style="font-size:14px;color:#44403c;line-height:1.7">Hi <strong>${uvr.vendorName}</strong>,</p>
  <p style="font-size:14px;color:#44403c;line-height:1.7">I am Alina from <strong>Consiere</strong> — an AI-powered personal concierge platform based in Sydney, Australia. We help high-value clients arrange on-demand services, and we found your business on Google Maps with an impressive <strong>${uvr.googleRating}★ rating</strong>.</p>
  <p style="font-size:14px;color:#44403c;line-height:1.7">We'd love to send you a new client job:</p>
  <div class="request-box">
    <div class="request-label">JOB REQUEST</div>
    <strong>${category}</strong><br>
    <span style="color:#ccc;font-size:14px">${(requestDescription||'').substr(0,150)}</span>
  </div>
  <div class="highlight">
    <strong>How it works:</strong><br>
    1. Register your business free (2 minutes)<br>
    2. View and accept the pending job<br>
    3. Quote the client directly<br>
    4. Complete the job — we release payment<br>
    <strong>We only take 10% on completion. No upfront fees.</strong>
  </div>
  <div class="timer">
    ⏰ <strong>You have ${REGISTRATION_WINDOW_MINUTES} minutes to register</strong> before we move to the next vendor.
  </div>
  <a class="btn" href="${regLink}">Register & Accept Job →</a>
  <div class="footer">
    Consiere — Cipher Concierge Group Pty Ltd | Sydney, Australia<br>
    You received this because your business was selected from Google Maps.<br>
    <a href="${CC_URL}/vendor-unsubscribe?token=${uvr.registrationToken}">Unsubscribe</a>
  </div>
</div>
</body>
</html>`;
    // Try to find email from website or use a generic address
    const toEmail = uvr.vendorEmail || null;
    if (toEmail) {
      await resend.emails.send({
        from: 'Consiere Vendors <vendors@consiere.com.au>',
        to: toEmail,
        cc: ['hello@consiere.com.au'],
        subject: '🌟 New ' + category.replace('_',' ').toLowerCase() + ' job from Consiere — accept in 2 minutes',
        html: emailHtml
      });
    }
    // Update status
    await prisma.unregisteredVendorRequest.update({
      where: { id: uvr.id },
      data: { status: 'OUTREACHED' }
    });
  } catch(e) {
    console.error('[OUTREACH]', e.message);
  }
}

// ── VENDOR REGISTRATION PAGE DATA ────────────────────────────────────────
async function getRegistrationContext(token) {
  try {
    const uvr = await prisma.unregisteredVendorRequest.findUnique({
      where: { registrationToken: token },
      include: { request: { include: { user: { select: { fullName: true } } } } }
    });
    if (!uvr) return { valid: false, reason: 'Invalid token' };
    if (uvr.registeredAt) return { valid: false, reason: 'Already registered' };
    if (new Date() > new Date(uvr.expiresAt)) {
      return { valid: false, reason: 'expired', minutesExpired: Math.round((Date.now() - new Date(uvr.expiresAt)) / 60000) };
    }
    const minutesLeft = Math.round((new Date(uvr.expiresAt) - Date.now()) / 60000);
    return {
      valid: true,
      vendorName: uvr.vendorName,
      category: uvr.category,
      city: uvr.city,
      googleRating: uvr.googleRating,
      requestDescription: uvr.request?.description || '',
      requestCategory: uvr.request?.category || uvr.category,
      minutesLeft,
      token,
      requestId: uvr.requestId
    };
  } catch(e) {
    console.error('[REG CONTEXT]', e.message);
    return { valid: false, reason: 'Error' };
  }
}

// ── COMPLETE REGISTRATION & AUTO-ASSIGN REQUEST ───────────────────────────
async function completeRegistrationAndAssign(token, vendorData) {
  try {
    const uvr = await prisma.unregisteredVendorRequest.findUnique({
      where: { registrationToken: token }
    });
    if (!uvr) return { success: false, error: 'Invalid token' };
    if (uvr.registeredAt) return { success: false, error: 'Already registered' };
    if (new Date() > new Date(uvr.expiresAt)) return { success: false, error: 'Registration window expired' };
    // Create vendor record
    const bcrypt = require('bcryptjs');
    const vendorPassword = await bcrypt.hash(vendorData.password || Math.random().toString(36).substr(2,10), 10);
    // Check if vendor already exists by email
    let vendor = await prisma.vendor.findFirst({ where: { email: vendorData.email } });
    if (!vendor) {
      // Geocode the registering vendor so the radius filter can match them.
      let _rlat = null, _rlng = null;
      try {
        const { geocode } = require('../utils/geo');
        const _g = await geocode((vendorData.businessName || uvr.vendorName) + ', ' + (uvr.city || 'Sydney') + ', Australia');
        if (_g) { _rlat = _g.lat; _rlng = _g.lng; }
      } catch(_ge) { console.error('[REGISTRATION] geocode error:', _ge.message); }
      vendor = await prisma.vendor.create({
        data: {
          name: vendorData.businessName || uvr.vendorName,
          contactName: vendorData.contactName || vendorData.businessName || uvr.vendorName,
          email: vendorData.email,
          phone: vendorData.phone || uvr.vendorPhone || '',
          category: uvr.category || 'PROCUREMENT',
          cities: uvr.city || 'Sydney',
          address: uvr.vendorAddress || null,
          lat: _rlat, lng: _rlng,
          isActive: true,
          passwordHash: vendorPassword,
          referredBy: vendorData.referredBy || null,
          referralCode: (String(vendorData.businessName||uvr.vendorName||'VENDOR').replace(/[^A-Za-z0-9]/g,'').toUpperCase().substring(0,6)||'VENDOR') + Math.random().toString(36).substring(2,6).toUpperCase()
        }
      });
      console.log('[REGISTRATION] New vendor created:', vendor.id, vendor.name);
      // Start 5-email onboarding sequence
      startVendorOnboarding(vendor.id).catch(e => console.error('[ONBOARDING]', e.message));
      // Record vendor agreement acceptance
      recordTermsAcceptance(null, vendor.id, 'VENDOR_AGREEMENT', null, null).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
    }
    // Mark as registered
    await prisma.unregisteredVendorRequest.update({
      where: { id: uvr.id },
      data: { status: 'REGISTERED', registeredAt: new Date() }
    });
    // NOW assign this vendor to the pending request
    const request = await prisma.request.findUnique({ where: { id: uvr.requestId } });
    if (request && ['RECEIVED','PENDING','DISPATCHED'].includes(request.status)) {
      // Vendor registered — flag for MANUAL push. Do NOT change status or notify client yet.
      await prisma.request.update({
        where: { id: uvr.requestId },
        data: { pendingFulfilment: true }
      });
      // Create a VendorInquiry so vendor can see and quote the job in their portal
      await prisma.vendorInquiry.create({
        data: {
          requestId: uvr.requestId,
          vendorId: vendor.id,
          status: 'SENT',
          emailSentAt: new Date()
        }
      }).catch(e => console.error('[REGISTRATION] Failed to create inquiry:', e.message));
      // Send vendor the job details
      const respondUrl = CC_URL + '/vendor-portal?token=' + uvr.registrationToken;
      if (vendorData.phone || uvr.vendorPhone) {
        await sendWA(vendorData.phone || uvr.vendorPhone,
          '🎉 *Registration complete & job assigned!*\n\n' +
          '*Job: ' + (request.category||'Service') + '*\n' +
          (request.description||'').substr(0,100) + '\n\n' +
          'Please quote the client now:\n👉 ' + respondUrl + '\n\n' +
          '_— Consiere_'
        );
      }
      // Client is NOT notified here — admin pushes fulfilment manually after speaking to the vendor.
      // Notify admin
      await sendWA('+61413536700',
        '🆕 *New Vendor Registered via Job Request*\n\n' +
        'Vendor: ' + vendor.name + '\n' +
        'Rating: ' + uvr.googleRating + '⭐\n' +
        'Category: ' + uvr.category + '\n' +
        'Email: ' + vendor.email + '\n\n' +
        'Auto-assigned to request: ' + uvr.requestId.substr(0,8)
      );
      console.log('[REGISTRATION] Vendor assigned to request:', uvr.requestId);
      return { success: true, vendorId: vendor.id, requestAssigned: true, vendorName: vendor.name };
    }
    return { success: true, vendorId: vendor.id, requestAssigned: false, reason: 'Request no longer available' };
  } catch(e) {
    console.error('[COMPLETE REGISTRATION]', e.message);
    return { success: false, error: e.message };
  }
}

// ── AUTO-ESCALATE EXPIRED REQUESTS ────────────────────────────────────────
async function escalateExpiredRequests(requestId) {
  try {
    // Find expired unregistered vendor requests for this job
    const expired = await prisma.unregisteredVendorRequest.findMany({
      where: { requestId, status: 'OUTREACHED', expiresAt: { lt: new Date() } }
    });
    if (!expired.length) return;
    await prisma.unregisteredVendorRequest.updateMany({
      where: { requestId, status: 'OUTREACHED', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' }
    });
    // Check if request is still unassigned
    const request = await prisma.request.findUnique({ where: { id: requestId } });
    if (!request || !['RECEIVED','PENDING','DISPATCHED'].includes(request.status)) return;
    if (request.status === 'COMPLETED') return; // Already completed
    console.log('[ESCALATE] No vendor registered for request:', requestId, '— escalating to next Google vendor');
    // Notify admin to handle manually
    await sendWA('+61413536700',
      '⚠️ *Vendor Registration Window Expired*\n\n' +
      'Request: ' + requestId.substr(0,8) + '\n' +
      'Category: ' + request.category + '\n' +
      'Description: ' + (request.description||'').substring(0,60) + '\n' +
      'Delivery: ' + (request.deliveryAddress||'not set') + '\n' +
      expired.length + ' vendors outreached — none registered.\n\n' +
      '*Action needed:* Please assign a vendor manually or we will re-search Google.\n\n' +
      'Request ID: ' + requestId
    );
    // Auto re-search Google using correct city and subcategory
    // Detect city from delivery address or description
    const { detectGlobalLocation } = require('../utils/global_locations');
    const { detectLocation } = require('../utils/australia_locations');
    const locText = (request.deliveryAddress || '') + ' ' + (request.description || '');
    const globalLoc = detectGlobalLocation(locText);
    const auLoc = detectLocation(locText);
    const city = globalLoc?.city || auLoc?.city || 'Sydney';
    const country = globalLoc?.country || 'AU';

    // Detect subcategory for better search
    const PROC_KEYWORDS = {
      CAKE_SHOP: ['cake','cupcake','birthday cake','wedding cake'],
      BAKERY: ['bakery','bread','pastry','croissant'],
      FLORIST: ['flower','bouquet','florist','roses','floral'],
      GIFT: ['gift','hamper','present','basket'],
      GROCERY: ['grocery','supermarket','food'],
      PHARMACY: ['pharmacy','chemist','medication'],
      FRUIT_BASKET: ['fruit','mango','fresh fruit'],
    };
    const SEARCH_TERMS = {
      CAKE_SHOP: 'cake shop bakery', BAKERY: 'bakery patisserie',
      FLORIST: 'florist flower shop', GIFT: 'gift shop hamper',
      GROCERY: 'grocery supermarket', PHARMACY: 'pharmacy chemist',
      FRUIT_BASKET: 'fruit shop',
    };
    const desc = (request.description || '').toLowerCase();
    let subcategory = null;
    for (const [sub, keywords] of Object.entries(PROC_KEYWORDS)) {
      if (keywords.some(k => desc.includes(k))) { subcategory = sub; break; }
    }
    const searchTerm = SEARCH_TERMS[subcategory] || request.category.toLowerCase();
    const searchQuery = searchTerm + ' ' + city + ' ' + (country === 'AU' ? 'Australia' : '');

    console.log('[ESCALATE] Re-searching Google for:', searchQuery);
    findAndOutreachUnregisteredVendors(request.id, request.description, request.category, city, country, subcategory)
      .catch(e => console.error('[ESCALATE GOOGLE]', e.message));
  } catch(e) {
    console.error('[ESCALATE]', e.message);
  }
}

// ── CRON: CHECK ALL EXPIRED UNREGISTERED REQUESTS ────────────────────────
async function runExpiredVendorCheck() {
  try {
    const expired = await prisma.unregisteredVendorRequest.findMany({
      where: { status: 'OUTREACHED', expiresAt: { lt: new Date() } },
      select: { requestId: true }
    });
    const uniqueRequestIds = [...new Set(expired.map(e => e.requestId))];
    for (const requestId of uniqueRequestIds) {
      await escalateExpiredRequests(requestId);
    }
    console.log('[EXPIRED CHECK] Processed', uniqueRequestIds.length, 'expired requests');
  } catch(e) {
    console.error('[EXPIRED CHECK]', e.message);
  }
}

// ── ADMIN: LIST PENDING UNREGISTERED LEADS ────────────────────────────────
async function getUnregisteredVendorLeads(status) {
  return await prisma.unregisteredVendorRequest.findMany({
    where: { status: status || 'OUTREACHED' },
    orderBy: [{ googleRating: 'desc' }, { createdAt: 'desc' }],
    take: 50
  });
}

module.exports = {
  findAndOutreachUnregisteredVendors,
  getRegistrationContext,
  completeRegistrationAndAssign,
  escalateExpiredRequests,
  runExpiredVendorCheck,
  getUnregisteredVendorLeads
};
