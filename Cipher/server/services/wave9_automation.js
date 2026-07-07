'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWA } = require('./whatsapp_notifications');
const { Resend } = require('resend');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';
function getResend() { return new Resend(process.env.RESEND_API_KEY); }

async function callClaude(prompt, maxTokens) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: maxTokens||300, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    return d.content?.[0]?.text || '';
  } catch(e) { console.error('[CLAUDE]', e.message); return ''; }
}

// ── 108. CONSIERE MOMENTS ─────────────────────────────────────────────────
async function generateConsiereMovement(requestId) {
  try {
    const req = await prisma.request.findUnique({ where: { id: requestId }, include: { user: { select: { fullName: true, phone: true, email: true } } } });
    if (!req || req.status !== 'COMPLETED') return;
    const memorable = ['EVENTS','TRAVEL','RELOCATION','AVIATION','DINING','HOTEL'];
    if (!memorable.includes(req.category)) return;
    const phone = req.user?.phone || (req.user?.email?.includes('@whatsapp.cipher') ? '+' + req.user.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
    if (!phone) return;
    const name = req.user?.fullName?.split(' ')[0] || 'there';
    const recap = await callClaude('Write a warm celebratory 3-sentence recap for a Consiere member named ' + name + ' about this completed request: "' + (req.description||req.category) + '". Make it feel special. Start with an emoji. End with "— Handled by Alina ✨". Be warm and personal.', 150);
    await sendWA(phone, '*✨ Your Consiere Moment*\n\n' + recap + '\n\n_Share your experience: #ConsiereLife_');
    console.log('[MOMENT] Sent to:', name, req.category);
    return { success: true };
  } catch(e) { console.error('[CONSIERE MOMENT]', e.message); }
}

// ── 110. VENDOR SHOWCASE ──────────────────────────────────────────────────
async function requestShowcaseApproval(vendorId) {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return { success: false, error: 'Vendor not found' };
    await sendWA('+61413536700',
      '🏪 *Vendor Showcase Approval Request*\n\nVendor: ' + vendor.name + '\nRating: ' + (vendor.rating||'N/A') + '⭐\n\nApprove: curl -X POST ' + CC_URL + '/api/w9/vendor-showcase/' + vendorId + '/approve\nReject: curl -X POST ' + CC_URL + '/api/w9/vendor-showcase/' + vendorId + '/reject'
    );
    return { success: true, message: 'Approval request sent to admin' };
  } catch(e) { return { success: false, error: e.message }; }
}

async function approveVendorShowcase(vendorId) {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return { success: false, error: 'Not found' };
    const slug = vendor.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    await prisma.vendor.update({ where: { id: vendorId }, data: { showcaseApproved: true, showcaseSlug: slug } });
    if (vendor.phone) await sendWA(vendor.phone, '🎉 *Your Consiere vendor profile is now live!*\n\n👉 ' + CC_URL + '/vendors/' + slug + '\n\nShare this with your clients!\n\n_— Consiere_');
    if (vendor.email) {
      const resend = getResend();
      await resend.emails.send({ from: 'Consiere <hello@consiere.com.au>', to: vendor.email, subject: 'Your Consiere vendor profile is live!', html: '<p>Your profile is live at <a href="' + CC_URL + '/vendors/' + slug + '">' + CC_URL + '/vendors/' + slug + '</a></p>' });
    }
    return { success: true, slug, url: CC_URL + '/vendors/' + slug };
  } catch(e) { return { success: false, error: e.message }; }
}

async function getVendorShowcasePage(slug) {
  try {
    const vendor = await prisma.vendor.findFirst({ where: { showcaseSlug: slug, showcaseApproved: true, isActive: true } });
    if (!vendor) return null;
    const completedJobs = await prisma.request.count({ where: { vendorId: vendor.id, status: 'COMPLETED' } });
    return { name: vendor.name, categories: vendor.categories, rating: vendor.rating||5.0, completedJobs, cities: vendor.cities, slug, badgeEarned: vendor.badgeEarned, joinedYear: new Date(vendor.createdAt||Date.now()).getFullYear() };
  } catch(e) { return null; }
}

// ── 111. HANDLED BY CONSIERE BADGE ────────────────────────────────────────
async function checkAndAwardBadge(vendorId) {
  try {
    const completedJobs = await prisma.request.count({ where: { vendorId, status: 'COMPLETED' } });
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor || vendor.badgeEarned || completedJobs < 50) return;
    await prisma.vendor.update({ where: { id: vendorId }, data: { badgeEarned: true } });
    if (vendor.phone) await sendWA(vendor.phone,
      '🏆 *You\'ve earned the Consiere Verified Partner badge!*\n\nYou have completed *' + completedJobs + ' jobs* through Consiere.\n\nDisplay the "Handled by Consiere ✓" badge on your website:\n👉 ' + CC_URL + '/vendor-badge/' + vendorId + '\n\n_— Consiere_'
    );
    console.log('[BADGE] Awarded to:', vendor.name);
  } catch(e) { console.error('[BADGE]', e.message); }
}

// ── 114. TRAVEL BRIEF ─────────────────────────────────────────────────────
async function generateTravelBrief(requestId, userId, destination) {
  try {
    const existing = await prisma.travelBrief.findUnique({ where: { requestId } }).catch(() => null);
    if (existing) return { success: false, error: 'Brief already sent' };
    const brief = await callClaude(
      'Generate a practical travel brief for a UHNW member travelling to ' + destination + '. Include: local etiquette (2-3 points), weather/packing (1-2 sentences), top 3 restaurants (name + one line), security notes (1-2 points), local phrases if needed (2-3), currency/tipping customs. Under 300 words. Bullet points. Practical not generic.', 600
    );
    await prisma.travelBrief.create({ data: { requestId, userId, destination, content: brief, sentAt: new Date() } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (user?.phone) await sendWA(user.phone, '🌍 *Cipher Private — Travel Brief: ' + destination + '*\n\n' + brief + '\n\n_Your director is available for any arrangements — just reply._\n\n_— Cipher Private_');
    console.log('[TRAVEL BRIEF] Generated for:', destination);
    return { success: true, brief };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 115. REQUEST DNA PROFILING ────────────────────────────────────────────
async function buildRequestDNA(userId) {
  try {
    const requests = await prisma.request.findMany({ where: { userId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 100 });
    if (requests.length < 3) return null;
    const catMap = {};
    requests.forEach(r => { catMap[r.category||'GENERAL'] = (catMap[r.category||'GENERAL']||0)+1; });
    const topCategory = Object.entries(catMap).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'GENERAL';
    const payments = await prisma.payment.findMany({ where: { request: { userId }, status: 'CAPTURED' }, select: { amount: true } });
    const avgSpend = payments.length ? payments.reduce((s,p)=>s+(p.amount||0),0)/payments.length : 0;
    const oldest = requests[requests.length-1];
    const weeksSince = Math.max(1, (Date.now()-new Date(oldest.createdAt))/(7*24*60*60*1000));
    const requestFrequency = requests.length / weeksSince;
    const dayMap = {}; const hourMap = {};
    requests.forEach(r => {
      const day = new Date(r.createdAt).getDay();
      const hour = new Date(r.createdAt).getHours();
      dayMap[day] = (dayMap[day]||0)+1;
      hourMap[hour] = (hourMap[hour]||0)+1;
    });
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const peakDay = days[Object.entries(dayMap).sort((a,b)=>b[1]-a[1])[0]?.[0]||5] || 'Friday';
    const peakHour = parseInt(Object.entries(hourMap).sort((a,b)=>b[1]-a[1])[0]?.[0]||'19');
    const ltv = avgSpend * requestFrequency * 52;
    const upsellScore = Math.min(100, Math.round((avgSpend/50)*40+(requestFrequency)*20+(requests.length/10)*40));
    await prisma.requestDNA.upsert({
      where: { userId },
      update: { topCategory, avgSpend, requestFrequency, peakDay, peakHour, ltv, upsellScore },
      create: { userId, topCategory, avgSpend, requestFrequency, peakDay, peakHour, ltv, upsellScore }
    });
    return { topCategory, avgSpend, requestFrequency, peakDay, peakHour, ltv, upsellScore };
  } catch(e) { console.error('[DNA]', e.message); return null; }
}

async function runDNAProfilesForAll() {
  try {
    const members = await prisma.user.findMany({ where: { role: 'MEMBER', isActive: true }, select: { id: true } });
    for (const m of members) await buildRequestDNA(m.id);
    const topLTV = await prisma.requestDNA.findMany({ orderBy: { ltv: 'desc' }, take: 5 });
    const enriched = await Promise.all(topLTV.map(async d => {
      const u = await prisma.user.findUnique({ where: { id: d.userId }, select: { fullName: true } });
      return (u?.fullName||'—') + ' — $' + d.ltv.toFixed(0) + '/yr | ' + d.topCategory;
    }));
    await sendWA('+61413536700', '🧬 *Weekly DNA Report*\n\nTop 5 by projected LTV:\n' + enriched.map((e,i)=>(i+1)+'. '+e).join('\n') + '\n\n_Consiere DNA Engine_');
    console.log('[DNA] Profiles built for', members.length, 'members');
  } catch(e) { console.error('[DNA ALL]', e.message); }
}

// ── 116. VENDOR HEALTH SCORE ──────────────────────────────────────────────
async function calculateVendorHealthScore(vendorId) {
  try {
    const thirtyDaysAgo = new Date(Date.now()-30*24*60*60*1000);
    const sixtyDaysAgo = new Date(Date.now()-60*24*60*60*1000);
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return null;
    const recentJobs = await prisma.request.count({ where: { vendorId, createdAt: { gte: thirtyDaysAgo } } });
    const totalJobs = await prisma.request.count({ where: { vendorId } });
    const completedJobs = await prisma.request.count({ where: { vendorId, status: 'COMPLETED' } });
    const responseRate = totalJobs > 0 ? completedJobs/totalJobs : 0.8;
    const recentRev = await prisma.payment.aggregate({ where: { request: { vendorId }, createdAt: { gte: thirtyDaysAgo }, status: 'CAPTURED' }, _sum: { amount: true } });
    const prevRev = await prisma.payment.aggregate({ where: { request: { vendorId }, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, status: 'CAPTURED' }, _sum: { amount: true } });
    const revenueGrowth = prevRev._sum.amount ? ((recentRev._sum.amount||0)-prevRev._sum.amount)/prevRev._sum.amount : 0;
    const capacityUtil = Math.min(1, recentJobs/(vendor.maxJobsPerWeek||20)/4);
    const overallScore = Math.round((vendor.rating||3)/5*35 + responseRate*25 + Math.min(1,Math.max(0,revenueGrowth+1)/2)*20 + capacityUtil*20);
    const status = overallScore>=80?'EXCELLENT':overallScore>=60?'HEALTHY':overallScore>=40?'AVERAGE':'AT_RISK';
    await prisma.vendorHealthScore.upsert({
      where: { vendorId },
      update: { overallScore, ratingTrend: (vendor.rating||3)>=4?1:-1, responseRate, capacityUtil, revenueGrowth, weeklyJobs: recentJobs, status },
      create: { vendorId, overallScore, ratingTrend: (vendor.rating||3)>=4?1:-1, responseRate, capacityUtil, revenueGrowth, weeklyJobs: recentJobs, status }
    });
    if (status === 'AT_RISK' && vendor.phone) {
      await sendWA(vendor.phone,
        '📊 *Vendor Performance Update*\n\nYour health score: *' + overallScore + '/100*\n\n' +
        (responseRate<0.7?'• Improve acceptance rate (currently '+Math.round(responseRate*100)+'%)\n':'') +
        ((vendor.rating||0)<4?'• Service quality needs attention ('+vendor.rating+'⭐)\n':'') +
        '\nNeed help? Reply to this message.\n\n_— Consiere Vendor Team_'
      );
    }
    return { overallScore, status };
  } catch(e) { console.error('[VENDOR HEALTH]', e.message); return null; }
}

async function runAllVendorHealthScores() {
  try {
    const vendors = await prisma.vendor.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    let excellent=0, healthy=0, atRisk=0;
    for (const v of vendors) {
      const s = await calculateVendorHealthScore(v.id);
      if (s?.status==='EXCELLENT') excellent++;
      else if (s?.status==='HEALTHY') healthy++;
      else if (s?.status==='AT_RISK') atRisk++;
    }
    await sendWA('+61413536700', '📊 *Weekly Vendor Health Report*\n\n✅ Excellent: '+excellent+'\n💚 Healthy: '+healthy+'\n⚠️ At Risk: '+atRisk+'\n📋 Total: '+vendors.length+'\n\n_At-risk vendors auto-coached._');
    console.log('[VENDOR HEALTH] Scored:', vendors.length);
  } catch(e) { console.error('[VENDOR HEALTH ALL]', e.message); }
}

// ── 117. API MARKETPLACE SPEC ─────────────────────────────────────────────
function getAPIMarketplaceSpec() {
  return {
    name: 'Consiere Concierge API', version: '1.0',
    description: 'AI-powered personal concierge API. Submit any request in natural language.',
    baseUrl: CC_URL + '/api/intel/wl',
    authentication: 'x-api-key header',
    pricing: { freeRequests: 100, paidPer1000Requests: 49 },
    endpoints: [
      { method: 'POST', path: '/request', description: 'Submit concierge request', body: { member: { externalId: 'string', name: 'string' }, request: 'string (natural language)' } },
      { method: 'GET', path: '/status/:requestId', description: 'Check request status' }
    ],
    categories: ['DINING','TRAVEL','TRANSPORT','HOME','SHOPPING','EVENTS','MEDICAL','RELOCATION'],
    useCases: ['Hotel guest concierge', 'Corporate employee benefits', 'Real estate settlement gifts', 'Banking premium client services']
  };
}

// ── 119. WEEKLY CONTENT ENGINE ────────────────────────────────────────────
async function generateWeeklyContent() {
  try {
    const oneWeekAgo = new Date(Date.now()-7*24*60*60*1000);
    const completed = await prisma.request.findMany({
      where: { status: 'COMPLETED', updatedAt: { gte: oneWeekAgo } },
      select: { category: true, description: true, deliveryCountry: true }, take: 20
    });
    if (!completed.length) return { success: false, reason: 'No completed requests this week' };
    const summary = completed.map(r => r.category + ': ' + (r.description||'').substr(0,50) + (r.deliveryCountry?' ('+r.deliveryCountry+')':'')).join('\n');
    const content = await callClaude(
      'Write 5 social media posts for Consiere — an AI personal concierge in Australia. Based on this week\'s anonymised requests:\n' + summary +
      '\n\n1. LinkedIn post (professional, 3 sentences)\n2. Instagram caption (aspirational, 5 hashtags)\n3. Twitter/X (under 240 chars, punchy)\n4. LinkedIn (highlight one specific request, anonymised)\n5. Instagram Story (under 50 words, bold)\n\nNever reveal client names. Sound exclusive, effortless, global.',
      800
    );
    // Split and save posts
    const platforms = ['linkedin','instagram','twitter','linkedin','instagram_story'];
    const lines = content.split('\n');
    let posts = []; let cur = ''; let idx = 0;
    for (const line of lines) {
      if (line.match(/^[1-5][.\)]/)) {
        if (cur.trim() && idx > 0) {
          await prisma.contentPost.create({ data: { platform: platforms[idx-1]||'general', content: cur.trim(), status: 'DRAFT', scheduledAt: new Date(Date.now()+idx*24*60*60*1000) } });
          posts.push({ platform: platforms[idx-1], preview: cur.trim().substr(0,80) });
        }
        cur = line.replace(/^[1-5][.\)]\s*/,'');
        idx++;
      } else { cur += ' ' + line; }
    }
    if (cur.trim()) {
      await prisma.contentPost.create({ data: { platform: platforms[idx-1]||'general', content: cur.trim(), status: 'DRAFT' } });
      posts.push({ platform: platforms[idx-1], preview: cur.trim().substr(0,80) });
    }
    await sendWA('+61413536700',
      '📱 *' + posts.length + ' social posts auto-generated!*\n\n' +
      posts.slice(0,2).map((p,i) => '*'+(i+1)+'. '+p.platform.toUpperCase()+'*\n'+p.preview+'...').join('\n\n') +
      '\n\nApprove in cc-admin → Content Posts'
    );
    console.log('[CONTENT ENGINE] Generated', posts.length, 'posts');
    return { success: true, count: posts.length, posts };
  } catch(e) { console.error('[CONTENT ENGINE]', e.message); return { success: false, error: e.message }; }
}

module.exports = {
  generateConsiereMoment: generateConsiereMovement,
  requestShowcaseApproval, approveVendorShowcase, getVendorShowcasePage,
  checkAndAwardBadge,
  generateTravelBrief,
  buildRequestDNA, runDNAProfilesForAll,
  calculateVendorHealthScore, runAllVendorHealthScores,
  getAPIMarketplaceSpec,
  generateWeeklyContent
};
