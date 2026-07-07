let _alinaAuto = null; const alinaAuto = { notifyMemberStatusUpdate: (...a) => { if(!_alinaAuto) _alinaAuto=require('../services/alina_automation'); return _alinaAuto.notifyMemberStatusUpdate(...a); } };
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { dispatchToVendors } = require('../services/dispatch');
const { sendRequestConfirmationEmail } = require('../utils/email');
const logger = require('../utils/logger');

// FIX: sendPushToUser was called later in this file but never imported,
// throwing a ReferenceError that was silently swallowed by the surrounding
// try/catch and mislabeled in logs as "[STATUS EMAIL ERROR]" (the email
// itself was sending fine — only the push call after it was crashing).
// Confirmed real implementation lives in ./push.js (same routes/ folder).
let sendPushToUser;
try {
  ({ sendPushToUser } = require('./push'));
  if (typeof sendPushToUser !== 'function') throw new Error('sendPushToUser not exported from ./push');
} catch (e) {
  console.error('[PUSH] Could not load sendPushToUser from ./push:', e.message, '— push notifications disabled.');
  sendPushToUser = () => Promise.resolve();
}

// GET all requests (member sees own, admin sees all)
router.get('/', authenticate, async (req, res) => {
  try {
    const where = req.user.role === 'MEMBER' ? { userId: req.user.id } : {};
    const requests = await prisma.request.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, email: true, memberTier: true } }, inquiries: { select: { id:true, status:true, quoteAmount:true, quoteDetails:true, vendor:{ select:{ name:true, phone:true } } }, orderBy:{ createdAt:'desc' } } },
    });
    res.json(requests);
  } catch(e) { res.status(500).json({ error: 'Failed to retrieve requests' }); }
});

// GET usage for current month
router.get('/usage', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const tier = user?.memberTier || 'CIPHER';
    const platform = user?.platform || 'CONSIERE';
    const LIMITS = { 'CIPHER': 2, 'CIPHER_BLACK': 9, 'CIPHER_SOVEREIGN': null };
    const limit = platform === 'CIPHER_PRIVATE' ? null : (LIMITS[tier] !== undefined ? LIMITS[tier] : 2);
    const isUnlimited = limit === null;
    const startOfMonth = new Date();
    startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
    const used = await prisma.request.count({ where: { userId, createdAt: { gte: startOfMonth } } });
    const remaining = isUnlimited ? null : Math.max(0, limit - used);
    res.json({ tier, used, limit, remaining, unlimited: isUnlimited, canMakeRequest: isUnlimited || used < limit });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST create new request
router.post('/', authenticate, async (req, res) => {
  try {
    const { description, category, priority } = req.body;
    if (!description || !category) return res.status(400).json({ error: 'Description and category are required' });

    // Tier-based request limits — Consiere only (Cipher Private has no limits)
    const _u = await prisma.user.findUnique({ where: { id: req.user.id } });
    const _platform = _u?.platform || 'CONSIERE';
    const _tier = _u?.memberTier || 'CIPHER';
    const _limits = { 'CIPHER': 2, 'CIPHER_BLACK': 9, 'CIPHER_SOVEREIGN': null };
    const _limit = _platform === 'CIPHER_PRIVATE' ? null : (_limits[_tier] !== undefined ? _limits[_tier] : 2);
    if (_limit !== null) {
      const _s = new Date(); _s.setDate(1); _s.setHours(0,0,0,0);
      const _n = await prisma.request.count({ where: { userId: req.user.id, createdAt: { gte: _s } } });
      if (_n >= _limit) {
        const _msgs = {
          'CIPHER': 'You have used both free requests this month. Upgrade to Standard for 9 requests.',
          'CIPHER_BLACK': 'You have used all 9 Standard requests this month. Upgrade to Premium for unlimited.'
        };
        const _upgrades = {
          'CIPHER': 'Upgrade to Standard ($9/mo + GST) for 9 requests/month, or Premium ($29/mo + GST) for unlimited.',
          'CIPHER_BLACK': 'Upgrade to Premium ($29/mo + GST) for unlimited requests.'
        };
        return res.status(402).json({
          error: 'REQUEST_LIMIT_REACHED',
          message: _msgs[_tier] || 'Monthly request limit reached.',
          used: _n, limit: _limit,
          upgradeMessage: _upgrades[_tier] || 'Upgrade your plan.',
          upgradeUrl: '/cc-portal?tab=plan'
        });
      }
    }

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
      logger.error('Confirmation email failed', { error: err.message })
    );
    logger.info('New request from ' + req.user.email + ': ' + request.id);

    // Send response first, then dispatch async
    res.status(201).json(request);

    dispatchToVendors(request.id, request.description, request.category, req.user.userId || req.user.id)
      .then(r => { if (r?.dispatched > 0) logger.info('[DISPATCH] Sent to ' + r.dispatched + ' vendors for ' + r.classified?.category); })
      .catch(e => logger.error('[DISPATCH] Error: ' + e.message));

  } catch(err) {
    logger.error('Create request error', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: 'Failed to submit request' });
  }
});

// PATCH update request status (admin only)
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'MEMBER') return res.status(403).json({ error: 'Admin access required' });
    const { status, adminNote } = req.body;
    const validStatuses = ['RECEIVED','IN_PROGRESS','AWAITING_MEMBER','COMPLETED','CANCELLED'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const request = await prisma.request.update({
      where: { id: req.params.id },
      data: { status, ...(adminNote && { adminNote }) },
      include: { user: { select: { fullName: true, email: true, memberTier: true } } },
    });
    alinaAuto.notifyMemberStatusUpdate(req.params.id, status).catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
    res.json(request);
    // Send status update email to member
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const member = request.user;
      const firstName = (member.fullName||'Member').split(' ')[0];
      const statusLabels = {
        'RECEIVED': '✓ Received — Alina is on it',
        'IN_PROGRESS': '⚡ In Progress — we are arranging this for you',
        'AWAITING_MEMBER': '⏳ Your input needed — please check your portal',
        'COMPLETED': '✅ Completed — your request has been fulfilled',
        'CANCELLED': '✗ Cancelled'
      };
      const statusColors = {
        'RECEIVED': '#b87333', 'IN_PROGRESS': '#0d9488',
        'AWAITING_MEMBER': '#d97706', 'COMPLETED': '#16a34a', 'CANCELLED': '#dc2626'
      };
      const label = statusLabels[status] || status;
      const color = statusColors[status] || '#b87333';
      if (['IN_PROGRESS','AWAITING_MEMBER','COMPLETED'].includes(status)) {
        await resend.emails.send({
          from: 'Alina from Consiere <hello@consiere.com.au>',
          to: member.email,
          subject: label + ' — ' + (request.title||request.description||'Your request').substring(0,50),
          html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden"><div style="background:#1c1917;padding:24px 32px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div></div><div style="padding:32px"><div style="display:inline-block;padding:6px 16px;background:' + color + '20;color:' + color + ';border:1px solid ' + color + '40;border-radius:100px;font-size:11px;font-weight:600;margin-bottom:16px">' + label + '</div><h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 8px">' + (request.title||request.description||'Your request').substring(0,60) + '</h2>' + (adminNote ? '<div style="background:#faf8f5;border-left:3px solid #b87333;padding:12px 16px;margin:16px 0;font-size:13px;color:#44403c;line-height:1.7">' + adminNote + '</div>' : '') + '<p style="color:#78716c;font-size:13px;line-height:1.7;margin:16px 0">Hi ' + firstName + ', your request has been updated. Log in to your portal to view details and next steps.</p><div style="text-align:center;margin:24px 0"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px">View in Portal</a></div></div><div style="background:#faf8f5;padding:16px 32px;border-top:1px solid #e8e0d4;text-align:center"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au · Sydney, Australia</p></div></div>'
        });
        console.log('[STATUS EMAIL] [' + req.params.id.substring(0,8).toUpperCase() + '] →', status, 'to', member.email);
      // Send push notification
      const pushTitles = { 'IN_PROGRESS':'⚡ In Progress', 'AWAITING_MEMBER':'⏳ Your input needed', 'COMPLETED':'✅ Completed' };
      const pushBodies = { 'IN_PROGRESS':'Alina is arranging your request', 'AWAITING_MEMBER':'Your input is needed on a request', 'COMPLETED':'Your request has been fulfilled' };
      if (pushTitles[status]) {
        sendPushToUser(request.userId, pushTitles[status], pushBodies[status], '/cc-portal').catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
      }
      }
    } catch(emailErr) { console.error('[STATUS EMAIL ERROR]', emailErr.message); }
  } catch(e) { res.status(500).json({ error: 'Failed to update request' }); }
});

// Get member's own requests
router.get('/my', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const requests = await prisma.request.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id:true, title:true, description:true, category:true, status:true, priority:true, adminNote:true, depositPaid:true, depositAmount:true, vendorBillAmt:true, commissionAmt:true, refundAmt:true, createdAt:true, updatedAt:true, paymentUrl:true,
        inquiries: { select: { id:true, status:true, quoteAmount:true, quoteDetails:true, quoteAcceptedAt:true, vendor:{ select:{ name:true, phone:true } } }, orderBy:{ createdAt:'desc' } } }
    });
    res.json(requests);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET single request
router.get('/:id', authenticate, async (req, res) => {
  try {
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { fullName: true, email: true, memberTier: true } } },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (req.user.role === 'MEMBER' && request.userId !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    res.json(request);
  } catch(e) { res.status(500).json({ error: 'Failed to retrieve request' }); }
});


module.exports = router;
