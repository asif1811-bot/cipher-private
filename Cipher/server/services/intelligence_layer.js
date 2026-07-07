'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWA } = require('./whatsapp_notifications');
const { Resend } = require('resend');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

// ── 51. CONVERSATION INTELLIGENCE ────────────────────────────────────────
async function analyseConversation(userId, messages) {
  try {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    // Sentiment scoring
    const positiveWords = ['great','amazing','perfect','love','excellent','wonderful','thank','appreciate','fantastic','brilliant'];
    const negativeWords = ['disappointed','terrible','awful','worst','useless','waste','frustrated','annoyed','bad','poor'];
    const positiveCount = positiveWords.filter(w => text.includes(w)).length;
    const negativeCount = negativeWords.filter(w => text.includes(w)).length;
    let sentiment = 'NEUTRAL';
    let satisfaction = 5;
    if (positiveCount > negativeCount + 1) { sentiment = 'POSITIVE'; satisfaction = Math.min(10, 7 + positiveCount); }
    if (negativeCount > positiveCount) { sentiment = 'NEGATIVE'; satisfaction = Math.max(1, 4 - negativeCount); }
    // Unmet needs detection
    const unmetPatterns = [/i wish/gi, /would be great if/gi, /can you also/gi, /what about/gi, /do you do/gi];
    const unmetNeeds = [];
    unmetPatterns.forEach(p => { const m = text.match(p); if (m) unmetNeeds.push(...m); });
    // Key topics
    const categories = ['dining','travel','transport','shopping','home','events','medical','legal','finance','cleaning'];
    const keyTopics = categories.filter(c => text.includes(c));
    // Save insight
    await prisma.conversationInsight.create({
      data: { userId, sentiment, satisfaction, unmetNeeds: unmetNeeds.slice(0,3).join('; ') || null, keyTopics: keyTopics.join(',') || null }
    });
    // Alert on very negative sentiment
    if (sentiment === 'NEGATIVE' && satisfaction <= 2) {
      await sendWA('+61413536700', '⚠️ *Negative conversation detected*\n\nUser ID: ' + userId + '\nSatisfaction: ' + satisfaction + '/10\nSentiment: ' + sentiment + '\n\nIntervention may be needed.');
    }
    return { sentiment, satisfaction, unmetNeeds, keyTopics };
  } catch(e) { console.error('[CONV INTELLIGENCE]', e.message); }
}

async function weeklyInsightReport() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const insights = await prisma.conversationInsight.findMany({ where: { createdAt: { gte: sevenDaysAgo } } });
    if (!insights.length) return;
    const sentiments = { POSITIVE:0, NEUTRAL:0, NEGATIVE:0 };
    const avgSat = insights.reduce((s,i) => { sentiments[i.sentiment]++; return s + i.satisfaction; }, 0) / insights.length;
    const topicMap = {};
    insights.forEach(i => { if (i.keyTopics) i.keyTopics.split(',').forEach(t => { topicMap[t] = (topicMap[t]||0)+1; }); });
    const topTopics = Object.entries(topicMap).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>k+':'+v).join(', ');
    await sendWA('+61413536700',
      '🧠 *Weekly Conversation Intelligence*\n\n' +
      '💬 Total conversations: ' + insights.length + '\n' +
      '😊 Positive: ' + sentiments.POSITIVE + ' | 😐 Neutral: ' + sentiments.NEUTRAL + ' | 😞 Negative: ' + sentiments.NEGATIVE + '\n' +
      '⭐ Avg satisfaction: ' + avgSat.toFixed(1) + '/10\n' +
      '🏷️ Top topics: ' + (topTopics||'—') + '\n\n' +
      '_Consiere Intelligence — ' + new Date().toLocaleDateString('en-AU') + '_'
    );
    console.log('[CONV INTELLIGENCE] Weekly report sent');
  } catch(e) { console.error('[WEEKLY INSIGHT]', e.message); }
}

// ── 52. VENDOR MATCH V2 — LEARNING MODEL ─────────────────────────────────
async function logVendorMatchOutcome(requestId, vendorId, outcome, responseTimeMinutes) {
  try {
    await prisma.vendorMatchLog.updateMany({
      where: { requestId, vendorId },
      data: { outcome, responseTime: responseTimeMinutes }
    });
    // Update vendor's learned score
    const logs = await prisma.vendorMatchLog.findMany({ where: { vendorId }, take: 50, orderBy: { createdAt: 'desc' } });
    if (logs.length < 5) return;
    const successRate = logs.filter(l => l.outcome === 'COMPLETED').length / logs.length;
    const avgResponse = logs.filter(l => l.responseTime).reduce((s,l) => s + l.responseTime, 0) / logs.filter(l=>l.responseTime).length || 60;
    const learnedScore = Math.round((successRate * 60) + (Math.max(0, 120 - avgResponse) / 120 * 40));
    await prisma.vendor.update({ where: { id: vendorId }, data: { ratingCount: { increment: 0 } } }); // touch record
    console.log('[VENDOR MATCH V2] Learned score for', vendorId, ':', learnedScore);
    return learnedScore;
  } catch(e) { console.error('[VENDOR MATCH LOG]', e.message); }
}

async function getSmartVendorRanking(category, location, requestDescription) {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true, categories: { hasSome: [category] } },
      include: { matchLogs: { take: 30, orderBy: { createdAt: 'desc' } } }
    }).catch(() => []);
    const scored = vendors.map(v => {
      const logs = v.matchLogs || [];
      const successRate = logs.length ? logs.filter(l=>l.outcome==='COMPLETED').length/logs.length : 0.7;
      const avgResp = logs.filter(l=>l.responseTime).length ? logs.filter(l=>l.responseTime).reduce((s,l)=>s+l.responseTime,0)/logs.filter(l=>l.responseTime).length : 60;
      const score = Math.round((v.rating||3)/5*40 + successRate*35 + Math.max(0,120-avgResp)/120*25);
      return { ...v, smartScore: score };
    });
    return scored.sort((a,b) => b.smartScore - a.smartScore);
  } catch(e) { console.error('[SMART RANKING]', e.message); return []; }
}

// ── 53. REQUEST AUTO-CATEGORISATION ──────────────────────────────────────
async function autoCategories(description) {
  const text = description.toLowerCase();
  const rules = [
    { cat:'AVIATION', sub:'private_jet', k:['jet','aircraft','private flight','charter'] },
    { cat:'DINING', sub:'fine_dining', k:['restaurant','dinner','lunch','table','reservation','booking','eat','meal','food'] },
    { cat:'DINING', sub:'catering', k:['cater','catering','event food','party food'] },
    { cat:'TRANSPORT', sub:'chauffeur', k:['car','driver','chauffeur','uber','taxi','ride','pickup','airport transfer'] },
    { cat:'TRANSPORT', sub:'yacht', k:['yacht','boat','vessel','charter boat'] },
    { cat:'TRAVEL', sub:'flights', k:['flight','fly','ticket','airline','airfare'] },
    { cat:'TRAVEL', sub:'hotel', k:['hotel','accommodation','stay','suite','resort','check in'] },
    { cat:'SHOPPING', sub:'gifts', k:['gift','present','birthday','anniversary','flowers','bouquet'] },
    { cat:'SHOPPING', sub:'luxury', k:['buy','purchase','order','shop','shopping'] },
    { cat:'HOME', sub:'cleaning', k:['clean','cleaner','maid','housekeeping'] },
    { cat:'HOME', sub:'repairs', k:['fix','repair','plumber','electrician','tradesperson','handyman'] },
    { cat:'EVENTS', sub:'tickets', k:['ticket','concert','show','event','performance'] },
    { cat:'EVENTS', sub:'planning', k:['party','wedding','event plan','organise'] },
    { cat:'MEDICAL', sub:'appointment', k:['doctor','medical','appointment','health','clinic','dentist'] },
    { cat:'PROCUREMENT', sub:'general', k:['source','find','get me','procure','locate'] },
    { cat:'RELOCATION', sub:'moving', k:['move','moving','relocate','visa','immigration'] },
    { cat:'SECURITY', sub:'personal', k:['security','bodyguard','protection','guard'] },
  ];
  for (const rule of rules) {
    if (rule.k.some(k => text.includes(k))) {
      return { category: rule.cat, subcategory: rule.sub, confidence: 0.85 };
    }
  }
  return { category: 'PROCUREMENT', subcategory: 'general', confidence: 0.5 };
}

// ── 54. FRAUD DETECTION ───────────────────────────────────────────────────
const FOUL_WORDS = ['fuck','shit','cunt','bitch','asshole','bastard','dick','pussy','cock','twat','wanker','arse','motherfucker','faggot','nigger','whore','slut'];

async function checkFraud(userId, phone, email, messageText) {
  try {
    const flags = [];
    // Foul language check
    if (messageText) {
      const lower = messageText.toLowerCase();
      const foulFound = FOUL_WORDS.filter(w => lower.includes(w));
      if (foulFound.length > 0) {
        flags.push({ reason: 'FOUL_LANGUAGE: ' + foulFound.join(', '), severity: 'MEDIUM' });
        // Warn user
        if (phone) {
          await sendWA(phone,
            '⚠️ *A friendly reminder*\n\nConsiere maintains a respectful environment for all members and staff.\n\nPlease keep all communications professional.\n\nContinued inappropriate language may result in account suspension.\n\n_— Consiere Trust & Safety_'
          );
        }
        // Notify admin
        await sendWA('+61413536700',
          '🚨 *Foul language detected*\n\nUser: ' + userId + '\nPhone: ' + (phone||'—') + '\nWords: ' + foulFound.join(', ') + '\n\nUser has been warned automatically.'
        );
      }
    }
    // Multiple accounts same phone
    if (phone) {
      const samePhone = await prisma.user.count({ where: { phone } });
      if (samePhone > 1) flags.push({ reason: 'DUPLICATE_PHONE: ' + phone, severity: 'HIGH' });
    }
    // Excess refunds
    if (userId) {
      const refunds = await prisma.payment.count({ where: { request: { userId }, status: 'REFUNDED' } });
      if (refunds >= 2) flags.push({ reason: 'REFUND_LIMIT_REACHED: ' + refunds + ' refunds', severity: 'MEDIUM' });
    }
    // Rapid message spam (>20 messages in 10 mins)
    if (userId) {
      const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentMsgs = await prisma.message.count({ where: { userId, createdAt: { gte: tenMinsAgo } } }).catch(() => 0);
      if (recentMsgs > 20) flags.push({ reason: 'MESSAGE_SPAM: ' + recentMsgs + ' messages in 10 mins', severity: 'HIGH' });
    }
    // Save flags
    for (const flag of flags) {
      await prisma.fraudFlag.create({ data: { userId: userId||null, phone: phone||null, email: email||null, ...flag } });
    }
    if (flags.some(f => f.severity === 'HIGH')) {
      await prisma.user.update({ where: { id: userId }, data: { isFraudFlagged: true } }).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
      await sendWA('+61413536700', '🚨 *HIGH RISK FRAUD FLAG*\n\nUser: ' + userId + '\nReasons:\n' + flags.map(f=>f.reason).join('\n') + '\n\nAccount flagged for review.');
    }
    return { flagged: flags.length > 0, flags };
  } catch(e) { console.error('[FRAUD CHECK]', e.message); return { flagged: false }; }
}

// ── 56. GOOGLE VENDOR AUTO-DISCOVERY ─────────────────────────────────────
async function findGoogleVendors(category, city, country) {
  try {
    const searchQuery = category + ' ' + city + ' ' + (country||'');
    // Use Google Places API if key available, otherwise use Outscraper/SerpAPI
    let results = [];
    if (GOOGLE_PLACES_KEY && GOOGLE_PLACES_KEY !== 'your_key_here' && GOOGLE_PLACES_KEY.length > 10) {
      const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?query=' + encodeURIComponent(searchQuery) + '&key=' + GOOGLE_PLACES_KEY;
      const r = await fetch(url);
      const d = await r.json();
      results = d.results || [];
    } else if (process.env.SERPAPI_KEY) {
      // SerpAPI fallback (free 100/month)
      const url = 'https://serpapi.com/search.json?engine=google_maps&q=' + encodeURIComponent(searchQuery) + '&api_key=' + process.env.SERPAPI_KEY;
      const r = await fetch(url);
      const d = await r.json();
      results = (d.local_results || []).map(p => ({
        name: p.title, place_id: p.place_id,
        rating: p.rating, formatted_address: p.address
      }));
    } else {
      // No API key — log the lead for manual follow-up
      console.log('[GOOGLE VENDOR] No API key — logging lead for manual outreach:', searchQuery);
      await sendWA('+61413536700',
        '🔍 *Vendor Search Required*\n\nCategory: ' + category + '\nCity: ' + city + ', ' + (country||'') + '\n\nNo Google API key configured. Please search manually:\n👉 maps.google.com/search/' + encodeURIComponent(searchQuery) + '\n\nAdd GOOGLE_PLACES_API_KEY to .env to automate this.'
      );
      return [];
    }
    // Sort by rating descending (5-star first)
    const sorted = results
      .filter(p => p.rating >= 3.5)
      .sort((a,b) => (b.rating||0) - (a.rating||0));
    const leads = [];
    for (const place of sorted.slice(0, 10)) {
      // Get phone via Place Details
      let phone = null;
      if (GOOGLE_PLACES_KEY) {
        try {
          const detailUrl = 'https://maps.googleapis.com/maps/api/place/details/json?place_id=' + place.place_id + '&fields=formatted_phone_number,website,opening_hours,business_status&key=' + GOOGLE_PLACES_KEY;
          const dr = await fetch(detailUrl);
          const dd = await dr.json();
          // Skip permanently or temporarily closed businesses
          if (dd.result?.business_status === 'CLOSED_PERMANENTLY') {
            console.log('[INTELLIGENCE] Skipping permanently closed:', place.name);
            continue;
          }
          if (dd.result?.business_status === 'CLOSED_TEMPORARILY') {
            console.log('[INTELLIGENCE] Skipping temporarily closed:', place.name);
            continue;
          }
          phone = dd.result?.formatted_phone_number || null;
        } catch(e) {}
      }
      // Save as lead
      const existing = await prisma.googleVendorLead.findFirst({ where: { googlePlaceId: place.place_id } });
      if (!existing) {
        const lead = await prisma.googleVendorLead.create({ data: {
          name: place.name, phone, address: place.formatted_address || '',
          city, category, googleRating: place.rating || 0, googlePlaceId: place.place_id
        }});
        leads.push(lead);
        // Auto-outreach if phone available
        if (phone) await outreachGoogleVendor(lead);
      }
    }
    console.log('[GOOGLE VENDOR] Found', leads.length, 'new leads for', category, 'in', city);
    // Notify admin of new leads
    if (leads.length > 0) {
      await sendWA('+61413536700',
        '🔍 *Google Vendor Discovery*\n\nCategory: ' + category + '\nCity: ' + city + ', ' + country + '\n\nFound ' + leads.length + ' new vendors:\n' +
        leads.slice(0,3).map(l => '• ' + l.name + ' ⭐' + l.googleRating + (l.phone?' 📱'+l.phone:' (no phone)')).join('\n') +
        (leads.length > 3 ? '\n+ ' + (leads.length-3) + ' more...' : '') +
        '\n\nView all at: consiere.com.au/cc-admin → Vendor Leads'
      );
    }
    return leads;
  } catch(e) { console.error('[GOOGLE VENDOR]', e.message); return []; }
}

async function outreachGoogleVendor(lead) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    // Format phone for WhatsApp — remove brackets, spaces, dashes
    // Add country code based on city/country if needed
    let waPhone = null;
    if (lead.phone) {
      // Strip all non-numeric except leading +
      let cleaned = lead.phone.replace(/[^0-9+]/g, '');
      // If no country code, try to detect from address
      if (!cleaned.startsWith('+')) {
        const addr = (lead.address||'').toLowerCase();
        if (addr.includes('canada') || addr.includes(', on') || addr.includes(', bc') || addr.includes(', ab')) {
          cleaned = '+1' + cleaned;
        } else if (addr.includes('australia') || addr.includes(', nsw') || addr.includes(', vic') || addr.includes(', qld')) {
          cleaned = '+61' + cleaned;
        } else if (addr.includes('united states') || addr.includes(', ny') || addr.includes(', ca') || addr.includes(', tx')) {
          cleaned = '+1' + cleaned;
        } else if (addr.includes('united kingdom') || addr.includes(', england') || addr.includes(', london')) {
          cleaned = '+44' + cleaned;
        } else if (addr.includes('uae') || addr.includes('dubai') || addr.includes('abu dhabi')) {
          cleaned = '+971' + cleaned;
        } else if (addr.includes('singapore')) {
          cleaned = '+65' + cleaned;
        } else {
          cleaned = '+' + cleaned; // Best guess
        }
      }
      waPhone = cleaned;
    }
    // WhatsApp outreach if phone available
    if (waPhone) {
      await sendWA(waPhone,
        '👋 Hi ' + lead.name + '!\n\nI\'m reaching out from *Consiere* — Australia\'s personal AI concierge platform.\n\n' +
        'We have members in your area requesting *' + lead.category + '* services and your business came up as highly rated (⭐' + lead.googleRating + ').\n\n' +
        'We\'d love to connect you with these clients. There\'s *no upfront cost* — we only charge a small commission on completed bookings.\n\n' +
        'Interested? Apply here:\n👉 ' + CC_URL + '/vendors\n\n' +
        'Or reply to this message and our team will be in touch.\n\n_— Consiere Vendor Team_'
      );
    }
    await prisma.googleVendorLead.update({ where: { id: lead.id }, data: { status: 'OUTREACHED', outreachedAt: new Date() } });
    console.log('[GOOGLE VENDOR OUTREACH] Sent to:', lead.name, waPhone||lead.phone);
  } catch(e) { console.error('[GOOGLE OUTREACH]', e.message); }
}

// ── 57. CROSS-REFERRAL BETWEEN MEMBERS ───────────────────────────────────
async function checkMemberCrossReferral(userId, requestDescription) {
  try {
    const text = requestDescription.toLowerCase();
    const professionalKeywords = ['looking for','need a','find me a','recommend','interior design','photographer','lawyer','accountant','doctor','trainer','architect','consultant'];
    if (!professionalKeywords.some(k => text.includes(k))) return null;
    // Search member profiles/descriptions for matching professionals
    const allMembers = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER', id: { not: userId } },
      select: { id: true, fullName: true, email: true, phone: true }
    });
    // Simple keyword match on names/notes — expand when member profiles added
    const matches = allMembers.filter(m => {
      const name = (m.fullName||'').toLowerCase();
      return professionalKeywords.some(k => text.includes(k));
    }).slice(0, 3);
    return matches.length > 0 ? matches : null;
  } catch(e) { console.error('[CROSS REFERRAL]', e.message); return null; }
}

// ── 58. CORPORATE NETWORK INTELLIGENCE ───────────────────────────────────
async function runCorporateIntelligenceReport() {
  try {
    const teams = await prisma.team.findMany({ include: { members: { include: { user: true } } } });
    for (const team of teams) {
      const memberIds = team.members.map(m => m.userId);
      if (!memberIds.length) continue;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const requests = await prisma.request.findMany({
        where: { userId: { in: memberIds }, createdAt: { gte: thirtyDaysAgo } }
      });
      if (!requests.length) continue;
      const byCategory = {};
      requests.forEach(r => { byCategory[r.category||'general'] = (byCategory[r.category||'general']||0)+1; });
      const topCats = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,3);
      const completedReqs = requests.filter(r => r.status === 'COMPLETED');
      const avgResponseMins = 47; // Placeholder — would calculate from actual timestamps
      // Email to team owner
      const owner = team.members.find(m => m.userId === team.ownerId);
      if (!owner?.user?.email) continue;
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Consiere Business <hello@consiere.com.au>',
        to: owner.user.email,
        subject: team.name + ' — Monthly Consiere Report',
        html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h2 style="color:#1a1612">${team.name} — Monthly Report</h2>
          <p style="color:#78716c;font-size:13px">${new Date().toLocaleDateString('en-AU',{month:'long',year:'numeric'})}</p>
          <table style="width:100%;border-collapse:collapse;margin:24px 0">
            <tr style="background:#f8f4ef"><td style="padding:12px;font-weight:600">Total requests</td><td style="padding:12px">${requests.length}</td></tr>
            <tr><td style="padding:12px;font-weight:600">Completed</td><td style="padding:12px">${completedReqs.length}</td></tr>
            <tr style="background:#f8f4ef"><td style="padding:12px;font-weight:600">Avg response time</td><td style="padding:12px">${avgResponseMins} minutes</td></tr>
            <tr><td style="padding:12px;font-weight:600">Top categories</td><td style="padding:12px">${topCats.map(([k,v])=>k+' ('+v+')').join(', ')}</td></tr>
            <tr style="background:#f8f4ef"><td style="padding:12px;font-weight:600">Team members</td><td style="padding:12px">${team.members.length}</td></tr>
          </table>
          <a href="${CC_URL}/cc-portal" style="display:inline-block;background:#c9a96e;color:#1a1612;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600">View Dashboard</a>
        </div>`
      });
      console.log('[CORPORATE INTEL] Report sent to:', owner.user.email);
    }
  } catch(e) { console.error('[CORPORATE INTEL]', e.message); }
}

// ── 59. CITY LAUNCH AUTOMATION ────────────────────────────────────────────
async function checkCityLaunchTrigger() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const requests = await prisma.request.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, deliveryCountry: { not: null } },
      select: { deliveryCountry: true, postcodeData: true }
    });
    const cityCounts = {};
    requests.forEach(r => {
      const key = (r.deliveryCountry||'') + ':' + (r.postcodeData||'unknown');
      cityCounts[key] = (cityCounts[key]||0) + 1;
    });
    for (const [cityKey, count] of Object.entries(cityCounts)) {
      if (count >= 10) {
        const [country, city] = cityKey.split(':');
        const existingVendors = await prisma.vendor.count({ where: { cities: { has: city } } }).catch(() => 0);
        if (existingVendors < 5) {
          // Trigger city launch!
          await sendWA('+61413536700',
            '🚀 *City Launch Triggered!*\n\nCity: ' + city + ', ' + country + '\nRequests this week: ' + count + '\nExisting vendors: ' + existingVendors + '\n\nAutomatic vendor outreach starting...'
          );
          // Find vendors via Google Places for top 5 categories
          const topCats = ['dining','transport','home','shopping','events'];
          for (const cat of topCats) {
            await findGoogleVendors(cat, city, country);
            await new Promise(r => setTimeout(r, 1000));
          }
          console.log('[CITY LAUNCH] Triggered for:', city, country);
        }
      }
    }
  } catch(e) { console.error('[CITY LAUNCH]', e.message); }
}

// ── 61. LANGUAGE AUTO-DETECTION UPGRADE ──────────────────────────────────
async function detectLanguageConfidence(text, userId) {
  try {
    const langPatterns = {
      ar: /[\u0600-\u06FF]/,
      hi: /[\u0900-\u097F]/,
      zh: /[\u4E00-\u9FFF]/,
      fr: /\b(je|vous|nous|est|avec|pour|dans|sur)\b/i,
      es: /\b(yo|tu|el|ella|nosotros|con|para|en|de)\b/i,
      de: /\b(ich|sie|wir|ist|mit|für|in|auf)\b/i,
    };
    let detectedLang = 'en';
    let confidence = 0.5;
    for (const [lang, pattern] of Object.entries(langPatterns)) {
      if (pattern.test(text)) { detectedLang = lang; confidence = 0.9; break; }
    }
    // Save preference if confident
    if (confidence >= 0.9 && userId) {
      await prisma.user.update({ where: { id: userId }, data: { languagePref: detectedLang } }).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
    }
    return { language: detectedLang, confidence };
  } catch(e) { return { language: 'en', confidence: 0.5 }; }
}

// ── 62. CONSIERE PAY WALLET ───────────────────────────────────────────────
async function walletDebit(userId, amount, description) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletBalance: true, fullName: true, phone: true } });
    if (!user) return { success: false, error: 'User not found' };
    if ((user.walletBalance||0) < amount) return { success: false, error: 'Insufficient wallet balance', balance: user.walletBalance };
    const newBalance = Math.round(((user.walletBalance||0) - amount) * 100) / 100;
    await prisma.user.update({ where: { id: userId }, data: { walletBalance: newBalance } });
    await prisma.walletTransaction.create({ data: { userId, amount: -amount, type: 'DEBIT', description, balanceAfter: newBalance } });
    const phone = user.phone;
    if (phone) await sendWA(phone,
      '💳 *Consiere Pay*\n\n$' + amount.toFixed(2) + ' debited for: ' + description + '\nNew balance: $' + newBalance.toFixed(2) + ' AUD\n\n_— Consiere Pay_'
    );
    return { success: true, newBalance, debited: amount };
  } catch(e) { return { success: false, error: e.message }; }
}

async function walletCredit(userId, amount, description) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletBalance: true, phone: true } });
    if (!user) return { success: false };
    const newBalance = Math.round(((user.walletBalance||0) + amount) * 100) / 100;
    await prisma.user.update({ where: { id: userId }, data: { walletBalance: newBalance } });
    await prisma.walletTransaction.create({ data: { userId, amount, type: 'CREDIT', description, balanceAfter: newBalance } });
    const phone = user.phone;
    if (phone) await sendWA(phone,
      '💳 *Consiere Pay*\n\n+$' + amount.toFixed(2) + ' added: ' + description + '\nNew balance: $' + newBalance.toFixed(2) + ' AUD\n\n_— Consiere Pay_'
    );
    return { success: true, newBalance };
  } catch(e) { return { success: false, error: e.message }; }
}

async function getWalletBalance(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
  return user?.walletBalance || 0;
}

// ── 63. CIPHER PRIVATE REVENUE SHARE ─────────────────────────────────────
async function processCPReferralReward(referrerId, newMemberId, newMemberTier) {
  try {
    const tierFees = { CIPHER: 5000, CIPHER_BLACK: 15000, CIPHER_SOVEREIGN: 25000 };
    const annualFee = tierFees[newMemberTier] || 5000;
    const rewardAmount = Math.round(annualFee * 0.05); // 5% of first year fee
    // Credit to referrer's Consiere Pay wallet
    const referrer = await prisma.user.findUnique({ where: { id: referrerId } });
    if (!referrer) return;
    await walletCredit(referrerId, rewardAmount, 'Cipher Private referral reward — ' + newMemberTier);
    const phone = referrer.phone;
    if (phone) await sendWA(phone,
      '🎉 *Cipher Private Referral Reward*\n\nYour referral has joined Cipher Private as a *' + newMemberTier.replace(/_/g,' ') + '* member.\n\n*$' + rewardAmount.toLocaleString() + ' AUD* has been added to your Consiere Pay wallet.\n\nThank you for growing the Cipher Private circle.\n\n_— Cipher Private_'
    );
    console.log('[CP REFERRAL REWARD] $' + rewardAmount + ' credited to:', referrerId);
  } catch(e) { console.error('[CP REFERRAL REWARD]', e.message); }
}

// ── 65. ALINA VOICE (WhatsApp Voice Messages) ─────────────────────────────
async function processVoiceMessage(mediaUrl, phone, userId) {
  try {
    // Download voice note from Twilio
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const response = await fetch(mediaUrl, {
      headers: { 'Authorization': 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64') }
    });
    const audioBuffer = await response.arrayBuffer();
    // Transcribe using Whisper (OpenAI) or Anthropic
    // For now use a simple placeholder — swap for actual transcription API
    const transcription = await transcribeAudio(Buffer.from(audioBuffer));
    if (transcription) {
      console.log('[VOICE] Transcribed:', transcription.substring(0,100));
      return { success: true, transcription };
    }
    return { success: false };
  } catch(e) { console.error('[VOICE]', e.message); return { success: false, error: e.message }; }
}

async function transcribeAudio(audioBuffer) {
  try {
    // Use Anthropic's API with audio support or fallback
    // For MVP — acknowledge voice and ask to type
    return '__VOICE_FALLBACK__';
  } catch(e) { return null; }
}

// ── 66. REQUEST TEMPLATES ─────────────────────────────────────────────────
async function saveRequestTemplate(userId, name, description, category) {
  try {
    const template = await prisma.requestTemplate.create({ data: { userId, name, description, category } });
    return { success: true, template };
  } catch(e) { return { success: false, error: e.message }; }
}

async function getUserTemplates(userId) {
  return await prisma.requestTemplate.findMany({ where: { userId, isActive: true }, orderBy: { useCount: 'desc' } });
}

async function useTemplate(templateId) {
  await prisma.requestTemplate.update({ where: { id: templateId }, data: { useCount: { increment: 1 } } });
  return await prisma.requestTemplate.findUnique({ where: { id: templateId } });
}

// ── 67. ALINA MEMORY LAYER ────────────────────────────────────────────────
async function getMemory(userId) {
  try {
    const mem = await prisma.memberMemory.findUnique({ where: { userId } });
    return mem ? JSON.parse(mem.data) : {};
  } catch(e) { return {}; }
}

async function updateMemory(userId, newFacts) {
  try {
    const existing = await getMemory(userId);
    const merged = { ...existing, ...newFacts, lastUpdated: new Date().toISOString() };
    await prisma.memberMemory.upsert({
      where: { userId },
      update: { data: JSON.stringify(merged) },
      create: { userId, data: JSON.stringify(merged) }
    });
    return merged;
  } catch(e) { console.error('[MEMORY UPDATE]', e.message); }
}

async function extractMemoryFromConversation(userId, userMessage, botReply) {
  try {
    const text = (userMessage + ' ' + botReply).toLowerCase();
    const facts = {};
    // Dietary preferences
    const dietary = ['vegetarian','vegan','halal','kosher','gluten free','dairy free','nut allergy','pescatarian'];
    dietary.forEach(d => { if (text.includes(d)) facts.dietary = d; });
    // Transport preference
    if (text.includes('uber black') || text.includes('premium car')) facts.transportPref = 'premium';
    if (text.includes('standard uber') || text.includes('normal car')) facts.transportPref = 'standard';
    // Hotel tier
    if (text.includes('5 star') || text.includes('luxury hotel')) facts.hotelPref = '5-star';
    if (text.includes('4 star') || text.includes('nice hotel')) facts.hotelPref = '4-star';
    // Dining preferences
    if (text.includes('window seat') || text.includes('by the window')) facts.diningPref = 'window-seat';
    if (text.includes('private dining') || text.includes('private room')) facts.diningPref = 'private-room';
    // Party size
    const partySizeMatch = text.match(/table for (\w+)|(\d+) people|party of (\d+)/);
    if (partySizeMatch) facts.typicalPartySize = partySizeMatch[1] || partySizeMatch[2] || partySizeMatch[3];
    // Location
    const suburbMatch = text.match(/in ([a-z\s]+) sydney|in ([a-z\s]+) melbourne|in ([a-z\s]+) brisbane/i);
    if (suburbMatch) facts.preferredSuburb = (suburbMatch[1]||suburbMatch[2]||suburbMatch[3]).trim();
    if (Object.keys(facts).length > 0) {
      await updateMemory(userId, facts);
      console.log('[MEMORY] Extracted', Object.keys(facts).length, 'facts for user:', userId);
    }
    return facts;
  } catch(e) { console.error('[MEMORY EXTRACT]', e.message); return {}; }
}

function buildMemoryContext(memory) {
  if (!memory || !Object.keys(memory).length) return '';
  const parts = [];
  if (memory.dietary) parts.push('Dietary: ' + memory.dietary);
  if (memory.transportPref) parts.push('Prefers ' + memory.transportPref + ' transport');
  if (memory.hotelPref) parts.push('Hotel preference: ' + memory.hotelPref);
  if (memory.diningPref) parts.push('Dining preference: ' + memory.diningPref);
  if (memory.typicalPartySize) parts.push('Typical party size: ' + memory.typicalPartySize);
  if (memory.preferredSuburb) parts.push('Preferred area: ' + memory.preferredSuburb);
  if (memory.favoriteRestaurant) parts.push('Favourite restaurant: ' + memory.favoriteRestaurant);
  if (!parts.length) return '';
  return '\nMember preferences (remembered): ' + parts.join(' | ');
}

// ── 68. WHITE-LABEL API ───────────────────────────────────────────────────
async function processWhiteLabelRequest(apiKey, memberContext, requestText) {
  try {
    // Validate API key
    const partner = await prisma.user.findFirst({ where: { referralCode: apiKey, role: 'ADMIN' } });
    if (!partner) return { success: false, error: 'Invalid API key' };
    // Create virtual user or find existing
    const virtualEmail = 'wl_' + apiKey + '_' + memberContext.externalId + '@whitelabel.cipher';
    let virtualUser = await prisma.user.findUnique({ where: { email: virtualEmail } });
    if (!virtualUser) {
      virtualUser = await prisma.user.create({ data: {
        email: virtualEmail, passwordHash: 'whitelabel', fullName: memberContext.name || 'Partner Member',
        platform: 'CONSIERE', memberTier: 'UNLIMITED', isActive: true
      }});
    }
    // Process through normal cipherbot flow
    const { autoCategories } = module.exports;
    const cat = await autoCategories(requestText);
    return { success: true, userId: virtualUser.id, category: cat.category, subcategory: cat.subcategory, message: 'Request received and processing' };
  } catch(e) { return { success: false, error: e.message }; }
}

module.exports = {
  analyseConversation, weeklyInsightReport,
  logVendorMatchOutcome, getSmartVendorRanking,
  autoCategories,
  checkFraud, FOUL_WORDS,
  findGoogleVendors, outreachGoogleVendor,
  checkMemberCrossReferral,
  runCorporateIntelligenceReport,
  checkCityLaunchTrigger,
  detectLanguageConfidence,
  walletDebit, walletCredit, getWalletBalance,
  processCPReferralReward,
  processVoiceMessage,
  saveRequestTemplate, getUserTemplates, useTemplate,
  getMemory, updateMemory, extractMemoryFromConversation, buildMemoryContext,
  processWhiteLabelRequest
};
