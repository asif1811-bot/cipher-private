'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const {
  handleDispute,
  processVendorRating,
  triggerUpsell,
  triggerReferralPrompt,
  sendVendorRatingRequest,
  getDynamicMarkup,
  prioritiseQueue
} = require('../services/automation_engine');
require('dotenv').config();

// ── VENDOR RATING ─────────────────────────────────────────────────────────
// Client submits rating via WhatsApp reply or web
router.post('/rate/:requestId', async (req, res) => {
  try {
    const { rating, userId } = req.body;
    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
    await processVendorRating(req.params.requestId, r, userId);
    res.json({ success: true, message: 'Thank you for your rating!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Rating page (served as HTML for WhatsApp link)
router.get('/rate/:requestId', async (req, res) => {
  const { requestId } = req.params;
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rate your experience — Consiere</title>
<style>
body{font-family:Georgia,serif;background:#f8f4ef;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.card{background:#fff;border-radius:16px;padding:40px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.logo{font-size:28px;color:#c9a96e;margin-bottom:8px}
h2{font-size:20px;color:#1a1612;margin:0 0 8px}
p{color:#78716c;font-size:13px;margin:0 0 28px}
.stars{display:flex;gap:12px;justify-content:center;margin-bottom:24px}
.star{font-size:40px;cursor:pointer;transition:transform 0.15s;filter:grayscale(1)}
.star:hover,.star.active{filter:none;transform:scale(1.15)}
.btn{background:#c9a96e;color:#1a1612;border:none;padding:14px 32px;border-radius:100px;font-size:15px;font-weight:600;cursor:pointer;width:100%}
.btn:hover{background:#b8763b}
.thanks{display:none;color:#16a34a;font-size:16px;margin-top:16px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">✦</div>
  <h2>How was your experience?</h2>
  <p>Rate your service from Consiere</p>
  <div class="stars">
    <span class="star" data-r="1">⭐</span>
    <span class="star" data-r="2">⭐</span>
    <span class="star" data-r="3">⭐</span>
    <span class="star" data-r="4">⭐</span>
    <span class="star" data-r="5">⭐</span>
  </div>
  <button class="btn" id="submit" disabled>Submit Rating</button>
  <div class="thanks" id="thanks">✅ Thank you! Your feedback helps us improve.</div>
</div>
<script>
var selected = 0;
document.querySelectorAll('.star').forEach(function(s){
  s.addEventListener('click', function(){
    selected = parseInt(this.dataset.r);
    document.querySelectorAll('.star').forEach(function(x,i){ x.classList.toggle('active', i < selected); });
    document.getElementById('submit').disabled = false;
  });
});
document.getElementById('submit').addEventListener('click', function(){
  if (!selected) return;
  this.textContent = 'Submitting...';
  this.disabled = true;
  fetch('/api/auto/rate/${requestId}', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:selected})})
    .then(function(){ document.getElementById('thanks').style.display='block'; document.getElementById('submit').style.display='none'; })
    .catch(function(){ document.getElementById('submit').textContent = 'Try again'; document.getElementById('submit').disabled = false; });
});
</script>
</body>
</html>`);
});

// ── DISPUTE / CANCELLATION ────────────────────────────────────────────────
router.post('/dispute/:requestId', authenticate, async (req, res) => {
  try {
    const { reason } = req.body; // 'cancel' or 'complaint'
    const result = await handleDispute(req.params.requestId, req.user.id, reason);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// WhatsApp-triggered cancellation (no auth — uses phone verification)
router.post('/cancel-wa', async (req, res) => {
  try {
    const { requestId, phone } = req.body;
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: true }
    });
    if (!request) return res.status(404).json({ error: 'Not found' });
    // Verify phone matches
    const userPhone = request.user?.phone || (request.user?.email?.includes('@whatsapp.cipher') ? '+' + request.user.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
    if (userPhone !== phone) return res.status(403).json({ error: 'Phone mismatch' });
    const result = await handleDispute(requestId, request.userId, 'cancel');
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DYNAMIC PRICING ───────────────────────────────────────────────────────
router.get('/pricing-markup', (req, res) => {
  const { category, time } = req.query;
  const markup = getDynamicMarkup(category || 'general', time ? new Date(time) : new Date());
  res.json({ markup, description: markup > 0 ? 'Peak pricing applies (+' + markup + '%)' : 'Standard pricing' });
});

// ── QUEUE PRIORITY ────────────────────────────────────────────────────────
router.post('/queue/prioritise', authenticate, async (req, res) => {
  try {
    const pending = await prisma.request.findMany({
      where: { status: { in: ['PENDING', 'DISPATCHED'] } },
      orderBy: { createdAt: 'asc' }
    });
    const prioritised = await prioritiseQueue(pending);
    res.json({ queue: prioritised.map(r => ({ id: r.id, description: r.description, userId: r.userId, status: r.status })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── B2B AUTO-QUALIFICATION ────────────────────────────────────────────────
router.post('/b2b/qualify', async (req, res) => {
  try {
    const { companyName, email, phone, employees, industry, message } = req.body;
    if (!email || !companyName) return res.status(400).json({ error: 'Company name and email required' });

    // Score the lead
    let score = 0;
    if (employees >= 50) score += 3;
    else if (employees >= 10) score += 2;
    else score += 1;

    const premiumIndustries = ['finance', 'law', 'real estate', 'construction', 'medical', 'hospitality'];
    if (premiumIndustries.some(i => (industry||'').toLowerCase().includes(i))) score += 2;

    const tier = score >= 4 ? 'ENTERPRISE' : score >= 2 ? 'SME' : 'STARTER';

    // Send personalised response
    const { sendWA } = require('../services/whatsapp_notifications');
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Email the B2B deck
    await resend.emails.send({
      from: 'Consiere Business <hello@consiere.com.au>',
      to: email,
      subject: 'Consiere for ' + companyName + ' — Corporate Concierge',
      html: `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h2 style="color:#1a1612">Hi ${companyName},</h2>
          <p style="color:#44403c;line-height:1.7">Thank you for your interest in Consiere Corporate. We have reviewed your enquiry and prepared information for your team.</p>
          <p style="color:#44403c;line-height:1.7">As a <strong>${tier}</strong> account, your team would receive:</p>
          <ul style="color:#44403c;line-height:2">
            <li>Dedicated corporate account manager</li>
            <li>Team dashboard with usage reports</li>
            <li>Priority handling for all requests</li>
            <li>Custom billing and invoicing</li>
            <li>Up to ${tier === 'ENTERPRISE' ? '50' : tier === 'SME' ? '15' : '5'} team members</li>
          </ul>
          <p style="color:#44403c;line-height:1.7">To discuss pricing and a custom plan, please book a call:</p>
          <a href="https://calendly.com/consiere/corporate" style="display:inline-block;background:#c9a96e;color:#1a1612;padding:14px 28px;border-radius:100px;text-decoration:none;font-weight:600;margin:16px 0">Book a 15-min call</a>
          <p style="color:#78716c;font-size:12px;margin-top:32px">Consiere — Your life, handled.<br>hello@consiere.com.au | consiere.com.au</p>
        </div>`
    });

    // Notify Asif
    await sendWA('+61413536700',
      '🏢 *New B2B enquiry — ' + tier + '*\n\nCompany: ' + companyName + '\nEmail: ' + email + '\nPhone: ' + (phone||'—') + '\nEmployees: ' + (employees||'?') + '\nIndustry: ' + (industry||'?') + '\nScore: ' + score + '/5\n\nDeck sent automatically.'
    );

    res.json({ success: true, tier, score, message: 'Deck sent to ' + email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
