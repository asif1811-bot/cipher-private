'use strict';

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authenticate);

// ── GET /api/chat/:roomId/history ────────────────────────────────────────────
router.get('/:roomId/history', async (req, res) => {
  try {
    // Members can only access their own room
    const roomId = req.user.role === 'MEMBER' ? req.user.id : req.params.roomId;

    const messages = await prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { user: { select: { fullName: true, role: true } } },
    });

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// ── GET /api/chat/rooms (admin only) ─────────────────────────────────────────
router.get('/rooms', async (req, res) => {
  try {
    if (req.user.role === 'MEMBER') {
      return res.status(403).json({ error: 'Admin only' });
    }

    // Get all unique rooms with last message
    const rooms = await prisma.message.groupBy({
      by: ['roomId'],
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
    });

    const roomsWithUsers = await Promise.all(
      rooms.map(async (room) => {
        const user = await prisma.user.findUnique({
          where: { id: room.roomId },
          select: { id: true, fullName: true, memberTier: true },
        });
        const lastMsg = await prisma.message.findFirst({
          where: { roomId: room.roomId },
          orderBy: { createdAt: 'desc' },
        });
        return { roomId: room.roomId, user, lastMessage: lastMsg };
      })
    );

    res.json(roomsWithUsers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load chat rooms' });
  }
});

module.exports = router;
