'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const w8 = require('../services/wave8_automation');
require('dotenv').config();

// ── 89. MARKETPLACE ───────────────────────────────────────────────────────
router.get('/marketplace', async (req, res) => {
  try { res.json({ listings: await w8.getMarketplaceListings(req.query.category) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/marketplace', authenticate, async (req, res) => {
  try {
    const { title, description, category, price, isFree } = req.body;
    if (!title||!description||!category) return res.status(400).json({ error: 'Missing fields' });
    res.json(await w8.createMemberListing(req.user.id, title, description, category, price, isFree));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/marketplace/:id/book', authenticate, async (req, res) => {
  try { res.json(await w8.bookMarketplaceListing(req.params.id, req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 90. EXPERIENCES ───────────────────────────────────────────────────────
router.post('/experiences', authenticate, async (req, res) => {
  try {
    const { title, description, category, price, maxGuests, eventDate, location } = req.body;
    if (!title||!price||!eventDate||!location) return res.status(400).json({ error: 'Missing fields' });
    res.json(await w8.createExperience(title, description||'', category||'EVENTS', price, maxGuests, eventDate, location));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/experiences', async (req, res) => {
  try {
    const exps = await prisma.consiergeExperience.findMany({
      where: { isActive: true, eventDate: { gte: new Date() } },
      orderBy: { eventDate: 'asc' }
    });
    res.json({ experiences: exps });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 91. WAITLIST PRIORITY ─────────────────────────────────────────────────
router.get('/waitlist/priority/:id', async (req, res) => {
  try {
    const result = await w8.chargeWaitlistPriority(req.params.id);
    if (result.success) res.redirect(result.url);
    else res.status(400).json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 92. FAMILY PLAN ───────────────────────────────────────────────────────
router.post('/family/subscribe', authenticate, async (req, res) => {
  try { res.json(await w8.subscribeFamilyPlan(req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 93. SUCCESSION ────────────────────────────────────────────────────────
router.post('/succession', authenticate, async (req, res) => {
  try {
    const { successorName, successorPhone, successorEmail } = req.body;
    if (!successorName||!successorPhone) return res.status(400).json({ error: 'Successor name and phone required' });
    res.json(await w8.setSuccessor(req.user.id, successorName, successorPhone, successorEmail));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 94. ASSET CONCIERGE ───────────────────────────────────────────────────
router.get('/assets', authenticate, async (req, res) => {
  try {
    const assets = await prisma.assetRecord.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
    res.json({ assets });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/assets', authenticate, async (req, res) => {
  try {
    const { assetType, assetName, notes, nextServiceDate } = req.body;
    if (!assetType||!assetName) return res.status(400).json({ error: 'Asset type and name required' });
    res.json(await w8.addAssetRecord(req.user.id, assetType, assetName, notes, nextServiceDate));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 96. COMMISSION RATE ───────────────────────────────────────────────────
router.get('/vendor/:id/commission', authenticate, async (req, res) => {
  try { res.json(await w8.getVendorCommissionRate(req.params.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 98. ANNUAL PLAN ───────────────────────────────────────────────────────
router.post('/annual/subscribe', authenticate, async (req, res) => {
  try { res.json(await w8.subscribeAnnualPlan(req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 100. NL ANALYTICS ────────────────────────────────────────────────────
router.post('/analytics/ask', authenticate, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question required' });
    res.json(await w8.nlAnalyticsQuery(question));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 101. PR RELEASES ──────────────────────────────────────────────────────
router.get('/pr-releases', authenticate, async (req, res) => {
  try {
    const releases = await prisma.pRRelease.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ releases });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.patch('/pr-releases/:id/approve', authenticate, async (req, res) => {
  try {
    await prisma.pRRelease.update({ where: { id: req.params.id }, data: { status: 'APPROVED', sentAt: new Date() } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 102. NPS ──────────────────────────────────────────────────────────────
router.get('/nps/stats', authenticate, async (req, res) => {
  try {
    const responses = await prisma.nPSResponse.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const avg = responses.length ? responses.reduce((s,r)=>s+r.score,0)/responses.length : 0;
    const promoters = responses.filter(r=>r.score>=9).length;
    const detractors = responses.filter(r=>r.score<=6).length;
    const nps = responses.length ? Math.round(((promoters-detractors)/responses.length)*100) : 0;
    res.json({ nps, avg: avg.toFixed(1), promoters, detractors, total: responses.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 103. ALINA STYLE ──────────────────────────────────────────────────────
router.post('/alina-style', authenticate, async (req, res) => {
  try {
    const { style } = req.body;
    if (!style) return res.status(400).json({ error: 'Style required. Options: FRIENDLY, FORMAL, BRIEF, DETAILED, CASUAL' });
    res.json(await w8.updateAlinaStyle(req.user.id, style));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/alina-style', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { alinaStyle: true } });
    res.json({ style: user?.alinaStyle || 'FRIENDLY' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 104. CASE STUDIES ─────────────────────────────────────────────────────
router.get('/case-studies', async (req, res) => {
  try {
    const studies = await prisma.caseStudy.findMany({ where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' } });
    res.json({ studies });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/case-studies/drafts', authenticate, async (req, res) => {
  try {
    const drafts = await prisma.caseStudy.findMany({ where: { status: 'DRAFT' }, orderBy: { createdAt: 'desc' } });
    res.json({ drafts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.patch('/case-studies/:id/approve', authenticate, async (req, res) => {
  try {
    await prisma.caseStudy.update({ where: { id: req.params.id }, data: { status: 'APPROVED' } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
