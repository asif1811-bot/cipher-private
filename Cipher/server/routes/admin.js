let _alinaAuto3 = null; const alinaAuto = { notifyMemberStatusUpdate: (...a) => { if(!_alinaAuto3) _alinaAuto3=require('../services/alina_automation'); return _alinaAuto3.notifyMemberStatusUpdate(...a); } };

const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendWelcomeEmail, sendRequestStatusEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();


// Public vendor directory (no auth)
router.get('/vendor-directory', async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      select: { name: true, category: true, cities: true, description: true },
      orderBy: { category: 'asc' }
    });
    res.json({ vendors });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// International requests list
router.get('/international-requests', async (req, res) => {
  try {
    const requests = await prisma.request.findMany({
      where: { isInternational: true },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, email: true, memberTier: true } }
      }
    });
    res.json({ requests });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send international quote to client
router.post('/international-quote', async (req, res) => {
  try {
    const { requestId, amount, note, wiseRef } = req.body;
    if (!requestId || !amount) return res.status(400).json({ error: 'requestId and amount required' });

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { user: { select: { email: true, fullName: true } } }
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    // Update request with quote details
    await prisma.request.update({
      where: { id: requestId },
      data: {
        fullPaymentAmt: parseFloat(amount),
        wiseTransferRef: wiseRef || null,
        status: 'QUOTED'
      }
    });

    // Send quote email to client
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const firstName = (request.user.fullName || 'Member').split(' ')[0];
    const orderRef = request.orderRef || requestId.substring(0,8).toUpperCase();

    await resend.emails.send({
      from: 'Consiere <hello@consiere.com.au>',
      to: request.user.email,
      subject: 'Your international request quote — ' + orderRef,
      html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
        '<div style="background:#1c1917;padding:24px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div></div>' +
        '<div style="padding:32px">' +
        '<h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 12px">Your quote is ready</h2>' +
        '<p style="font-size:13px;color:#78716c;line-height:1.8;margin:0 0 20px">Hi ' + firstName + ', we have sourced your international request.</p>' +
        '<div style="background:#faf8f5;border:1px solid #e8e0d4;border-radius:8px;padding:20px;margin:0 0 20px">' +
        '<div style="font-size:12px;color:#78716c;margin-bottom:4px">Order reference</div>' +
        '<div style="font-size:14px;font-weight:600;color:#b87333;margin-bottom:12px">' + orderRef + '</div>' +
        '<div style="font-size:12px;color:#78716c;margin-bottom:4px">Request</div>' +
        '<div style="font-size:13px;color:#1c1917;margin-bottom:12px">' + (request.description || '').substring(0,100) + '</div>' +
        (note ? '<div style="font-size:12px;color:#78716c;margin-bottom:4px">Notes from our team</div><div style="font-size:13px;color:#1c1917;margin-bottom:12px">' + note + '</div>' : '') +
        '<div style="font-size:12px;color:#78716c;margin-bottom:4px">Total amount</div>' +
        '<div style="font-size:28px;font-family:Georgia;color:#b87333">$' + parseFloat(amount).toFixed(2) + ' AUD</div>' +
        '<div style="font-size:11px;color:#78716c;margin-top:4px">Includes 20% international service fee</div>' +
        '</div>' +
        '<div style="text-align:center">' +
        '<a href="' + (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px">Accept &amp; Pay in Portal</a>' +
        '</div></div>' +
        '<div style="background:#faf8f5;padding:14px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au</p></div>' +
        '</div>'
    });

    res.json({ success: true, message: 'Quote sent to ' + request.user.email });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Klaviyo status check
router.get('/klaviyo-status', async (req, res) => {
  try {
    const key = process.env.KLAVIYO_API_KEY;
    if (!key) return res.json({ connected: false, error: 'KLAVIYO_API_KEY not set in .env' });
    const r = await fetch('https://a.klaviyo.com/api/lists/', {
      headers: { 'Authorization': 'Klaviyo-API-Key ' + key, 'revision': '2024-02-15' }
    });
    const d = await r.json();
    if (!d.data) return res.json({ connected: false, error: 'Invalid API key' });
    // Get profile counts for each list
    const lists = await Promise.all(d.data.map(async l => {
      try {
        const r2 = await fetch('https://a.klaviyo.com/api/lists/' + l.id + '/profiles/?page[size]=1', {
          headers: { 'Authorization': 'Klaviyo-API-Key ' + key, 'revision': '2024-02-15' }
        });
        const d2 = await r2.json();
        return { id: l.id, name: l.attributes.name, count: d2.meta?.total || 0 };
      } catch(e) { return { id: l.id, name: l.attributes.name, count: '?' }; }
    }));
    res.json({ connected: true, lists });
  } catch(e) { res.json({ connected: false, error: e.message }); }
});

// Klaviyo sync — push all members to Consiere Members list
router.post('/klaviyo-sync', async (req, res) => {
  try {
    const key = process.env.KLAVIYO_API_KEY;
    if (!key) return res.status(400).json({ error: 'KLAVIYO_API_KEY not set' });
    const MEMBERS_LIST = 'VrcY7j';
    const users = await prisma.user.findMany({
      where: { isActive: true, role: 'MEMBER' },
      select: { email: true, fullName: true, memberTier: true, createdAt: true }
    });
    let synced = 0;
    for (const user of users) {
      try {
        const [firstName, ...rest] = (user.fullName || '').split(' ');
        const profileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
          method: 'POST',
          headers: { 'Authorization': 'Klaviyo-API-Key ' + key, 'Content-Type': 'application/json', 'revision': '2024-02-15' },
          body: JSON.stringify({ data: { type: 'profile', attributes: {
            email: user.email, first_name: firstName || '', last_name: rest.join(' '),
            properties: { tier: user.memberTier, source: 'Consiere Admin Sync' }
          }}})
        });
        const pd = await profileRes.json();
        const profileId = pd?.data?.id;
        if (profileId) {
          await fetch('https://a.klaviyo.com/api/lists/' + MEMBERS_LIST + '/relationships/profiles/', {
            method: 'POST',
            headers: { 'Authorization': 'Klaviyo-API-Key ' + key, 'Content-Type': 'application/json', 'revision': '2024-02-15' },
            body: JSON.stringify({ data: [{ type: 'profile', id: profileId }] })
          });
          synced++;
        }
      } catch(e) { console.error('[KLAVIYO SYNC]', user.email, e.message); }
    }
    res.json({ success: true, synced, total: users.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Member database — full contact list with payment totals
router.get('/contacts', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: 'MEMBER' },
      select: {
        id: true, fullName: true, email: true, phone: true,
        memberTier: true, isActive: true, createdAt: true, platform: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get payment totals per user
    const payments = await prisma.payment.groupBy({
      by: ['userId'],
      _sum: { amount: true },
      where: { status: 'PAID' }
    });
    const payMap = {};
    payments.forEach(p => { payMap[p.userId] = p._sum.amount || 0; });

    const contacts = users.map(u => ({ ...u, totalPaid: payMap[u.id] || 0 }));
    res.json({ contacts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get broadcast audience count
router.get('/broadcast-audience', async (req, res) => {
  try {
    const type = req.query.type || 'all';
    let count = 0;

    if (type === 'vendors') {
      count = await prisma.vendor.count({ where: { isActive: true, phone: { not: null } } });
    } else {
      const where = { role: 'MEMBER', isActive: true };
      if (type === 'paid') where.memberTier = 'CIPHER_BLACK';
      if (type === 'free') where.memberTier = 'CIPHER';
      const users = await prisma.user.findMany({ where, select: { email: true, phone: true } });
      count = users.filter(u => u.phone || u.email?.includes('@whatsapp.cipher')).length;
    }
    res.json({ count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send broadcast
router.post('/broadcast', async (req, res) => {
  try {
    const { message, audience } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const { sendWA } = require('../services/whatsapp_notifications');
    let phones = [];

    if (audience === 'vendors') {
      const vendors = await prisma.vendor.findMany({ where: { isActive: true, phone: { not: null } }, select: { phone: true } });
      phones = vendors.map(v => v.phone).filter(Boolean);
    } else {
      const where = { role: 'MEMBER', isActive: true };
      if (audience === 'paid') where.memberTier = 'CIPHER_BLACK';
      if (audience === 'free') where.memberTier = 'CIPHER';
      const users = await prisma.user.findMany({ where, select: { email: true, phone: true } });
      users.forEach(u => {
        if (u.phone) phones.push(u.phone);
        else if (u.email?.includes('@whatsapp.cipher')) {
          phones.push('+' + u.email.replace('wa_','').replace('@whatsapp.cipher',''));
        }
      });
    }

    let sent = 0, failed = 0;
    for (const phone of phones) {
      await new Promise(r => setTimeout(r, 300)); // rate limit
      const ok = await sendWA(phone, message);
      if (ok) sent++; else failed++;
    }

    console.log('[BROADCAST] Sent:', sent, 'Failed:', failed, 'Audience:', audience);
    res.json({ success: true, sent, failed, total: phones.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send test broadcast
router.post('/broadcast-test', async (req, res) => {
  try {
    const { message, phone } = req.body;
    if (!message || !phone) return res.status(400).json({ error: 'message and phone required' });
    const { sendWA } = require('../services/whatsapp_notifications');
    const ok = await sendWA(phone, '[TEST] ' + message);
    res.json({ success: ok });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Stripe status check
router.get('/stripe-status-check', async (req, res) => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.json({ connected: false, error: 'STRIPE_SECRET_KEY not set' });
    const Stripe = require('stripe');
    const stripe = new Stripe(key);
    const account = await stripe.balance.retrieve();
    res.json({ connected: true, livemode: !key.startsWith('sk_test') });
  } catch(e) { res.json({ connected: false, error: e.message }); }
});

// Twilio / WhatsApp status check
router.get('/twilio-status', async (req, res) => {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const number = process.env.TWILIO_WHATSAPP_NUMBER || '';
    if (!sid || !token) return res.json({ connected: false, error: 'Twilio credentials not set' });
    const twilio = require('twilio')(sid, token);
    const account = await twilio.api.accounts(sid).fetch();
    res.json({ connected: account.status === 'active', number: number.replace('whatsapp:', ''), accountName: account.friendlyName });
  } catch(e) { res.json({ connected: false, error: e.message }); }
});

router.use(authenticate, requireAdmin);

// Dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalMembers, activeRequests, pendingApplications,
      recentRequests, recentApplications,
      newMembersThisMonth, newMembersLastMonth,
      requestsThisMonth, requestsLastMonth,
      completedRequests, cancelledRequests,
      totalVendors, activeVendors,
      totalInquiries, acceptedInquiries,
      payments, topCategories, tierCounts
    ] = await Promise.all([
      prisma.user.count({ where: { role:'MEMBER', platform:'CIPHER_PRIVATE', isApproved:true } }),
      prisma.request.count({ where: { status: { in:['RECEIVED','IN_PROGRESS','AWAITING_MEMBER'] } } }),
      prisma.application.count({ where: { status:'PENDING' } }).catch(()=>0),
      prisma.request.findMany({ take:10, orderBy:{ createdAt:'desc' }, include:{ user:{ select:{ fullName:true, email:true, memberTier:true } } } }),
      prisma.application.findMany({ where:{ status:'PENDING' }, take:10, orderBy:{ createdAt:'desc' } }).catch(()=>[]),
      prisma.user.count({ where:{ role:'MEMBER', platform:'CIPHER_PRIVATE', createdAt:{ gte:startOfMonth } } }),
      prisma.user.count({ where:{ role:'MEMBER', platform:'CIPHER_PRIVATE', createdAt:{ gte:startOfLastMonth, lte:endOfLastMonth } } }),
      prisma.request.count({ where:{ createdAt:{ gte:startOfMonth } } }),
      prisma.request.count({ where:{ createdAt:{ gte:startOfLastMonth, lte:endOfLastMonth } } }),
      prisma.request.count({ where:{ status:'COMPLETED' } }),
      prisma.request.count({ where:{ status:'CANCELLED' } }),
      prisma.vendor.count(),
      prisma.vendor.count({ where:{ isActive:true } }),
      prisma.vendorInquiry.count(),
      prisma.vendorInquiry.count({ where:{ status:'ACCEPTED' } }),
      prisma.payment.findMany({ where:{ status:'paid' }, select:{ amount:true, createdAt:true } }).catch(()=>[]),
      prisma.request.groupBy({ by:['category'], _count:{ id:true }, orderBy:{ _count:{ id:'desc' } }, take:5 }).catch(()=>[]),
      prisma.user.groupBy({ by:['memberTier'], where:{ role:'MEMBER', platform:'CIPHER_PRIVATE' }, _count:{ id:true } }).catch(()=>[]),
    ]);

    const totalRevenue = payments.reduce((s,p)=>s+(p.amount||0),0);
    const revenueThisMonth = payments.filter(p=>new Date(p.createdAt)>=startOfMonth).reduce((s,p)=>s+(p.amount||0),0);

    res.json({
      totalMembers, activeRequests, pendingApplications,
      recentRequests, recentApplications,
      growth: { newMembersThisMonth, newMembersLastMonth, requestsThisMonth, requestsLastMonth },
      requests: { completed:completedRequests, cancelled:cancelledRequests, active:activeRequests },
      vendors: { total:totalVendors, active:activeVendors, inquiries:totalInquiries, accepted:acceptedInquiries, acceptRate: totalInquiries ? Math.round(acceptedInquiries/totalInquiries*100) : 0 },
      revenue: { total:totalRevenue, thisMonth:revenueThisMonth },
      topCategories,
      tierCounts,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// CC Admin analytics dashboard
router.get('/cc-dashboard', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const ccMembers = await prisma.user.findMany({ where:{ platform:'CONSIERE' }, select:{ id:true, memberTier:true, createdAt:true } });
    const ccIds = ccMembers.map(m=>m.id);

    const [
      activeRequests, requestsThisMonth, requestsLastMonth,
      completedRequests, totalInquiries, acceptedInquiries,
      payments, topCategories, newMembersThisMonth, newMembersLastMonth
    ] = await Promise.all([
      prisma.request.count({ where:{ userId:{ in:ccIds }, status:{ in:['RECEIVED','IN_PROGRESS','AWAITING_MEMBER'] } } }),
      prisma.request.count({ where:{ userId:{ in:ccIds }, createdAt:{ gte:startOfMonth } } }),
      prisma.request.count({ where:{ userId:{ in:ccIds }, createdAt:{ gte:startOfLastMonth, lte:endOfLastMonth } } }),
      prisma.request.count({ where:{ userId:{ in:ccIds }, status:'COMPLETED' } }),
      prisma.vendorInquiry.count(),
      prisma.vendorInquiry.count({ where:{ status:'ACCEPTED' } }),
      prisma.payment.findMany({ where:{ status:'paid' }, select:{ amount:true, createdAt:true } }).catch(()=>[]),
      prisma.request.groupBy({ by:['category'], where:{ userId:{ in:ccIds } }, _count:{ id:true }, orderBy:{ _count:{ id:'desc' } }, take:5 }).catch(()=>[]),
      prisma.user.count({ where:{ platform:'CONSIERE', createdAt:{ gte:startOfMonth } } }),
      prisma.user.count({ where:{ platform:'CONSIERE', createdAt:{ gte:startOfLastMonth, lte:endOfLastMonth } } }),
    ]);

    const totalRevenue = payments.reduce((s,p)=>s+(p.amount||0),0);
    const revenueThisMonth = payments.filter(p=>new Date(p.createdAt)>=startOfMonth).reduce((s,p)=>s+(p.amount||0),0);
    const tierCounts = { free: ccMembers.filter(m=>m.memberTier==='CIPHER').length, standard: ccMembers.filter(m=>m.memberTier==='CIPHER_BLACK').length, premium: ccMembers.filter(m=>m.memberTier==='CIPHER_SOVEREIGN').length };
    const referralCount = 0;

    res.json({
      totalMembers: ccMembers.length, activeRequests, completedRequests,
      growth: { newMembersThisMonth, newMembersLastMonth, requestsThisMonth, requestsLastMonth },
      vendors: { inquiries:totalInquiries, accepted:acceptedInquiries, acceptRate: totalInquiries ? Math.round(acceptedInquiries/totalInquiries*100) : 0 },
      revenue: { total:totalRevenue, thisMonth:revenueThisMonth },
      topCategories, tierCounts, referralCount,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Analytics alias (used by admin panels)
router.get('/analytics', async (req, res) => {
  try {
    const ccMembers = await prisma.user.findMany({ where:{ platform:'CONSIERE' }, select:{ id:true, memberTier:true, createdAt:true, isActive:true } });
    const cpMembers = await prisma.user.findMany({ where:{ platform:'CIPHER_PRIVATE' }, select:{ id:true, memberTier:true, createdAt:true } });
    const ccIds = ccMembers.map(m=>m.id);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [requests, inquiries, deliveredInquiries] = await Promise.all([
      prisma.request.count({ where:{ userId:{ in:ccIds } } }),
      prisma.vendorInquiry.count(),
      prisma.vendorInquiry.findMany({ where:{ billAmount:{ gt:0 } }, select:{ billAmount:true, commissionAmt:true } })
    ]);
    const totalCommission = deliveredInquiries.reduce((s,i) => s + (i.commissionAmt || (i.billAmount||0)*0.1), 0);
    const tierCounts = {
      free: ccMembers.filter(m=>m.memberTier==='CIPHER').length,
      standard: ccMembers.filter(m=>m.memberTier==='CIPHER_BLACK').length,
      premium: ccMembers.filter(m=>m.memberTier==='CIPHER_SOVEREIGN').length
    };
    res.json({
      totalMembers: ccMembers.length,
      cpMembers: cpMembers.length,
      totalRequests: requests,
      totalInquiries: inquiries,
      totalCommission: Math.round(totalCommission*100)/100,
      mrr: 0,
      tierCounts,
      activeMembers: ccMembers.filter(m=>m.isActive).length,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Members list
router.get('/members', async (req, res) => {
  try {
    const members = await prisma.user.findMany({
      where: { role: 'MEMBER', platform: 'CIPHER_PRIVATE', platform: 'CIPHER_PRIVATE' },
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
      data: { email: email.toLowerCase(), passwordHash, fullName, phone: phone || null, memberTier: memberTier || 'CIPHER', role: 'MEMBER', platform: 'CIPHER_PRIVATE', isApproved: true, isActive: true },
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
    const { isActive, isApproved, memberTier, fullName, email } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(fullName && { fullName }),
        ...(email && { email: email.toLowerCase() }),
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
    const FROM = `"Cipher Private" <${process.env.EMAIL_FROM || 'hello@cipherprivate.com'}>`;

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
router.post('/requests/:id/push-fulfilment', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'MEMBER') return res.status(403).json({ error: 'Admin access required' });
    const request = await prisma.request.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { fullName: true, phone: true, email: true } },
        inquiries: { orderBy: { createdAt: 'desc' }, take: 1, include: { vendor: { select: { name: true, phone: true } } } }
      }
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    // Button shows on all requests now; allow push from any status. No-op guard removed.
    await prisma.request.update({ where: { id: request.id }, data: { status: 'IN_PROGRESS', pendingFulfilment: false } });

    const { sendWA } = require('../services/whatsapp_notifications');
    const inq = request.inquiries && request.inquiries[0];
    const vendor = inq && inq.vendor;

    // Notify client
    if (request.user && request.user.phone) {
      await sendWA(request.user.phone,
        '\u2705 *Update on your request*\n\n' +
        (request.description||'').substring(0,100) + '\n\n' +
        'A verified provider is now confirmed and arranging this for you. You will receive details shortly.\n\n_\u2014 Alina_'
      ).catch(function(e){ if(e) console.error('[PUSH client]', e.message||e); });
    }
    // Re-ping vendor
    if (vendor && vendor.phone) {
      await sendWA(vendor.phone,
        '\u{1F7E2} *You are confirmed for this job*\n\n' +
        '*' + (request.category||'Service') + '*\n' +
        (request.description||'').substring(0,100) + '\n\n' +
        'Please proceed. Quote/respond in your portal: ' + (process.env.CC_URL||'https://consiere.com.au') + '/vendor-portal\n\n_\u2014 Consiere_'
      ).catch(function(e){ if(e) console.error('[PUSH vendor]', e.message||e); });
    }
    res.json({ ok: true, status: 'IN_PROGRESS', clientNotified: !!(request.user&&request.user.phone), vendorNotified: !!(vendor&&vendor.phone) });
  } catch(e) { console.error('[PUSH FULFILMENT]', e.message); res.status(500).json({ error: e.message }); }
});

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
    alinaAuto.notifyMemberStatusUpdate(req.params.id, req.body.status||updated?.status||'').catch(function(e){ if(e) console.error("[ERROR]",e.message||e); });
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
    // Only show requests from Cipher Private members
    const cpMembers = await prisma.user.findMany({
      where: { platform: 'CIPHER_PRIVATE' },
      select: { id: true }
    });
    const cpIds = cpMembers.map(function(u){ return u.id; });
    const where = { userId: { in: cpIds } };
    if (status) where.status = status;
    const requests = await prisma.request.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, email: true, memberTier: true, phone: true } },
        inquiries: {
          select: { status: true, quoteAmount: true, emailSentAt: true, respondedAt: true, deliveredAt: true,
            vendor: { select: { name: true, email: true, phone: true, address: true } } },
          orderBy: { emailSentAt: 'desc' }, take: 10
        }
      },
    });
    // Flatten delivery details into response
    // Get unregistered vendor outreach for each request
    const requestIds = requests.map(r => r.id);
    const uvOutreach = await prisma.unregisteredVendorRequest.findMany({
      where: { requestId: { in: requestIds } },
      orderBy: { createdAt: 'desc' }
    });

    const enriched = requests.map(r => {
      const uvrs = uvOutreach.filter(u => u.requestId === r.id);
      const uniqueUVVendors = [...new Map(uvrs.map(u => [u.vendorName, u])).values()];
      return {
        ...r,
        deliveryAddress: r.deliveryAddress || null,
        recipientName: r.recipientName || null,
        recipientPhone: r.recipientPhone || null,
        deliveryNotes: r.deliveryNotes || null,
        vendorsContacted: [...new Set((r.inquiries||[]).map(function(i){return i.vendor&&i.vendor.name;}).filter(Boolean))].length || 0,
        vendorNames: [...new Set((r.inquiries||[]).map(function(i){return i.vendor&&i.vendor.name;}).filter(Boolean))].join(', ') || '',
        vendorContacts: Object.values((r.inquiries||[]).reduce(function(acc,i){if(i.vendor&&i.vendor.name&&!acc[i.vendor.name])acc[i.vendor.name]={name:i.vendor.name,phone:i.vendor.phone||null,email:i.vendor.email||null,address:i.vendor.address||null};return acc;},{})),
        hasQuote: r.inquiries?.some(i => i.quoteAmount > 0),
        topQuote: r.inquiries?.filter(i=>i.quoteAmount).sort((a,b)=>a.quoteAmount-b.quoteAmount)[0]?.quoteAmount || null,
        googleVendors: uniqueUVVendors.map(u => ({
          id: u.id, name: u.vendorName, phone: u.vendorPhone, email: u.vendorEmail,
          status: u.status, city: u.city, registeredAt: u.registeredAt
        })),
        googleVendorsCount: uniqueUVVendors.length,
      };
    });
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list requests' });
  }
});


// Get member chat history
router.get('/members/:id/chats', async (req, res) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { userId: req.params.id },
      orderBy: { createdAt: 'asc' },
      take: 200
    });
    res.json({ messages });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get member requests
router.get('/members/:id/requests', async (req, res) => {
  try {
    const requests = await prisma.request.findMany({
      where: { userId: req.params.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ requests });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Toggle member active status
router.patch('/members/:id/toggle', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: !user.isActive } });
    res.json({ success: true, isActive: updated.isActive });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// CC Admin — Consiere members only
router.get('/cc-members', async (req, res) => {
  try {
    const members = await prisma.user.findMany({
      where: { role: 'MEMBER', platform: 'CONSIERE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, fullName: true, phone: true, memberTier: true, isActive: true, isApproved: true, createdAt: true, platform: true, _count: { select: { requests: true } } },
    });
    res.json(members);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CC Admin — Consiere requests only
router.get('/cc-requests', async (req, res) => {
  try {
    const { status } = req.query;
    const ccMembers = await prisma.user.findMany({
      where: { platform: 'CONSIERE' },
      select: { id: true }
    });
    const ccIds = ccMembers.map(function(u){ return u.id; });
    const where = { userId: { in: ccIds } };
    if (status) where.status = status;
    const requests = await prisma.request.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, email: true, memberTier: true, phone: true } },
        inquiries: {
          select: { status: true, quoteAmount: true, emailSentAt: true, respondedAt: true, deliveredAt: true,
            vendor: { select: { name: true, email: true, phone: true, address: true } } },
          orderBy: { emailSentAt: 'desc' }, take: 10
        }
      },
    });
    // Flatten delivery details into response
    // Get unregistered vendor outreach for each request
    const requestIds = requests.map(r => r.id);
    const uvOutreach = await prisma.unregisteredVendorRequest.findMany({
      where: { requestId: { in: requestIds } },
      orderBy: { createdAt: 'desc' }
    });

    const enriched = requests.map(r => {
      const uvrs = uvOutreach.filter(u => u.requestId === r.id);
      const uniqueUVVendors = [...new Map(uvrs.map(u => [u.vendorName, u])).values()];
      return {
        ...r,
        deliveryAddress: r.deliveryAddress || null,
        recipientName: r.recipientName || null,
        recipientPhone: r.recipientPhone || null,
        deliveryNotes: r.deliveryNotes || null,
        vendorsContacted: [...new Set((r.inquiries||[]).map(function(i){return i.vendor&&i.vendor.name;}).filter(Boolean))].length || 0,
        vendorNames: [...new Set((r.inquiries||[]).map(function(i){return i.vendor&&i.vendor.name;}).filter(Boolean))].join(', ') || '',
        vendorContacts: Object.values((r.inquiries||[]).reduce(function(acc,i){if(i.vendor&&i.vendor.name&&!acc[i.vendor.name])acc[i.vendor.name]={name:i.vendor.name,phone:i.vendor.phone||null,email:i.vendor.email||null,address:i.vendor.address||null};return acc;},{})),
        hasQuote: r.inquiries?.some(i => i.quoteAmount > 0),
        topQuote: r.inquiries?.filter(i=>i.quoteAmount).sort((a,b)=>a.quoteAmount-b.quoteAmount)[0]?.quoteAmount || null,
        googleVendors: uniqueUVVendors.map(u => ({
          id: u.id, name: u.vendorName, phone: u.vendorPhone, email: u.vendorEmail,
          status: u.status, city: u.city, registeredAt: u.registeredAt
        })),
        googleVendorsCount: uniqueUVVendors.length,
      };
    });
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Admin: manually redispatch a request to vendors
router.post('/requests/:id/redispatch', authenticate, async (req, res) => {
  try {
    const req2 = await prisma.request.findUnique({ where: { id: req.params.id } });
    if (!req2) return res.status(404).json({ error: 'Request not found' });
    const { dispatchToVendors } = require('../services/dispatch');
    await prisma.request.update({ where: { id: req.params.id }, data: { status: 'RECEIVED', adminNote: 'Manually redispatched by admin' } });
    dispatchToVendors(req2.id, req2.description || req2.title, req2.category, req2.userId).catch(e => console.error('[REDISPATCH]', e.message));
    res.json({ success: true, message: 'Redispatched to vendors' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



router.post('/vendors/:id/request-payment', authenticate, async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.params.id },
      include: { inquiries: { where: { commissionAmt: { gt: 0 }, status: { in: ['DELIVERED','COMPLETED'] }, paymentPaidAt: null } } }
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const totalOwed = vendor.inquiries.reduce((s,i) => s + (i.commissionAmt||0), 0);
    if (totalOwed === 0) return res.json({ message: 'No outstanding commission' });
    const { Resend } = require('resend');
    const rs = new Resend(process.env.RESEND_API_KEY);
    const portalUrl = (process.env.CC_URL||'https://consiere.com.au') + '/vendor-portal';
    await rs.emails.send({
      from: 'Consiere Accounts <hello@consiere.com.au>', to: vendor.email,
      subject: 'Commission Payment Required — $' + totalOwed.toFixed(2) + ' AUD Outstanding',
      html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;padding:32px;border:1px solid #e8e0d4;border-radius:8px"><h2 style="font-family:Georgia;color:#1c1917;font-weight:400">Commission Payment Required</h2><p style="color:#44403c;font-size:14px">Hi ' + vendor.name + ', you have an outstanding commission balance of <strong>$' + totalOwed.toFixed(2) + ' AUD</strong>.</p><div style="text-align:center;margin:24px 0"><a href="' + portalUrl + '" style="display:inline-block;padding:14px 32px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px">Pay Commission</a></div></div>'
    });
    res.json({ success: true, emailSent: vendor.email, amountOwed: totalOwed });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mark vendor commission as paid and reactivate
router.post('/vendors/:id/mark-paid', authenticate, async (req, res) => {
  try {
    await prisma.vendorInquiry.updateMany({
      where: { vendorId: req.params.id },
      data: { status: 'COMPLETED', paymentPaidAt: new Date() }
    });
    await prisma.vendor.update({ where: { id: req.params.id }, data: { isActive: true } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});



// ── Discovered (Google Places) leads for a request — review only ──
router.get('/discovered/:requestId', async (req, res) => {
  try {
    const leads = await prisma.unregisteredVendorRequest.findMany({
      where: { requestId: req.params.requestId },
      orderBy: { googleRating: 'desc' }
    });
    res.json(leads);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin-approved outreach to one discovered lead: email-first, WhatsApp fallback ──
// (shares the same logic used for registered-vendor dispatch — see unregistered_vendor.js)
router.post('/discovered/:id/invite', async (req, res) => {
  try {
    const { outreachUnregisteredVendor, REGISTRATION_WINDOW_MINUTES } = require('../services/unregistered_vendor');
    const lead = await prisma.unregisteredVendorRequest.findUnique({
      where: { id: req.params.id },
      include: { request: { select: { description: true } } }
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.registeredAt) return res.status(400).json({ error: 'This vendor has already registered' });
    if (!lead.vendorEmail && !lead.vendorPhone) return res.status(400).json({ error: 'No email or phone on file — contact manually' });
    // Reset the registration window from this approval moment, not from when the lead was
    // discovered — it may have sat in the review queue for a while before an admin got to it.
    const expiresAt = new Date(Date.now() + REGISTRATION_WINDOW_MINUTES * 60 * 1000);
    await prisma.unregisteredVendorRequest.update({ where: { id: lead.id }, data: { expiresAt } });
    await outreachUnregisteredVendor({ ...lead, expiresAt }, lead.request?.description || '', lead.category);
    console.log('[DISCOVERY INVITE] Outreach approved and sent for', lead.vendorName);
    return res.json({ success: true, invited: lead.vendorName });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── ADMIN: manually send a vendor's quote to the client (fallback if Alina didn't) ──
router.post('/inquiry/:inquiryId/send-quote-to-client', async (req, res) => {
  try {
    const { sendWA } = require('../services/whatsapp_notifications');
    const inq = await prisma.vendorInquiry.findUnique({
      where: { id: req.params.inquiryId },
      include: { vendor: { select: { name: true } }, request: { include: { user: { select: { phone: true, fullName: true } } } } }
    });
    if (!inq) return res.status(404).json({ error: 'Inquiry not found' });
    const phone = inq.request?.user?.phone;
    if (!phone) return res.status(400).json({ error: 'No client phone on file' });
    const quote = inq.quoteAmount ? ('$' + inq.quoteAmount) : 'See details';
    const msg = 'Update on your request:\n\n' +
      (inq.vendor?.name ? inq.vendor.name + '\n' : '') +
      'Quote: ' + quote + '\n' +
      (inq.quoteDetails ? inq.quoteDetails + '\n' : '') +
      '\nReply here to confirm or ask a question.\n\n— Consiere';
    await sendWA(phone, msg);
    console.log('[ADMIN] Quote sent to client', phone, 'for inquiry', inq.id);
    res.json({ success: true, sentTo: phone });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;