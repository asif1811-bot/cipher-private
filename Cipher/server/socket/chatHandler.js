'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

const handleSocketConnection = (io, socket) => {
  const user = socket.user;
  logger.info(`Socket connected: ${user.email} (${user.role})`);

  // Members join their own room; admins can join any room
  const memberRoom = user.role === 'MEMBER' ? user.id : null;
  if (memberRoom) {
    socket.join(memberRoom);
    logger.info(`${user.email} joined room: ${memberRoom}`);
  }

  // Admin joins all active rooms
  if (user.role !== 'MEMBER') {
    socket.join('admin-room');
  }

  // ── Send Message ───────────────────────────────────────────────────────────
  socket.on('send_message', async ({ roomId, content }) => {
    try {
      if (!content || content.trim().length === 0) return;
      if (content.length > 2000) return socket.emit('error', { message: 'Message too long' });

      // Members can only send to their own room
      const targetRoom = user.role === 'MEMBER' ? user.id : roomId;
      if (!targetRoom) return socket.emit('error', { message: 'Room ID required' });

      const message = await prisma.message.create({
        data: {
          roomId: targetRoom,
          userId: user.id,
          content: content.trim(),
          isAdmin: user.role !== 'MEMBER',
        },
        include: { user: { select: { fullName: true, role: true } } },
      });

      const payload = {
        id: message.id,
        roomId: targetRoom,
        content: message.content,
        isAdmin: message.isAdmin,
        sender: message.user.fullName,
        role: message.user.role,
        createdAt: message.createdAt,
      };

      // Emit to the member's room
      io.to(targetRoom).emit('new_message', payload);

      // Notify admins
      io.to('admin-room').emit('new_message', payload);

      logger.info(`Message sent in room ${targetRoom} by ${user.email}`);
    } catch (err) {
      logger.error('Message send error', { error: err.message });
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // ── Admin joins a specific member room ────────────────────────────────────
  socket.on('join_room', ({ roomId }) => {
    if (user.role === 'MEMBER') return;
    socket.join(roomId);
    logger.info(`Admin ${user.email} joined room: ${roomId}`);
  });

  // ── Typing indicator ──────────────────────────────────────────────────────
  socket.on('typing', ({ roomId }) => {
    const targetRoom = user.role === 'MEMBER' ? user.id : roomId;
    socket.to(targetRoom).emit('user_typing', {
      userId: user.id,
      name: user.fullName,
      isAdmin: user.role !== 'MEMBER',
    });
  });

  socket.on('stop_typing', ({ roomId }) => {
    const targetRoom = user.role === 'MEMBER' ? user.id : roomId;
    socket.to(targetRoom).emit('user_stop_typing', { userId: user.id });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${user.email}`);
  });
};

module.exports = { handleSocketConnection };
