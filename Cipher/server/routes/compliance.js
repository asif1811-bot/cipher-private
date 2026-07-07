'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const ce = require('../services/compliance_engine');
require('dotenv').config();

// ── 143. TERMS ACCEPTANCE ─────────────────────────────────────────────────
router.post('/terms/accept', async (req, res) => {
  try {
    const { userId, vendorId, type } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    if (!type) return res.status(400).json({ error: 'Type required' });
    const result = await ce.recordTermsAcceptance(userId||null, vendorId||null, type, ip, ua);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/terms/check', authenticate, async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) return res.status(400).json({ error: 'Type required' });
    const result = await ce.checkTermsAccepted(req.user.id, null, type);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/terms/history', authenticate, async (req, res) => {
  try {
    const history = await ce.getTermsAcceptanceHistory(req.user.id, null);
    res.json({ history });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TERMS PAGES (Legal) ───────────────────────────────────────────────────
router.get('/terms-of-service', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terms of Service — Consiere</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1612;line-height:1.8}
h1{font-size:28px;margin-bottom:4px}.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;font-family:Arial,sans-serif;font-weight:700}
h2{font-size:16px;margin-top:32px;font-family:Arial,sans-serif}p,li{font-size:14px;color:#44403c}
.version{font-size:11px;color:#78716c;font-family:Arial,sans-serif}</style></head>
<body>
<div class="logo">CONSIERE</div>
<h1>Terms of Service</h1>
<div class="version">Version ${ce.CURRENT_TERMS_VERSION} — Last updated: June 2025</div>
<h2>1. Service Description</h2>
<p>Consiere is an AI-powered personal concierge platform operated by Cipher Concierge Group Pty Ltd (ACN: [INSERT ACN], ABN: [INSERT ABN]), Sydney, Australia. The platform connects members with service vendors via an AI assistant.</p>
<h2>2. Membership</h2>
<p>Memberships are available on monthly or annual subscription plans. Subscriptions auto-renew unless cancelled. Free request credits do not carry cash value and expire as stated.</p>
<h2>3. Payments & Refunds</h2>
<p>All payments are processed via Stripe. A $20 deposit is required to confirm bookings. Refunds are available on the first two requests per member. Subsequent refunds are at our discretion.</p>
<h2>4. Vendor Services</h2>
<p>Consiere connects members with third-party vendors. We do not guarantee vendor performance but operate a dispute resolution process. Consiere takes a 10% commission on completed bookings.</p>
<h2>5. Privacy</h2>
<p>We collect and process personal data in accordance with our Privacy Policy and Australian Privacy Act 1988. Members may request data export or deletion at any time.</p>
<h2>6. Cipher Private</h2>
<p>Cipher Private membership is by invitation only. Annual fees are non-refundable. Members agree to a strict confidentiality clause regarding service details.</p>
<h2>7. Limitation of Liability</h2>
<p>To the maximum extent permitted by Australian law, Cipher Concierge Group Pty Ltd limits liability to the value of the transaction in dispute.</p>
<h2>8. Contact</h2>
<p>hello@consiere.com.au | Cipher Concierge Group Pty Ltd, Sydney NSW, Australia</p>
</body></html>`);
});

router.get('/privacy-policy', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — Consiere</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1612;line-height:1.8}
h1{font-size:28px;margin-bottom:4px}.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;font-family:Arial,sans-serif;font-weight:700}
h2{font-size:16px;margin-top:32px;font-family:Arial,sans-serif}p,li{font-size:14px;color:#44403c}
.version{font-size:11px;color:#78716c;font-family:Arial,sans-serif}</style></head>
<body>
<div class="logo">CONSIERE</div>
<h1>Privacy Policy</h1>
<div class="version">Version ${ce.CURRENT_TERMS_VERSION} — Last updated: June 2025</div>
<h2>1. Data We Collect</h2>
<p>We collect: name, email, phone number, request history, chat messages, payment information (via Stripe), location data from requests, and AI-generated preference profiles.</p>
<h2>2. How We Use Your Data</h2>
<p>To fulfil service requests, personalise your AI concierge experience, send relevant communications, process payments, and improve our platform.</p>
<h2>3. Data Sharing</h2>
<p>We share necessary information with: service vendors (to fulfil requests), Stripe (payments), Twilio (WhatsApp), Resend (email), Anthropic (AI processing). We never sell your data.</p>
<h2>4. Data Retention</h2>
<p>Account data is retained for 7 years post-closure for tax/legal compliance. Request history is retained for 3 years. Chat messages are retained for 12 months.</p>
<h2>5. Your Rights</h2>
<ul><li>Access your data — request export via your portal</li><li>Correct inaccurate data — email hello@consiere.com.au</li><li>Delete your data — we process within 30 days</li><li>Port your data — available via data export feature</li></ul>
<h2>6. Contact</h2>
<p>Privacy Officer: hello@consiere.com.au | Cipher Concierge Group Pty Ltd, Sydney NSW, Australia</p>
</body></html>`);
});

router.get('/vendor-agreement', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vendor Agreement — Consiere</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1612;line-height:1.8}
h1{font-size:28px;margin-bottom:4px}.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;font-family:Arial,sans-serif;font-weight:700}
h2{font-size:16px;margin-top:32px;font-family:Arial,sans-serif}p,li{font-size:14px;color:#44403c}
.version{font-size:11px;color:#78716c;font-family:Arial,sans-serif}</style></head>
<body>
<div class="logo">CONSIERE</div>
<h1>Vendor Partner Agreement</h1>
<div class="version">Version ${ce.CURRENT_VENDOR_TERMS_VERSION} — Last updated: June 2025</div>
<h2>1. Commission Structure</h2>
<p>Consiere takes a commission on completed jobs: Standard 10%, Silver (>$1K/mo) 9%, Gold (>$5K/mo) 8%, Platinum (>$10K/mo) 6%. Commission is automatically deducted before payment release.</p>
<h2>2. Payment Terms</h2>
<p>Payments are held for 48 hours after service completion, then released automatically to your registered bank account. Tax invoices are auto-generated for every transaction.</p>
<h2>3. Service Standards</h2>
<p>Vendors must: respond to job requests within 15 minutes, maintain a 4.0+ rating, honour quoted prices, complete jobs as described. Failure may result in removal from the network.</p>
<h2>4. Dispute Resolution</h2>
<p>Disputes are handled by Consiere's automated resolution engine. Vendors must respond to dispute requests within 2 hours. Our decision is final for transactions under $500.</p>
<h2>5. Termination</h2>
<p>Either party may terminate with 7 days notice. Outstanding payments will be settled within 14 days. Vendors with active jobs must complete them before termination takes effect.</p>
<h2>6. Contact</h2>
<p>vendors@consiere.com.au | Cipher Concierge Group Pty Ltd, Sydney NSW, Australia</p>
</body></html>`);
});

// ── 144. DISPUTE RESOLUTION ───────────────────────────────────────────────
router.post('/disputes', authenticate, async (req, res) => {
  try {
    const { requestId, paymentId, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    const result = await ce.openDispute(req.user.id, requestId, paymentId, reason);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/disputes/:id/statement', authenticate, async (req, res) => {
  try {
    const { statement } = req.body;
    if (!statement) return res.status(400).json({ error: 'Statement required' });
    const result = await ce.submitDisputeStatement(req.params.id, req.user.id, null, statement);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/disputes/:id', authenticate, async (req, res) => {
  try {
    const dispute = await ce.getDisputeStatus(req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Not found' });
    res.json({ dispute });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/disputes', authenticate, async (req, res) => {
  try {
    const disputes = await prisma.disputeCase.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ disputes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 145. GDPR DATA EXPORT ─────────────────────────────────────────────────
router.post('/gdpr/export', authenticate, async (req, res) => {
  try {
    const result = await ce.requestDataExport(req.user.id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/gdpr/status', authenticate, async (req, res) => {
  try {
    const exports = await prisma.gDPRExport.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    res.json({ exports });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
