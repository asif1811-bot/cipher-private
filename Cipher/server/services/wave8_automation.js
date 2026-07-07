'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWA } = require('./whatsapp_notifications');
const { Resend } = require('resend');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';
function getStripe() { return require('stripe')(process.env.STRIPE_SECRET_KEY); }
function getResend() { return new Resend(process.env.RESEND_API_KEY); }

// ── 89. MEMBER-TO-MEMBER MARKETPLACE ─────────────────────────────────────
async function createMemberListing(userId, title, description, category, price, isFree) {
  try {
    const listing = await prisma.memberListing.create({
      data: { userId, title, description, category, price: price||null, isFree: isFree||false }
    });
    console.log('[MARKETPLACE] Listing created:', title);
    return { success: true, listing };
  } catch(e) { return { success: false, error: e.message }; }
}

async function getMarketplaceListings(category) {
  const listings = await prisma.memberListing.findMany({
    where: { isActive: true, category: category||undefined },
    orderBy: { createdAt: 'desc' }
  });
  // Enrich with user data
  const enriched = await Promise.all(listings.map(async l => {
    const user = await prisma.user.findUnique({ where: { id: l.userId }, select: { fullName: true, memberTier: true } });
    return { ...l, seller: { fullName: user?.fullName || 'Member', memberTier: user?.memberTier } };
  }));
  return enriched;
}

async function bookMarketplaceListing(listingId, buyerUserId) {
  try {
    const listing = await prisma.memberListing.findUnique({
      where: { id: listingId },
      include: { user: true }
    });
    if (!listing) return { success: false, error: 'Listing not found' };
    const buyer = await prisma.user.findUnique({ where: { id: buyerUserId } });
    // Notify seller
    const sellerPhone = listing.user.phone;
    if (sellerPhone) await sendWA(sellerPhone,
      '🛍️ *New booking on your Consiere listing!*\n\n' +
      '"' + listing.title + '"\n' +
      'Booked by: ' + buyer?.fullName + '\n\n' +
      'Consiere will facilitate the connection. Reply to confirm.\n\n_— Consiere Marketplace_'
    );
    await prisma.memberListing.update({ where: { id: listingId }, data: { bookings: { increment: 1 } } });
    return { success: true, sellerName: listing.user.fullName };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 90. CONSIERE EXPERIENCES ──────────────────────────────────────────────
async function createExperience(title, description, category, price, maxGuests, eventDate, location) {
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'aud', unit_amount: Math.round(price*100), product_data: { name: 'Consiere Experience: ' + title, description: location + ' — ' + new Date(eventDate).toLocaleDateString('en-AU') } }, quantity: 1 }],
      success_url: CC_URL + '/experiences/success',
      cancel_url: CC_URL + '/experiences',
      metadata: { type: 'experience', title }
    });
    const exp = await prisma.consiergeExperience.create({
      data: { title, description, category, price, maxGuests: maxGuests||8, eventDate: new Date(eventDate), location, stripeLink: session.url }
    });
    // Broadcast to interested members
    const members = await prisma.user.findMany({ where: { isActive: true, role: 'MEMBER' }, select: { phone: true, email: true, fullName: true }, take: 200 });
    let sent = 0;
    for (const m of members) {
      const phone = m.phone || (m.email?.includes('@whatsapp.cipher') ? '+' + m.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
      if (!phone) continue;
      await sendWA(phone,
        '🌟 *New Consiere Experience*\n\n*' + title + '*\n📍 ' + location + '\n📅 ' + new Date(eventDate).toLocaleDateString('en-AU') + '\n💰 $' + price + ' per person\n👥 Only ' + maxGuests + ' spots\n\n' + description.substr(0,100) + '\n\n👉 ' + session.url + '\n\n_— Consiere_'
      );
      sent++;
      await new Promise(r => setTimeout(r, 300));
      if (sent >= 50) break; // Rate limit
    }
    console.log('[EXPERIENCE] Created and broadcast to', sent, 'members');
    return { success: true, experience: exp, broadcastSent: sent };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 91. WAITLIST MONETISATION ─────────────────────────────────────────────
async function chargeWaitlistPriority(waitlistEntryId) {
  try {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: waitlistEntryId } });
    if (!entry) return { success: false, error: 'Not found' };
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_WAITLIST_PRIORITY, quantity: 1 }],
      success_url: CC_URL + '/cipher-private?priority=confirmed',
      cancel_url: CC_URL + '/cipher-private',
      customer_email: entry.email,
      metadata: { type: 'waitlist_priority', waitlistId: waitlistEntryId }
    });
    return { success: true, url: session.url };
  } catch(e) { return { success: false, error: e.message }; }
}

async function sendWaitlistPriorityOffer() {
  try {
    const pending = await prisma.waitlistEntry.findMany({ where: { status: 'PENDING', brand: 'CIPHER_PRIVATE' }, take: 20 });
    const resend = getResend();
    for (const entry of pending) {
      await resend.emails.send({
        from: 'Cipher Private <hello@cipherprivate.com>',
        to: entry.email,
        subject: 'Jump the Cipher Private waitlist — Priority Access available',
        html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px;background:#0f0e0c;color:#fff">
          <h2 style="color:#c9a96e">Priority Waitlist Access</h2>
          <p>Dear ${entry.name},</p>
          <p>You are on the Cipher Private waitlist. We are offering a limited number of Priority Access positions — skip the queue and be reviewed first.</p>
          <div style="background:#1a1612;padding:20px;border-radius:8px;margin:24px 0;border:1px solid #c9a96e">
            <div style="color:#c9a96e;font-size:24px;font-weight:700">A$500</div>
            <div style="color:#999;font-size:13px">Non-refundable. Applied to your first year if accepted.</div>
          </div>
          <a href="${CC_URL}/api/w8/waitlist/priority/${entry.id}" style="display:inline-block;background:#c9a96e;color:#0f0e0c;padding:14px 28px;border-radius:100px;text-decoration:none;font-weight:700">Secure Priority Access →</a>
          <p style="color:#666;font-size:11px;margin-top:32px">Cipher Private — By referral only. Australia.</p>
        </div>`
      });
    }
    console.log('[WAITLIST PRIORITY] Offers sent to:', pending.length);
    return { success: true, sent: pending.length };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 92. FAMILY PLAN ───────────────────────────────────────────────────────
async function subscribeFamilyPlan(userId) {
  try {
    const stripe = getStripe();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    let customerId = user?.stripeCustomerId;
    if (!customerId) {
      const cust = await stripe.customers.create({ email: user.email, name: user.fullName });
      customerId = cust.id;
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_FAMILY, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?plan=family',
      cancel_url: CC_URL + '/cc-portal',
      customer: customerId,
      metadata: { type: 'family_plan', userId }
    });
    return { success: true, url: session.url };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 93. CIPHER SUCCESSION PLANNING ───────────────────────────────────────
async function setSuccessor(userId, successorName, successorPhone, successorEmail) {
  try {
    await prisma.cipherJournal.create({
      data: { userId, content: JSON.stringify({ successorName, successorPhone, successorEmail, setAt: new Date() }), type: 'SUCCESSION', addedBy: 'MEMBER' }
    });
    await sendWA('+61413536700',
      '🔐 *Cipher Private — Succession Set*\n\nMember ID: ' + userId + '\nSuccessor: ' + successorName + '\nPhone: ' + successorPhone + '\nEmail: ' + (successorEmail||'—') + '\n\nDocumented in member journal.'
    );
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 94. CIPHER ASSET CONCIERGE ────────────────────────────────────────────
async function addAssetRecord(userId, assetType, assetName, notes, nextServiceDate) {
  try {
    const record = await prisma.assetRecord.create({
      data: { userId, assetType, assetName, notes: notes||null, nextService: nextServiceDate ? new Date(nextServiceDate) : null }
    });
    return { success: true, record };
  } catch(e) { return { success: false, error: e.message }; }
}

async function runAssetReminders() {
  try {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const assets = await prisma.assetRecord.findMany({
      where: { nextService: { lte: sevenDaysFromNow, gte: new Date() }, reminderSent: false },
      include: { user: { select: { phone: true, fullName: true } } }
    });
    for (const asset of assets) {
      const phone = asset.user.phone;
      if (!phone) continue;
      await sendWA(phone,
        '🔧 *Asset Maintenance Reminder — Cipher Private*\n\n' +
        'Your *' + asset.assetName + '* (' + asset.assetType + ') is due for service on ' +
        new Date(asset.nextService).toLocaleDateString('en-AU') + '.\n\n' +
        (asset.notes ? 'Notes: ' + asset.notes + '\n\n' : '') +
        'Shall I arrange this for you?\n\n_— Your Cipher Private Director_'
      );
      await prisma.assetRecord.update({ where: { id: asset.id }, data: { reminderSent: true } });
      console.log('[ASSET REMINDER] Sent for:', asset.assetName);
    }
  } catch(e) { console.error('[ASSET REMINDERS]', e.message); }
}

// ── 95. CIPHER EVENT CALENDAR ─────────────────────────────────────────────
async function runEventCalendarCuration() {
  try {
    const upcomingEvents = [
      { name: 'Formula 1 Australian Grand Prix', date: 'March', location: 'Melbourne', category: 'MOTORSPORT' },
      { name: 'Art Basel Hong Kong', date: 'March', location: 'Hong Kong', category: 'ART' },
      { name: 'Sydney Film Festival', date: 'June', location: 'Sydney', category: 'CULTURE' },
      { name: 'Melbourne Cup', date: 'November', location: 'Melbourne', category: 'RACING' },
      { name: 'Vivid Sydney', date: 'May-June', location: 'Sydney', category: 'CULTURE' },
    ];
    const month = new Date().toLocaleString('default', { month: 'long' });
    const relevant = upcomingEvents.filter(e => e.date.includes(month));
    if (!relevant.length) return;
    const cpMembers = await prisma.user.findMany({
      where: { platform: 'CIPHER_PRIVATE', isActive: true, memberTier: { in: ['CIPHER_BLACK','CIPHER_SOVEREIGN'] } },
      select: { phone: true, fullName: true }
    });
    for (const member of cpMembers) {
      if (!member.phone) continue;
      const name = member.fullName?.split(' ')[0] || '';
      const eventList = relevant.map(e => '• *' + e.name + '* — ' + e.location).join('\n');
      await sendWA(member.phone,
        '📅 *Cipher Private — Upcoming Events*\n\nDear ' + name + ',\n\nEvents worth considering this month:\n\n' + eventList + '\n\nWould you like me to arrange attendance, hospitality or travel for any of these?\n\n_— Your Cipher Private Director_'
      );
    }
    console.log('[EVENT CALENDAR] Curated for', cpMembers.length, 'CP members');
  } catch(e) { console.error('[EVENT CALENDAR]', e.message); }
}

// ── 96. TIERED COMMISSION ─────────────────────────────────────────────────
async function getVendorCommissionRate(vendorId) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const payments = await prisma.payment.aggregate({
      where: { requestId: { in: (await prisma.request.findMany({ where: { vendorId }, select: { id: true } })).map(r=>r.id) }, createdAt: { gte: thirtyDaysAgo }, status: 'CAPTURED' },
      _sum: { amount: true }
    });
    const monthlyRevenue = payments._sum.amount || 0;
    let rate = 10;
    if (monthlyRevenue >= 10000) rate = 6;
    else if (monthlyRevenue >= 5000) rate = 8;
    else if (monthlyRevenue >= 1000) rate = 9;
    return { rate, monthlyRevenue, tier: rate === 6 ? 'PLATINUM' : rate === 8 ? 'GOLD' : rate === 9 ? 'SILVER' : 'STANDARD' };
  } catch(e) { return { rate: 10, tier: 'STANDARD' }; }
}

// ── 97. CREDITS EXPIRY ────────────────────────────────────────────────────
async function runCreditsExpiryCheck() {
  try {
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const expiring = await prisma.user.findMany({
      where: { credits: { gt: 0 }, creditsExpiresAt: { lte: thirtyDaysFromNow, gte: new Date() } },
      select: { id: true, phone: true, email: true, credits: true, creditsExpiresAt: true, fullName: true }
    });
    for (const user of expiring) {
      const phone = user.phone || (user.email?.includes('@whatsapp.cipher') ? '+' + user.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
      if (!phone) continue;
      await sendWA(phone,
        '⏰ *Your Consiere credits expire soon!*\n\n' +
        'You have *' + user.credits + ' request credit' + (user.credits>1?'s':'') + '* expiring on ' +
        new Date(user.creditsExpiresAt).toLocaleDateString('en-AU') + '.\n\n' +
        'Use them before they expire — just tell Alina what you need!\n\n_— Consiere_'
      );
      console.log('[CREDITS EXPIRY] Warned:', user.email, user.credits, 'credits');
    }
    // Auto-expire overdue credits
    const expired = await prisma.user.updateMany({
      where: { credits: { gt: 0 }, creditsExpiresAt: { lt: new Date() } },
      data: { credits: 0 }
    });
    console.log('[CREDITS EXPIRY] Expired', expired.count, 'accounts');
  } catch(e) { console.error('[CREDITS EXPIRY]', e.message); }
}

// ── 98. ANNUAL PLAN ───────────────────────────────────────────────────────
async function subscribeAnnualPlan(userId) {
  try {
    const stripe = getStripe();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    let customerId = user?.stripeCustomerId;
    if (!customerId) {
      const cust = await stripe.customers.create({ email: user.email, name: user.fullName });
      customerId = cust.id;
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_ANNUAL, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?plan=annual',
      cancel_url: CC_URL + '/cc-portal',
      customer: customerId,
      metadata: { type: 'annual_plan', userId }
    });
    return { success: true, url: session.url, saving: '$19.90/year (2 months free)' };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 99. SERVICE COMPLETION BONUS ──────────────────────────────────────────
async function runVendorBonusCheck() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const vendors = await prisma.vendor.findMany({ where: { isActive: true } });
    for (const vendor of vendors) {
      const completedJobs = await prisma.request.count({
        where: { vendorId: vendor.id, status: 'COMPLETED', updatedAt: { gte: thirtyDaysAgo } }
      });
      if (completedJobs >= 20 && (vendor.rating||0) >= 4.5) {
        const bonus = completedJobs * 0.5; // $0.50 per job = ~$10-15
        console.log('[VENDOR BONUS] Eligible:', vendor.name, 'Jobs:', completedJobs, 'Bonus: $' + bonus);
        if (vendor.phone) await sendWA(vendor.phone,
          '🎉 *Performance Bonus — Consiere*\n\nCongratulations! You completed *' + completedJobs + ' jobs* this month with a ' + vendor.rating + '⭐ rating.\n\nA *$' + bonus.toFixed(2) + ' bonus* has been added to your next payment.\n\nThank you for being a top Consiere partner!\n\n_— Consiere Vendor Team_'
        );
        if (vendor.email) {
          const resend = getResend();
          await resend.emails.send({
            from: 'Consiere <hello@consiere.com.au>', to: vendor.email,
            subject: 'Performance Bonus — $' + bonus.toFixed(2),
            html: '<p>Dear ' + vendor.name + ',</p><p>You have earned a performance bonus of <strong>$' + bonus.toFixed(2) + '</strong> for completing ' + completedJobs + ' jobs with a ' + vendor.rating + '⭐ rating this month.</p><p>This will be included in your next payment.</p>'
          });
        }
      }
    }
  } catch(e) { console.error('[VENDOR BONUS]', e.message); }
}

// ── 100. NATURAL LANGUAGE ANALYTICS ──────────────────────────────────────
async function nlAnalyticsQuery(question) {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const lower = question.toLowerCase();

    // Gather relevant data based on question
    let data = {};
    if (lower.includes('revenue') || lower.includes('money') || lower.includes('payment')) {
      const thisMonth = await prisma.payment.aggregate({ where: { status: 'CAPTURED', createdAt: { gte: thirtyDaysAgo } }, _sum: { amount: true }, _count: true });
      const lastMonth = await prisma.payment.aggregate({ where: { status: 'CAPTURED', createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } }, _sum: { amount: true }, _count: true });
      data.thisMonthRevenue = thisMonth._sum.amount || 0;
      data.lastMonthRevenue = lastMonth._sum.amount || 0;
      data.growth = lastMonth._sum.amount ? Math.round(((data.thisMonthRevenue - data.lastMonthRevenue) / data.lastMonthRevenue) * 100) : 0;
    }
    if (lower.includes('member') || lower.includes('user') || lower.includes('signup')) {
      data.totalMembers = await prisma.user.count({ where: { role: 'MEMBER' } });
      data.newThisMonth = await prisma.user.count({ where: { role: 'MEMBER', createdAt: { gte: thirtyDaysAgo } } });
      data.cpMembers = await prisma.user.count({ where: { platform: 'CIPHER_PRIVATE' } });
    }
    if (lower.includes('request') || lower.includes('category') || lower.includes('popular')) {
      const requests = await prisma.request.groupBy({ by: ['category'], _count: { id: true }, where: { createdAt: { gte: thirtyDaysAgo } }, orderBy: { _count: { id: 'desc' } }, take: 5 });
      data.topCategories = requests.map(r => r.category + ': ' + r._count.id);
      data.totalRequests = await prisma.request.count({ where: { createdAt: { gte: thirtyDaysAgo } } });
    }
    if (lower.includes('vendor')) {
      data.totalVendors = await prisma.vendor.count({ where: { isActive: true } });
      data.avgRating = (await prisma.vendor.aggregate({ _avg: { rating: true } }))._avg?.rating?.toFixed(1);
    }

    // Build natural language answer using Anthropic
    const prompt = 'You are an analytics assistant for Consiere, an AI concierge platform. Answer this question in 2-3 natural sentences using ONLY the data provided. Be specific with numbers.\n\nQuestion: ' + question + '\n\nData: ' + JSON.stringify(data);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 200, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await response.json();
    const answer = d.content?.[0]?.text || 'Unable to generate answer';
    return { success: true, answer, data };
  } catch(e) { return { success: false, error: e.message }; }
}

// ── 101. AUTOMATED PR ENGINE ──────────────────────────────────────────────
async function checkAndFirePRMilestones() {
  try {
    const memberCount = await prisma.user.count({ where: { role: 'MEMBER' } });
    const requestCount = await prisma.request.count();
    const milestones = [
      { key: 'members_100', value: 100, check: memberCount, title: '100 Members' },
      { key: 'members_500', value: 500, check: memberCount, title: '500 Members' },
      { key: 'members_1000', value: 1000, check: memberCount, title: '1,000 Members' },
      { key: 'requests_1000', value: 1000, check: requestCount, title: '1,000 Requests Handled' },
      { key: 'requests_10000', value: 10000, check: requestCount, title: '10,000 Requests Handled' },
    ];
    for (const milestone of milestones) {
      if (milestone.check < milestone.value) continue;
      const existing = await prisma.pRRelease.findFirst({ where: { milestone: milestone.key } });
      if (existing) continue; // Already fired
      // Generate PR using Anthropic
      const prompt = 'Write a short, punchy press release (150 words) for Consiere — an AI-powered personal concierge platform in Australia. The milestone is: ' + milestone.title + '. Include: what Consiere does, the milestone, a quote from Asif Shariff (Founder), and contact details (hello@consiere.com.au). Be professional and newsworthy.';
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
      });
      const d = await response.json();
      const prContent = d.content?.[0]?.text || '';
      await prisma.pRRelease.create({ data: { title: 'Milestone: ' + milestone.title, content: prContent, milestone: milestone.key } });
      await sendWA('+61413536700',
        '📣 *PR Milestone Reached: ' + milestone.title + '*\n\nAuto-generated press release ready for review.\n\nCheck Admin → PR Releases to approve and send.'
      );
      console.log('[PR ENGINE] Milestone fired:', milestone.key);
    }
  } catch(e) { console.error('[PR ENGINE]', e.message); }
}

// ── 102. MEMBER NPS ───────────────────────────────────────────────────────
async function checkAndSendNPS(userId) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { npsRequestCount: true, phone: true, email: true } });
    if (!user) return;
    const newCount = (user.npsRequestCount || 0) + 1;
    await prisma.user.update({ where: { id: userId }, data: { npsRequestCount: newCount } });
    if (newCount % 5 !== 0) return; // Only every 5th request
    const phone = user.phone || (user.email?.includes('@whatsapp.cipher') ? '+' + user.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
    if (!phone) return;
    await sendWA(phone,
      '⭐ *Quick question*\n\nHow likely are you to recommend Consiere to a friend?\n\nReply with a number:\n*1-6* = Not likely\n*7-8* = Maybe\n*9-10* = Definitely!\n\n_— Alina_'
    );
    console.log('[NPS] Sent to user:', userId, 'at request #', newCount);
  } catch(e) { console.error('[NPS]', e.message); }
}

async function processNPSReply(userId, score) {
  try {
    const reqCount = await prisma.request.count({ where: { userId } });
    await prisma.nPSResponse.create({ data: { userId, score, requestCount: reqCount } });
    const phone = (await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }))?.phone;
    if (score >= 9) {
      // Promoter — ask for referral
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, fullName: true } });
      const code = user?.referralCode || 'CONSIERE';
      if (phone) await sendWA(phone,
        '🙏 *Thank you! That means everything to us.*\n\nShare Consiere with a friend and you both get a free request:\n👉 ' + CC_URL + '/signup?ref=' + code + '\n\n_— Alina_'
      );
    } else if (score <= 6) {
      // Detractor — immediate intervention
      if (phone) await sendWA(phone,
        '💙 *Thank you for your honest feedback.*\n\nWe are sorry we haven\'t met your expectations. Can you tell me what we could do better? Your feedback goes directly to our team.\n\n_— Alina_'
      );
      await sendWA('+61413536700',
        '⚠️ *NPS Detractor — Score: ' + score + '*\n\nUser ID: ' + userId + '\nImmediate intervention sent. Please follow up personally.'
      );
    }
    console.log('[NPS] Processed score:', score, 'for user:', userId);
  } catch(e) { console.error('[NPS REPLY]', e.message); }
}

// ── 103. ALINA PERSONALITY CALIBRATION ───────────────────────────────────
async function updateAlinaStyle(userId, style) {
  try {
    const validStyles = ['FRIENDLY', 'FORMAL', 'BRIEF', 'DETAILED', 'CASUAL'];
    if (!validStyles.includes(style.toUpperCase())) return { success: false, error: 'Invalid style. Choose: FRIENDLY, FORMAL, BRIEF, DETAILED, CASUAL' };
    await prisma.user.update({ where: { id: userId }, data: { alinaStyle: style.toUpperCase() } });
    const styleDescriptions = {
      FRIENDLY: 'warm and conversational', FORMAL: 'professional and formal',
      BRIEF: 'concise and to the point', DETAILED: 'thorough and comprehensive', CASUAL: 'relaxed and casual'
    };
    return { success: true, style: style.toUpperCase(), description: styleDescriptions[style.toUpperCase()] };
  } catch(e) { return { success: false, error: e.message }; }
}

function getAlinaStylePrompt(style) {
  const styles = {
    FRIENDLY: 'Be warm, friendly, and conversational. Use the member\'s name occasionally.',
    FORMAL: 'Be professional, formal, and precise. Address the member respectfully.',
    BRIEF: 'Be extremely concise — 1-2 sentences maximum per response unless detail is requested.',
    DETAILED: 'Be thorough — provide full details, options, and context in every response.',
    CASUAL: 'Be relaxed and casual, like a helpful friend. Contractions, informal language OK.'
  };
  return styles[style] || styles.FRIENDLY;
}

// ── 104. AUTO-GENERATED CASE STUDIES ─────────────────────────────────────
async function generateCaseStudy(requestId) {
  try {
    const req = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { memberTier: true } } }
    });
    if (!req || req.status !== 'COMPLETED') return;
    const complexCategories = ['RELOCATION', 'EVENTS', 'TRAVEL', 'AVIATION', 'PROCUREMENT'];
    if (!complexCategories.includes(req.category)) return;
    const prompt = 'Write a 2-paragraph anonymised case study for Consiere (AI concierge platform). Category: ' + req.category + '. Request: ' + (req.description||'').substr(0,200) + '. Make it compelling for a website or pitch deck. Do not include any names. Start with "A [city] based member..." Style: professional, warm, specific.';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await response.json();
    const content = d.content?.[0]?.text;
    if (!content) return;
    await prisma.caseStudy.create({
      data: { requestId, title: req.category + ' — ' + new Date().toLocaleDateString('en-AU'), content, category: req.category }
    });
    await sendWA('+61413536700', '📝 *New case study auto-generated*\n\nCategory: ' + req.category + '\n\nReview in admin → Case Studies.');
    console.log('[CASE STUDY] Generated for request:', requestId);
  } catch(e) { console.error('[CASE STUDY]', e.message); }
}

module.exports = {
  createMemberListing, getMarketplaceListings, bookMarketplaceListing,
  createExperience,
  chargeWaitlistPriority, sendWaitlistPriorityOffer,
  subscribeFamilyPlan,
  setSuccessor,
  addAssetRecord, runAssetReminders,
  runEventCalendarCuration,
  getVendorCommissionRate,
  runCreditsExpiryCheck,
  subscribeAnnualPlan,
  runVendorBonusCheck,
  nlAnalyticsQuery,
  checkAndFirePRMilestones,
  checkAndSendNPS, processNPSReply,
  updateAlinaStyle, getAlinaStylePrompt,
  generateCaseStudy
};
