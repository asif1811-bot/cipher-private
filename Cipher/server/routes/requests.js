'use strict';

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const { sendRequestConfirmationEmail, sendRequestStatusEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authenticate);
router.use(apiLimiter);

// GET all requests
router.get('/', async (req, res) => {
  try {
    const where = req.user.role === 'MEMBER' ? { userId: req.user.id } : {};
    const requests = await prisma.request.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, email: true, memberTier: true } } },
    });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve requests' });
  }
});

// POST create request
router.post('/', async (req, res) => {
  try {
    const { description, category, priority } = req.body;
    if (!description || !category) return res.status(400).json({ error: 'Description and category are required' });
    const validPriorities = ['STANDARD', 'URGENT', 'CRITICAL'];
    const request = await prisma.request.create({
      data: {
        userId: req.user.id,
        title: description.substring(0, 100),
        description,
        category,
        priority: validPriorities.includes(priority) ? priority : 'STANDARD',
        status: 'RECEIVED',
      },
    });
    sendRequestConfirmationEmail(req.user, request).catch(err =>
      logger.error('Request confirmation email failed', { error: err.message })
    );
    logger.info(`New request from ${req.user.email}: ${request.id}`);
    res.status(201).json(request);
  } catch (err) {
    logger.error('Create request error', { error: err.message });
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// PATCH update status (admin only)
router.patch('/:id/status', async (req, res) => {
  try {
    if (req.user.role === 'MEMBER') return res.status(403).json({ error: 'Admin access required' });
    const { status, adminNote } = req.body;
    const validStatuses = ['RECEIVED', 'IN_PROGRESS', 'AWAITING_MEMBER', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const request = await prisma.request.update({
      where: { id: req.params.id },
      data: { status, adminNote },
      include: { user: true },
    });

    // Email member about status change
    if (['IN_PROGRESS', 'COMPLETED', 'AWAITING_MEMBER', 'CANCELLED'].includes(status)) {
      sendRequestStatusEmail(request.user, request, status).catch(err =>
        logger.error('Status email failed', { error: err.message })
      );
    }

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// GET single request
router.get('/:id', async (req, res) => {
  try {
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { fullName: true, email: true, memberTier: true } } },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (req.user.role === 'MEMBER' && request.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve request' });
  }
});

module.exports = router;
