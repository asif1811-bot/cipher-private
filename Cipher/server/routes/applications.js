'use strict';

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { sendApplicationReceivedEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

// ── POST /api/applications ───────────────────────────────────────────────────
// Public — no auth required
router.post('/', async (req, res) => {
  try {
    const { fullName, email, phone, tier, referral } = req.body;

    if (!fullName || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const validTiers = ['CIPHER', 'CIPHER_BLACK', 'CIPHER_SOVEREIGN'];

    const application = await prisma.application.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        phone: phone || null,
        tier: validTiers.includes(tier) ? tier : 'CIPHER',
        referral: referral || null,
      },
    });

    // Send confirmation email
    sendApplicationReceivedEmail(application).catch(err =>
      logger.error('Failed to send application email', { error: err.message })
    );

    logger.info(`New application received from ${email}`);
    res.status(201).json({ message: 'Application received', id: application.id });
  } catch (err) {
    logger.error('Application error', { error: err.message });
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

module.exports = router;
