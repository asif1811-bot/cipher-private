'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendWA } = require('./whatsapp_notifications');
const { Resend } = require('resend');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';
function getResend() { return new Resend(process.env.RESEND_API_KEY); }

// ── 128. VENDOR AUTO-ONBOARDING SEQUENCE ─────────────────────────────────
const ONBOARDING_EMAILS = [
  {
    step: 1, delay: 0,
    subject: '🎉 Welcome to Consiere — Your first job is waiting',
    html: (vendor) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#f8f4ef">
<div style="background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
<div style="font-size:11px;letter-spacing:4px;color:#c9a96e;font-weight:700;margin-bottom:8px">CONSIERE VENDOR NETWORK</div>
<h2 style="color:#1a1612;margin:0 0 16px;font-size:24px;font-family:Georgia,serif">Welcome, ${vendor.name}! 🎉</h2>
<p style="color:#44403c;font-size:14px;line-height:1.7">You're now part of the Consiere vendor network — the world's AI-powered personal concierge platform. Here's everything you need to know to get started.</p>
<div style="background:#1a1612;border-radius:12px;padding:24px;margin:24px 0">
<div style="color:#c9a96e;font-size:11px;letter-spacing:2px;font-weight:700;margin-bottom:12px">YOUR QUICK START GUIDE</div>
${['Log in to your vendor portal: ' + CC_URL + '/vendor-portal','Complete your profile — add photos, description, pricing','Turn on notifications so you never miss a job request','Respond to job requests within 15 minutes for best placement'].map((item, i) => `<div style="color:#fff;font-size:13px;padding:8px 0;border-bottom:1px solid #333"><span style="color:#c9a96e;font-weight:700;margin-right:8px">${i+1}.</span>${item}</div>`).join('')}
</div>
<div style="background:#f8f4ef;border-radius:12px;padding:20px;margin:20px 0">
<div style="font-size:13px;color:#44403c"><strong>💰 How you get paid:</strong><br>Client pays via Stripe → held 48hrs → released to you automatically. We take 10% commission only on completed jobs. No upfront fees, ever.</div>
</div>
<a href="${CC_URL}/vendor-portal" style="display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:14px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;margin-top:24px">Access Your Vendor Portal →</a>
<p style="color:#78716c;font-size:11px;text-align:center;margin-top:20px">Questions? Reply to this email or WhatsApp us at +61 489 207 207</p>
</div></div>`
  },
  {
    step: 2, delay: 3 * 24 * 60 * 60 * 1000, // Day 3
    subject: '📋 3 things top Consiere vendors do differently',
    html: (vendor) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#f8f4ef">
<div style="background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
<div style="font-size:11px;letter-spacing:4px;color:#c9a96e;font-weight:700;margin-bottom:8px">CONSIERE VENDOR TIPS</div>
<h2 style="color:#1a1612;margin:0 0 16px;font-size:22px;font-family:Georgia,serif">Hi ${vendor.name} — here's what top vendors do</h2>
${[
  {n:'01', title:'Respond in under 15 minutes', body:'Vendors who respond fastest get 3x more jobs. When a request comes in, reply immediately — even if just to say "On it, quote in 10 mins."'},
  {n:'02', title:'Quote a firm price, not a range', body:'Members dislike uncertainty. "From $80" loses to "$85 all-inclusive". Be specific. You can always adjust for complex jobs.'},
  {n:'03', title:'Follow up after completion', body:'A quick "Hope you enjoyed the service! I\'m available any time" after completion generates repeat bookings and 5-star ratings.'}
].map(tip => `<div style="border:1px solid #e8e0d8;border-radius:12px;padding:20px;margin:16px 0"><div style="font-size:11px;color:#c9a96e;font-weight:700;letter-spacing:2px">${tip.n}</div><div style="font-size:15px;font-weight:700;color:#1a1612;margin:4px 0">${tip.title}</div><div style="font-size:13px;color:#78716c;line-height:1.6">${tip.body}</div></div>`).join('')}
<a href="${CC_URL}/vendor-portal" style="display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:14px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;margin-top:24px">View Your Dashboard →</a>
</div></div>`
  },
  {
    step: 3, delay: 5 * 24 * 60 * 60 * 1000, // Day 5
    subject: '⭐ How your rating affects your income',
    html: (vendor) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#f8f4ef">
<div style="background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
<div style="font-size:11px;letter-spacing:4px;color:#c9a96e;font-weight:700;margin-bottom:8px">YOUR RATING MATTERS</div>
<h2 style="color:#1a1612;margin:0 0 16px;font-size:22px;font-family:Georgia,serif">Your rating is your ranking</h2>
<p style="color:#44403c;font-size:14px;line-height:1.7">Our AI dispatches job requests to vendors in rating order — highest rated first. Here's exactly how it works:</p>
<div style="background:#1a1612;border-radius:12px;padding:24px;margin:20px 0">
${[['4.9-5.0 ⭐','First pick on every request. Featured placement. Bonus payments.'],['4.5-4.8 ⭐','Dispatched on most requests. Good volume.'],['4.0-4.4 ⭐','Dispatched when top vendors are at capacity.'],['Below 4.0','Rarely dispatched. Risk of removal from network.']].map(([r,d]) => `<div style="display:flex;padding:10px 0;border-bottom:1px solid #333"><div style="color:#c9a96e;font-size:13px;font-weight:700;min-width:120px">${r}</div><div style="color:#ccc;font-size:12px">${d}</div></div>`).join('')}
</div>
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:16px 0">
<div style="font-size:13px;color:#166534"><strong>💡 Quick win:</strong> After your next job, ask the client: "If you're happy, a 5-star rating on Consiere helps us a lot." Most members are happy to do it.</div>
</div>
<a href="${CC_URL}/vendor-portal" style="display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:14px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;margin-top:24px">Check Your Rating →</a>
</div></div>`
  },
  {
    step: 4, delay: 7 * 24 * 60 * 60 * 1000, // Day 7
    subject: '🏆 Upgrade to Featured Vendor — get 3x more jobs',
    html: (vendor) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#f8f4ef">
<div style="background:#1a1612;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
<div style="font-size:11px;letter-spacing:4px;color:#c9a96e;font-weight:700;margin-bottom:8px">EXCLUSIVE OFFER — WEEK 1 ONLY</div>
<h2 style="color:#fff;margin:0 0 16px;font-size:22px;font-family:Georgia,serif">Become a Featured Vendor</h2>
<p style="color:#ccc;font-size:14px;line-height:1.7">Featured vendors appear at the top of every member search and get first priority on job dispatch — regardless of category competition.</p>
<div style="background:#c9a96e;border-radius:12px;padding:24px;margin:24px 0;text-align:center">
<div style="font-size:32px;font-weight:700;color:#1a1612">$49/month</div>
<div style="font-size:13px;color:#1a1612;margin-top:4px">Cancel anytime. No contract.</div>
</div>
${['Priority dispatch — first on every relevant request','Featured badge on your vendor profile page','"Consiere Featured" badge for your own website','Monthly performance report with insights','Dedicated support line'].map(b => `<div style="color:#fff;font-size:13px;padding:8px 0;border-bottom:1px solid #333">✓  ${b}</div>`).join('')}
<a href="${CC_URL}/vendor-featured?id=${vendor.id}" style="display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:16px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;margin-top:24px">Upgrade to Featured →</a>
<p style="color:#666;font-size:11px;text-align:center;margin-top:16px">This offer expires in 7 days.</p>
</div></div>`
  },
  {
    step: 5, delay: 14 * 24 * 60 * 60 * 1000, // Day 14
    subject: '📊 Your first 2 weeks on Consiere',
    html: async (vendor) => {
      const jobs = await prisma.request.count({ where: { vendorId: vendor.id } });
      const completed = await prisma.request.count({ where: { vendorId: vendor.id, status: 'COMPLETED' } });
      return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#f8f4ef">
<div style="background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
<div style="font-size:11px;letter-spacing:4px;color:#c9a96e;font-weight:700;margin-bottom:8px">YOUR 2-WEEK REPORT</div>
<h2 style="color:#1a1612;margin:0 0 16px;font-size:22px;font-family:Georgia,serif">How your first 2 weeks went</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0">
${[['Jobs Received', jobs],['Jobs Completed', completed],['Completion Rate', jobs>0?Math.round(completed/jobs*100)+'%':'—'],['Current Rating', vendor.rating||'New']].map(([l,v]) => `<div style="background:#f8f4ef;border-radius:12px;padding:20px;text-align:center"><div style="font-size:28px;font-weight:700;color:#1a1612;font-family:Georgia,serif">${v}</div><div style="font-size:11px;color:#78716c;letter-spacing:1px;margin-top:4px">${l}</div></div>`).join('')}
</div>
${completed === 0 ? '<div style="background:#fff3cd;border:1px solid #c9a96e;border-radius:12px;padding:16px;font-size:13px;color:#856404">You haven\'t completed any jobs yet. Make sure your availability is set correctly in your vendor portal and your notification settings are on.</div>' : '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;font-size:13px;color:#166534">Great start! Keep responding quickly and maintaining high quality to climb the rankings.</div>'}
<a href="${CC_URL}/vendor-portal" style="display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:14px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;margin-top:24px">View Full Dashboard →</a>
</div></div>`;
    }
  }
];

async function startVendorOnboarding(vendorId) {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor?.email) { console.log('[ONBOARDING] No email for vendor:', vendorId); return; }
    // Send first email immediately
    await sendOnboardingStep(vendor, ONBOARDING_EMAILS[0]);
    // Schedule remaining emails
    for (let i = 1; i < ONBOARDING_EMAILS.length; i++) {
      const emailDef = ONBOARDING_EMAILS[i];
      setTimeout(async () => {
        const freshVendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
        if (freshVendor) await sendOnboardingStep(freshVendor, emailDef);
      }, emailDef.delay);
    }
    // Also send WhatsApp welcome
    if (vendor.phone) {
      await sendWA(vendor.phone,
        '🎉 *Welcome to Consiere, ' + vendor.name + '!*\n\n' +
        'Your vendor account is active. You\'ll start receiving job requests shortly.\n\n' +
        '📋 Portal: ' + CC_URL + '/vendor-portal\n' +
        '⏰ Respond within 15 minutes for best placement\n' +
        '💰 We take 10% commission on completed jobs only\n\n' +
        'Check your email for your full getting started guide.\n\n' +
        '_— Consiere Vendor Team_'
      );
    }
    console.log('[ONBOARDING] Started for vendor:', vendor.name);
  } catch(e) { console.error('[ONBOARDING]', e.message); }
}

async function sendOnboardingStep(vendor, emailDef) {
  try {
    // Check not already sent
    const existing = await prisma.vendorOnboardingEmail.findFirst({
      where: { vendorId: vendor.id, step: emailDef.step }
    });
    if (existing) return;
    const html = typeof emailDef.html === 'function'
      ? (emailDef.html.constructor.name === 'AsyncFunction' ? await emailDef.html(vendor) : emailDef.html(vendor))
      : emailDef.html;
    const resend = getResend();
    await resend.emails.send({
      from: 'Consiere Vendors <vendors@consiere.com.au>',
      to: vendor.email,
      cc: ['hello@consiere.com.au'],
      subject: emailDef.subject,
      html
    });
    await prisma.vendorOnboardingEmail.create({ data: { vendorId: vendor.id, step: emailDef.step } });
    console.log('[ONBOARDING] Step', emailDef.step, 'sent to:', vendor.email);
  } catch(e) { console.error('[ONBOARDING STEP]', emailDef.step, e.message); }
}

// ── 143. AUTOMATED TERMS ACCEPTANCE ──────────────────────────────────────
const CURRENT_TERMS_VERSION = '2.1';
const CURRENT_VENDOR_TERMS_VERSION = '1.3';

async function recordTermsAcceptance(userId, vendorId, type, ipAddress, userAgent) {
  try {
    const version = type === 'VENDOR_AGREEMENT' ? CURRENT_VENDOR_TERMS_VERSION : CURRENT_TERMS_VERSION;
    await prisma.termsAcceptance.create({
      data: { userId: userId||null, vendorId: vendorId||null, type, version, ipAddress: ipAddress||null, userAgent: userAgent||null }
    });
    console.log('[TERMS] Accepted:', type, 'v'+version, 'by:', userId||vendorId);
    return { success: true, version };
  } catch(e) { return { success: false, error: e.message }; }
}

async function checkTermsAccepted(userId, vendorId, type) {
  try {
    const version = type === 'VENDOR_AGREEMENT' ? CURRENT_VENDOR_TERMS_VERSION : CURRENT_TERMS_VERSION;
    const acceptance = await prisma.termsAcceptance.findFirst({
      where: { userId: userId||null, vendorId: vendorId||null, type, version }
    });
    return { accepted: !!acceptance, version, acceptedAt: acceptance?.acceptedAt };
  } catch(e) { return { accepted: false }; }
}

async function getTermsAcceptanceHistory(userId, vendorId) {
  return await prisma.termsAcceptance.findMany({
    where: { OR: [{ userId: userId||undefined }, { vendorId: vendorId||undefined }] },
    orderBy: { acceptedAt: 'desc' }
  });
}

// ── 144. DISPUTE RESOLUTION ENGINE ───────────────────────────────────────
async function openDispute(userId, requestId, paymentId, reason) {
  try {
    const request = await prisma.request.findUnique({ where: { id: requestId }, include: { vendor: true } });
    const dispute = await prisma.disputeCase.create({
      data: { requestId, paymentId: paymentId||null, userId, vendorId: request?.vendorId||null, reason, status: 'OPEN' }
    });
    // Ask member for their statement via WhatsApp
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, fullName: true } });
    if (user?.phone) {
      await sendWA(user.phone,
        '📋 *Dispute Opened — Case #' + dispute.id.substr(0,8).toUpperCase() + '*\n\n' +
        'We have received your dispute for:\n*' + (request?.description||'').substr(0,80) + '*\n\n' +
        'Please describe what went wrong in your own words. Reply to this message with your statement.\n\n' +
        '_We will review and respond within 2 hours._\n\n_— Consiere Trust & Safety_'
      );
    }
    // Notify vendor if exists
    if (request?.vendor?.phone) {
      await sendWA(request.vendor.phone,
        '⚠️ *Dispute Filed — Case #' + dispute.id.substr(0,8).toUpperCase() + '*\n\n' +
        'A client has opened a dispute for:\n*' + (request?.description||'').substr(0,80) + '*\n\n' +
        'Please reply with your side of the story. We will review both statements and resolve fairly.\n\n' +
        '_— Consiere Trust & Safety_'
      );
    }
    // Notify admin
    await sendWA('+61413536700',
      '⚠️ *New Dispute — Case #' + dispute.id.substr(0,8).toUpperCase() + '*\n\n' +
      'Member: ' + (user?.fullName||userId) + '\n' +
      'Vendor: ' + (request?.vendor?.name||'—') + '\n' +
      'Reason: ' + reason + '\n' +
      'Request: ' + (request?.description||'').substr(0,60) + '\n\n' +
      'Auto-resolution running. You will be notified if escalation needed.'
    );
    // Start auto-resolution timer — give vendor 2 hours to respond
    setTimeout(() => autoResolveDispute(dispute.id), 2 * 60 * 60 * 1000);
    return { success: true, disputeId: dispute.id, caseNumber: dispute.id.substr(0,8).toUpperCase() };
  } catch(e) { return { success: false, error: e.message }; }
}

async function submitDisputeStatement(disputeId, fromUserId, fromVendorId, statement) {
  try {
    const dispute = await prisma.disputeCase.findUnique({ where: { id: disputeId } });
    if (!dispute) return { success: false, error: 'Dispute not found' };
    if (fromUserId) {
      await prisma.disputeCase.update({ where: { id: disputeId }, data: { memberStatement: statement } });
    } else if (fromVendorId) {
      await prisma.disputeCase.update({ where: { id: disputeId }, data: { vendorStatement: statement } });
    }
    // If both statements received — auto-resolve
    const updated = await prisma.disputeCase.findUnique({ where: { id: disputeId } });
    if (updated.memberStatement && updated.vendorStatement) {
      await autoResolveDispute(disputeId);
    }
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

async function autoResolveDispute(disputeId) {
  try {
    const dispute = await prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { payment: true }
    });
    if (!dispute || dispute.status !== 'OPEN') return;
    // Auto-resolution rules
    let resolution = '';
    let refundAmount = 0;
    let autoResolved = true;
    const reason = (dispute.reason||'').toLowerCase();
    const memberStatement = (dispute.memberStatement||'').toLowerCase();
    // Rule 1: Service not delivered — full refund
    if (reason.includes('not delivered') || reason.includes('no show') || reason.includes('cancelled')) {
      resolution = 'Service was not delivered. Full refund issued automatically.';
      refundAmount = dispute.payment?.amount || 0;
    }
    // Rule 2: Service below standard — 50% refund
    else if (reason.includes('poor quality') || reason.includes('not as described') || memberStatement.includes('terrible') || memberStatement.includes('awful')) {
      resolution = 'Service quality issue acknowledged. 50% refund issued as goodwill.';
      refundAmount = (dispute.payment?.amount || 0) * 0.5;
    }
    // Rule 3: Minor complaint — $15 credit
    else if (reason.includes('late') || reason.includes('delay') || memberStatement.includes('late')) {
      resolution = 'Service was delayed. $15 credit added to your Consiere wallet.';
      refundAmount = 0;
    }
    // Rule 4: No vendor statement received — rule in favour of member
    else if (!dispute.vendorStatement) {
      resolution = 'Vendor did not respond within the required timeframe. Full refund issued.';
      refundAmount = dispute.payment?.amount || 0;
    }
    // Rule 5: Escalate if complex
    else {
      autoResolved = false;
      resolution = 'This dispute requires manual review. Our team will contact you within 4 hours.';
      await sendWA('+61413536700',
        '🚨 *Dispute Needs Manual Review*\n\n' +
        'Case: #' + disputeId.substr(0,8).toUpperCase() + '\n' +
        'Member statement: ' + (dispute.memberStatement||'—').substr(0,100) + '\n' +
        'Vendor statement: ' + (dispute.vendorStatement||'—').substr(0,100) + '\n\n' +
        'Please review and resolve manually.'
      );
    }
    // Apply resolution
    await prisma.disputeCase.update({
      where: { id: disputeId },
      data: { status: autoResolved ? 'RESOLVED' : 'ESCALATED', resolution, refundAmount, resolvedAt: autoResolved ? new Date() : null }
    });
    // Process refund or credit
    if (refundAmount > 0 && dispute.payment?.stripePaymentIntentId) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        await stripe.refunds.create({ payment_intent: dispute.payment.stripePaymentIntentId, amount: Math.round(refundAmount * 100) });
        await prisma.payment.update({ where: { id: dispute.paymentId }, data: { status: 'REFUNDED' } });
      } catch(e) { console.error('[DISPUTE REFUND]', e.message); }
    } else if (resolution.includes('$15 credit')) {
      await prisma.user.update({ where: { id: dispute.userId }, data: { retainerBalance: { increment: 15 } } });
    }
    // Notify member
    const user = await prisma.user.findUnique({ where: { id: dispute.userId }, select: { phone: true } });
    if (user?.phone) {
      await sendWA(user.phone,
        (autoResolved ? '✅' : '⏳') + ' *Dispute Update — Case #' + disputeId.substr(0,8).toUpperCase() + '*\n\n' +
        resolution + (refundAmount > 0 ? '\n\n*Refund: $' + refundAmount.toFixed(2) + ' AUD*' : '') + '\n\n_— Consiere Trust & Safety_'
      );
    }
    console.log('[DISPUTE] Auto-resolved:', disputeId, resolution.substr(0,50));
  } catch(e) { console.error('[DISPUTE RESOLVE]', e.message); }
}

async function getDisputeStatus(disputeId) {
  return await prisma.disputeCase.findUnique({ where: { id: disputeId } });
}

// ── 145. GDPR/PRIVACY DATA EXPORT ────────────────────────────────────────
async function requestDataExport(userId) {
  try {
    // Check no pending export
    const pending = await prisma.gDPRExport.findFirst({ where: { userId, status: 'PENDING' } });
    if (pending) return { success: false, error: 'Export already in progress' };
    const exportRecord = await prisma.gDPRExport.create({
      data: { userId, status: 'PENDING', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
    });
    // Generate export async
    generateDataExport(exportRecord.id, userId).catch(e => console.error('[GDPR]', e.message));
    return { success: true, exportId: exportRecord.id, message: 'Export generating — you will receive an email when ready (usually within 5 minutes).' };
  } catch(e) { return { success: false, error: e.message }; }
}

async function generateDataExport(exportId, userId) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const requests = await prisma.request.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const payments = await prisma.payment.findMany({ where: { request: { userId } }, orderBy: { createdAt: 'desc' } });
    const messages = await prisma.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, take: 500 });
    const dna = await prisma.requestDNA.findUnique({ where: { userId } }).catch(() => null);
    // Build HTML report
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;color:#1a1612;padding:20px}
h1{color:#1a1612;font-family:Georgia,serif}h2{color:#c9a96e;font-size:14px;letter-spacing:2px;margin-top:32px}
table{width:100%;border-collapse:collapse;margin:12px 0}th{background:#1a1612;color:#fff;padding:8px;text-align:left;font-size:11px}
td{padding:8px;border-bottom:1px solid #e8e0d8;font-size:12px}.section{margin:24px 0;padding:20px;background:#f8f4ef;border-radius:8px}
</style></head><body>
<h1>Your Consiere Data Export</h1>
<p style="color:#78716c;font-size:13px">Generated: ${new Date().toLocaleString('en-AU')} | This report contains all personal data held by Cipher Concierge Group Pty Ltd.</p>
<h2>ACCOUNT INFORMATION</h2>
<div class="section">
<table><tr><th>Field</th><th>Value</th></tr>
${[['Full Name',user?.fullName||'—'],['Email',user?.email||'—'],['Phone',user?.phone||'—'],['Member Since',user?.createdAt?new Date(user.createdAt).toLocaleDateString('en-AU'):'—'],['Membership Tier',user?.memberTier||'—'],['Platform',user?.platform||'—']].map(([k,v])=>`<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`).join('')}
</table></div>
<h2>SERVICE REQUESTS (${requests.length} total)</h2>
<div class="section"><table><tr><th>Date</th><th>Category</th><th>Description</th><th>Status</th></tr>
${requests.slice(0,50).map(r=>`<tr><td>${new Date(r.createdAt).toLocaleDateString('en-AU')}</td><td>${r.category||'—'}</td><td>${(r.description||'').substr(0,80)}</td><td>${r.status}</td></tr>`).join('')}
</table>${requests.length>50?`<p style="color:#78716c;font-size:11px">Showing 50 of ${requests.length} requests.</p>`:''}</div>
<h2>PAYMENT HISTORY (${payments.length} total)</h2>
<div class="section"><table><tr><th>Date</th><th>Amount</th><th>Status</th></tr>
${payments.slice(0,20).map(p=>`<tr><td>${new Date(p.createdAt).toLocaleDateString('en-AU')}</td><td>$${(p.amount||0).toFixed(2)} AUD</td><td>${p.status}</td></tr>`).join('')}
</table></div>
<h2>CHAT MESSAGES (${messages.length} stored)</h2>
<div class="section"><table><tr><th>Date</th><th>From</th><th>Message</th></tr>
${messages.slice(0,30).map(m=>`<tr><td>${new Date(m.createdAt).toLocaleDateString('en-AU')}</td><td>${m.role||'user'}</td><td>${(m.content||'').substr(0,100)}</td></tr>`).join('')}
</table></div>
${dna?`<h2>AI PROFILE DATA</h2><div class="section"><table><tr><th>Field</th><th>Value</th></tr>
${[['Top Category',dna.topCategory],['Avg Spend','$'+dna.avgSpend.toFixed(2)],['Requests/Week',dna.requestFrequency.toFixed(1)],['Peak Day',dna.peakDay],['Upsell Score',dna.upsellScore+'/100']].map(([k,v])=>`<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`).join('')}
</table><p style="font-size:11px;color:#78716c">This profile is used to personalise your Consiere experience. You can request deletion at any time.</p></div>`:''}
<div style="margin-top:40px;padding:20px;background:#1a1612;border-radius:8px;color:#fff">
<p style="font-size:12px;color:#ccc">To request deletion of your data, email hello@consiere.com.au with subject "Data Deletion Request". We will process within 30 days.<br><br>Cipher Concierge Group Pty Ltd | Sydney, Australia | ABN: [INSERT ABN]</p>
</div></body></html>`;
    // Email to member
    const resend = getResend();
    await resend.emails.send({
      from: 'Consiere Privacy <hello@consiere.com.au>',
      to: user.email,
      subject: 'Your Consiere Data Export',
      html,
      attachments: [{
        filename: 'consiere-data-export-' + new Date().toISOString().split('T')[0] + '.html',
        content: Buffer.from(html).toString('base64'),
        contentType: 'text/html'
      }]
    });
    await prisma.gDPRExport.update({ where: { id: exportId }, data: { status: 'COMPLETE' } });
    console.log('[GDPR] Export sent to:', user.email);
  } catch(e) {
    console.error('[GDPR GENERATE]', e.message);
    await prisma.gDPRExport.update({ where: { id: exportId }, data: { status: 'FAILED' } }).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
  }
}

module.exports = {
  startVendorOnboarding,
  recordTermsAcceptance, checkTermsAccepted, getTermsAcceptanceHistory,
  openDispute, submitDisputeStatement, autoResolveDispute, getDisputeStatus,
  requestDataExport, generateDataExport,
  CURRENT_TERMS_VERSION, CURRENT_VENDOR_TERMS_VERSION
};
