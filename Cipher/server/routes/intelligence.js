'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const il = require('../services/intelligence_layer');
require('dotenv').config();

// ── MEMORY ────────────────────────────────────────────────────────────────
router.get('/memory', authenticate, async (req, res) => {
  try {
    const memory = await il.getMemory(req.user.id);
    res.json({ memory });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/memory', authenticate, async (req, res) => {
  try {
    const updated = await il.updateMemory(req.user.id, req.body);
    res.json({ success: true, memory: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TEMPLATES ─────────────────────────────────────────────────────────────
router.get('/templates', authenticate, async (req, res) => {
  try {
    const templates = await il.getUserTemplates(req.user.id);
    res.json({ templates });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/templates', authenticate, async (req, res) => {
  try {
    const { name, description, category } = req.body;
    if (!name || !description) return res.status(400).json({ error: 'Name and description required' });
    const cat = category || (await il.autoCategories(description)).category;
    const result = await il.saveRequestTemplate(req.user.id, name, description, cat);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/templates/:id/use', authenticate, async (req, res) => {
  try {
    const template = await il.useTemplate(req.params.id);
    res.json({ success: true, template });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WALLET ────────────────────────────────────────────────────────────────
router.get('/wallet', authenticate, async (req, res) => {
  try {
    const balance = await il.getWalletBalance(req.user.id);
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 20
    });
    res.json({ balance, transactions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/wallet/debit', authenticate, async (req, res) => {
  try {
    const { amount, description } = req.body;
    const result = await il.walletDebit(req.user.id, parseFloat(amount), description);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GOOGLE VENDOR LEADS (ADMIN) ───────────────────────────────────────────
router.get('/vendor-leads', async (req, res) => {
  try {
    const leads = await prisma.googleVendorLead.findMany({
      orderBy: [{ googleRating: 'desc' }, { createdAt: 'desc' }], take: 50
    });
    res.json({ leads, total: leads.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/vendor-leads/search', async (req, res) => { // no auth — called internally
  try {
    const { category, city, country } = req.body;
    if (!category || !city) return res.status(400).json({ error: 'Category and city required' });
    const leads = await il.findGoogleVendors(category, city, country || 'Australia');
    res.json({ leads, found: leads.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/vendor-leads/:id/register', authenticate, async (req, res) => {
  try {
    await prisma.googleVendorLead.update({
      where: { id: req.params.id },
      data: { status: 'REGISTERED', registeredAt: new Date() }
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUTO-CATEGORISE ───────────────────────────────────────────────────────
router.post('/categorise', async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: 'Description required' });
    const result = await il.autoCategories(description);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FRAUD FLAGS (ADMIN) ───────────────────────────────────────────────────
router.get('/fraud-flags', authenticate, async (req, res) => {
  try {
    const flags = await prisma.fraudFlag.findMany({
      where: { resolved: false }, orderBy: { createdAt: 'desc' }, take: 30
    });
    res.json({ flags, count: flags.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/fraud-flags/:id/resolve', authenticate, async (req, res) => {
  try {
    await prisma.fraudFlag.update({ where: { id: req.params.id }, data: { resolved: true } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WHITE-LABEL API ───────────────────────────────────────────────────────
router.post('/wl/request', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const { member, request: requestText } = req.body;
    if (!apiKey) return res.status(401).json({ error: 'API key required' });
    if (!requestText) return res.status(400).json({ error: 'Request text required' });
    const result = await il.processWhiteLabelRequest(apiKey, member||{}, requestText);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SMART VENDOR RANKING ──────────────────────────────────────────────────
router.post('/vendor-ranking', authenticate, async (req, res) => {
  try {
    const { category, location, description } = req.body;
    const ranked = await il.getSmartVendorRanking(category, location, description);
    res.json({ vendors: ranked.slice(0,10).map(v => ({ id:v.id, name:v.name, score:v.smartScore, rating:v.rating })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
