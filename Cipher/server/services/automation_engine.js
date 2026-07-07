'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const Stripe = require('stripe');
const { sendWA } = require('./whatsapp_notifications');
require('dotenv').config();

function getStripe() { return new Stripe(process.env.STRIPE_SECRET_KEY); }

// ── HELPER ────────────────────────────────────────────────────────────────
function getPhone(user) {
  if (user.phone) return user.phone;
  if (user.email && user.email.includes('@whatsapp.cipher'))
    return '+' + user.email.replace('wa_','').replace('@whatsapp.cipher','');
  return null;
}

// ── 16. DYNAMIC PRICING ENGINE ────────────────────────────────────────────
function getDynamicMarkup(category, requestTime) {
  const hour = requestTime ? new Date(requestTime).getHours() : new Date().getHours();
  const day = requestTime ? new Date(requestTime).getDay() : new Date().getDay();
  const isWeekend = day === 0 || day === 6;
  const isPeakHour = hour >= 18 && hour <= 22;
  const isLastMinute = false; // Set via request urgency flag
  let multiplier = 1.0;
  if (isPeakHour) multiplier += 0.10;
  if (isWeekend) multiplier += 0.05;
  const categoryPremiums = { dining: 0.08, events: 0.15, travel: 0.05, transport: 0.10 };
  if (categoryPremiums[category]) multiplier += categoryPremiums[category];
  return Math.round((multiplier - 1) * 100); // Returns % markup e.g. 18
}

// ── 17. AUTO-UPSELL ON COMPLETION ─────────────────────────────────────────
async function triggerUpsell(requestId) {
  try {
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: true }
    });
    if (!req || !req.user) return;
    const phone = getPhone(req.user);
    if (!phone) return;
    const upsells = {
      dining: '🍷 Enjoy your dinner! Want me to arrange a taxi or Uber for the trip home?',
      travel: '✈️ Your travel is sorted! Want me to book airport transfers or travel insurance?',
      home: '🏠 All done! Want me to schedule the next maintenance visit or arrange a cleaner?',
      shopping: '🛍️ Delivered! Want me to find similar items or arrange gift wrapping?',
      events: '🎟️ Tickets confirmed! Want me to book a table for before the show?',
    };
    const msg = upsells[req.category] || '✅ All done! Anything else I can handle for you today?';
    setTimeout(async () => {
      await sendWA(phone, msg);
    }, 30 * 60 * 1000); // 30 mins after completion
    console.log('[UPSELL] Scheduled for request:', requestId);
  } catch(e) { console.error('[UPSELL]', e.message); }
}

// ── 18. ABANDONED REQUEST RECOVERY ────────────────────────────────────────
async function recoverAbandonedRequests() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    // Find quotes sent but not paid (status QUOTED, older than 2hrs but newer than 6hrs)
    const abandoned = await prisma.request.findMany({
      where: { status: 'QUOTED', updatedAt: { lte: twoHoursAgo, gte: sixHoursAgo } },
      include: { user: true }
    });
    for (const req of abandoned) {
      const phone = getPhone(req.user);
      if (!phone) continue;
      await sendWA(phone,
        '⏰ *Still need help with your request?*\n\n_' + (req.description || 'Your request') + '_\n\nYour quote is still waiting. Just reply to confirm or ask for a different option.\n\n_— Alina_'
      );
      console.log('[ABANDONED RECOVERY] Sent to:', phone);
    }
    console.log('[ABANDONED RECOVERY] Processed:', abandoned.length, 'requests');
  } catch(e) { console.error('[ABANDONED RECOVERY]', e.message); }
}

// ── 19. SUBSCRIPTION WIN-BACK ──────────────────────────────────────────────
async function runWinBack() {
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Users who cancelled (CIPHER tier, no active sub, updated recently)
    const cancelled = await prisma.user.findMany({
      where: {
        memberTier: 'CIPHER', isActive: true,
        updatedAt: { lte: threeDaysAgo, gte: sevenDaysAgo }
      }
    });
    for (const user of cancelled) {
      const phone = getPhone(user);
      if (!phone) continue;
      await sendWA(phone,
        '👋 *Miss having Alina handle things for you?*\n\nCome back to Consiere Unlimited for just *$9.99/month* — and your first week back is on us.\n\n👉 ' + (process.env.CC_URL || 'https://consiere.com.au') + '/signup\n\n_— The Consiere team_'
      );
      console.log('[WIN-BACK] Sent to:', user.email);
    }
  } catch(e) { console.error('[WIN-BACK]', e.message); }
}

// ── 20. SMART REFERRAL TRIGGER ────────────────────────────────────────────
async function triggerReferralPrompt(userId) {
  try {
    const completedCount = await prisma.request.count({
      where: { userId, status: 'COMPLETED' }
    });
    if (completedCount !== 3) return; // Only trigger on exactly 3rd completion
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    let code = user.referralCode;
    if (!code) {
      code = 'CC' + Math.random().toString(36).substr(2,6).toUpperCase();
      await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
    }
    const phone = getPhone(user);
    if (!phone) return;
    const link = (process.env.CC_URL || 'https://consiere.com.au') + '/signup?ref=' + code;
    await sendWA(phone,
      '🌟 *Loving Consiere?*\n\nShare with a friend and you both get a free request credit!\n\nYour personal link:\n👉 ' + link + '\n\n_— Alina_'
    );
    console.log('[REFERRAL TRIGGER] Sent to:', user.email);
  } catch(e) { console.error('[REFERRAL TRIGGER]', e.message); }
}

// ── 21. RENEWAL PREDICTION & INTERVENTION ────────────────────────────────
async function runRenewalIntervention() {
  try {
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const thirtyOneDaysFromNow = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    // Find Cipher Private members with annual renewal coming up
    const upcomingRenewals = await prisma.user.findMany({
      where: {
        platform: 'CIPHER_PRIVATE',
        isActive: true,
        updatedAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 + 30 * 24 * 60 * 60 * 1000) }
      },
      include: { requests: { where: { status: 'COMPLETED' } } }
    });
    for (const user of upcomingRenewals) {
      const phone = getPhone(user);
      if (!phone) continue;
      const reqCount = user.requests.length;
      const hoursSaved = reqCount * 2;
      await sendWA(phone,
        '🔐 *Your Cipher Private membership renews soon.*\n\nThis past year, your director handled *' + reqCount + ' matters* for you — saving an estimated *' + hoursSaved + ' hours* of your time.\n\nYour renewal is scheduled automatically. No action needed.\n\nIs there anything you would like to arrange before then?\n\n_— Cipher Private_'
      );
      console.log('[RENEWAL INTERVENTION] Sent to:', user.email);
    }
  } catch(e) { console.error('[RENEWAL INTERVENTION]', e.message); }
}

// ── 22. INACTIVE MEMBER RE-ENGAGEMENT ────────────────────────────────────
async function runInactiveReengagement() {
  try {
    const twentyOneDaysAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const inactive = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER' },
      include: { requests: { orderBy: { createdAt: 'desc' }, take: 1 } }
    });
    const msgs = [
      '👋 Hi {name}! Anything on your plate this week? Just message me — I handle restaurants, travel, shopping, home services and more.\n\n_— Alina_',
      '🌟 Hi {name}! A quick reminder — I am available 24/7 for anything you need handled. What can I sort for you today?\n\n_— Alina_',
      '✨ Hi {name}! Need help with anything? A dinner reservation, a tradesperson, a gift idea — just say the word.\n\n_— Alina_',
    ];
    let count = 0;
    for (const user of inactive) {
      const lastRequest = user.requests[0];
      const lastActivity = lastRequest ? lastRequest.createdAt : user.createdAt;
      if (lastActivity > twentyOneDaysAgo) continue; // Active recently — skip
      if (lastActivity < sixtyDaysAgo) continue; // Too long gone — skip
      const phone = getPhone(user);
      if (!phone) continue;
      const msg = msgs[Math.floor(Math.random() * msgs.length)].replace('{name}', user.fullName?.split(' ')[0] || 'there');
      await sendWA(phone, msg);
      count++;
    }
    console.log('[INACTIVE RE-ENGAGEMENT] Sent to:', count, 'members');
  } catch(e) { console.error('[INACTIVE RE-ENGAGEMENT]', e.message); }
}

// ── 23. LOYALTY AUTO-UPGRADE NOTIFICATION ────────────────────────────────
async function runLoyaltyUpgrades() {
  try {
    const members = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER' },
      select: { id: true, email: true, fullName: true, phone: true, loyaltyTier: true, referralCount: true, createdAt: true }
    });
    for (const user of members) {
      const monthsActive = Math.floor((Date.now() - new Date(user.createdAt)) / (30 * 24 * 60 * 60 * 1000));
      const requestCount = await prisma.request.count({ where: { userId: user.id } });
      let newTier = 'STANDARD';
      if (monthsActive >= 6 || requestCount >= 20 || user.referralCount >= 3) newTier = 'GOLD';
      if (monthsActive >= 18 || requestCount >= 100 || user.referralCount >= 10) newTier = 'PLATINUM';
      if (newTier !== user.loyaltyTier) {
        await prisma.user.update({ where: { id: user.id }, data: { loyaltyTier: newTier } });
        const phone = getPhone(user);
        if (!phone) continue;
        if (newTier === 'GOLD') {
          await sendWA(phone,
            '🌟 *Congratulations ' + (user.fullName?.split(' ')[0]||'') + ' — you have reached Consiere Gold!*\n\nYour new perks:\n✅ Priority handling on all requests\n✅ Dedicated support\n✅ 1 bonus credit every month\n\nYou are also now eligible for a personal invitation to *Cipher Private* — Australia\'s most exclusive concierge.\n\nReply *CIPHER* if you would like an introduction.\n\n_— Alina_'
          );
        } else if (newTier === 'PLATINUM') {
          await sendWA(phone,
            '💎 *Welcome to Consiere Platinum, ' + (user.fullName?.split(' ')[0]||'') + '!*\n\nYou have unlocked our highest tier:\n✅ Same-day priority on every request\n✅ Personal account manager\n✅ 3 bonus credits every month\n✅ Cipher Private invitation\n\nYour Cipher Private invitation has been arranged. Expect a personal message from our team shortly.\n\n_— Consiere_'
          );
          // Notify founder for Cipher Private outreach
          await sendWA('+61413536700',
            '💎 *Platinum member ready for CP outreach*\n\nName: ' + user.fullName + '\nEmail: ' + user.email + '\nPhone: ' + (getPhone(user)||'—')
          );
        }
        console.log('[LOYALTY UPGRADE]', user.email, user.loyaltyTier, '->', newTier);
      }
    }
  } catch(e) { console.error('[LOYALTY UPGRADES]', e.message); }
}

// ── 24. VENDOR RATING SYSTEM ──────────────────────────────────────────────
async function sendVendorRatingRequest(requestId) {
  try {
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: true, vendor: true }
    });
    if (!req || !req.user || !req.vendor) return;
    const phone = getPhone(req.user);
    if (!phone) return;
    const rateUrl = (process.env.CC_URL || 'https://consiere.com.au') + '/rate/' + requestId;
    // Send rating request 1 hour after completion
    setTimeout(async () => {
      await sendWA(phone,
        '⭐ *How was your experience?*\n\nYour request was handled by *' + req.vendor.name + '*.\n\nRate your experience:\n👉 ' + rateUrl + '\n\nOr simply reply with a number:\n*1* = Poor  *2* = OK  *3* = Good  *4* = Great  *5* = Excellent\n\n_— Alina_'
      );
      console.log('[RATING REQUEST] Sent for request:', requestId);
    }, 60 * 60 * 1000); // 1 hour after completion
  } catch(e) { console.error('[VENDOR RATING]', e.message); }
}

async function processVendorRating(requestId, rating, userId) {
  try {
    const req = await prisma.request.findUnique({ where: { id: requestId }, include: { vendor: true } });
    if (!req?.vendorId) return;
    // Update vendor rating average
    const vendor = await prisma.vendor.findUnique({ where: { id: req.vendorId } });
    if (!vendor) return;
    const currentRating = vendor.rating || 5;
    const currentCount = vendor.ratingCount || 0;
    const newCount = currentCount + 1;
    const newRating = ((currentRating * currentCount) + rating) / newCount;
    await prisma.vendor.update({
      where: { id: req.vendorId },
      data: { rating: Math.round(newRating * 10) / 10, ratingCount: newCount }
    });
    // Update request with rating
    await prisma.request.update({ where: { id: requestId }, data: { clientRating: rating } });
    console.log('[VENDOR RATING] Updated:', req.vendorId, 'new rating:', newRating.toFixed(1));
  } catch(e) { console.error('[PROCESS RATING]', e.message); }
}

// ── 24b. VENDOR AUTO-PERFORMANCE SCORE ───────────────────────────────────
async function runVendorPerformanceCheck() {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      include: { requests: { where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } } }
    });
    for (const vendor of vendors) {
      const reqs = vendor.requests;
      if (reqs.length < 3) continue; // Not enough data
      const avgRating = vendor.rating || 5;
      const acceptanceRate = reqs.filter(r => r.status !== 'DECLINED').length / reqs.length;
      const score = (avgRating / 5 * 0.6) + (acceptanceRate * 0.4);
      if (score < 0.5 && avgRating < 3.0) {
        // Low performer — send warning
        if (vendor.email) {
          // Email warning via Resend
          console.log('[VENDOR PERFORMANCE] Low score warning:', vendor.name, score.toFixed(2));
        }
        if (vendor.phone) {
          await sendWA(vendor.phone,
            '⚠️ *Performance Notice — Consiere Vendor Partner*\n\nYour current rating is ' + avgRating + '/5 with a ' + Math.round(acceptanceRate*100) + '% acceptance rate.\n\nTo maintain your partnership, please improve response times and acceptance rate.\n\nIf you need support, reply to this message.\n\n_— Consiere Vendor Team_'
          );
        }
      } else if (score >= 0.9) {
        // Top performer — flag for featured placement unlock
        console.log('[VENDOR PERFORMANCE] Top performer:', vendor.name, 'score:', score.toFixed(2));
      }
    }
    console.log('[VENDOR PERFORMANCE] Checked:', vendors.length, 'vendors');
  } catch(e) { console.error('[VENDOR PERFORMANCE]', e.message); }
}

// ── 26. WHATSAPP BROADCAST AUTOMATION ────────────────────────────────────
async function runSmartBroadcast() {
  try {
    const members = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER' },
      include: { requests: { orderBy: { createdAt: 'desc' }, take: 5 } }
    });
    for (const user of members) {
      const phone = getPhone(user);
      if (!phone) continue;
      const categories = user.requests.map(r => r.category);
      const lastRequest = user.requests[0];
      const daysSinceRequest = lastRequest
        ? Math.floor((Date.now() - new Date(lastRequest.createdAt)) / (24*60*60*1000))
        : 999;
      if (daysSinceRequest < 7) continue; // Active — skip
      // Pick personalised message based on last category used
      let msg = null;
      const lastCat = categories[0];
      const dayOfWeek = new Date().getDay();
      if (lastCat === 'dining' && (dayOfWeek === 5 || dayOfWeek === 6)) {
        msg = '🍽️ *Any dinner plans this weekend?*\n\nJust tell me where you feel like going and I will get you the best table.\n\n_— Alina_';
      } else if (lastCat === 'travel') {
        msg = '✈️ *Planning your next trip?*\n\nTell me where you want to go and I will handle everything — flights, hotels, transfers, activities.\n\n_— Alina_';
      } else if (lastCat === 'home') {
        msg = '🏠 *Any home maintenance coming up?*\n\nI have trusted tradespeople available 7 days. Just tell me what needs doing.\n\n_— Alina_';
      } else if (daysSinceRequest > 30) {
        msg = '👋 *It has been a while!*\n\nI am still here, handling everything for Consiere members 24/7. What can I sort for you?\n\n_— Alina_';
      }
      if (msg) {
        await sendWA(phone, msg);
        console.log('[SMART BROADCAST] Sent to:', user.email, 'last cat:', lastCat);
        await new Promise(r => setTimeout(r, 500)); // Rate limit
      }
    }
  } catch(e) { console.error('[SMART BROADCAST]', e.message); }
}

// ── 27. NEW MEMBER ONBOARDING SEQUENCE ───────────────────────────────────
async function runOnboardingSequence() {
  try {
    const now = Date.now();
    const members = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER', createdAt: { gte: new Date(now - 35 * 24 * 60 * 60 * 1000) } }
    });
    for (const user of members) {
      const phone = getPhone(user);
      if (!phone) continue;
      const daysOld = Math.floor((now - new Date(user.createdAt)) / (24*60*60*1000));
      const name = user.fullName?.split(' ')[0] || 'there';
      let msg = null;
      if (daysOld === 3) {
        msg = '🍽️ *' + name + ', have you tried asking Alina for a restaurant?*\n\nJust say something like:\n_"Book a table for 2 at a great Italian in Surry Hills tonight at 7:30pm"_\n\nI will handle everything.\n\n_— Alina_';
      } else if (daysOld === 7) {
        msg = '🌟 *Here is what I can handle for you, ' + name + ':*\n\n🍽️ Restaurant reservations\n✈️ Travel & flights\n🏠 Home services\n🛍️ Shopping & gifts\n📋 Admin & paperwork\n🎟️ Events & tickets\n\nJust message me anytime — no app, no login, just WhatsApp.\n\n_— Alina_';
      } else if (daysOld === 14) {
        const reqCount = await prisma.request.count({ where: { userId: user.id } });
        if (reqCount >= 2 && user.memberTier === 'CIPHER') {
          msg = '⚡ *Going well, ' + name + '?*\n\nYou have used ' + reqCount + ' of your 2 free requests.\n\nUnlock unlimited requests for just *$9.99/month* — cancel anytime.\n\n👉 consiere.com.au/cc-portal\n\n_— Alina_';
        }
      } else if (daysOld === 30) {
        const reqCount2 = await prisma.request.count({ where: { userId: user.id } });
        if (reqCount2 >= 3) {
          msg = '🎉 *One month with Consiere, ' + name + '!*\n\nYou have made ' + reqCount2 + ' requests so far.\n\nShare with a friend and you both get a free credit:\n👉 consiere.com.au/signup?ref=' + (user.referralCode || 'CONSIERE') + '\n\n_— Alina_';
        }
      }
      if (msg) {
        await sendWA(phone, msg);
        console.log('[ONBOARDING]', name, 'day:', daysOld);
      }
    }
  } catch(e) { console.error('[ONBOARDING SEQUENCE]', e.message); }
}

// ── 29. VENDOR PAYMENT AUTO-RELEASE ──────────────────────────────────────
async function runAutoPaymentRelease() {
  try {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const pendingPayouts = await prisma.payment.findMany({
      where: {
        status: 'HELD',
        createdAt: { lte: fortyEightHoursAgo }
      },
      include: { request: { include: { vendor: true } } }
    });
    for (const payment of pendingPayouts) {
      if (!payment.vendorStripeId && !payment.request?.vendor?.stripeAccountId) {
        // No Stripe account — mark as ready for bank transfer
        await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PENDING_TRANSFER' } });
        console.log('[AUTO RELEASE] Marked for transfer:', payment.id, payment.amount);
        // Notify admin
        await sendWA('+61413536700',
          '💰 *Vendor payment ready for transfer*\n\nVendor: ' + (payment.request?.vendor?.name||'Unknown') + '\nAmount: $' + payment.amount + '\n\nNo Stripe account — manual bank transfer needed.'
        );
      } else {
        // Has Stripe — attempt transfer
        try {
          const stripe = getStripe();
          const transfer = await stripe.transfers.create({
            amount: Math.round(payment.amount * 100),
            currency: 'aud',
            destination: payment.request?.vendor?.stripeAccountId,
            description: 'Consiere vendor payment — request ' + payment.requestId
          });
          await prisma.payment.update({ where: { id: payment.id }, data: { status: 'RELEASED', stripeTransferId: transfer.id } });
          console.log('[AUTO RELEASE] Stripe transfer:', transfer.id);
        } catch(e) { console.error('[AUTO RELEASE STRIPE]', e.message); }
      }
    }
    console.log('[AUTO RELEASE] Processed:', pendingPayouts.length, 'payments');
  } catch(e) { console.error('[AUTO RELEASE]', e.message); }
}

// ── 30. AUTO-DISPUTE RESOLUTION ───────────────────────────────────────────
async function handleDispute(requestId, userId, reason) {
  try {
    const stripe = getStripe();
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: true, payments: true }
    });
    if (!req) return { success: false, error: 'Request not found' };
    const user = req.user;
    const phone = getPhone(user);
    const payment = req.payments?.find(p => p.status === 'CAPTURED' || p.status === 'RELEASED');

    // Check refund eligibility (max 2 refunds per phone/email)
    const refundCount = await prisma.payment.count({
      where: {
        status: 'REFUNDED',
        request: { userId: user.id }
      }
    });
    const isEligible = refundCount < 2;

    if (reason === 'cancel' && isEligible && payment) {
      // Full refund
      if (payment.stripePaymentIntentId) {
        try {
          await stripe.refunds.create({
            payment_intent: payment.stripePaymentIntentId,
            reason: 'requested_by_customer'
          });
          await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
          await prisma.request.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
          // Hold vendor payment
          await prisma.payment.updateMany({
            where: { requestId, status: 'HELD' },
            data: { status: 'HELD_DISPUTE' }
          });
          if (phone) await sendWA(phone,
            '✅ *Your cancellation has been processed.*\n\nA full refund of $' + payment.amount + ' has been issued to your card.\nPlease allow 3-5 business days.\n\n_— Consiere_'
          );
          // Notify admin
          await sendWA('+61413536700',
            '⚠️ *Cancellation & refund processed*\n\nUser: ' + user.fullName + '\nRequest: ' + (req.description||requestId) + '\nAmount: $' + payment.amount + '\nRefunds used: ' + (refundCount + 1) + '/2'
          );
          return { success: true, refunded: true, amount: payment.amount };
        } catch(e) { console.error('[DISPUTE REFUND]', e.message); }
      }
    } else if (reason === 'cancel' && !isEligible) {
      // Non-refundable — exceeded 2 refund limit
      if (phone) await sendWA(phone,
        '❌ *Cancellation received — non-refundable*\n\nWe have noted your cancellation. However, you have reached the maximum refund limit for your account (2 refunds).\n\nFuture cancellations are non-refundable per our terms.\n\nIf you believe this is an error, please contact hello@consiere.com.au\n\n_— Consiere_'
      );
      await prisma.request.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
      return { success: true, refunded: false, reason: 'limit_exceeded' };
    } else if (reason === 'complaint') {
      // Service complaint — goodwill credit
      await prisma.user.update({
        where: { id: userId },
        data: { retainerBalance: { increment: 20 } }
      });
      // Hold vendor payment for review
      await prisma.payment.updateMany({
        where: { requestId, status: 'HELD' },
        data: { status: 'HELD_DISPUTE' }
      });
      if (phone) await sendWA(phone,
        '🙏 *We are sorry about your experience.*\n\nWe have added *$20 credit* to your Consiere wallet as a goodwill gesture.\n\nOur team will review this within 24 hours.\n\n_— Consiere_'
      );
      await sendWA('+61413536700',
        '⚠️ *Service complaint received*\n\nUser: ' + user.fullName + ' (' + user.email + ')\nRequest: ' + (req.description||requestId) + '\nReason: ' + reason + '\n\n$20 credit issued. Vendor payment on hold.'
      );
      return { success: true, creditIssued: 20 };
    }
    return { success: false };
  } catch(e) { console.error('[DISPUTE]', e.message); return { success: false, error: e.message }; }
}

// ── 31. DAILY HEALTH REPORT ───────────────────────────────────────────────
async function sendDailyHealthReport() {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      activeRequests,
      pendingQuotes,
      newMembers,
      completedToday,
      paymentsToday,
      totalMembers,
      totalVendors,
      waitlistCount
    ] = await Promise.all([
      prisma.request.count({ where: { status: { in: ['PENDING','DISPATCHED','QUOTED'] } } }),
      prisma.request.count({ where: { status: 'QUOTED' } }),
      prisma.user.count({ where: { role: 'MEMBER', createdAt: { gte: oneDayAgo } } }),
      prisma.request.count({ where: { status: 'COMPLETED', updatedAt: { gte: oneDayAgo } } }),
      prisma.payment.aggregate({ where: { status: 'CAPTURED', createdAt: { gte: oneDayAgo } }, _sum: { amount: true } }),
      prisma.user.count({ where: { role: 'MEMBER', isActive: true } }),
      prisma.vendor.count({ where: { isActive: true } }).catch(()=>0),
      prisma.waitlistEntry.count({ where: { status: 'PENDING' } }).catch(()=>0)
    ]);

    const revenue = paymentsToday._sum.amount || 0;

    // Find items needing attention
    const sixHrsAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const stalledRequests = await prisma.request.findMany({
      where: { status: 'DISPATCHED', updatedAt: { lte: sixHrsAgo } },
      include: { vendor: true },
      take: 3
    });
    let attentionItems = '';
    if (stalledRequests.length > 0) {
      attentionItems = '\n\n⚠️ *Needs attention:*\n' + stalledRequests.map(r =>
        '• ' + (r.vendor?.name||'No vendor') + ' — no response in 6hrs on: ' + (r.description||r.id).substr(0,40)
      ).join('\n');
    }
    if (pendingQuotes > 3) {
      attentionItems += '\n• ' + pendingQuotes + ' quotes awaiting client payment';
    }

    const msg = '☀️ *Good morning, Asif — Daily Report*\n\n' +
      '📊 *Today at a glance:*\n' +
      '• Active requests: ' + activeRequests + '\n' +
      '• Completed today: ' + completedToday + '\n' +
      '• Pending quotes: ' + pendingQuotes + '\n' +
      '• New members: ' + newMembers + '\n' +
      '• Revenue today: $' + revenue.toFixed(2) + '\n\n' +
      '📈 *Platform totals:*\n' +
      '• Total members: ' + totalMembers + '\n' +
      '• Active vendors: ' + totalVendors + '\n' +
      '• CP waitlist: ' + waitlistCount +
      attentionItems +
      '\n\n_Consiere Automation Engine — ' + new Date().toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'short' }) + '_';

    await sendWA('+61413536700', msg);
    console.log('[HEALTH REPORT] Sent to founder');
  } catch(e) { console.error('[HEALTH REPORT]', e.message); }
}

// ── 32. SMART QUEUE MANAGEMENT ────────────────────────────────────────────
async function prioritiseQueue(requests) {
  const tierPriority = { CIPHER_SOVEREIGN: 5, CIPHER_BLACK: 4, CIPHER_BLACK_PRIVATE: 4, UNLIMITED: 3, CIPHER: 1 };
  const loyaltyBonus = { PLATINUM: 2, GOLD: 1, STANDARD: 0 };
  const users = await prisma.user.findMany({
    where: { id: { in: requests.map(r => r.userId) } },
    select: { id: true, memberTier: true, loyaltyTier: true }
  });
  const userMap = {};
  users.forEach(u => userMap[u.id] = u);
  return requests.sort((a, b) => {
    const ua = userMap[a.userId] || {};
    const ub = userMap[b.userId] || {};
    const scoreA = (tierPriority[ua.memberTier] || 1) + (loyaltyBonus[ua.loyaltyTier] || 0) + (a.isUrgent ? 3 : 0);
    const scoreB = (tierPriority[ub.memberTier] || 1) + (loyaltyBonus[ub.loyaltyTier] || 0) + (b.isUrgent ? 3 : 0);
    return scoreB - scoreA; // Higher score first
  });
}

// ── EXPORTS ───────────────────────────────────────────────────────────────
module.exports = {
  getDynamicMarkup,
  triggerUpsell,
  recoverAbandonedRequests,
  runWinBack,
  triggerReferralPrompt,
  runRenewalIntervention,
  runInactiveReengagement,
  runLoyaltyUpgrades,
  sendVendorRatingRequest,
  processVendorRating,
  runVendorPerformanceCheck,
  runSmartBroadcast,
  runOnboardingSequence,
  runAutoPaymentRelease,
  handleDispute,
  sendDailyHealthReport,
  prioritiseQueue
};
