'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const w9 = require('../services/wave9_automation');
require('dotenv').config();

// ── 110. VENDOR SHOWCASE ──────────────────────────────────────────────────
router.post('/vendor-showcase/:id/request', authenticate, async (req, res) => {
  try { res.json(await w9.requestShowcaseApproval(req.params.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/vendor-showcase/:id/approve', authenticate, async (req, res) => {
  try { res.json(await w9.approveVendorShowcase(req.params.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/vendor-showcase/:id/reject', authenticate, async (req, res) => {
  try {
    await prisma.vendor.update({ where: { id: req.params.id }, data: { showcaseApproved: false } });
    res.json({ success: true, message: 'Showcase request rejected' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 114. TRAVEL BRIEF ─────────────────────────────────────────────────────
router.post('/travel-brief', authenticate, async (req, res) => {
  try {
    const { requestId, destination } = req.body;
    if (!destination) return res.status(400).json({ error: 'Destination required' });
    const rid = requestId || ('manual-' + Date.now());
    res.json(await w9.generateTravelBrief(rid, req.user.id, destination));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 115. REQUEST DNA ──────────────────────────────────────────────────────
router.get('/dna', authenticate, async (req, res) => {
  try {
    const dna = await prisma.requestDNA.findUnique({ where: { userId: req.user.id } });
    if (!dna) {
      const fresh = await w9.buildRequestDNA(req.user.id);
      return res.json({ dna: fresh });
    }
    res.json({ dna });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 116. VENDOR HEALTH ────────────────────────────────────────────────────
router.get('/vendor-health', authenticate, async (req, res) => {
  try {
    const scores = await prisma.vendorHealthScore.findMany({ orderBy: { overallScore: 'desc' }, take: 20 });
    res.json({ scores });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/vendor-health/:vendorId', authenticate, async (req, res) => {
  try {
    const score = await w9.calculateVendorHealthScore(req.params.vendorId);
    res.json({ score });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 117. API SPEC ─────────────────────────────────────────────────────────
router.get('/api-spec', async (req, res) => {
  try { res.json(w9.getAPIMarketplaceSpec()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 119. CONTENT POSTS ────────────────────────────────────────────────────
router.get('/content-posts', authenticate, async (req, res) => {
  try {
    const posts = await prisma.contentPost.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    res.json({ posts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.patch('/content-posts/:id/approve', authenticate, async (req, res) => {
  try {
    await prisma.contentPost.update({ where: { id: req.params.id }, data: { status: 'APPROVED' } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.delete('/content-posts/:id', authenticate, async (req, res) => {
  try {
    await prisma.contentPost.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
