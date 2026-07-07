'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const adv = require('../services/advanced_automation');
require('dotenv').config();

// ── 34. SUBSCRIPTION PAUSE ────────────────────────────────────────────────
router.post('/subscription/pause', authenticate, async (req, res) => {
  try {
    const { months } = req.body;
    const result = await adv.pauseSubscription(req.user.id, months || 1);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/subscription/resume', authenticate, async (req, res) => {
  try {
    const result = await adv.resumeSubscription(req.user.id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 35. GIFTING ───────────────────────────────────────────────────────────
router.post('/gift/create', authenticate, async (req, res) => {
  try {
    const { toEmail, months } = req.body;
    const result = await adv.createGiftSubscription(req.user.id, toEmail, months || 3);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/gift/redeem', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });
    const result = await adv.redeemGift(code, req.user.id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Gift landing page
router.get('/gift/:code', async (req, res) => {
  const { code } = req.params;
  const gift = await prisma.giftSubscription.findUnique({ where: { code } }).catch(() => null);
  if (!gift || gift.redeemed) {
    return res.send('<html><body style="font-family:Georgia;text-align:center;padding:60px"><h2>' + (gift?.redeemed ? 'This gift has already been redeemed.' : 'Invalid gift code.') + '</h2><a href="/">Return to Consiere</a></body></html>');
  }
  res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>You have a gift — Consiere</title>
<style>
body{font-family:Georgia,serif;background:#f8f4ef;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.card{background:#fff;border-radius:16px;padding:48px 40px;max-width:440px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.08)}
.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;margin-bottom:20px;font-family:Arial,sans-serif}
h1{font-size:28px;color:#1a1612;margin:0 0 8px}
p{color:#78716c;font-size:14px;margin:0 0 28px;font-family:Arial,sans-serif;line-height:1.6}
.gift-badge{background:#1a1612;color:#c9a96e;border-radius:12px;padding:20px;margin-bottom:28px}
.gift-months{font-size:40px;font-weight:700;color:#c9a96e}
.gift-label{font-size:12px;letter-spacing:2px;color:#999;font-family:Arial,sans-serif;margin-top:4px}
.btn{display:block;background:#c9a96e;color:#1a1612;padding:16px;border-radius:100px;text-decoration:none;font-weight:700;font-size:15px;font-family:Arial,sans-serif;margin-top:8px}
.sub{font-size:12px;color:#78716c;margin-top:12px;font-family:Arial,sans-serif}
</style></head>
<body>
<div class="card">
  <div class="logo">CONSIERE</div>
  <h1>🎁 You have a gift!</h1>
  <p>Someone has gifted you a Consiere subscription. Alina is ready to handle everything for you.</p>
  <div class="gift-badge">
    <div class="gift-months">${gift.months}</div>
    <div class="gift-label">MONTHS FREE</div>
  </div>
  <a class="btn" href="/signup?gift=${code}">Claim your gift →</a>
  <div class="sub">Already have an account? <a href="/cc-portal?gift=${code}" style="color:#c9a96e">Sign in to redeem</a></div>
</div>
</body></html>`);
});

// ── 37. CP PRE-APPROVAL ───────────────────────────────────────────────────
router.post('/cp/preapprove/limit', authenticate, async (req, res) => {
  try {
    const { limit } = req.body;
    if (!limit || limit < 0) return res.status(400).json({ error: 'Valid limit required' });
    await prisma.user.update({ where: { id: req.user.id }, data: { cpPreApproveLimit: parseFloat(limit) } });
    res.json({ success: true, limit });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 40. AFFILIATE PROGRAM ─────────────────────────────────────────────────
router.post('/affiliate/create', async (req, res) => {
  try {
    const { email, name, commissionPct } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'Email and name required' });
    const result = await adv.createAffiliateLink(email, name, commissionPct);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/affiliate/:code/stats', async (req, res) => {
  try {
    const aff = await prisma.affiliateLink.findUnique({ where: { code: req.params.code } });
    if (!aff) return res.status(404).json({ error: 'Not found' });
    const commission = aff.totalRevenue * (aff.commissionPct / 100);
    res.json({ ...aff, estimatedCommission: commission });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 41. POSTCODE ──────────────────────────────────────────────────────────
router.get('/postcodes/report', authenticate, async (req, res) => {
  try {
    const report = await adv.getPostcodeReport();
    res.json(report);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 46. CURRENCY CONVERSION ───────────────────────────────────────────────
router.get('/fx/convert', async (req, res) => {
  try {
    const { amount, currency } = req.query;
    const result = await adv.convertToCurrency(parseFloat(amount||100), currency||'USD');
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/fx/rates', async (req, res) => {
  try {
    const rates = await adv.getFxRates();
    res.json({ rates, base: 'AUD' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 47. DEMAND HEATMAP (ADMIN) ────────────────────────────────────────────
router.get('/demand/heatmap', authenticate, async (req, res) => {
  try {
    const report = await adv.runDemandHeatmapReport();
    res.json(report);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 49. CHURN SCORES (ADMIN) ──────────────────────────────────────────────
router.get('/churn/report', authenticate, async (req, res) => {
  try {
    const highRisk = await prisma.user.findMany({
      where: { churnRiskScore: { gte: 70 }, isActive: true, role: 'MEMBER' },
      select: { id: true, fullName: true, email: true, churnRiskScore: true, memberTier: true },
      orderBy: { churnRiskScore: 'desc' },
      take: 20
    });
    res.json({ highRisk, count: highRisk.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 50. REVENUE FORECAST (ADMIN) ─────────────────────────────────────────
router.get('/revenue/forecast', authenticate, async (req, res) => {
  try {
    const forecast = await adv.runRevenueForecast();
    res.json(forecast);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
