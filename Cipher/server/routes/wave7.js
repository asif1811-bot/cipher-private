'use strict';
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');
const w7 = require('../services/wave7_automation');
require('dotenv').config();

// ── 69. DYNAMIC PRICING ───────────────────────────────────────────────────
router.get('/pricing', authenticate, async (req, res) => {
  try { res.json(await w7.getDynamicPrice(req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 71. INSURANCE ─────────────────────────────────────────────────────────
router.post('/insurance/subscribe', authenticate, async (req, res) => {
  try { res.json(await w7.subscribeInsurance(req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/insurance/claim', authenticate, async (req, res) => {
  try {
    const { requestId, reason } = req.body;
    res.json(await w7.processInsuranceClaim(req.user.id, requestId, reason));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 72. FLASH DEALS ───────────────────────────────────────────────────────
router.post('/flash-deals', async (req, res) => {
  try {
    const { vendorId, title, description, discount, category, hoursValid, maxBookings } = req.body;
    if (!vendorId||!title||!discount||!category) return res.status(400).json({ error: 'Missing required fields' });
    res.json(await w7.createFlashDeal(vendorId, title, description, discount, category, hoursValid||2, maxBookings||10));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
router.get('/flash-deals', async (req, res) => {
  try { res.json({ deals: await w7.getActiveFlashDeals(req.query.category) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 73. PREMIUM TIER ──────────────────────────────────────────────────────
router.post('/premium/subscribe', authenticate, async (req, res) => {
  try { res.json(await w7.upgradeToPremium(req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 75. CIPHER JOURNAL ────────────────────────────────────────────────────
router.get('/journal', authenticate, async (req, res) => {
  try { res.json({ entries: await w7.getJournalEntries(req.user.id) }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
router.post('/journal', authenticate, async (req, res) => {
  try {
    const { content, type } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });
    res.json(await w7.addJournalEntry(req.user.id, content, type, req.user.role === 'ADMIN' ? 'DIRECTOR' : 'MEMBER'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 76. EMERGENCY LINE ────────────────────────────────────────────────────
router.post('/emergency', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    res.json(await w7.triggerEmergencyAlert(req.user.id, message));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 82. HOTEL WHITE-LABEL ─────────────────────────────────────────────────
router.post('/hotel/register', async (req, res) => {
  try {
    const { hotelName, email, phone, city } = req.body;
    if (!hotelName||!email) return res.status(400).json({ error: 'Hotel name and email required' });
    res.json(await w7.createHotelPartner(hotelName, email, phone, city));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 83. CORPORATE HR ──────────────────────────────────────────────────────
router.post('/hr/onboard', async (req, res) => {
  try {
    const { companyCode, name, email, phone } = req.body;
    if (!email||!name) return res.status(400).json({ error: 'Name and email required' });
    res.json(await w7.onboardCorporateEmployee(companyCode||'', name, email, phone));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 84. REAL ESTATE PARTNER ───────────────────────────────────────────────
router.post('/realestate/register', async (req, res) => {
  try {
    const { agencyName, email, commission } = req.body;
    if (!agencyName||!email) return res.status(400).json({ error: 'Agency name and email required' });
    res.json(await w7.createRealEstatePartner(agencyName, email, commission||29));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 85. AIRPORT WELCOME ───────────────────────────────────────────────────
router.post('/airport/arrival', async (req, res) => {
  try {
    const { userId, airport, flightNumber } = req.body;
    if (!userId||!airport) return res.status(400).json({ error: 'userId and airport required' });
    res.json(await w7.triggerAirportWelcome(userId, airport, flightNumber));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VENDOR WAITLIST ───────────────────────────────────────────────────────
router.post('/vendor-waitlist', async (req, res) => {
  try {
    const { category, city, email, phone, name } = req.body;
    if (!category||!email||!name) return res.status(400).json({ error: 'Missing fields' });
    const entry = await prisma.vendorWaitlist.create({ data: { category, city: city||'Sydney', email, phone: phone||null, name } });
    res.json({ success: true, entry });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
