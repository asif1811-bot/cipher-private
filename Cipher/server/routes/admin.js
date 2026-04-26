'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendWelcomeEmail, sendRequestStatusEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authenticate, requireAdmin);

// Dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [totalMembers, activeRequests, pendingApplications, recentRequests, recentApplications] = await Promise.all([
      prisma.user.count({ where: { role: 'MEMBER', isApproved: true } }),
      prisma.request.count({ where: { status: { in: ['RECEIVED', 'IN_PROGRESS', 'AWAITING_MEMBER'] } } }),
      prisma.application.count({ where: { status: 'PENDING' } }),
      prisma.request.findMany({ take: 20, orderBy: { createdAt: 'desc' }, include: { user: { select: { fullName: true, email: true, memberTier: true } } } }),
      prisma.application.findMany({ where: { status: 'PENDING' }, take: 20, orderBy: { createdAt: 'desc' } }),
    ]);
    res.json({ totalMembers, activeRequests, pendingApplications, recentRequests, recentApplications });
  } catch (err) {
    logger.error('Dashboard error', { error: err.message });
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Members list
router.get('/members', async (req, res) => {
  try {
    const members = await prisma.user.findMany({
      where: { role: 'MEMBER' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, phone: true, memberTier: true, isActive: true, isApproved: true, createdAt: true, _count: { select: { requests: true, documents: true } } },
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list members' });
  }
});

// Create member
router.post('/members', async (req, res) => {
  try {
    const { email, fullName, phone, memberTier, password } = req.body;
    if (!email || !fullName || !password) return res.status(400).json({ error: 'Email, name, and password required' });
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), passwordHash, fullName, phone: phone || null, memberTier: memberTier || 'CIPHER', role: 'MEMBER', isApproved: true, isActive: true },
    });
    sendWelcomeEmail(user).catch(err => logger.error('Welcome email failed', { error: err.message }));
    logger.info(`Admin created member: ${user.email}`);
    res.status(201).json({ id: user.id, email: user.email, fullName: user.fullName });
  } catch (err) {
    logger.error('Create member error', { error: err.message });
    res.status(500).json({ error: 'Failed to create member' });
  }
});

// Update member (suspend/activate/tier)
router.patch('/members/:id', async (req, res) => {
  try {
    const { isActive, isApproved, memberTier } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(isApproved !== undefined && { isApproved }),
        ...(memberTier && { memberTier }),
      },
    });
    if (isApproved === true) {
      sendWelcomeEmail(user).catch(err => logger.error('Welcome email failed', { error: err.message }));
    }
    res.json({ id: user.id, isActive: user.isActive, isApproved: user.isApproved, memberTier: user.memberTier });
  } catch (err) {
    logger.error('Update member error', { error: err.message });
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// Applications list
router.get('/applications', async (req, res) => {
  try {
    const applications = await prisma.application.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list applications' });
  }
});

// Update application (approve/decline) + send email
router.patch('/applications/:id', async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['PENDING', 'APPROVED', 'DECLINED'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const application = await prisma.application.update({ where: { id: req.params.id }, data: { status, adminNote } });

    // Send approval/decline email to applicant
    const SITE_URL = process.env.CLIENT_URL || 'https://cipherprivate.com';
    const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.sendgrid.net', port: 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    const FROM = `"Cipher Private" <${process.env.EMAIL_FROM || 'noreply@cipherprivate.com'}>`;

    if (status === 'APPROVED') {
      const html = `<!DOCTYPE html><html><head><style>body{margin:0;background:#080808;font-family:Helvetica,Arial,sans-serif}.c{max-width:600px;margin:0 auto;background:#0f0f0f;border:1px solid rgba(201,169,110,0.15)}.h{padding:48px 40px;text-align:center;border-bottom:1px solid rgba(201,169,110,0.12)}.b{padding:48px 40px}.f{padding:24px 40px;border-top:1px solid rgba(201,169,110,0.08);text-align:center;font-size:10px;color:#444}</style></head><body><div style="background:#080808;padding:40px 20px"><div class="c"><div class="h"><div style="color:#c9a96e;font-size:24px;margin-bottom:8px">◆</div><div style="font-size:10px;letter-spacing:8px;color:#c9a96e;text-transform:uppercase">Cipher Private</div><div style="font-size:9px;letter-spacing:3px;color:#5a4a2a;margin-top:4px">Your Life. Your Cipher. Our Promise.</div></div><div class="b"><div style="font-size:10px;letter-spacing:4px;color:#c9a96e;text-transform:uppercase;margin-bottom:16px">Membership Approved</div><h1 style="font-size:28px;color:#f0ede8;font-weight:300;margin:0 0 20px">Welcome to<br><span style="color:#c9a96e">Cipher Private</span></h1><p style="color:#888;font-size:13px;line-height:1.9;margin:0 0 16px">Dear ${application.fullName.split(' ')[0]},</p><p style="color:#888;font-size:13px;line-height:1.9;margin:0 0 16px">We are delighted to confirm that your application for <strong style="color:#f0ede8">${tierMap[application.tier] || application.tier}</strong> membership has been approved.</p><p style="color:#888;font-size:13px;line-height:1.9;margin:0 0 24px">Your dedicated lifestyle manager will contact you within 24 hours to arrange your personal onboarding call and provide your secure portal credentials.</p><div style="background:#1a1605;border-left:3px solid #c9a96e;padding:20px 24px;margin:24px 0"><p style="color:#c9a96e;font-size:12px;margin:0">Your login credentials will be sent in a separate secure communication. Please do not share your access details with anyone.</p></div><div style="text-align:center;margin:32px 0"><a href="${SITE_URL}" style="display:inline-block;background:#c9a96e;color:#080808;padding:16px 40px;font-size:10px;letter-spacing:4px;text-transform:uppercase;text-decoration:none;font-weight:700">Access Your Portal</a></div><div style="margin-top:32px"><div style="font-size:14px;color:#f0ede8">The Cipher Private Team</div><div style="font-size:10px;color:#8a6f3e;letter-spacing:2px;text-transform:uppercase;margin-top:4px">Cipher Private · Sydney, Australia</div></div></div><div class="f"><p>Cipher Private Pty Ltd · Sydney, NSW · <a href="${SITE_URL}/privacy" style="color:#8a6f3e;text-decoration:none">Privacy Policy</a></p></div></div></div></body></html>`;
      transporter.sendMail({ from: FROM, to: application.email, subject: 'Cipher Private — Your Membership Has Been Approved', html }).catch(e => logger.error('Approval email failed', { error: e.message }));
    } else if (status === 'DECLINED') {
      const html = `<!DOCTYPE html><html><head><style>body{margin:0;background:#080808;font-family:Helvetica,Arial,sans-serif}</style></head><body><div style="background:#080808;padding:40px 20px"><div style="max-width:600px;margin:0 auto;background:#0f0f0f;border:1px solid rgba(201,169,110,0.15);padding:48px 40px"><div style="color:#c9a96e;font-size:10px;letter-spacing:4px;text-transform:uppercase;margin-bottom:16px">Application Update</div><p style="color:#888;font-size:13px;line-height:1.9">Dear ${application.fullName.split(' ')[0]},</p><p style="color:#888;font-size:13px;line-height:1.9">Thank you for your interest in Cipher Private. After careful consideration, we are unable to proceed with your application at this time. We receive a significant volume of applications and must limit our membership to maintain the standard of service our existing members expect.</p><p style="color:#888;font-size:13px;line-height:1.9">We wish you every success and hope to have the opportunity to welcome you in the future.<br><br>The Cipher Private Team</p></div></div></body></html>`;
      transporter.sendMail({ from: FROM, to: application.email, subject: 'Cipher Private — Application Update', html }).catch(e => logger.error('Decline email failed', { error: e.message }));
    }

    logger.info(`Application ${req.params.id} → ${status} by ${req.user.email}`);
    res.json(application);
  } catch (err) {
    logger.error('Update application error', { error: err.message });
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// Update request status (admin) + notify member
router.patch('/requests/:id/status', async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['RECEIVED', 'IN_PROGRESS', 'AWAITING_MEMBER', 'COMPLETED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const request = await prisma.request.update({
      where: { id: req.params.id },
      data: { status, adminNote },
      include: { user: true },
    });
    if (['IN_PROGRESS', 'COMPLETED', 'AWAITING_MEMBER', 'CANCELLED'].includes(status)) {
      sendRequestStatusEmail(request.user, request, status).catch(err =>
        logger.error('Status email failed', { error: err.message })
      );
    }
    logger.info(`Request ${req.params.id} → ${status}`);
    res.json(request);
  } catch (err) {
    logger.error('Update request status error', { error: err.message });
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// All requests list
router.get('/requests', async (req, res) => {
  try {
    const { status } = req.query;
    const requests = await prisma.request.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, email: true, memberTier: true } } },
    });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list requests' });
  }
});

module.exports = router;
