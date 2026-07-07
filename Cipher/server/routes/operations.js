'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const ops = require('../services/operations_engine');
require('dotenv').config();

// ── 150. CANCELLATION ─────────────────────────────────────────────────────
router.post('/cancel/:requestId', authenticate, async (req, res) => {
  try {
    const result = await ops.processCancellation(req.params.requestId, req.user.id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 151. TESTIMONIALS ─────────────────────────────────────────────────────
router.get('/testimonials', async (req, res) => {
  try {
    const testimonials = await ops.getTestimonials(20);
    res.json({ testimonials });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Public testimonials page
router.get('/testimonials/page', async (req, res) => {
  try {
    const testimonials = await ops.getTestimonials(30);
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Member Stories — Consiere</title>
<style>
body{font-family:Georgia,serif;background:#f8f4ef;margin:0;padding:40px 20px}
.container{max-width:800px;margin:0 auto}
.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;font-family:Arial,sans-serif;font-weight:700;margin-bottom:8px}
h1{font-size:32px;color:#1a1612;margin:0 0 8px}
.subtitle{color:#78716c;font-size:15px;font-family:Arial,sans-serif;margin-bottom:40px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}
.card{background:#fff;border-radius:16px;padding:28px;box-shadow:0 2px 16px rgba(0,0,0,0.06)}
.stars{color:#c9a96e;font-size:18px;margin-bottom:12px}
.text{font-size:15px;color:#44403c;line-height:1.7;font-style:italic}
.cat{font-size:11px;letter-spacing:2px;color:#c9a96e;font-family:Arial,sans-serif;font-weight:700;margin-top:16px}
</style></head>
<body><div class="container">
<div class="logo">CONSIERE</div>
<h1>Member Stories</h1>
<div class="subtitle">Real experiences. Anonymised. Handled by Alina.</div>
<div class="grid">
${testimonials.map(t => `<div class="card">
  <div class="stars">★★★★★</div>
  <div class="text">"${t.content}"</div>
  <div class="cat">${t.hashtags || 'CONCIERGE'}</div>
</div>`).join('')}
${testimonials.length === 0 ? '<div class="card"><div class="stars">★★★★★</div><div class="text">"Alina sorted a last-minute dinner for 8 in Sydney CBD on a Friday night. Had it confirmed in 4 minutes."</div><div class="cat">DINING</div></div>' : ''}
</div>
</div></body></html>`);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 156. HEALTH CHECK (ADMIN) ─────────────────────────────────────────────
router.get('/health-check', authenticate, async (req, res) => {
  try {
    const result = await ops.runDailyHealthCheck();
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
