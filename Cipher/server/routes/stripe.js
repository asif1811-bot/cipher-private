'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { generateTaxInvoice } = require('../services/advanced_automation');
const { notifyPaymentConfirmed, notifySubscriptionActivated, notifySubscriptionRenewed, notifyRenewalReminder, getPhone } = require('../services/whatsapp_notifications');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe not configured. Add STRIPE_SECRET_KEY to .env');
  return require('stripe')(key);
}

// Create checkout session for one-off service payment
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const stripe = getStripe();
    const { requestId, amount, description } = req.body;
    const userId = req.user.userId || req.user.id;
    if (!amount || !description) return res.status(400).json({ error: 'Amount and description required' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'aud', product_data: { name: description }, unit_amount: Math.round(amount * 100) }, quantity: 1 }],
      mode: 'payment',
      customer_email: user.email,
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?payment=cancelled',
      metadata: { requestId: requestId || '', userId, description: description.substring(0, 100) }
    });
    try {
      await prisma.payment.create({ data: { userId, requestId: requestId||null, stripeSessionId: session.id, amount: parseFloat(amount), description: description.substring(0,200), status: 'PENDING' } });
    } catch(e) {}
    console.log('[STRIPE] Checkout:', session.id, '$'+amount);
    res.json({ url: session.url, sessionId: session.id });
  } catch(e) { console.error('[STRIPE]', e.message); res.status(500).json({ error: e.message }); }
});

// Create no-login quote payment link (for WhatsApp clients)
router.post('/quote-payment-link', async (req, res) => {
  try {
    const { inquiryId, token } = req.body;
    if (!inquiryId || !token) return res.status(400).json({ error: 'inquiryId and token required' });
    const inq = await prisma.vendorInquiry.findUnique({
      where: { id: inquiryId },
      include: { request: { include: { user: true } }, vendor: true }
    });
    if (!inq) return res.status(404).json({ error: 'Inquiry not found' });
    if (!inq.quoteAmount) return res.status(400).json({ error: 'No quote amount' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: inq.request?.title || inq.request?.description || 'Consiere Service',
            description: 'Handled by ' + (inq.vendor?.name || 'Consiere') + ' via Consiere'
          },
          unit_amount: Math.round(inq.quoteAmount * 100)
        },
        quantity: 1
      }],
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/pay/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/pay/cancel',
      customer_email: inq.request?.user?.email || undefined,
      metadata: {
        type: 'whatsapp_quote_payment',
        inquiryId,
        userId: inq.request?.userId || '',
        phone: getPhone(inq.request?.user) || '',
        vendorName: inq.vendor?.name || '',
        description: (inq.request?.description || '').substring(0, 100)
      }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create subscription checkout
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const stripe = getStripe();
    const { plan } = req.body;
    const userId = req.user.userId || req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const prices = { standard: process.env.STRIPE_PRICE_STANDARD, premium: process.env.STRIPE_PRICE_PREMIUM };
    if (!prices[plan]) return res.status(400).json({ error: 'Invalid plan. Configure STRIPE_PRICE_STANDARD and STRIPE_PRICE_PREMIUM in .env' });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'], mode: 'subscription',
      customer_email: user.email,
      line_items: [{ price: prices[plan], quantity: 1 }],
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?subscription=success',
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?subscription=cancelled',
      metadata: { userId, plan }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stripe connection status
router.get('/webhook-register-now', async (req, res) => { try { const stripe=require('stripe')(process.env.STRIPE_SECRET_KEY); const list=await stripe.webhookEndpoints.list(); const existing=list.data.find(w=>w.url.includes('consiere.com.au')); if(existing){return res.json({status:'already_exists',id:existing.id,url:existing.url,events:existing.enabled_events,secret:'already_set'});} const wh=await stripe.webhookEndpoints.create({url:'https://consiere.com.au/api/stripe/webhook',enabled_events:['checkout.session.completed','invoice.payment_succeeded','customer.subscription.deleted']}); res.json({status:'created',id:wh.id,url:wh.url,secret:wh.secret,events:wh.enabled_events}); } catch(e){res.status(500).json({error:e.message});} });
router.get('/status', async (req, res) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.json({ connected: false, error: 'No key' });
    const s = getStripe();
    await s.balance.retrieve();
    res.json({ connected: true, livemode: !key.startsWith('sk_test'), mode: key.startsWith('sk_test') ? 'test' : 'live' });
  } catch(e) { res.json({ connected: false, error: e.message }); }
});

// Stripe webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = getStripe();
    const sig = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const event = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    // Payment update handled by full checkout handler below
    // Handle quote payment
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      // Handle quote payment
      // ── Credits purchase ─────────────────────────────────
      if (session.metadata?.type === 'credits_purchase') {
        try {
          const { userId, credits } = session.metadata;
          await prisma.user.update({ where: { id: userId }, data: { credits: { increment: parseInt(credits) } } });
          const u = await prisma.user.findUnique({ where: { id: userId } });
          const phone = u?.phone || (u?.email?.includes('@whatsapp.cipher') ? '+' + u.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
          if (phone) await sendWA(phone, '✅ *' + credits + ' request credits added to your account!*\n\nYour balance: ' + ((u?.credits||0)) + ' credits.\nJust message Alina anytime to use them.');
          console.log('[STRIPE] Credits added:', credits, 'to user:', userId);
        } catch(e) { console.error('[STRIPE CREDITS]', e.message); }
      }

      // ── Wallet top-up ─────────────────────────────────────
      if (session.metadata?.type === 'wallet_topup') {
        try {
          const { userId, amount } = session.metadata;
          await prisma.user.update({ where: { id: userId }, data: { retainerBalance: { increment: parseFloat(amount) } } });
          const u = await prisma.user.findUnique({ where: { id: userId } });
          const phone = u?.phone || (u?.email?.includes('@whatsapp.cipher') ? '+' + u.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
          if (phone) await sendWA(phone, '💳 *$' + amount + ' added to your Consiere wallet!*\n\nBalance: $' + (u?.retainerBalance||0).toFixed(2) + ' AUD.\nYour wallet is used automatically when you approve service quotes.');
          console.log('[STRIPE] Wallet topup:', amount, 'for user:', userId);
        } catch(e) { console.error('[STRIPE WALLET]', e.message); }
      }

      // ── Bundle purchase ───────────────────────────────────
      if (session.metadata?.type === 'bundle_purchase') {
        try {
          const { userId, bundle, requests } = session.metadata;
          await prisma.user.update({ where: { id: userId }, data: { credits: { increment: parseInt(requests) } } });
          const bundleNames = { WEDDING: 'Wedding Package', RELOCATION: 'Relocation Package', TRAVEL: 'Travel Planning Package' };
          const u = await prisma.user.findUnique({ where: { id: userId } });
          const phone = u?.phone || (u?.email?.includes('@whatsapp.cipher') ? '+' + u.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
          if (phone) await sendWA(phone, '🎉 *' + (bundleNames[bundle]||bundle) + ' activated!*\n\n' + requests + ' coordinated requests are now ready.\n\nJust message Alina with what you need — she will handle everything end-to-end.');
          console.log('[STRIPE] Bundle activated:', bundle, 'for user:', userId);
        } catch(e) { console.error('[STRIPE BUNDLE]', e.message); }
      }

      // ── Corporate team created ────────────────────────────
      if (session.metadata?.type === 'corporate') {
        try {
          const { userId, teamName } = session.metadata;
          const team = await prisma.team.create({ data: { name: teamName, ownerId: userId, maxMembers: 5, stripeSubId: session.subscription } });
          await prisma.user.update({ where: { id: userId }, data: { teamId: team.id, memberTier: 'CIPHER_BLACK' } });
          const u = await prisma.user.findUnique({ where: { id: userId } });
          const phone = u?.phone || (u?.email?.includes('@whatsapp.cipher') ? '+' + u.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
          if (phone) await sendWA(phone, '🏢 *' + teamName + ' Corporate Plan activated!*\n\nYou can now invite up to 5 team members.\nManage your team at: consiere.com.au/cc-portal\n\nAlina is now available for your whole team!');
          console.log('[STRIPE] Corporate team created:', teamName);
        } catch(e) { console.error('[STRIPE CORPORATE]', e.message); }
      }

      // ── Cipher Private subscription ───────────────────────
      if (session.metadata?.type === 'cp_subscription') {
        try {
          const { userId, tier } = session.metadata;
          const tierMap = { CIPHER: 'CIPHER_BLACK', BLACK: 'CIPHER_BLACK', SOVEREIGN: 'CIPHER_SOVEREIGN' };
          await prisma.user.update({ where: { id: userId }, data: { memberTier: tierMap[tier] || 'CIPHER_BLACK', platform: 'CIPHER_PRIVATE' } });
          const u = await prisma.user.findUnique({ where: { id: userId } });
          const phone = u?.phone || (u?.email?.includes('@whatsapp.cipher') ? '+' + u.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
          if (phone) await sendWA(phone, '🔐 *Welcome to Cipher Private — ' + tier + '*\n\nYour membership is now active. Your dedicated director will contact you within 24 hours.\n\nFor immediate assistance: hello@cipherprivate.com\ncipherprivate.com/portal');
          // Notify founder
          await sendWA('+61413536700', '🔔 *New Cipher Private member!*\n\nTier: ' + tier + '\nUser: ' + u?.fullName + '\nEmail: ' + u?.email);
          console.log('[STRIPE] Cipher Private activated:', tier, 'for user:', userId);
        } catch(e) { console.error('[STRIPE CP]', e.message); }
      }

      // ── Cipher Private retainer ───────────────────────────
      if (session.metadata?.type === 'cp_retainer') {
        try {
          const { userId, amount } = session.metadata;
          await prisma.user.update({ where: { id: userId }, data: { retainerBalance: { increment: parseFloat(amount) } } });
          console.log('[STRIPE] CP Retainer added:', amount, 'for user:', userId);
        } catch(e) { console.error('[STRIPE CP RETAINER]', e.message); }
      }

      // ── Vendor featured ───────────────────────────────────
      if (session.metadata?.type === 'vendor_featured') {
        try {
          const { vendorId, tier } = session.metadata;
          const paidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await prisma.vendorFeatured.upsert({
            where: { vendorId },
            update: { tier, paidUntil, amount: tier === 'PREMIUM' ? 249 : 99 },
            create: { vendorId, tier, paidUntil, amount: tier === 'PREMIUM' ? 249 : 99 }
          });
          console.log('[STRIPE] Vendor featured activated:', vendorId, tier);
        } catch(e) { console.error('[STRIPE VENDOR FEATURED]', e.message); }
      }

      // Handle WhatsApp no-login quote payment
      if (session.metadata?.type === 'whatsapp_quote_payment' && session.metadata?.inquiryId) {
        try {
          const inq2 = await prisma.vendorInquiry.findUnique({ where: { id: session.metadata.inquiryId }, include: { request: true, vendor: true } });
          if (inq2) {
            await prisma.vendorInquiry.update({ where: { id: inq2.id }, data: { status: 'ACCEPTED', paymentPaidAt: new Date() } });
            await prisma.request.update({ where: { id: inq2.requestId }, data: { status: 'IN_PROGRESS', depositPaid: true } });
            // Send WhatsApp invoice/receipt
            const phone = session.metadata.phone;
            if (phone) {
              const invoiceUrl = session.invoice ? 'https://invoice.stripe.com/i/' + session.invoice : null;
              await notifyPaymentConfirmed(phone, session.amount_total/100, session.metadata.description || 'Consiere Service', invoiceUrl, inq2.request?.orderRef);
            }
            console.log('[STRIPE] WhatsApp quote payment confirmed:', session.metadata.inquiryId);
          }
        } catch(e) { console.error('[STRIPE WA QUOTE]', e.message); }
      }

      if (session.metadata?.type === 'quote_payment' && session.metadata?.inquiryId) {
        const inquiryId = session.metadata.inquiryId;
        try {
          const inquiry = await prisma.vendorInquiry.update({
            where: { id: inquiryId },
            data: { paymentPaidAt: new Date(), status: 'ACCEPTED' },
            include: {
              vendor: { select: { name: true, email: true } },
              request: { include: { user: { select: { email: true, fullName: true } } } }
            }
          });
          await prisma.request.update({ where: { id: inquiry.requestId }, data: { status: 'IN_PROGRESS' } }).catch(function(e){console.error("[STRIPE]",e&&e.message||e);});

          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          const member = inquiry.request?.user;
          const firstName = (member?.fullName || 'Member').split(' ')[0];

          // Email vendor — payment received, proceed with order
          if (inquiry.vendor?.email) {
            await resend.emails.send({
              from: 'Consiere <hello@consiere.com.au>',
              to: inquiry.vendor.email,
              subject: '[Payment Received] Proceed with order — ' + (inquiry.request?.title || inquiryId.substring(0,8)),
              html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
                '<div style="background:#1c1917;padding:20px;text-align:center"><div style="color:#b87333;letter-spacing:4px;font-size:11px">CONSIERE</div></div>' +
                '<div style="padding:28px">' +
                '<h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 12px">Payment Received — Please Proceed</h2>' +
                '<p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 16px">The client has accepted your quote and payment has been confirmed.</p>' +
                '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 16px">' +
                '<div style="font-size:12px;color:#166534;font-weight:600;margin-bottom:8px">✓ Payment confirmed: $' + (inquiry.quoteAmount||0).toFixed(2) + ' AUD</div>' +
                '<div style="font-size:13px;color:#1c1917"><b>Order:</b> ' + (inquiry.request?.title || 'Service request') + '</div>' +
                '</div>' +
                '<p style="color:#44403c;font-size:13px;line-height:1.8">Please proceed with the order and mark it as delivered in your vendor portal once complete.</p>' +
                '<div style="text-align:center;margin-top:20px"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/vendor-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:7px">Go to Vendor Portal</a></div>' +
                '</div></div>'
            }).catch(e => console.error('[VENDOR PAYMENT EMAIL]', e.message));
          }

          // Email client — payment confirmed, order in progress
          if (member?.email) {
            await resend.emails.send({
              from: 'Consiere <hello@consiere.com.au>',
              to: member.email,
              subject: 'Payment confirmed — your order is in progress',
              html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
                '<div style="background:#1c1917;padding:20px;text-align:center"><div style="color:#b87333;letter-spacing:4px;font-size:11px">CONSIERE</div></div>' +
                '<div style="padding:28px">' +
                '<h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 12px">Hi ' + firstName + ', payment confirmed!</h2>' +
                '<p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 16px">Your payment has been received and ' + (inquiry.vendor?.name||'our vendor') + ' has been notified to proceed.</p>' +
                '<div style="background:#faf8f5;border:1px solid #e8e0d4;border-radius:8px;padding:16px;margin:0 0 20px">' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:#78716c;font-size:13px">Order</span><span style="font-size:13px;color:#1c1917;font-weight:500">' + (inquiry.request?.title||'Your request').substring(0,50) + '</span></div>' +
                '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:#78716c;font-size:13px">Provider</span><span style="font-size:13px;color:#1c1917">' + (inquiry.vendor?.name||'') + '</span></div>' +
                '<div style="display:flex;justify-content:space-between"><span style="color:#78716c;font-size:13px">Amount paid</span><span style="font-size:13px;color:#b87333;font-weight:600">$' + (inquiry.quoteAmount||0).toFixed(2) + ' AUD</span></div>' +
                '</div>' +
                '<p style="color:#44403c;font-size:13px;line-height:1.8">You will receive another notification once your order has been delivered.</p>' +
                '</div></div>'
            }).catch(e => console.error('[CLIENT PAYMENT EMAIL]', e.message));
          }

          console.log('[PAYMENT] Quote paid:', inquiryId);
        } catch(e) { console.error('[QUOTE PAYMENT WEBHOOK]', e.message); }
      }

      // Handle deposit payment
      if (session.metadata?.type === 'deposit' && session.metadata?.requestId) {
        await prisma.request.update({
          where: { id: session.metadata.requestId },
          data: { depositPaid: true, depositSessionId: session.id, status: 'IN_PROGRESS' }
        }).catch(e => console.error('[DEPOSIT WEBHOOK]', e.message));
        console.log('[DEPOSIT] Paid for request:', session.metadata.requestId);
        try {
          const rq = await prisma.request.findUnique({where:{id:session.metadata.requestId},include:{user:{select:{email:true,fullName:true}},inquiries:{include:{vendor:{select:{name:true,email:true}}}}}});
          if (rq) {
            const {Resend} = require('resend');
            const rs = new Resend(process.env.RESEND_API_KEY);
            const fn = (rq.user?.fullName || 'Member').split(' ')[0];
            const tt = (rq.title || rq.description || 'Request').substring(0, 60);
            const amt = (session.amount_total || 1000) / 100;
            if (rq.user?.email && rq.user.email.indexOf('@whatsapp') === -1) {
              await rs.emails.send({
              from:'Alina at Consiere <hello@consiere.com.au>',
              to:rq.user.email,
              subject:'Payment Confirmed — ' + tt,
              html:'<div style="font-family:Arial;max-width:560px;margin:40px auto;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
                '<div style="background:#1c1917;padding:20px;text-align:center"><span style="color:#b87333;font-size:11px;letter-spacing:4px">CONSIERE</span></div>' +
                '<div style="padding:28px">' +
                '<h2 style="font-family:Georgia;color:#1c1917;font-weight:400">Payment Confirmed ✓</h2>' +
                '<p style="color:#44403c;font-size:14px;line-height:1.8">Hi ' + fn + ', your payment of <strong>$' + amt.toFixed(2) + ' AUD</strong> has been received for:</p>' +
                '<div style="background:#faf8f5;border-left:3px solid #b87333;padding:14px 18px;margin:16px 0;border-radius:0 6px 6px 0">' +
                '<p style="font-size:14px;font-weight:600;color:#1c1917;margin:0">' + tt + '</p></div>' +
                '<p style="color:#44403c;font-size:14px;line-height:1.8">Your vendor partner will confirm the booking details with you shortly. You can track your request in the portal at any time.</p>' +
                '<div style="text-align:center;margin:24px 0"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:14px">View My Requests</a></div>' +
                '<p style="color:#78716c;font-size:12px">— Alina, Consiere AI Concierge</p></div>' +
                '<div style="background:#faf8f5;padding:12px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au</p></div></div>'
            });
              console.log('[DEPOSIT] Email sent to:', rq.user.email);
            }
            for (const i of rq.inquiries || []) {
              if (i.vendor?.email) {
                await rs.emails.send({from:'Consiere <hello@consiere.com.au>',to:i.vendor.email,subject:'Payment Confirmed - ' + tt,html:'<p>Hi ' + i.vendor.name + ', client paid. Please proceed with: ' + tt + '</p>'}).catch(function(e){console.error("[STRIPE]",e&&e.message||e);});
                console.log('[DEPOSIT] Vendor email sent:', i.vendor.name);
              }
            }
          }
        } catch(em) { console.error('[DEPOSIT EMAIL]', em.message); }
        try {
          const rq = await prisma.request.findUnique({where:{id:session.metadata.requestId},include:{user:{select:{email:true,fullName:true}},inquiries:{include:{vendor:{select:{name:true,email:true}}}}}});
          if (rq) {
            const {Resend} = require('resend');
            const rs = new Resend(process.env.RESEND_API_KEY);
            const fn = (rq.user?.fullName || 'Member').split(' ')[0];
            const tt = (rq.title || rq.description || 'Request').substring(0, 60);
            const amt = (session.amount_total || 1000) / 100;
            if (rq.user?.email && rq.user.email.indexOf('@whatsapp') === -1) {
              await rs.emails.send({from:'Consiere <hello@consiere.com.au>',to:rq.user.email,subject:'Payment Received - ' + tt,html:'<p>Hi ' + fn + ', your $' + amt.toFixed(2) + ' AUD deposit is confirmed for: <strong>' + tt + '</strong>. Your vendor will confirm shortly.</p>'});
              console.log('[DEPOSIT] Email sent to:', rq.user.email);
            }
            for (const i of rq.inquiries || []) {
              if (i.vendor?.email) {
                await rs.emails.send({from:'Consiere <hello@consiere.com.au>',to:i.vendor.email,subject:'Payment Confirmed - ' + tt,html:'<p>Hi ' + i.vendor.name + ', client paid. Please proceed with: ' + tt + '</p>'}).catch(function(e){console.error("[STRIPE]",e&&e.message||e);});
                console.log('[DEPOSIT] Vendor email sent:', i.vendor.name);
              }
            }
          }
        } catch(em) { console.error('[DEPOSIT EMAIL]', em.message); }
      }
    }

    // Subscription cancelled and period ended — downgrade to free
    // Handle failed payments
    if (event.type === 'payment_intent.payment_failed') {
      try {
        const pi = event.data.object;
        const sessionWithMeta = await prisma.payment.findFirst({ where: { stripeSessionId: { contains: pi.id } }, include: { user: true } }).catch(function(){ return null; });
        if (sessionWithMeta?.user?.email) {
          const { Resend } = require('resend');
          await new Resend(process.env.RESEND_API_KEY).emails.send({
            from: 'Consiere <hello@consiere.com.au>',
            to: sessionWithMeta.user.email,
            subject: 'Payment failed — please try again',
            html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;padding:32px;border:1px solid #e8e0d4;border-radius:8px"><h2 style="font-family:Georgia;color:#1c1917;font-weight:400">Payment unsuccessful</h2><p style="color:#44403c;font-size:14px">Your payment could not be processed. Please try again or use a different card.</p><div style="text-align:center;margin:24px 0"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px">Try Again</a></div></div>'
          }).catch(function(){});
        }
        console.log('[STRIPE] Payment failed:', pi.id, pi.last_payment_error?.message||'');
      } catch(e) { console.error('[STRIPE PAYMENT FAILED]', e.message); }
    }

    if (event.type === 'customer.subscription.deleted') {
      try {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (userId) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              memberTier: 'CIPHER',
              stripeSubscriptionId: null,
              planExpiry: null
            }
          }).catch(() => {});
          console.log('[STRIPE] Subscription ended, user downgraded to free:', userId);
          // Send downgrade email
          try {
            const { Resend } = require('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } });
            if (user?.email) {
              const firstName = (user.fullName || 'Member').split(' ')[0];
              await resend.emails.send({
                from: 'Consiere <hello@consiere.com.au>',
                to: user.email,
                subject: 'Your Consiere subscription has ended',
                html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
                  '<div style="background:#1c1917;padding:24px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div></div>' +
                  '<div style="padding:32px">' +
                  '<h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 12px">Your subscription has ended</h2>' +
                  '<p style="font-size:13px;color:#78716c;line-height:1.8;margin:0 0 20px">Hi ' + firstName + ', your paid subscription has now ended. Your account has moved to the free plan (2 requests per month).</p>' +
                  '<p style="font-size:13px;color:#78716c;line-height:1.8;margin:0 0 24px">You can resubscribe at any time from your portal to restore your full access.</p>' +
                  '<div style="text-align:center"><a href="' + (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px">Resubscribe now</a></div>' +
                  '</div>' +
                  '<div style="background:#faf8f5;padding:14px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au</p></div>' +
                  '</div>'
              });
              console.log('[STRIPE] Downgrade email sent to:', user.email);
            }
          } catch(emailErr) { console.error('[STRIPE] Downgrade email error:', emailErr.message); }
        }
      } catch(e) { console.error('[STRIPE] subscription.deleted error:', e.message); }
    }

    // Subscription created — notify client via WhatsApp
    if (event.type === 'customer.subscription.created') {
      try {
        const sub2 = event.data.object;
        const custId = sub2.customer;
        const waUser = await prisma.user.findFirst({ where: { stripeCustomerId: custId } });
        if (waUser) {
          const phone = getPhone(waUser);
          if (phone) {
            const firstName = (waUser.fullName||'').split(' ')[0] || 'there';
            await notifySubscriptionActivated(phone, firstName);
            console.log('[STRIPE] Subscription activated WhatsApp sent to:', phone);
          }
          // Upgrade tier
          await prisma.user.update({ where: { id: waUser.id }, data: { memberTier: 'CIPHER_BLACK' } });
        }
      } catch(e) { console.error('[STRIPE SUB CREATED]', e.message); }
    }

    // Subscription renewed — send receipt via WhatsApp
    if (event.type === 'invoice.payment_succeeded') {
      try {
        const inv = event.data.object;
        if (inv.billing_reason === 'subscription_cycle' && inv.customer) {
          const waUser2 = await prisma.user.findFirst({ where: { stripeCustomerId: inv.customer } });
          if (waUser2) {
            const phone = getPhone(waUser2);
            if (phone) {
              const firstName = (waUser2.fullName||'').split(' ')[0] || 'there';
              const amount = inv.amount_paid / 100;
              const nextDate = new Date(inv.lines?.data?.[0]?.period?.end * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
              await notifySubscriptionRenewed(phone, firstName, amount, nextDate);
              console.log('[STRIPE] Renewal receipt WhatsApp sent to:', phone);
            }
          }
        }
      } catch(e) { console.error('[STRIPE INVOICE]', e.message); }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      if (sub.metadata?.userId) {
        const tier = sub.metadata?.plan === 'premium' ? 'CIPHER_SOVEREIGN' : 'CIPHER_BLACK';
        const updateData = { memberTier: tier };
        if (sub.customer) updateData.stripeCustomerId = sub.customer;
        await prisma.user.update({ where: { id: sub.metadata.userId }, data: { memberTier: tier } }).catch(function(e){console.error("[STRIPE]",e&&e.message||e);});
      }
    }
    res.json({ received: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Get payments — admin only
router.get('/payments', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Admin only' });
    const payments = await prisma.payment.findMany({
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' }, take: 100
    }).catch(() => []);
    const paid = payments.filter(p => p.status === 'PAID');
    const total = paid.reduce((s,p) => s + p.amount, 0);
    res.json({ payments, totalCollected: total, totalCommission: total * 0.15, totalVendorPayable: total * 0.85, pendingVendorPayments: paid.filter(p => !p?.vendorPaid).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark vendor as paid
router.patch('/payments/:id/vendor-paid', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Admin only' });
    const payment = await prisma.payment.update({ where: { id: req.params.id }, data: { vendorPaid: true, vendorPaidAt: new Date() } });
    res.json({ payment });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Generate invoice HTML
router.get('/invoice/:sessionId', authenticate, async (req, res) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { stripeSessionId: req.params.sessionId },
      include: { user: true }
    }).catch(()=>null);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const inv = 'CC-' + payment.createdAt.getTime().toString().slice(-8);
    const date = new Date().toLocaleDateString('en-AU', { day:'2-digit', month:'long', year:'numeric' });
    const due = new Date(payment.createdAt.getTime() + 7*86400000).toLocaleDateString('en-AU', { day:'2-digit', month:'long', year:'numeric' });
    const comm = payment.commissionAmt || payment.amount * 0.15;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${inv}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Helvetica,Arial,sans-serif;background:#fff;color:#1c1917;padding:48px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:20px;border-bottom:2px solid #b87333}
.brand{font-size:24px;font-weight:700}.brand span{color:#b87333}
.inv-num{font-size:22px;font-weight:700;color:#b87333;text-align:right}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{background:#1c1917;color:#fff;padding:10px 16px;text-align:left;font-size:11px;letter-spacing:2px;text-transform:uppercase}
td{padding:12px 16px;border-bottom:1px solid #f0ede8;font-size:13px}
.totals{margin-left:auto;width:300px}
.tr{display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid #f0ede8}
.tr.grand{font-size:16px;font-weight:700;border-top:2px solid #b87333;border-bottom:none;padding-top:12px}
.bank{background:#faf8f5;border:1px solid rgba(184,115,51,0.2);padding:16px;margin-top:28px}
.btitle{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#b87333;margin-bottom:8px;font-weight:600}
.footer{display:flex;justify-content:space-between;margin-top:40px;padding-top:20px;border-top:1px solid #f0ede8;font-size:11px;color:#78716c}
</style></head><body>
<div class="hdr">
<div><div class="brand">Consiere</div>
<div style="font-size:11px;color:#78716c;margin-top:4px;letter-spacing:2px;text-transform:uppercase">Concierge Services</div>
<div style="margin-top:10px;font-size:12px;color:#78716c">hello@consiere.com.au<br>consiere.com.au</div></div>
<div><div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#78716c;margin-bottom:4px">Invoice</div>
<div class="inv-num">${inv}</div>
<div style="font-size:12px;color:#78716c;text-align:right;margin-top:8px">Date: ${date}<br>Due: ${due}</div></div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:28px">
<div><div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#b87333;margin-bottom:8px">Billed To</div>
<div style="font-size:13px;color:#44403c"><strong style="color:#1c1917;font-size:14px">${payment.user?.fullName||'Client'}</strong><br>${payment.user?.email||''}</div></div>
<div><div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#b87333;margin-bottom:8px">Service Details</div>
<div style="font-size:13px;color:#44403c">Arranged by Consiere<br>Status: <strong style="color:${payment.status==='PAID'?'#16a34a':'#b87333'}">${payment.status}</strong></div></div></div>
<table><thead><tr><th>Description</th><th style="text-align:right">Amount (AUD)</th></tr></thead>
<tbody><tr><td>${payment.description}</td><td style="text-align:right">$${payment.amount.toLocaleString('en-AU',{minimumFractionDigits:2})}</td></tr></tbody></table>
<div class="totals">
<div class="tr"><span>Subtotal</span><span>$${payment.amount.toLocaleString('en-AU',{minimumFractionDigits:2})}</span></div>
<div class="tr" style="color:#b87333"><span>Service Fee (15%)</span><span>$${comm.toLocaleString('en-AU',{minimumFractionDigits:2})}</span></div>
<div class="tr grand"><span>Total</span><span>$${payment.amount.toLocaleString('en-AU',{minimumFractionDigits:2})}</span></div></div>
<div class="bank"><div class="btitle">Payment Reference</div>
<div style="font-size:12px;color:#44403c">Reference: ${inv}<br>Email: hello@consiere.com.au</div></div>
<div class="footer"><div>Thank you for choosing Consiere. Your life, handled.</div><div style="text-align:right">Cipher Concierge Group Pty Ltd &nbsp;|&nbsp; hello@consiere.com.au</div></div>
</body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Cancel subscription
router.post('/cancel-subscription', authenticate, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const userId = req.user.userId || req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Find active subscription in Stripe
    if (!user.stripeCustomerId) return res.status(400).json({ error: 'No active subscription found' });

    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'active',
      limit: 1
    });

    if (!subscriptions.data.length) return res.status(400).json({ error: 'No active subscription found' });

    // Cancel at period end (not immediately)
    const sub = await stripe.subscriptions.update(subscriptions.data[0].id, {
      cancel_at_period_end: true
    });

    // Send cancellation confirmation email
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = (user.fullName||'Member').split(' ')[0];
      const periodEnd = new Date(sub.current_period_end * 1000).toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' });
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>',
        to: user.email,
        subject: 'Your Consiere subscription has been cancelled',
        html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden"><div style="background:#1c1917;padding:24px 32px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div></div><div style="padding:32px"><h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 16px">Subscription cancelled</h2><p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 12px">Hi ' + firstName + ', your subscription has been cancelled.</p><p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 20px">You will continue to have access to Consiere until <strong>' + periodEnd + '</strong>. After that, your account will move to the free plan (2 requests/month).</p><div style="background:#faf8f5;border-radius:8px;padding:16px 20px;margin:0 0 24px"><p style="color:#78716c;font-size:13px;margin:0">Changed your mind? You can resubscribe at any time from your portal. We would love to have you back.</p></div><div style="text-align:center"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px">Return to Portal</a></div></div><div style="background:#faf8f5;padding:16px 32px;border-top:1px solid #e8e0d4;text-align:center"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au · Sydney, Australia</p></div></div>'
      });
    } catch(emailErr) { console.error('[CANCEL EMAIL]', emailErr.message); }

    const cancelDate = new Date(sub.current_period_end * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    res.json({
      success: true,
      cancelAt: sub.current_period_end,
      cancelDate: cancelDate,
      message: 'Your subscription remains active until ' + cancelDate + '. No further charges will be made. After this date your account moves to the free plan (2 requests/month).'
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get subscription status
router.get('/subscription-status', authenticate, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const userId = req.user.userId || req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.stripeCustomerId) return res.json({ status: 'none', tier: user?.memberTier || 'CIPHER' });

    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      limit: 1
    });

    if (!subscriptions.data.length) return res.json({ status: 'none', tier: user.memberTier });

    const sub = subscriptions.data[0];
    res.json({
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: sub.current_period_end,
      tier: user.memberTier
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Deposit checkout — $20 booking confirmation ──────────────────
router.post('/deposit-checkout', authenticate, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { requestId } = req.body;
    const userId = req.user.userId || req.user.id;
    if (!requestId) return res.status(400).json({ error: 'Request ID required' });

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { fullName: true, email: true } } }
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.userId !== userId) return res.status(403).json({ error: 'Unauthorised' });
    if (request.depositPaid) return res.status(400).json({ error: 'Deposit already paid' });
    if (request.status !== 'AWAITING_MEMBER') return res.status(400).json({ error: 'Request not ready for deposit' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: request.user.email,
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Consiere Booking Deposit',
            description: request.title || request.description.substring(0, 80),
          },
          unit_amount: 2000, // $20.00 AUD
        },
        quantity: 1,
      }],
      metadata: { requestId, userId, type: 'deposit' },
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?deposit=success&requestId=' + requestId,
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?deposit=cancelled',
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Vendor bill submission ────────────────────────────────────────
router.post('/vendor-bill', async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { requestId, vendorToken, billAmount } = req.body;
    if (!requestId || !vendorToken || !billAmount) return res.status(400).json({ error: 'Missing fields' });

    const amount = parseFloat(billAmount);
    if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid bill amount' });

    // Verify vendor token matches request
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { email: true, fullName: true } } }
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.depositPaid) return res.status(400).json({ error: 'Deposit not yet paid' });
    if (request.vendorBillAmt) return res.status(400).json({ error: 'Bill already submitted' });

    // Calculate commission and refund — use the accepted vendor's effective rate (referral-aware), not a flat 10%.
    const DEPOSIT = 20;
    let _rate = 10;
    try {
      const _inq = await prisma.vendorInquiry.findFirst({
        where: { requestId, status: { in: ['ACCEPTED','QUOTED','DELIVERED'] } },
        orderBy: { updatedAt: 'desc' }, include: { vendor: true }
      });
      const _v = _inq && _inq.vendor;
      if (_v) _rate = (_v.commissionDiscountUntil && new Date(_v.commissionDiscountUntil) > new Date()) ? 8 : (typeof _v.commissionPct === 'number' ? _v.commissionPct : 10);
    } catch(_e) { console.error('[VENDOR-BILL] rate lookup failed, using 10%:', _e.message); }
    const commission = Math.round(amount * (_rate/100) * 100) / 100;
    const refund = Math.max(0, Math.round((DEPOSIT - commission) * 100) / 100);
    console.log('[VENDOR-BILL] commission', _rate + '% =', commission, 'refund', refund, 'for request', requestId);

    // Update request with bill details
    await prisma.request.update({
      where: { id: requestId },
      data: {
        vendorBillAmt: amount,
        vendorBillSubmittedAt: new Date(),
        commissionAmt: commission,
        refundAmt: refund,
        completedAt: new Date(),
        status: 'COMPLETED',
      }
    });

    // Process refund if applicable
    if (refund > 0 && request.depositSessionId) {
      try {
        // Get payment intent from session
        const session = await stripe.checkout.sessions.retrieve(request.depositSessionId);
        if (session.payment_intent) {
          await stripe.refunds.create({
            payment_intent: session.payment_intent,
            amount: Math.round(refund * 100), // convert to cents
            reason: 'requested_by_customer',
            metadata: { requestId, reason: 'Commission adjustment refund' }
          });
          await prisma.request.update({
            where: { id: requestId },
            data: { depositRefunded: true, depositRefundAmt: refund, refundProcessedAt: new Date() }
          });
          console.log('[REFUND] Processed $' + refund + ' refund for request ' + requestId);
        }
      } catch(refundErr) {
        console.error('[REFUND ERROR]', refundErr.message);
      }
    }

    // Send summary email to admin
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>',
        to: 'hello@consiere.com.au',
        subject: '[Bill Submitted] ' + (request.title || requestId.substring(0,8).toUpperCase()),
        html: '<div style="font-family:Arial;padding:24px"><h2>Vendor Bill Submitted</h2>' +
          '<p><b>Request:</b> ' + (request.title || request.description?.substring(0,60)) + '</p>' +
          '<p><b>Bill amount:</b> $' + amount.toFixed(2) + ' AUD</p>' +
          '<p><b>Consiere commission (10%):</b> $' + commission.toFixed(2) + ' AUD</p>' +
          '<p><b>Deposit paid by client:</b> $20.00 AUD</p>' +
          (refund > 0 ? '<p><b>Refund to client:</b> $' + refund.toFixed(2) + ' AUD ✅ Auto-processed</p>' : '<p><b>No refund required</b> (commission ≥ deposit)</p>') +
          '<p><b>Client pays vendor directly:</b> $' + Math.max(0, amount - DEPOSIT + refund).toFixed(2) + ' AUD</p>' +
          '</div>'
      });
    } catch(emailErr) { console.error('[BILL EMAIL]', emailErr.message); }

    // Send completion email to member
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = (request.user.fullName || 'Member').split(' ')[0];
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>',
        to: request.user.email,
        subject: 'Your booking is complete — ' + (request.title || 'Consiere request'),
        html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
          '<div style="background:#1c1917;padding:24px 32px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div></div>' +
          '<div style="padding:32px">' +
          '<h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 16px">Your booking is complete</h2>' +
          '<p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 16px">Hi ' + firstName + ', your request has been fulfilled.</p>' +
          '<div style="background:#faf8f5;border-radius:8px;padding:16px 20px;margin:0 0 16px">' +
          '<div style="font-size:12px;color:#78716c;margin-bottom:4px">Request</div>' +
          '<div style="font-size:14px;color:#1c1917;font-weight:500">' + (request.title || request.description?.substring(0,60)) + '</div>' +
          '</div>' +
          '<div style="background:#faf8f5;border-radius:8px;padding:16px 20px;margin:0 0 20px">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:13px;color:#78716c">Deposit paid</span><span style="font-size:13px;color:#1c1917">$20.00 AUD</span></div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:13px;color:#78716c">Vendor bill total</span><span style="font-size:13px;color:#1c1917">$' + amount.toFixed(2) + ' AUD</span></div>' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:13px;color:#78716c">Consiere commission</span><span style="font-size:13px;color:#1c1917">$' + commission.toFixed(2) + ' AUD</span></div>' +
          (refund > 0 ? '<div style="display:flex;justify-content:space-between;border-top:1px solid #e8e0d4;padding-top:8px"><span style="font-size:13px;color:#16a34a;font-weight:500">Refund to your card</span><span style="font-size:13px;color:#16a34a;font-weight:500">$' + refund.toFixed(2) + ' AUD</span></div>' : '') +
          '<div style="display:flex;justify-content:space-between;border-top:1px solid #e8e0d4;padding-top:8px"><span style="font-size:13px;color:#78716c">Payable to vendor</span><span style="font-size:13px;color:#1c1917;font-weight:500">$' + Math.max(0, amount - 20 + refund).toFixed(2) + ' AUD</span></div>' +
          '</div>' +
          (refund > 0 ? '<p style="color:#16a34a;font-size:13px;margin:0 0 20px">✓ A refund of $' + refund.toFixed(2) + ' has been automatically processed to your card. Please allow 5-10 business days.</p>' : '') +
          '<div style="text-align:center"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px">View in Portal</a></div>' +
          '</div>' +
          '<div style="background:#faf8f5;padding:16px 32px;border-top:1px solid #e8e0d4;text-align:center"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au · Sydney, Australia</p></div>' +
          '</div>'
      });
    } catch(emailErr) { console.error('[COMPLETE EMAIL]', emailErr.message); }

    res.json({
      success: true,
      billAmount: amount,
      commission,
      refund,
      vendorReceives: Math.max(0, amount - 20 + refund),
      message: refund > 0 ? 'Bill submitted. $' + refund + ' refund auto-processed to client.' : 'Bill submitted. Commission covered by deposit.'
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Get deposit status for a request ─────────────────────────────
router.get('/deposit-status/:requestId', authenticate, async (req, res) => {
  try {
    const request = await prisma.request.findUnique({
      where: { id: req.params.requestId },
      select: { depositPaid: true, depositAmount: true, depositRefunded: true, depositRefundAmt: true, vendorBillAmt: true, commissionAmt: true, refundAmt: true, status: true }
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json(request);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Request details for vendor bill page (public — vendor token auth)
router.get('/request-details/:requestId', async (req, res) => {
  try {
    const request = await prisma.request.findUnique({
      where: { id: req.params.requestId },
      include: { user: { select: { fullName: true } } }
    });
    if (!request || !request.depositPaid) return res.status(404).json({ error: 'Not found' });
    res.json({
      title: request.title,
      description: request.description,
      category: request.category,
      memberName: request.user?.fullName || 'Member',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── International full payment checkout ──────────────────────────────
router.post('/international-checkout', authenticate, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { requestId, quotedAmountAUD } = req.body;
    const userId = req.user.userId || req.user.id;
    if (!requestId || !quotedAmountAUD) return res.status(400).json({ error: 'Request ID and quoted amount required' });

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { fullName: true, email: true } } }
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.isInternational) return res.status(400).json({ error: 'Not an international request' });
    if (request.fullPaymentPaid) return res.status(400).json({ error: 'Already paid' });

    const amountCents = Math.round(parseFloat(quotedAmountAUD) * 100);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: request.user.email,
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Consiere International Service — ' + (request.deliveryCountry || 'International'),
            description: (request.title || request.description || '').substring(0, 100) + ' (includes 20% international service fee)',
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      metadata: { requestId, userId, type: 'international' },
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?intl=success&requestId=' + requestId,
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?intl=cancelled',
    });

    await prisma.request.update({
      where: { id: requestId },
      data: { fullPaymentAmt: parseFloat(quotedAmountAUD), status: 'AWAITING_MEMBER' }
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Get request details for international (admin quotes client) ───────
router.post('/international-quote', authenticate, async (req, res) => {
  try {
    const { requestId, quotedAmountAUD, adminNote } = req.body;
    if (!requestId || !quotedAmountAUD) return res.status(400).json({ error: 'Missing fields' });
    const request = await prisma.request.update({
      where: { id: requestId },
      data: {
        fullPaymentAmt: parseFloat(quotedAmountAUD),
        adminNote: adminNote || null,
        status: 'AWAITING_MEMBER'
      },
      include: { user: { select: { email: true, fullName: true } } }
    });
    // Email client with quote
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = (request.user.fullName || 'Member').split(' ')[0];
      const portalUrl = (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal';
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>',
        to: request.user.email,
        subject: 'Your international request is ready to confirm — ' + (request.title || 'Consiere'),
        html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
          '<div style="background:#1c1917;padding:24px;text-align:center"><div style="color:#b87333;letter-spacing:6px;font-size:10px;text-transform:uppercase">Consiere</div></div>' +
          '<div style="padding:32px">' +
          '<h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 16px">Hi ' + firstName + ', your international request is ready.</h2>' +
          '<p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 20px">Our team has sourced a local provider for your request in <strong>' + (request.deliveryCountry || 'your destination') + '</strong>.</p>' +
          '<div style="background:#faf8f5;border:1px solid #e8e0d4;border-radius:8px;padding:20px;margin:0 0 20px">' +
          '<div style="font-size:12px;color:#78716c;margin-bottom:6px">Service requested</div>' +
          '<div style="font-size:14px;color:#1c1917;font-weight:500;margin-bottom:16px">' + (request.title || request.description || '').substring(0, 100) + '</div>' +
          '<div style="font-size:12px;color:#78716c;margin-bottom:6px">Total amount (AUD)</div>' +
          '<div style="font-size:28px;font-family:Georgia;color:#b87333;font-weight:400">$' + parseFloat(quotedAmountAUD).toFixed(2) + ' AUD</div>' +
          '<div style="font-size:11px;color:#78716c;margin-top:4px">Includes 20% international service fee. No additional charges.</div>' +
          '</div>' +
          (adminNote ? '<div style="background:#fff8f0;border:1px solid rgba(184,115,51,0.2);border-radius:8px;padding:14px;margin:0 0 20px;font-size:13px;color:#44403c"><b>Note from your concierge:</b> ' + adminNote + '</div>' : '') +
          '<div style="text-align:center"><a href="' + portalUrl + '" style="display:inline-block;padding:13px 32px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:7px;font-size:14px">Pay & Confirm in Portal</a></div>' +
          '</div>' +
          '<div style="background:#faf8f5;padding:14px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere &middot; hello@consiere.com.au</p></div>' +
          '</div>'
      });
      console.log('[INTL QUOTE] Email sent to:', request.user.email);
    } catch(emailErr) { console.error('[INTL QUOTE EMAIL]', emailErr.message); }
    res.json({ success: true, request });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Quote acceptance + Stripe checkout ───────────────────────────────
router.post('/quote-checkout', authenticate, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { inquiryId, token } = req.body;
    const userId = req.user.userId || req.user.id;
    if (!inquiryId || !token) return res.status(400).json({ error: 'Missing fields' });

    const inquiry = await prisma.vendorInquiry.findUnique({
      where: { id: inquiryId },
      include: {
        vendor: { select: { name: true } },
        request: { include: { user: { select: { email: true, fullName: true } } } }
      }
    });
    if (!inquiry) return res.status(404).json({ error: 'Quote not found' });
    if (inquiry.quoteToken !== token) return res.status(403).json({ error: 'Invalid token' });
    if (inquiry.paymentPaidAt) return res.status(400).json({ error: 'Already paid' });
    if (!inquiry.quoteAmount) return res.status(400).json({ error: 'No quote amount' });

    // PROCUREMENT = full payment; others = already paid $10 deposit
    const isProcurement = ['PROCUREMENT', 'SHOPPING'].includes(inquiry.request?.category?.toUpperCase());
    const paymentAmount = isProcurement
      ? Math.round(inquiry.quoteAmount * 100)  // 100% for procurement
      : 1000; // $10 deposit for all others (already set at request creation)
    const paymentDesc = isProcurement
      ? 'Full payment — ' + (inquiry.quoteDetails || '').substring(0, 80)
      : '$10 booking deposit — balance paid to vendor on delivery';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: inquiry.request?.user?.email,
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Consiere — ' + (inquiry.request?.title || 'Service').substring(0, 80),
            description: 'Provided by ' + inquiry.vendor?.name + '. ' + paymentDesc,
          },
          unit_amount: paymentAmount,
        },
        quantity: 1,
      }],
      metadata: { inquiryId, userId, type: 'quote_payment' },
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?payment=success&inquiryId=' + inquiryId,
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?payment=cancelled',
    });

    await prisma.vendorInquiry.update({
      where: { id: inquiryId },
      data: { paymentSessionId: session.id, quoteAcceptedAt: new Date(), status: 'ACCEPTED' }
    });
    await prisma.request.update({ where: { id: inquiry.requestId }, data: { status: 'IN_PROGRESS' } }).catch(function(e){console.error("[STRIPE]",e&&e.message||e);});

    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Get quote details for accept page ────────────────────────────────
router.get('/quote-details/:inquiryId', authenticate, async (req, res) => {
  try {
    const inquiry = await prisma.vendorInquiry.findUnique({
      where: { id: req.params.inquiryId },
      include: { vendor: { select: { name: true } }, request: { select: { title: true, description: true } } }
    });
    if (!inquiry) return res.status(404).json({ error: 'Not found' });
    res.json({
      inquiryId: inquiry.id,
      vendorName: inquiry.vendor?.name,
      quoteAmount: inquiry.quoteAmount,
      quoteDetails: inquiry.quoteDetails,
      requestTitle: inquiry.request?.title || inquiry.request?.description?.substring(0,80),
      status: inquiry.status,
      paid: !!inquiry.paymentPaidAt
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


router.get('/my-payments', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const payments = await prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    }).catch(() => []);
    const total = payments.filter(p => p.status === 'PAID').reduce((s,p) => s + p.amount, 0);
    res.json({ payments, totalSpent: total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create checkout for a specific request (Pay Now button)
router.post('/pay-request', authenticate, async (req, res) => {
  try {
    const stripe = getStripe();
    const { requestId, amount, description } = req.body;
    const userId = req.user.userId || req.user.id;
    if (!amount || !description) return res.status(400).json({ error: 'Amount and description required' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'aud', product_data: { name: description, description: 'Arranged by Consiere' }, unit_amount: Math.round(amount * 100) }, quantity: 1 }],
      mode: 'payment',
      customer_email: user.email,
      payment_method_collection: 'always',
      billing_address_collection: 'auto',
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal?payment=cancelled',
      metadata: { requestId: requestId || '', userId, description: description.substring(0,100) }
    });
    // Save pending payment
    await prisma.payment.create({ data: { userId, requestId: requestId || null, stripeSessionId: session.id, amount: parseFloat(amount), description: description.substring(0,200), status: 'PENDING' } }).catch(function(e){console.error("[STRIPE]",e&&e.message||e);});
    console.log('[CIPHER PAY] Checkout created:', session.id, '$'+amount, 'AUD');
    res.json({ url: session.url, sessionId: session.id });
  } catch(e) { console.error('[CIPHER PAY]', e.message); res.status(500).json({ error: e.message }); }
});


module.exports = router;