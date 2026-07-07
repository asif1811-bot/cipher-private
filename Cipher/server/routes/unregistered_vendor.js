'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const uv = require('../services/unregistered_vendor');
require('dotenv').config();

const CC_URL = process.env.CC_URL || 'https://consiere.com.au';

// ── VENDOR REGISTRATION PAGE ──────────────────────────────────────────────
router.get('/vendor-register', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/vendors');
  const ctx = await uv.getRegistrationContext(token);
  if (!ctx.valid) {
    const reason = ctx.reason === 'expired'
      ? 'Sorry — the registration window for this job has expired. You were ' + (ctx.minutesExpired||0) + ' minutes too late.'
      : ctx.reason === 'Already registered' ? 'You have already registered for this request.'
      : 'This registration link is invalid.';
    return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Registration Expired — Consiere</title>
<style>body{font-family:Georgia,serif;background:#f8f4ef;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.card{background:#fff;border-radius:16px;padding:48px 40px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;margin-bottom:20px;font-family:Arial,sans-serif}
h2{color:#1a1612;margin:0 0 12px}p{color:#78716c;font-family:Arial,sans-serif;font-size:14px}
.btn{display:inline-block;background:#c9a96e;color:#1a1612;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;margin-top:20px}</style>
</head><body><div class="card">
<div class="logo">CONSIERE</div>
<h2>⏰ ${reason}</h2>
<p>Want to join the Consiere vendor network and receive future job requests?</p>
<a class="btn" href="${CC_URL}/vendors">Apply as a Vendor →</a>
</div></body></html>`);
  }

  // Show registration form
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Register & Accept Job — Consiere</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;background:#f8f4ef;margin:0;padding:20px;min-height:100vh}
.card{background:#fff;border-radius:16px;padding:40px;max-width:560px;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;margin-bottom:8px;font-weight:700}
h2{color:#1a1612;margin:0 0 4px;font-size:22px;font-family:Georgia,serif}
.subtitle{color:#78716c;font-size:13px;margin-bottom:24px}
.job-box{background:#1a1612;color:#fff;border-radius:12px;padding:20px;margin-bottom:24px}
.job-label{font-size:10px;letter-spacing:2px;color:#c9a96e;margin-bottom:6px}
.job-cat{font-size:18px;font-weight:700;color:#c9a96e;font-family:Georgia,serif}
.job-desc{font-size:13px;color:#ccc;margin-top:6px}
.timer-bar{background:#fff3cd;border:1px solid #c9a96e;border-radius:8px;padding:12px 16px;margin-bottom:24px;font-size:13px;color:#856404;display:flex;align-items:center;gap:8px}
.rating{display:inline-block;background:#f8f4ef;border-radius:100px;padding:4px 12px;font-size:12px;color:#c9a96e;font-weight:700;margin-bottom:20px}
label{display:block;font-size:12px;font-weight:700;color:#44403c;letter-spacing:0.5px;margin-bottom:5px;margin-top:14px}
input,textarea{width:100%;border:1px solid #e8e0d8;border-radius:8px;padding:12px 14px;font-size:14px;color:#1a1612;outline:none;transition:border 0.2s;font-family:Arial,sans-serif}
input:focus,textarea:focus{border-color:#c9a96e}
textarea{height:80px;resize:vertical}
.btn{display:block;width:100%;background:#c9a96e;color:#1a1612;border:none;padding:16px;border-radius:100px;font-size:16px;font-weight:700;cursor:pointer;margin-top:24px;font-family:Arial,sans-serif}
.btn:hover{background:#b8945a}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.terms{font-size:11px;color:#78716c;text-align:center;margin-top:16px}
.success{display:none;text-align:center;padding:40px 20px}
.success h3{color:#16a34a;font-size:22px;font-family:Georgia,serif}
.success p{color:#78716c;font-size:14px}
</style>
</head>
<body>
<div class="card">
  <div id="formSection">
    <div class="logo">CONSIERE VENDOR NETWORK</div>
    <h2>Register & Accept This Job</h2>
    <div class="subtitle">Complete your free registration to accept this pending job request.</div>
    <div class="rating">⭐ ${ctx.googleRating} Google Rating — selected as top vendor</div>
    <div class="job-box">
      <div class="job-label">PENDING JOB REQUEST</div>
      <div class="job-cat">${ctx.requestCategory}</div>
      <div class="job-desc">${(ctx.requestDescription||'').substr(0,150)}</div>
    </div>
    <div class="timer-bar">
      ⏰ <span id="timerText">You have <strong>${ctx.minutesLeft} minutes</strong> to register before this job moves to the next vendor.</span>
    </div>
    <label>Business Name *</label>
    <input type="text" id="businessName" value="${ctx.vendorName||''}" placeholder="Your business name">
    <label>Your Name *</label>
    <input type="text" id="contactName" placeholder="Your full name">
    <label>Email Address *</label>
    <input type="email" id="email" placeholder="your@business.com">
    <label>Phone Number *</label>
    <input type="tel" id="phone" placeholder="+61 4XX XXX XXX">
    <label>Password (for your vendor portal) *</label>
    <input type="password" id="password" placeholder="Choose a password">
    <label>Tell clients about your services</label>
    <textarea id="bio" placeholder="e.g. We are a Sydney-based catering company specialising in..."></textarea>
    <button class="btn" id="submitBtn" onclick="submitReg()">Register & Accept Job →</button>
    <div class="terms">By registering you agree to Consiere's vendor terms. We take 10% commission on completed jobs only. No upfront fees.</div>
  </div>
  <div class="success" id="successSection">
    <div style="font-size:48px;margin-bottom:16px">🎉</div>
    <h3>You're registered!</h3>
    <p>The job has been assigned to you. You'll receive a WhatsApp shortly with the client details and a link to submit your quote.</p>
    <p style="margin-top:16px"><strong>Check your phone for next steps.</strong></p>
  </div>
</div>
<script>
// Countdown timer
let mins = ${ctx.minutesLeft};
let secs = 0;
const timer = setInterval(() => {
  if (secs === 0) { if (mins === 0) { clearInterval(timer); document.getElementById('timerText').innerHTML = '<strong style="color:#dc2626">Registration window has expired.</strong>'; document.getElementById('submitBtn').disabled = true; return; } mins--; secs = 59; } else { secs--; }
  document.getElementById('timerText').innerHTML = 'You have <strong>' + mins + ':' + String(secs).padStart(2,'0') + '</strong> to register before this job moves to the next vendor.';
}, 1000);

async function submitReg() {
  const btn = document.getElementById('submitBtn');
  const bname = document.getElementById('businessName').value.trim();
  const cname = document.getElementById('contactName').value.trim();
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const pass = document.getElementById('password').value.trim();
  if (!bname||!cname||!email||!phone||!pass) { alert('Please fill in all required fields.'); return; }
  if (pass.length < 6) { alert('Password must be at least 6 characters.'); return; }
  btn.disabled = true; btn.textContent = 'Registering...';
  try {
    const r = await fetch('/api/uv/register', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: '${token}', businessName: bname, contactName: cname, email, phone, password: pass, bio: document.getElementById('bio').value, ref: new URLSearchParams(location.search).get('ref') })
    });
    const d = await r.json();
    if (d.success) {
      document.getElementById('formSection').style.display = 'none';
      document.getElementById('successSection').style.display = 'block';
      clearInterval(timer);
    } else {
      btn.disabled = false; btn.textContent = 'Register & Accept Job →';
      alert(d.error || 'Registration failed. Please try again.');
    }
  } catch(e) {
    btn.disabled = false; btn.textContent = 'Register & Accept Job →';
    alert('Something went wrong. Please try again.');
  }
}
</script>
</body></html>`);
});

// ── SUBMIT REGISTRATION ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { token, businessName, contactName, email, phone, password, bio, ref } = req.body;
    if (!token||!email||!password) return res.status(400).json({ error: 'Missing required fields' });
    const result = await uv.completeRegistrationAndAssign(token, { businessName, contactName, email, phone, password, bio, referredBy: ref || null });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: VIEW UNREGISTERED LEADS ────────────────────────────────────────
router.get('/leads', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const leads = await uv.getUnregisteredVendorLeads(status);
    res.json({ leads, total: leads.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: MANUALLY TRIGGER OUTREACH ─────────────────────────────────────
router.post('/outreach', authenticate, async (req, res) => {
  try {
    const { requestId, category, city, country, description } = req.body;
    if (!requestId||!category) return res.status(400).json({ error: 'requestId and category required' });
    const count = await uv.findAndOutreachUnregisteredVendors(requestId, description||'', category, city||'Sydney', country||'Australia');
    res.json({ success: true, outreached: count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
