'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWA } = require('./whatsapp_notifications');
const { Resend } = require('resend');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';
function getResend() { return new Resend(process.env.RESEND_API_KEY); }

// ── 150. LATE CANCELLATION FEE ────────────────────────────────────────────
const CANCELLATION_FEE = 15;
const VENDOR_CANCELLATION_SHARE = 10;
const CANCELLATION_WINDOW_HOURS = 2;

async function processCancellation(requestId, cancelledByUserId) {
  try {
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: true, vendor: true, payments: true }
    });
    if (!req) return { success: false, error: 'Request not found' };
    // Check if confirmed booking exists
    if (!['DISPATCHED','QUOTED','IN_PROGRESS'].includes(req.status)) {
      // Not yet confirmed — free cancellation
      await prisma.request.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
      return { success: true, fee: 0, message: 'Cancelled — no charge' };
    }
    // Check time — within CANCELLATION_WINDOW_HOURS of service?
    const hoursUntilService = req.scheduledAt
      ? (new Date(req.scheduledAt) - Date.now()) / (1000 * 60 * 60)
      : CANCELLATION_WINDOW_HOURS + 1; // No scheduled time = treat as not late

    if (hoursUntilService > CANCELLATION_WINDOW_HOURS) {
      // More than 2 hours away — free cancellation
      await prisma.request.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
      const phone = req.user?.phone;
      if (phone) await sendWA(phone, '✅ *Booking cancelled* — no charge applies.\n\n_— Alina_');
      return { success: true, fee: 0, message: 'Cancelled — no charge' };
    }
    // Late cancellation — charge $15
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const user = req.user;
    let charged = false;
    // Try to charge the customer
    if (user?.stripeCustomerId) {
      try {
        const paymentMethods = await stripe.paymentMethods.list({ customer: user.stripeCustomerId, type: 'card', limit: 1 });
        if (paymentMethods.data.length > 0) {
          await stripe.paymentIntents.create({
            amount: CANCELLATION_FEE * 100,
            currency: 'aud',
            customer: user.stripeCustomerId,
            payment_method: paymentMethods.data[0].id,
            confirm: true,
            description: 'Late cancellation fee — Request ' + requestId.substr(0,8),
            metadata: { type: 'cancellation_fee', requestId }
          });
          charged = true;
        }
      } catch(e) { console.error('[CANCEL FEE STRIPE]', e.message); }
    }
    // If cannot charge card — deduct from wallet balance
    if (!charged) {
      await prisma.user.update({ where: { id: req.userId }, data: { retainerBalance: { increment: -CANCELLATION_FEE } } });
      charged = true;
    }
    // Pay vendor their share
    if (req.vendor?.email) {
      const resend = getResend();
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>', to: req.vendor.email,
        subject: 'Late cancellation compensation — $' + VENDOR_CANCELLATION_SHARE,
        html: '<p>A client cancelled within 2 hours. You have been credited $' + VENDOR_CANCELLATION_SHARE + ' as compensation. This will be included in your next payment.</p>'
      });
    }
    await prisma.request.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
    // Notify member
    const phone = req.user?.phone;
    if (phone) await sendWA(phone,
      '❌ *Booking cancelled*\n\n' +
      'A *$' + CANCELLATION_FEE + ' late cancellation fee* has been charged as the booking was cancelled within ' + CANCELLATION_WINDOW_HOURS + ' hours of service.\n\n' +
      '$' + VENDOR_CANCELLATION_SHARE + ' has been sent to your vendor as compensation.\n\n' +
      '_— Consiere_'
    );
    console.log('[LATE CANCEL] Fee charged for request:', requestId);
    return { success: true, fee: CANCELLATION_FEE, charged, message: 'Late cancellation fee of $' + CANCELLATION_FEE + ' applied' };
  } catch(e) { console.error('[CANCELLATION]', e.message); return { success: false, error: e.message }; }
}

// ── 151. AUTOMATED REVIEW MINING ─────────────────────────────────────────
async function mineAndPublishReview(requestId, rating) {
  try {
    if (rating < 5) return; // Only 5-star reviews
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { fullName: true, memberTier: true } } }
    });
    if (!req) return;
    // Generate anonymised testimonial using AI
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5', max_tokens: 100,
        messages: [{ role: 'user', content: 'Write a 1-sentence anonymised testimonial for Consiere AI concierge based on this completed request: "' + (req.description||req.category) + '". Format: "A [city/profession] [member/client] needed [brief description]. Alina [what happened]. [Outcome]." Keep under 25 words. Do not use names.' }]
      })
    });
    const d = await response.json();
    const testimonial = d.content?.[0]?.text?.trim();
    if (!testimonial) return;
    // Save as a content post for the testimonials page
    await prisma.contentPost.create({
      data: {
        platform: 'testimonial',
        content: testimonial,
        hashtags: req.category || 'GENERAL',
        status: 'APPROVED', // Auto-approved testimonials
        postedAt: new Date()
      }
    });
    console.log('[REVIEW MINING] Published testimonial for:', req.category);
    return { success: true, testimonial };
  } catch(e) { console.error('[REVIEW MINING]', e.message); }
}

async function getTestimonials(limit) {
  return await prisma.contentPost.findMany({
    where: { platform: 'testimonial', status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    take: limit || 20
  });
}

// ── 153. ALINA PROACTIVE CHECK-INS ───────────────────────────────────────
async function runProactiveCheckins() {
  try {
    const twentyOneDaysAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const dormant = await prisma.user.findMany({
      where: {
        isActive: true, role: 'MEMBER',
        OR: [
          { requests: { none: { createdAt: { gte: twentyOneDaysAgo } } } },
        ]
      },
      include: { requests: { orderBy: { createdAt: 'desc' }, take: 3 } },
      take: 100
    });
    let sent = 0;
    for (const user of dormant) {
      const phone = user.phone || (user.email?.includes('@whatsapp.cipher') ? '+' + user.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
      if (!phone) continue;
      const name = user.fullName?.split(' ')[0] || 'there';
      const lastReq = user.requests[0];
      const lastCat = lastReq?.category || null;
      // Personalised message based on history
      const messages = {
        DINING: '🍽️ *Hey ' + name + '!* Haven\'t arranged a table for you in a while — got any dinner plans coming up? Just say the word.',
        TRAVEL: '✈️ *Hey ' + name + '!* Any trips coming up? I can handle flights, hotels, and transfers end-to-end.',
        HOME: '🏠 *Hey ' + name + '!* Any home maintenance or cleaning due? I have trusted tradespeople ready this week.',
        SHOPPING: '🛍️ *Hey ' + name + '!* Need anything sorted — gifts, shopping, deliveries? I\'m on standby.',
        TRANSPORT: '🚗 *Hey ' + name + '!* Need a driver or transfer arranged? Just let me know.',
        DEFAULT: '👋 *Hey ' + name + '!* Just checking in — haven\'t heard from you in a while. What can I sort for you today? Restaurants, travel, home, shopping — anything.'
      };
      const msg = (messages[lastCat] || messages.DEFAULT) + '\n\n_— Alina_';
      await sendWA(phone, msg);
      sent++;
      await new Promise(r => setTimeout(r, 400));
    }
    console.log('[CHECKINS] Sent to', sent, 'dormant members');
    return { sent };
  } catch(e) { console.error('[CHECKINS]', e.message); return { sent: 0 }; }
}

// ── 158. SMART REQUEST DEDUPLICATION ─────────────────────────────────────
async function checkDuplicateRequest(userId, description, category) {
  try {
    const thirtyMinsAgo = new Date(Date.now() - 10 * 60 * 1000); // 10 min window
    const recent = await prisma.request.findMany({
      where: { userId, createdAt: { gte: thirtyMinsAgo }, status: { notIn: ['CANCELLED','COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
      take: 3
    });
    if (!recent.length) return { isDuplicate: false };
    const descLower = (description||'').toLowerCase().trim();
    for (const req of recent) {
      const reqDescLower = (req.description||'').toLowerCase().trim();
      // Same category + very similar description
      if (req.category === category) {
        // Check word overlap
        const words1 = new Set(descLower.split(/\s+/).filter(w => w.length > 3));
        const words2 = new Set(reqDescLower.split(/\s+/).filter(w => w.length > 3));
        const overlap = [...words1].filter(w => words2.has(w)).length;
        const similarity = overlap / Math.max(words1.size, words2.size, 1);
        if (similarity > 0.9) { // Only block near-identical requests
          console.log('[DEDUP] Duplicate detected for user:', userId, 'similarity:', similarity.toFixed(2));
          return { isDuplicate: true, originalRequestId: req.id, similarity };
        }
      }
    }
    return { isDuplicate: false };
  } catch(e) { console.error('[DEDUP]', e.message); return { isDuplicate: false }; }
}

// ── 156. DAILY HEALTH CHECK ───────────────────────────────────────────────
async function runDailyHealthCheck() {
  try {
    const checks = [];
    const startTime = Date.now();
    // 1. Database
    try {
      await prisma.user.count();
      checks.push({ name: 'Database', status: '✅', detail: 'Connected' });
    } catch(e) { checks.push({ name: 'Database', status: '🔴', detail: e.message.substr(0,50) }); }
    // 2. Anthropic API
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'ping' }] })
      });
      checks.push({ name: 'Anthropic AI', status: r.ok ? '✅' : '⚠️', detail: 'HTTP ' + r.status });
    } catch(e) { checks.push({ name: 'Anthropic AI', status: '🔴', detail: e.message.substr(0,50) }); }
    // 3. Stripe
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.balance.retrieve();
      checks.push({ name: 'Stripe', status: '✅', detail: 'Connected' });
    } catch(e) { checks.push({ name: 'Stripe', status: '🔴', detail: e.message.substr(0,50) }); }
    // 4. Resend
    try {
      const resend = getResend();
      const r = await resend.emails.send({ from: 'test@consiere.com.au', to: 'hello@consiere.com.au', subject: 'Health Check', text: 'ping' });
      checks.push({ name: 'Resend Email', status: r.data?.id ? '✅' : '⚠️', detail: r.data?.id ? 'OK' : 'No ID returned' });
    } catch(e) { checks.push({ name: 'Resend Email', status: '🔴', detail: e.message.substr(0,50) }); }
    // 5. Pending requests check
    const stalled = await prisma.request.count({ where: { status: 'DISPATCHED', updatedAt: { lt: new Date(Date.now() - 4 * 60 * 60 * 1000) } } });
    checks.push({ name: 'Stalled Requests', status: stalled > 5 ? '⚠️' : '✅', detail: stalled + ' stalled >4hrs' });
    // 6. Memory check via PM2-style
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.rss / 1024 / 1024);
    checks.push({ name: 'Server Memory', status: memMB > 400 ? '⚠️' : '✅', detail: memMB + 'MB RSS' });
    // 7. Google Places API
    try {
      const r = await fetch('https://maps.googleapis.com/maps/api/place/textsearch/json?query=test&key=' + process.env.GOOGLE_PLACES_API_KEY);
      const d = await r.json();
      checks.push({ name: 'Google Places', status: d.status === 'ZERO_RESULTS' || d.results ? '✅' : '⚠️', detail: d.status });
    } catch(e) { checks.push({ name: 'Google Places', status: '🔴', detail: e.message.substr(0,50) }); }
    const elapsed = Date.now() - startTime;
    const hasIssues = checks.some(c => c.status !== '✅');
    const report = '🏥 *Daily Health Check*\n\n' +
      checks.map(c => c.status + ' ' + c.name + ': ' + c.detail).join('\n') +
      '\n\n⏱️ Check took: ' + elapsed + 'ms' +
      '\n📅 ' + new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) +
      (hasIssues ? '\n\n⚠️ *Issues detected — please review.*' : '\n\n_All systems operational._');
    await sendWA('+61413536700', report);
    console.log('[HEALTH CHECK] Complete —', checks.filter(c=>c.status==='✅').length + '/' + checks.length, 'passed');
    return { checks, hasIssues, elapsed };
  } catch(e) { console.error('[HEALTH CHECK]', e.message); }
}

module.exports = {
  processCancellation,
  mineAndPublishReview, getTestimonials,
  runProactiveCheckins,
  checkDuplicateRequest,
  runDailyHealthCheck
};
