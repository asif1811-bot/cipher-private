'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { authenticate } = require('../middleware/auth');
const { sendWA } = require('../services/whatsapp_notifications');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';

// ── SERVICE MARKUP (10% on all vendor payments) ───────────────────────────
// Applied automatically in vendor quote flow — stored in quoteAmount
// Client pays quoteAmount * 1.10, vendor receives quoteAmount

// ── 1. REFERRAL PROGRAM ───────────────────────────────────────────────────
// Generate referral link for member
router.get('/referral/link', authenticate, async (req, res) => {
  try {
    let user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.referralCode) {
      const code = 'CC' + Math.random().toString(36).substr(2,6).toUpperCase();
      user = await prisma.user.update({ where: { id: req.user.id }, data: { referralCode: code } });
    }
    const link = CC_URL + '/signup?ref=' + user.referralCode;
    res.json({ code: user.referralCode, link, count: user.referralCount || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Track referral signup
router.post('/referral/track', async (req, res) => {
  try {
    const { code, newUserId } = req.body;
    if (!code || !newUserId) return res.status(400).json({ error: 'Missing params' });
    const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!referrer) return res.status(404).json({ error: 'Invalid referral code' });
    // Give referrer 1 free credit, update count
    await prisma.user.update({
      where: { id: referrer.id },
      data: { credits: { increment: 1 }, referralCount: { increment: 1 } }
    });
    // Give new user 1 free credit
    await prisma.user.update({
      where: { id: newUserId },
      data: { credits: { increment: 1 }, referredBy: referrer.id }
    });
    // Notify referrer via WhatsApp
    const phone = referrer.phone || (referrer.email?.includes('@whatsapp.cipher') ? '+' + referrer.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
    if (phone) {
      await sendWA(phone, '🎉 *Someone joined Consiere using your referral link!*\n\nYou\'ve earned a free request credit. Keep sharing:\n' + CC_URL + '/signup?ref=' + referrer.referralCode);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 2. CREDITS (Pay-as-you-go) ────────────────────────────────────────────
router.get('/credits/balance', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { credits: true } });
    res.json({ credits: user?.credits || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/credits/purchase', authenticate, async (req, res) => {
  try {
    const { pack } = req.body; // '3', '7', '20'
    const prices = { '3': process.env.STRIPE_CREDITS_3, '7': process.env.STRIPE_CREDITS_7, '20': process.env.STRIPE_CREDITS_20 };
    const priceId = prices[pack];
    if (!priceId) return res.status(400).json({ error: 'Invalid pack' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?credits=success&pack=' + pack,
      cancel_url: CC_URL + '/cc-portal',
      customer_email: req.user.email,
      metadata: { type: 'credits_purchase', userId: req.user.id, credits: pack }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 3. CORPORATE / TEAM PLANS ─────────────────────────────────────────────
router.post('/corporate/create', authenticate, async (req, res) => {
  try {
    const { teamName } = req.body;
    if (!teamName) return res.status(400).json({ error: 'Team name required' });
    // Create Stripe subscription
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const cust = await stripe.customers.create({ email: req.user.email, name: req.user.fullName });
      customerId = cust.id;
      await prisma.user.update({ where: { id: req.user.id }, data: { stripeCustomerId: customerId } });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_CORPORATE, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?corporate=success',
      cancel_url: CC_URL + '/cc-portal',
      customer: customerId,
      metadata: { type: 'corporate', userId: req.user.id, teamName }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/corporate/team', authenticate, async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: { OR: [{ ownerId: req.user.id }, { members: { some: { userId: req.user.id } } }] },
      include: { members: { include: { user: { select: { fullName: true, email: true, phone: true } } } } }
    });
    res.json({ team });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/corporate/invite', authenticate, async (req, res) => {
  try {
    const { email } = req.body;
    const team = await prisma.team.findFirst({ where: { ownerId: req.user.id } });
    if (!team) return res.status(404).json({ error: 'No team found' });
    const memberCount = await prisma.teamMember.count({ where: { teamId: team.id } });
    if (memberCount >= team.maxMembers) return res.status(400).json({ error: 'Team is full (max ' + team.maxMembers + ' members)' });
    // Find or flag for invitation
    const invitee = await prisma.user.findUnique({ where: { email } });
    if (invitee) {
      await prisma.teamMember.upsert({ where: { id: invitee.id + team.id }, update: {}, create: { teamId: team.id, userId: invitee.id } });
      await prisma.user.update({ where: { id: invitee.id }, data: { teamId: team.id, memberTier: 'CIPHER_BLACK' } });
    }
    res.json({ success: true, message: invitee ? 'Member added' : 'Invite sent (pending signup)' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 5. CONCIERGE CREDIT WALLET (Retainer) ────────────────────────────────
router.get('/wallet/balance', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { retainerBalance: true } });
    res.json({ balance: user?.retainerBalance || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/topup', authenticate, async (req, res) => {
  try {
    const { amount } = req.body; // 50, 100, 250
    const prices = { 50: process.env.STRIPE_RETAINER_50, 100: process.env.STRIPE_RETAINER_100, 250: process.env.STRIPE_RETAINER_250 };
    const priceId = prices[amount];
    if (!priceId) return res.status(400).json({ error: 'Invalid amount' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?wallet=success&amount=' + amount,
      cancel_url: CC_URL + '/cc-portal',
      customer_email: req.user.email,
      metadata: { type: 'wallet_topup', userId: req.user.id, amount: String(amount) }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 6. BUNDLES ────────────────────────────────────────────────────────────
router.post('/bundle/purchase', authenticate, async (req, res) => {
  try {
    const { bundle } = req.body; // WEDDING, RELOCATION, TRAVEL
    const prices = {
      WEDDING: process.env.STRIPE_BUNDLE_WEDDING,
      RELOCATION: process.env.STRIPE_BUNDLE_RELOCATION,
      TRAVEL: process.env.STRIPE_BUNDLE_TRAVEL
    };
    const bundleDetails = {
      WEDDING: { name: 'Wedding Package', requests: 10, desc: 'Venue, catering, florist, photographer, transport — all coordinated by Alina' },
      RELOCATION: { name: 'Relocation Package', requests: 8, desc: 'Housing, Medicare, TFN, banking, school search, movers — handled end-to-end' },
      TRAVEL: { name: 'Travel Planning Package', requests: 6, desc: 'Flights, hotels, transfers, activities, dining reservations — full trip arranged' }
    };
    const priceId = prices[bundle];
    if (!priceId) return res.status(400).json({ error: 'Invalid bundle' });
    const details = bundleDetails[bundle];
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?bundle=success&type=' + bundle,
      cancel_url: CC_URL + '/cc-portal',
      customer_email: req.user.email,
      metadata: { type: 'bundle_purchase', userId: req.user.id, bundle, requests: String(details.requests) }
    });
    res.json({ url: session.url, details });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 7. CIPHER PRIVATE RETAINER ────────────────────────────────────────────
router.post('/cp/retainer/add', authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount < 1000) return res.status(400).json({ error: 'Minimum retainer $1,000' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'aud', unit_amount: Math.round(amount * 100), product_data: { name: 'Cipher Private Retainer Credit — $' + amount } }, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?retainer=success&amount=' + amount,
      cancel_url: CC_URL + '/cc-portal',
      customer_email: req.user.email,
      metadata: { type: 'cp_retainer', userId: req.user.id, amount: String(amount) }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 8. CIPHER PRIVATE WAITLIST ────────────────────────────────────────────
router.post('/cp/waitlist', async (req, res) => {
  try {
    const { name, email, phone, referredBy, notes } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const existing = await prisma.waitlistEntry.findUnique({ where: { email } }).catch(() => null);
    if (existing) return res.json({ success: true, message: 'Already on waitlist', position: existing.id });
    const entry = await prisma.waitlistEntry.create({
      data: { name, email, phone: phone || null, referredBy: referredBy || null, notes: notes || null, brand: 'CIPHER_PRIVATE' }
    });
    // Notify admin
    await sendWA('+61413536700', '🔔 *New Cipher Private waitlist enquiry*\n\nName: ' + name + '\nEmail: ' + email + '\nPhone: ' + (phone || '—') + '\nNotes: ' + (notes || '—') + '\n\nReview at cc-admin → Waitlist');
    res.json({ success: true, message: 'Added to waitlist', entryId: entry.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/cp/waitlist/count', async (req, res) => {
  try {
    const count = await prisma.waitlistEntry.count({ where: { brand: 'CIPHER_PRIVATE', status: 'PENDING' } });
    res.json({ count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 9. CIPHER PRIVATE MEMBERSHIP ─────────────────────────────────────────
router.post('/cp/subscribe', authenticate, async (req, res) => {
  try {
    const { tier } = req.body; // CIPHER, BLACK, SOVEREIGN
    const prices = {
      CIPHER: process.env.STRIPE_CP_CIPHER,
      BLACK: process.env.STRIPE_CP_BLACK,
      SOVEREIGN: process.env.STRIPE_CP_SOVEREIGN
    };
    const priceId = prices[tier];
    if (!priceId) return res.status(400).json({ error: 'Invalid tier' });
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const cust = await stripe.customers.create({ email: req.user.email, name: req.user.fullName });
      customerId = cust.id;
      await prisma.user.update({ where: { id: req.user.id }, data: { stripeCustomerId: customerId } });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: CC_URL + '/cc-portal?cp_sub=success&tier=' + tier,
      cancel_url: CC_URL + '/cc-portal',
      customer: customerId,
      metadata: { type: 'cp_subscription', userId: req.user.id, tier }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 11. DATA INSIGHTS (B2B) ───────────────────────────────────────────────
router.get('/insights/summary', authenticate, async (req, res) => {
  try {
    // Only for admin
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
    const requests = await prisma.request.findMany({
      select: { category: true, deliveryCountry: true, createdAt: true, status: true },
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
    });
    const byCategory = {};
    const byCountry = {};
    requests.forEach(r => {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      const c = r.deliveryCountry || 'AU';
      byCountry[c] = (byCountry[c] || 0) + 1;
    });
    res.json({ total: requests.length, byCategory, byCountry, period: '30 days' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 12. VENDOR FEATURED PLACEMENT ────────────────────────────────────────
router.post('/vendor/featured/purchase', async (req, res) => {
  try {
    const { vendorId, tier } = req.body; // tier: STANDARD ($99) or PREMIUM ($249)
    const prices = { STANDARD: process.env.STRIPE_VENDOR_FEATURED_STD, PREMIUM: process.env.STRIPE_VENDOR_FEATURED_PREM };
    const priceId = prices[tier];
    if (!priceId) return res.status(400).json({ error: 'Invalid tier' });
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: CC_URL + '/vendor-portal?featured=success',
      cancel_url: CC_URL + '/vendor-portal',
      customer_email: vendor.email,
      metadata: { type: 'vendor_featured', vendorId, tier }
    });
    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 14. STRIPE SAVED CARDS / ONE-TAP PAY ─────────────────────────────────
router.post('/payment/save-card', authenticate, async (req, res) => {
  try {
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const cust = await stripe.customers.create({ email: req.user.email, name: req.user.fullName });
      customerId = cust.id;
      await prisma.user.update({ where: { id: req.user.id }, data: { stripeCustomerId: customerId } });
    }
    const setupSession = await stripe.checkout.sessions.create({
      mode: 'setup', payment_method_types: ['card'],
      customer: customerId,
      success_url: CC_URL + '/cc-portal?card=saved',
      cancel_url: CC_URL + '/cc-portal',
      metadata: { type: 'save_card', userId: req.user.id }
    });
    res.json({ url: setupSession.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// One-tap pay using saved card
router.post('/payment/one-tap', authenticate, async (req, res) => {
  try {
    const { amount, description, inquiryId } = req.body;
    if (!req.user.stripeCustomerId) return res.status(400).json({ error: 'No saved card. Please save a card first.' });
    // Get saved payment method
    const methods = await stripe.paymentMethods.list({ customer: req.user.stripeCustomerId, type: 'card', limit: 1 });
    if (!methods.data.length) return res.status(400).json({ error: 'No saved card found.' });
    const pmId = methods.data[0].id;
    const card = methods.data[0].card;
    // Create payment intent
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), currency: 'aud',
      customer: req.user.stripeCustomerId,
      payment_method: pmId,
      confirm: true, off_session: true,
      description,
      metadata: { userId: req.user.id, inquiryId: inquiryId || '' }
    });
    if (pi.status === 'succeeded') {
      res.json({ success: true, message: 'Payment confirmed', amount, card: card.brand + ' •••• ' + card.last4 });
    } else {
      res.status(400).json({ error: 'Payment failed: ' + pi.status });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get saved card info
router.get('/payment/saved-card', authenticate, async (req, res) => {
  try {
    if (!req.user.stripeCustomerId) return res.json({ card: null });
    const methods = await stripe.paymentMethods.list({ customer: req.user.stripeCustomerId, type: 'card', limit: 1 });
    if (!methods.data.length) return res.json({ card: null });
    const c = methods.data[0].card;
    res.json({ card: { brand: c.brand, last4: c.last4, expMonth: c.exp_month, expYear: c.exp_year } });
  } catch(e) { res.json({ card: null }); }
});

// ── 15. LOYALTY TIER ─────────────────────────────────────────────────────
router.get('/loyalty/status', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { loyaltyTier: true, credits: true, referralCount: true, createdAt: true } });
    const monthsActive = Math.floor((Date.now() - new Date(user.createdAt)) / (30 * 24 * 60 * 60 * 1000));
    const requestCount = await prisma.request.count({ where: { userId: req.user.id } });
    // Auto-upgrade loyalty tier
    let newTier = 'STANDARD';
    if (monthsActive >= 12 || requestCount >= 50 || user.referralCount >= 5) newTier = 'GOLD';
    if (monthsActive >= 24 || requestCount >= 150 || user.referralCount >= 15) newTier = 'PLATINUM';
    if (user.loyaltyTier !== newTier) {
      await prisma.user.update({ where: { id: req.user.id }, data: { loyaltyTier: newTier } });
      // Notify on upgrade
      if (newTier === 'GOLD' && user.loyaltyTier === 'STANDARD') {
        const phone = req.user.phone;
        if (phone) await sendWA(phone, '🌟 *Welcome to Consiere Gold!*\n\nYou\'ve unlocked Gold status — priority handling on all requests and exclusive access.\n\nThis also means you\'re eligible for a personal invitation to *Cipher Private*, our ultra-exclusive tier.\n\nReply "CIPHER" to request an introduction.');
      }
    }
    res.json({ tier: newTier, monthsActive, requestCount, referralCount: user.referralCount, credits: user.credits, perks: {
      STANDARD: ['2 free requests/month', 'Standard response time'],
      GOLD: ['Priority queue', 'Dedicated support', 'Cipher Private eligible', '1 bonus credit/month'],
      PLATINUM: ['Same-day priority', 'Personal account manager', 'Cipher Private invitation', '3 bonus credits/month']
    }[newTier] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WEBHOOK HANDLERS for new payment types ────────────────────────────────
router.post('/webhook/handle', express.raw({ type: 'application/json' }), async (req, res) => {
  // This is called from the main stripe webhook — not directly
  res.json({ ok: true });
});

module.exports = router;
