'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendWelcomeEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authenticate, requireAdmin);

// ── GET /api/admin/dashboard ─────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalMembers,
      activeRequests,
      pendingApplications,
      recentRequests,
      recentApplications,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'MEMBER', isApproved: true } }),
      prisma.request.count({ where: { status: { in: ['RECEIVED', 'IN_PROGRESS', 'AWAITING_MEMBER'] } } }),
      prisma.application.count({ where: { status: 'PENDING' } }),
      prisma.request.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { fullName: true, memberTier: true } } },
      }),
      prisma.application.findMany({
        where: { status: 'PENDING' },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({ totalMembers, activeRequests, pendingApplications, recentRequests, recentApplications });
  } catch (err) {
    logger.error('Dashboard error', { error: err.message });
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ── GET /api/admin/members ───────────────────────────────────────────────────
router.get('/members', async (req, res) => {
  try {
    const members = await prisma.user.findMany({
      where: { role: 'MEMBER' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, fullName: true, phone: true,
        memberTier: true, isActive: true, isApproved: true, createdAt: true,
        _count: { select: { requests: true, documents: true } },
      },
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list members' });
  }
});

// ── POST /api/admin/members ──────────────────────────────────────────────────
// Create a new approved member
router.post('/members', async (req, res) => {
  try {
    const { email, fullName, phone, memberTier, password } = req.body;

    if (!email || !fullName || !password) {
      return res.status(400).json({ error: 'Email, name, and password required' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        phone: phone || null,
        memberTier: memberTier || 'CIPHER',
        role: 'MEMBER',
        isApproved: true,
        isActive: true,
      },
    });

    sendWelcomeEmail(user).catch(err =>
      logger.error('Welcome email failed', { error: err.message })
    );

    logger.info(`Admin created member: ${user.email}`);
    res.status(201).json({ id: user.id, email: user.email, fullName: user.fullName });
  } catch (err) {
    logger.error('Create member error', { error: err.message });
    res.status(500).json({ error: 'Failed to create member' });
  }
});

// ── PATCH /api/admin/members/:id ─────────────────────────────────────────────
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

    res.json({ id: user.id, isActive: user.isActive, isApproved: user.isApproved, memberTier: user.memberTier });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// ── GET /api/admin/applications ──────────────────────────────────────────────
router.get('/applications', async (req, res) => {
  try {
    const applications = await prisma.application.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list applications' });
  }
});

// ── PATCH /api/admin/applications/:id ────────────────────────────────────────
router.patch('/applications/:id', async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const validStatuses = ['PENDING', 'APPROVED', 'DECLINED'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const application = await prisma.application.update({
      where: { id: req.params.id },
      data: { status, adminNote },
    });

    logger.info(`Application ${req.params.id} updated to ${status} by ${req.user.email}`);
    res.json(application);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update application' });
  }
});

module.exports = router;
