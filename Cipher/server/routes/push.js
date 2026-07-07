const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate } = require('../middleware/auth');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:hello@consiere.com.au',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Subscribe to push notifications
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
    const userId = req.user.userId || req.user.id;
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth }
    });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Unsubscribe
router.post('/unsubscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await prisma.pushSubscription.deleteMany({ where: { endpoint } }).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get VAPID public key
router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Send push notification to a user (internal use)
async function sendPushToUser(userId, title, body, url) {
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body, url: url || '/cc-portal', icon: '/icon-192.png', badge: '/icon-192.png' });
    const results = await Promise.allSettled(
      subs.map(sub => webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ))
    );
    // Remove invalid subscriptions
    results.forEach(async (r, i) => {
      if (r.status === 'rejected' && (r.reason?.statusCode === 410 || r.reason?.statusCode === 404)) {
        await prisma.pushSubscription.delete({ where: { endpoint: subs[i].endpoint } }).catch(function(e){ if(e) console.error("[ERR]",e.message||e); });
      }
    });
    console.log('[PUSH] Sent to', subs.length, 'subscription(s) for user', userId);
  } catch(e) { console.error('[PUSH ERROR]', e.message); }
}

module.exports = { router, sendPushToUser };
