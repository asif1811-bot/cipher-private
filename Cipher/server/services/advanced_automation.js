'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWA } = require('./whatsapp_notifications');
const { Resend } = require('resend');
require('dotenv').config();

function getResend() { return new Resend(process.env.RESEND_API_KEY); }
function getStripe() { return require('stripe')(process.env.STRIPE_SECRET_KEY); }
const CC_URL = process.env.CC_URL || 'https://consiere.com.au';

// ── EXCHANGE RATES (cached daily) ─────────────────────────────────────────
let fxCache = { rates: { AUD:1, USD:0.65, AED:2.39, SGD:0.88, INR:54, GBP:0.51, CAD:0.88 }, updatedAt: null };
async function getFxRates() {
  const stale = !fxCache.updatedAt || (Date.now() - fxCache.updatedAt) > 24*60*60*1000;
  if (stale) {
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/AUD');
      const d = await r.json();
      if (d.rates) { fxCache = { rates: d.rates, updatedAt: Date.now() }; }
    } catch(e) { console.error('[FX]', e.message); }
  }
  return fxCache.rates;
}

// ── 33. AI UPSELL DURING CHAT ─────────────────────────────────────────────
function generateUpsellSuggestion(category, description) {
  const upsells = {
    dining: { trigger: /(table|book|restaurant|dinner|lunch)/i, offer: 'private dining room or chef\'s table experience', premium: 40 },
    transport: { trigger: /(car|taxi|uber|ride|airport)/i, offer: 'premium chauffeur service or business class vehicle', premium: 60 },
    travel: { trigger: /(flight|hotel|trip|holiday)/i, offer: 'business class upgrade or 5-star suite', premium: 150 },
    events: { trigger: /(ticket|show|concert|event)/i, offer: 'VIP hospitality package or backstage access', premium: 80 },
    home: { trigger: /(clean|repair|fix|install)/i, offer: 'same-day premium service with senior technician', premium: 30 },
  };
  const cat = upsells[category];
  if (!cat) return null;
  return { offer: cat.offer, premium: cat.premium };
}

// ── 34. SUBSCRIPTION PAUSE ────────────────────────────────────────────────
async function pauseSubscription(userId, pauseMonths) {
  try {
    const stripe = getStripe();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) return { success: false, error: 'No Stripe customer' };
    const subs = await stripe.subscriptions.list({ customer: user.stripeCustomerId, status: 'active', limit: 1 });
    if (!subs.data.length) return { success: false, error: 'No active subscription' };
    const sub = subs.data[0];
    const resumeAt = Math.floor(Date.now()/1000) + (pauseMonths * 30 * 24 * 60 * 60);
    await stripe.subscriptions.update(sub.id, {
      pause_collection: { behavior: 'mark_uncollectible', resumes_at: resumeAt }
    });
    const phone = user.phone;
    if (phone) await sendWA(phone,
      '⏸️ *Your Consiere subscription has been paused for ' + pauseMonths + ' month' + (pauseMonths>1?'s':'') + '.*\n\nYou can still use your existing credits. Your subscription resumes automatically.\n\nMiss Alina before then? Just reply *RESUME* anytime.\n\n_— Consiere_'
    );
    return { success: true, resumeAt: new Date(resumeAt*1000).toLocaleDateString('en-AU') };
  } catch(e) { return { success: false, error: e.message }; }
}

async function resumeSubscription(userId) {
  try {
    const stripe = getStripe();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) return { success: false };
    const subs = await stripe.subscriptions.list({ customer: user.stripeCustomerId, limit: 1 });
    if (!subs.data.length) return { success: false };
    await stripe.subscriptions.update(subs.data[0].id, { pause_collection: '' });
    const phone = user.phone;
    if (phone) await sendWA(phone, '▶️ *Welcome back! Your Consiere subscription has been resumed.*\n\nAlina is ready whenever you are.\n\n_— Consiere_');
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 35. GIFTING FEATURE ───────────────────────────────────────────────────
async function createGiftSubscription(fromUserId, toEmail, months) {
  try {
    const stripe = getStripe();
    const amounts = { 1: 999, 3: 2499, 6: 4499, 12: 7999 };
    const amount = amounts[months] || 999;
    const code = 'GIFT-' + Math.random().toString(36).substr(2,8).toUpperCase();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'aud', unit_amount: amount, product_data: { name: 'Consiere Gift — ' + months + ' month' + (months>1?'s':'') } }, quantity: 1 }],
      success_url: CC_URL + '/gift/success?code=' + code,
      cancel_url: CC_URL + '/cc-portal',
      metadata: { type: 'gift', fromUserId: fromUserId||'', toEmail: toEmail||'', months: String(months), code }
    });
    await prisma.giftSubscription.create({ data: { code, fromUserId: fromUserId||null, toEmail: toEmail||null, months } });
    return { success: true, url: session.url, code };
  } catch(e) { return { success: false, error: e.message }; }
}

async function redeemGift(code, userId) {
  try {
    const gift = await prisma.giftSubscription.findUnique({ where: { code } });
    if (!gift) return { success: false, error: 'Invalid gift code' };
    if (gift.redeemed) return { success: false, error: 'Gift already redeemed' };
    await prisma.user.update({ where: { id: userId }, data: { memberTier: 'UNLIMITED', credits: { increment: gift.months * 10 } } });
    await prisma.giftSubscription.update({ where: { code }, data: { redeemed: true, redeemedBy: userId } });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const phone = user?.phone;
    if (phone) await sendWA(phone, '🎁 *Your gift has been activated!*\n\n' + gift.months + ' month' + (gift.months>1?'s':'') + ' of Consiere Unlimited — enjoy!\n\nAlina is ready whenever you are.\n\n_— Consiere_');
    return { success: true, months: gift.months };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 36. BIRTHDAY & ANNIVERSARY AUTOMATION ────────────────────────────────
async function runBirthdayAnniversaryCheck() {
  try {
    const today = new Date();
    const todayMD = (today.getMonth()+1) + '-' + today.getDate();
    const members = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER' },
      select: { id: true, fullName: true, phone: true, email: true, birthday: true, createdAt: true, credits: true }
    });
    let count = 0;
    for (const user of members) {
      const phone = user.phone;
      if (!phone) continue;
      const name = user.fullName?.split(' ')[0] || 'there';
      // Birthday check
      if (user.birthday) {
        const [,bMonth,bDay] = user.birthday.split('-');
        if ((parseInt(bMonth)) + '-' + parseInt(bDay) === todayMD) {
          await prisma.user.update({ where: { id: user.id }, data: { credits: { increment: 1 } } });
          await sendWA(phone, '🎂 *Happy Birthday, ' + name + '!*\n\nWishing you a wonderful day. We have added a free request to your account as our gift.\n\nWhat can Alina arrange for you today?\n\n_— The Consiere team_');
          count++;
          continue;
        }
      }
      // Anniversary check (1 year since signup)
      const joinDate = new Date(user.createdAt);
      const joinMD = (joinDate.getMonth()+1) + '-' + joinDate.getDate();
      const yearsSince = today.getFullYear() - joinDate.getFullYear();
      if (joinMD === todayMD && yearsSince > 0) {
        const reqCount = await prisma.request.count({ where: { userId: user.id } });
        await prisma.user.update({ where: { id: user.id }, data: { credits: { increment: 1 } } });
        await sendWA(phone,
          '🥂 *' + yearsSince + ' year' + (yearsSince>1?'s':'') + ' with Consiere, ' + name + '!*\n\nIn this time, Alina has handled *' + reqCount + ' requests* for you.\n\nThank you for being with us. We have added a free request as our gift.\n\n_— The Consiere team_'
        );
        count++;
      }
    }
    console.log('[BIRTHDAY/ANNIVERSARY] Messages sent:', count);
  } catch(e) { console.error('[BIRTHDAY/ANNIVERSARY]', e.message); }
}

// ── 37. CP PRE-APPROVAL LIMIT ─────────────────────────────────────────────
async function checkCPPreApproval(userId, estimatedAmount, requestId) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { cpPreApproveLimit: true, phone: true, fullName: true } });
    const limit = user?.cpPreApproveLimit || 500;
    if (estimatedAmount <= limit) {
      await prisma.request.update({ where: { id: requestId }, data: { preApproved: true } });
      return { approved: true, autoApproved: true };
    }
    // Over limit — need approval
    const phone = user?.phone;
    if (phone) {
      await sendWA(phone,
        '💼 *Cipher Private — Approval Required*\n\nYour request requires an estimated spend of *$' + estimatedAmount + ' AUD*.\n\nThis exceeds your pre-approved limit of $' + limit + '.\n\nReply *APPROVE ' + requestId.substr(0,8) + '* to proceed, or *DECLINE* to cancel.\n\n_— Cipher Private_'
      );
    }
    return { approved: false, autoApproved: false, awaitingApproval: true, estimatedAmount };
  } catch(e) { return { approved: false, error: e.message }; }
}

// ── 38. VENDOR REFERRAL PROGRAM ───────────────────────────────────────────
async function trackVendorReferral(newVendorId, referralCode) {
  try {
    if (!referralCode) return;
    const referrer = await prisma.vendor.findFirst({ where: { affiliateCode: referralCode } });
    if (!referrer) return;
    // Give referrer 2% commission discount for 6 months (log in notes)
    console.log('[VENDOR REFERRAL] Vendor', newVendorId, 'referred by', referrer.id);
    if (referrer.phone) {
      await sendWA(referrer.phone,
        '🤝 *Thanks for the referral!*\n\nA new vendor joined Consiere using your referral code.\n\nYou have earned a 2% commission reduction for the next 6 months.\n\n_— Consiere Vendor Team_'
      );
    }
  } catch(e) { console.error('[VENDOR REFERRAL]', e.message); }
}

// ── 39. SOCIAL PROOF ENGINE ───────────────────────────────────────────────
async function triggerSocialProof(requestId, rating) {
  if (rating < 4) return; // Only for 4-5 stars
  try {
    const req = await prisma.request.findUnique({ where: { id: requestId }, include: { user: true } });
    if (!req?.user) return;
    const phone = req.user.phone;
    if (!phone) return;
    setTimeout(async () => {
      await sendWA(phone,
        '🌟 *Glad you loved it, ' + (req.user.fullName?.split(' ')[0]||'') + '!*\n\nWould you mind sharing your experience? It takes 30 seconds and helps others find us.\n\n👉 g.page/consiere-au/review\n\nThank you!\n\n_— The Consiere team_'
      );
    }, 2 * 60 * 60 * 1000); // 2 hours after rating
  } catch(e) { console.error('[SOCIAL PROOF]', e.message); }
}

// ── 40. INFLUENCER AFFILIATE PROGRAM ─────────────────────────────────────
async function createAffiliateLink(ownerEmail, ownerName, commissionPct) {
  try {
    const code = ownerName.replace(/\s+/g,'-').toLowerCase() + '-' + Math.random().toString(36).substr(2,4);
    const link = await prisma.affiliateLink.create({
      data: { code, ownerEmail, ownerName, commissionPct: commissionPct||20 }
    });
    const trackingUrl = CC_URL + '/signup?aff=' + code;
    return { success: true, code, url: trackingUrl };
  } catch(e) { return { success: false, error: e.message }; }
}

async function trackAffiliateSignup(code, newUserId) {
  try {
    const aff = await prisma.affiliateLink.findUnique({ where: { code } });
    if (!aff) return;
    await prisma.affiliateLink.update({ where: { code }, data: { totalSignups: { increment: 1 } } });
    await prisma.user.update({ where: { id: newUserId }, data: { affiliateCode: code } });
    console.log('[AFFILIATE] Signup via:', code, 'user:', newUserId);
  } catch(e) { console.error('[AFFILIATE]', e.message); }
}

// ── 41. POSTCODE INTELLIGENCE ─────────────────────────────────────────────
async function updatePostcodeData(userId, postcode) {
  try {
    await prisma.user.update({ where: { id: userId }, data: { postcodeData: postcode } });
  } catch(e) {}
}

async function getPostcodeReport() {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'MEMBER', isActive: true, postcodeData: { not: null } },
      select: { postcodeData: true }
    });
    const counts = {};
    users.forEach(u => { if (u.postcodeData) counts[u.postcodeData] = (counts[u.postcodeData]||0)+1; });
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
    return { topPostcodes: sorted, totalWithData: users.length };
  } catch(e) { return { topPostcodes: [], totalWithData: 0 }; }
}

// ── 42. SLA MONITORING & AUTO-ESCALATION ─────────────────────────────────
async function setSLATimer(requestId, tier) {
  try {
    const slaMinutes = { CIPHER_SOVEREIGN: 30, CIPHER_BLACK: 60, UNLIMITED: 120, CIPHER: 240, DEFAULT: 240 };
    const mins = slaMinutes[tier] || slaMinutes.DEFAULT;
    const deadlineAt = new Date(Date.now() + mins * 60 * 1000);
    await prisma.sLATimer.upsert({
      where: { requestId },
      update: { deadlineAt, escalated: false },
      create: { requestId, tier: tier||'DEFAULT', deadlineAt }
    });
    console.log('[SLA] Set for request:', requestId, 'deadline:', deadlineAt);
  } catch(e) { console.error('[SLA SET]', e.message); }
}

async function runSLACheck() {
  try {
    const now = new Date();
    const breached = await prisma.sLATimer.findMany({
      where: { deadlineAt: { lte: now }, escalated: false },
      include: { request: { include: { user: true } } }
    });
    for (const sla of breached) {
      const req = sla.request;
      if (!req || ['COMPLETED','CANCELLED'].includes(req.status)) {
        await prisma.sLATimer.update({ where: { id: sla.id }, data: { escalated: true } });
        continue;
      }
      // Give client a $10 credit
      if (req.userId) {
        await prisma.user.update({ where: { id: req.userId }, data: { retainerBalance: { increment: 10 } } });
        const phone = req.user?.phone;
        if (phone) await sendWA(phone,
          '⏰ *We apologise for the delay on your request.*\n\nWe have added *$10 credit* to your Consiere wallet as compensation.\n\nWe are escalating your request now.\n\n_— Consiere_'
        );
      }
      // Notify Asif
      await sendWA('+61413536700',
        '🚨 *SLA BREACH — ' + sla.tier + '*\n\nRequest: ' + (req.description||req.id).substr(0,60) + '\nDeadline was: ' + sla.deadlineAt.toLocaleString('en-AU') + '\nStatus: ' + req.status + '\n\nClient given $10 credit.'
      );
      await prisma.sLATimer.update({ where: { id: sla.id }, data: { escalated: true } });
      console.log('[SLA BREACH]', req.id, sla.tier);
    }
    console.log('[SLA CHECK] Processed:', breached.length, 'breaches');
  } catch(e) { console.error('[SLA CHECK]', e.message); }
}

// ── 43. VENDOR CAPACITY MANAGEMENT ───────────────────────────────────────
async function checkVendorCapacity(vendorId) {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return { available: false };
    const available = vendor.currentWeekJobs < vendor.maxJobsPerWeek;
    return { available, current: vendor.currentWeekJobs, max: vendor.maxJobsPerWeek };
  } catch(e) { return { available: true }; }
}

async function resetWeeklyVendorCapacity() {
  try {
    const updated = await prisma.vendor.updateMany({ data: { currentWeekJobs: 0 } });
    console.log('[VENDOR CAPACITY] Reset', updated.count, 'vendors for new week');
  } catch(e) { console.error('[VENDOR CAPACITY RESET]', e.message); }
}

// ── 44. SEASONAL DEMAND FORECASTING ──────────────────────────────────────
async function runSeasonalForecast() {
  try {
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const auHolidays = [
      { date: '12-25', name: 'Christmas Day', categories: ['dining','gifts','transport'] },
      { date: '12-26', name: 'Boxing Day', categories: ['shopping','dining'] },
      { date: '01-01', name: "New Year's Day", categories: ['dining','events','transport'] },
      { date: '02-14', name: "Valentine's Day", categories: ['dining','gifts','flowers'] },
      { date: '05-11', name: "Mother's Day", categories: ['dining','gifts','flowers'] },
      { date: '09-01', name: "Father's Day", categories: ['dining','gifts','experiences'] },
    ];
    const upcomingHolidays = auHolidays.filter(h => {
      const [hMonth, hDay] = h.date.split('-').map(Number);
      const hDate = new Date(today.getFullYear(), hMonth-1, hDay);
      if (hDate < today) hDate.setFullYear(today.getFullYear()+1);
      return hDate >= today && hDate <= nextWeek;
    });
    if (!upcomingHolidays.length) { console.log('[SEASONAL] No upcoming holidays'); return; }
    // Get vendors in affected categories
    for (const holiday of upcomingHolidays) {
      const vendors = await prisma.vendor.findMany({
        where: { isActive: true, categories: { hasSome: holiday.categories } },
        select: { id: true, name: true, phone: true, email: true, categories: true }
      }).catch(() => []);
      console.log('[SEASONAL] Holiday:', holiday.name, 'Notifying', vendors.length, 'vendors');
      for (const vendor of vendors) {
        if (!vendor.phone) continue;
        const cats = holiday.categories.filter(c => vendor.categories?.includes(c)).join(', ');
        await sendWA(vendor.phone,
          '📅 *Heads up from Consiere — ' + holiday.name + ' is next week!*\n\nExpect higher demand for: *' + cats + '*\n\nWant to increase your weekly capacity? Log in to your vendor portal:\n👉 ' + CC_URL + '/vendor-portal\n\n_— Consiere Vendor Team_'
        );
        await new Promise(r => setTimeout(r, 300));
      }
    }
  } catch(e) { console.error('[SEASONAL FORECAST]', e.message); }
}

// ── 45. AUTOMATIC TAX INVOICE ─────────────────────────────────────────────
async function generateTaxInvoice(paymentId) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { request: { include: { user: true, vendor: true } } }
    });
    if (!payment) return;
    const invoiceNumber = 'CCG-' + new Date().getFullYear() + '-' + String(await prisma.taxInvoice.count() + 1001).padStart(5,'0');
    const amount = payment.amount;
    const gst = Math.round(amount / 11 * 100) / 100;
    const subtotal = Math.round((amount - gst) * 100) / 100;
    const user = payment.request?.user;
    const date = new Date().toLocaleDateString('en-AU', { day:'2-digit', month:'long', year:'numeric' });
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#1a1612;padding:0 20px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #c9a96e}
.logo{font-size:22px;color:#c9a96e;letter-spacing:3px;font-family:Georgia,serif}
.title{font-size:28px;font-weight:700;color:#1a1612;margin:0}
.sub{color:#78716c;font-size:13px}
table{width:100%;border-collapse:collapse;margin:24px 0}
th{background:#f8f4ef;padding:10px;text-align:left;font-size:11px;letter-spacing:2px;color:#78716c;text-transform:uppercase}
td{padding:10px;border-bottom:1px solid #e8e0d8;font-size:13px}
.total-row{background:#1a1612;color:#fff}
.total-row td{font-weight:700;font-size:14px;color:#fff}
.footer{margin-top:40px;padding-top:20px;border-top:1px solid #e8e0d8;font-size:11px;color:#78716c}
</style></head>
<body>
<div class="header">
<div>
<div class="logo">CONSIERE</div>
<div style="font-size:11px;color:#78716c;margin-top:4px">Cipher Concierge Group Pty Ltd<br>ABN: [INSERT ABN]<br>Sydney, Australia</div>
</div>
<div style="text-align:right">
<div class="title">TAX INVOICE</div>
<div class="sub">Invoice #: ${invoiceNumber}</div>
<div class="sub">Date: ${date}</div>
</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px">
<div><div style="font-size:11px;letter-spacing:2px;color:#78716c;margin-bottom:6px">BILL TO</div>
<div style="font-weight:600">${user?.fullName||'Member'}</div>
<div style="font-size:13px;color:#44403c">${user?.email||''}</div></div>
<div><div style="font-size:11px;letter-spacing:2px;color:#78716c;margin-bottom:6px">SERVICE</div>
<div style="font-weight:600">${payment.request?.category||'Concierge Service'}</div>
<div style="font-size:13px;color:#44403c">${(payment.request?.description||'').substr(0,60)}</div></div>
</div>
<table>
<tr><th>Description</th><th>Amount</th></tr>
<tr><td>Concierge Service — ${payment.request?.category||'General'}</td><td>A$${subtotal.toFixed(2)}</td></tr>
<tr><td style="color:#78716c;font-size:12px">GST (10%)</td><td style="color:#78716c;font-size:12px">A$${gst.toFixed(2)}</td></tr>
<tr class="total-row"><td>TOTAL (incl. GST)</td><td>A$${amount.toFixed(2)}</td></tr>
</table>
<div class="footer">
<p>Payment method: Card via Stripe | Payment ID: ${payment.stripePaymentIntentId||paymentId}</p>
<p>Cipher Concierge Group Pty Ltd | ABN: [INSERT ABN] | GST Registered</p>
<p>hello@consiere.com.au | consiere.com.au | Sydney, Australia</p>
</div>
</body></html>`;
    // Record invoice
    await prisma.taxInvoice.create({ data: { paymentId, invoiceNumber } });
    // Email to member
    const resend = getResend();
    if (user?.email) {
      await resend.emails.send({
        from: 'Consiere Billing <hello@consiere.com.au>',
        to: user.email,
        subject: 'Tax Invoice ' + invoiceNumber + ' — Consiere',
        html
      });
    }
    console.log('[TAX INVOICE] Generated:', invoiceNumber, 'for payment:', paymentId);
    return { success: true, invoiceNumber };
  } catch(e) { console.error('[TAX INVOICE]', e.message); return { success: false }; }
}

// ── 46. MULTI-CURRENCY ────────────────────────────────────────────────────
async function convertToCurrency(audAmount, targetCurrency) {
  try {
    const rates = await getFxRates();
    const rate = rates[targetCurrency];
    if (!rate) return { amount: audAmount, currency: 'AUD', converted: false };
    const converted = Math.round(audAmount * rate * 100) / 100;
    return { amount: converted, currency: targetCurrency, rate, converted: true, aud: audAmount };
  } catch(e) { return { amount: audAmount, currency: 'AUD', converted: false }; }
}

function getCurrencyForCountry(country) {
  const map = { AU:'AUD', UAE:'AED', SG:'SGD', IN:'INR', US:'USD', CA:'CAD', GB:'GBP', NZ:'NZD' };
  return map[country?.toUpperCase()] || 'AUD';
}

// ── 47. DEMAND HEATMAP ────────────────────────────────────────────────────
async function runDemandHeatmapReport() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const requests = await prisma.request.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { category: true, createdAt: true, deliveryCountry: true, postcodeData: true, amount: true }
    });
    const byCategory = {};
    const byDay = {};
    const byHour = {};
    const byCountry = {};
    let totalRevenue = 0;
    requests.forEach(r => {
      byCategory[r.category||'general'] = (byCategory[r.category||'general']||0)+1;
      const day = new Date(r.createdAt).toLocaleDateString('en-AU',{weekday:'short'});
      byDay[day] = (byDay[day]||0)+1;
      const hour = new Date(r.createdAt).getHours();
      byHour[hour] = (byHour[hour]||0)+1;
      byCountry[r.deliveryCountry||'AU'] = (byCountry[r.deliveryCountry||'AU']||0)+1;
      if (r.amount) totalRevenue += r.amount;
    });
    const topCat = Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>k+': '+v).join(', ');
    const topDay = Object.entries(byDay).sort((a,b)=>b[1]-a[1])[0];
    const topHour = Object.entries(byHour).sort((a,b)=>b[1]-a[1])[0];
    const msg = '📊 *Weekly Demand Heatmap*\n\n' +
      '📈 Total requests: ' + requests.length + '\n' +
      '💰 Revenue: $' + totalRevenue.toFixed(2) + '\n\n' +
      '🏆 Top categories: ' + (topCat||'—') + '\n' +
      '📅 Busiest day: ' + (topDay?topDay[0]+' ('+topDay[1]+' requests)':'—') + '\n' +
      '⏰ Peak hour: ' + (topHour?topHour[0]+':00 ('+topHour[1]+' requests)':'—') + '\n\n' +
      '🌍 By country: ' + Object.entries(byCountry).map(([k,v])=>k+':'+v).join(', ') + '\n\n' +
      '_Consiere Intelligence — ' + new Date().toLocaleDateString('en-AU') + '_';
    await sendWA('+61413536700', msg);
    console.log('[DEMAND HEATMAP] Report sent');
    return { requests: requests.length, byCategory, byDay, byCountry };
  } catch(e) { console.error('[DEMAND HEATMAP]', e.message); }
}

// ── 48. VENDOR MATCH SCORING ──────────────────────────────────────────────
async function scoreVendorMatch(vendorId, requestCategory, requestLocation) {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return 0;
    let score = 0;
    // Rating score (0-40pts)
    score += (vendor.rating||3) / 5 * 40;
    // Acceptance rate (0-30pts) — from past requests
    const total = await prisma.request.count({ where: { vendorId } });
    const completed = await prisma.request.count({ where: { vendorId, status: 'COMPLETED' } });
    if (total > 0) score += (completed/total) * 30;
    // Capacity available (0-20pts)
    const capacity = await checkVendorCapacity(vendorId);
    if (capacity.available) score += 20 * (1 - (capacity.current||0)/(capacity.max||20));
    // Featured (0-10pts)
    const featured = await prisma.vendorFeatured.findUnique({ where: { vendorId } }).catch(()=>null);
    if (featured && featured.paidUntil > new Date()) score += 10;
    return Math.round(score);
  } catch(e) { return 50; }
}

// ── 49. CHURN PREDICTION ──────────────────────────────────────────────────
async function runChurnPrediction() {
  try {
    const members = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER' },
      include: { requests: { orderBy: { createdAt: 'desc' }, take: 10 }, messages: { orderBy: { createdAt: 'desc' }, take: 5 } }
    });
    let highRiskCount = 0;
    for (const user of members) {
      let score = 0;
      const daysSinceSignup = (Date.now() - new Date(user.createdAt)) / (24*60*60*1000);
      const lastReq = user.requests[0];
      const daysSinceReq = lastReq ? (Date.now() - new Date(lastReq.createdAt)) / (24*60*60*1000) : daysSinceSignup;
      // Scoring factors
      if (daysSinceReq > 30) score += 30;
      if (daysSinceReq > 60) score += 20;
      if (user.requests.length === 0) score += 25;
      if (user.requests.length === 1) score += 10;
      if (user.memberTier === 'CIPHER') score += 10; // Free tier
      // Low message activity
      if (!user.messages.length) score += 15;
      score = Math.min(score, 100);
      await prisma.user.update({ where: { id: user.id }, data: { churnRiskScore: score } });
      // Intervene on high risk (score > 70)
      if (score > 70) {
        const phone = user.phone;
        if (phone) {
          await sendWA(phone,
            '👋 *Hi ' + (user.fullName?.split(' ')[0]||'there') + '!*\n\nAlina here — just checking in. Is there anything I can help you with?\n\nRestaurants, travel, shopping, home services — just say the word.\n\n_— Alina_'
          );
        }
        highRiskCount++;
      }
    }
    console.log('[CHURN PREDICTION] High risk members:', highRiskCount, 'of', members.length);
    return { total: members.length, highRisk: highRiskCount };
  } catch(e) { console.error('[CHURN PREDICTION]', e.message); }
}

// ── 50. REVENUE FORECASTING ───────────────────────────────────────────────
async function runRevenueForecast() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const [
      activeSubscribers,
      newMembersThisMonth,
      newMembersLastMonth,
      revenueThisMonth,
      revenueLastMonth,
      cpMembers,
      pendingRenewals
    ] = await Promise.all([
      prisma.user.count({ where: { memberTier: 'UNLIMITED', isActive: true } }),
      prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: sixtyDaysAgo, lte: thirtyDaysAgo } } }),
      prisma.payment.aggregate({ where: { createdAt: { gte: thirtyDaysAgo }, status: 'CAPTURED' }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { createdAt: { gte: sixtyDaysAgo, lte: thirtyDaysAgo }, status: 'CAPTURED' }, _sum: { amount: true } }),
      prisma.user.count({ where: { platform: 'CIPHER_PRIVATE', isActive: true } }),
      prisma.user.count({ where: { memberTier: 'UNLIMITED', isActive: true } })
    ]);
    const mrr = (activeSubscribers * 9.99) + (cpMembers * 833); // $10K avg CP / 12
    const revThisM = revenueThisMonth._sum.amount || 0;
    const revLastM = revenueLastMonth._sum.amount || 0;
    const growth = revLastM > 0 ? Math.round(((revThisM - revLastM)/revLastM)*100) : 0;
    const growthRate = newMembersLastMonth > 0 ? newMembersThisMonth/newMembersLastMonth : 1;
    const projectedNextMonth = revThisM * Math.max(0.9, Math.min(growthRate, 3.0));
    const msg = '📈 *Weekly Revenue Forecast*\n\n' +
      '💳 Active subscribers: ' + activeSubscribers + '\n' +
      '🔐 Cipher Private members: ' + cpMembers + '\n' +
      '📊 Estimated MRR: $' + Math.round(mrr).toLocaleString() + '\n\n' +
      '📅 Revenue this month: $' + revThisM.toFixed(2) + '\n' +
      '📅 Revenue last month: $' + revLastM.toFixed(2) + '\n' +
      (growth >= 0 ? '📈' : '📉') + ' Growth: ' + (growth >= 0 ? '+' : '') + growth + '%\n\n' +
      '🔮 Projected next month: $' + projectedNextMonth.toFixed(2) + '\n' +
      '👥 New members this month: ' + newMembersThisMonth + '\n\n' +
      '_Consiere Revenue Intelligence — ' + new Date().toLocaleDateString('en-AU') + '_';
    await sendWA('+61413536700', msg);
    console.log('[REVENUE FORECAST] Report sent');
    return { mrr, growth, projectedNextMonth };
  } catch(e) { console.error('[REVENUE FORECAST]', e.message); }
}

module.exports = {
  generateUpsellSuggestion, pauseSubscription, resumeSubscription,
  createGiftSubscription, redeemGift,
  runBirthdayAnniversaryCheck,
  checkCPPreApproval, trackVendorReferral,
  triggerSocialProof, createAffiliateLink, trackAffiliateSignup,
  updatePostcodeData, getPostcodeReport,
  setSLATimer, runSLACheck,
  checkVendorCapacity, resetWeeklyVendorCapacity,
  runSeasonalForecast, generateTaxInvoice,
  convertToCurrency, getCurrencyForCountry,
  runDemandHeatmapReport, scoreVendorMatch,
  runChurnPrediction, runRevenueForecast, getFxRates
};
