'use strict';

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { otpLimiter } = require('../middleware/rateLimiter');
const { generateOTP, hashOTP, verifyOTP, decryptFile } = require('../utils/encryption');
const { sendOTPEmail } = require('../utils/email');
const fs = require('fs');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

// ── POST /api/otp/send ───────────────────────────────────────────────────────
// Generate OTP and email the recipient
router.post('/send', authenticate, otpLimiter, async (req, res) => {
  try {
    const { documentId, recipientEmail, expiryHours = 24 } = req.body;

    if (!documentId || !recipientEmail) {
      return res.status(400).json({ error: 'Document ID and recipient email required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({ error: 'Invalid recipient email' });
    }

    // Verify document ownership
    const doc = await prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (req.user.role === 'MEMBER' && doc.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Generate OTP and expiry
    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + Math.min(expiryHours, 168)); // max 7 days

    const otpSend = await prisma.otpSend.create({
      data: {
        documentId,
        userId: req.user.id,
        recipientEmail: recipientEmail.toLowerCase(),
        otpHash,
        expiresAt,
      },
    });

    // Send email
    await sendOTPEmail({
      recipientEmail,
      otp,
      documentName: doc.originalName,
      senderName: req.user.fullName,
      expiresAt,
      accessToken: otpSend.token,
    });

    logger.info(`OTP sent for document ${documentId} to ${recipientEmail} by ${req.user.email}`);

    res.json({
      message: `Secure link and OTP sent to ${recipientEmail}`,
      expiresAt,
      token: otpSend.token,
    });
  } catch (err) {
    logger.error('OTP send error', { error: err.message });
    res.status(500).json({ error: 'Failed to send OTP: ' + err.message });
  }
});

// ── POST /api/otp/verify/:token ──────────────────────────────────────────────
// Recipient verifies OTP and downloads document (no auth required)
router.post('/verify/:token', async (req, res) => {
  try {
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({ error: 'OTP code required' });
    }

    const otpSend = await prisma.otpSend.findUnique({
      where: { token: req.params.token },
      include: { document: true },
    });

    if (!otpSend) {
      return res.status(404).json({ error: 'Invalid or expired access link' });
    }

    if (otpSend.expiresAt < new Date()) {
      return res.status(410).json({ error: 'This access link has expired' });
    }

    if (otpSend.accessedAt) {
      return res.status(410).json({ error: 'This link has already been used' });
    }

    if (!verifyOTP(otp, otpSend.otpHash)) {
      logger.warn(`Failed OTP attempt for token ${req.params.token}`);
      return res.status(401).json({ error: 'Incorrect OTP code' });
    }

    const doc = otpSend.document;

    if (!fs.existsSync(doc.encryptedPath)) {
      return res.status(404).json({ error: 'Document no longer available' });
    }

    // Mark as accessed (one-time use)
    await prisma.otpSend.update({
      where: { id: otpSend.id },
      data: { accessedAt: new Date() },
    });

    // Decrypt and stream document
    const decrypted = decryptFile(doc.encryptedPath, doc.iv);

    logger.info(`Document ${doc.id} accessed via OTP by ${otpSend.recipientEmail}`);

    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `attachment; filename="${doc.originalName}"`,
      'Content-Length': decrypted.length,
      'X-Cipher-Verified': 'OTP',
    });

    res.send(decrypted);
  } catch (err) {
    logger.error('OTP verify error', { error: err.message });
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── GET /api/otp/access/:token ───────────────────────────────────────────────
// Return metadata for the OTP access page (no auth required)
router.get('/access/:token', async (req, res) => {
  try {
    const otpSend = await prisma.otpSend.findUnique({
      where: { token: req.params.token },
      include: {
        document: { select: { originalName: true, sizeBytes: true, mimeType: true } },
        user: { select: { fullName: true } },
      },
    });

    if (!otpSend) return res.status(404).json({ error: 'Invalid link' });

    res.json({
      documentName: otpSend.document.originalName,
      senderName: otpSend.user.fullName,
      expiresAt: otpSend.expiresAt,
      expired: otpSend.expiresAt < new Date(),
      alreadyUsed: !!otpSend.accessedAt,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve link info' });
  }
});

module.exports = router;
