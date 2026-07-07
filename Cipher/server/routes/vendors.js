'use strict';
const { getDynamicMarkup } = require('../services/automation_engine');
const express = require('express');
const router = express.Router();

// ── Referral: effective commission for a vendor ──
// Returns 8 if within a referral discount window OR it's their unused first job; else their normal rate.
function effectiveCommission(vendor, opts) {
  opts = opts || {};
  if (!vendor) return 10;
  var base = (typeof vendor.commissionPct === 'number' ? vendor.commissionPct : 10);
  // First-job perk for a referred new joiner (8% on first job only)
  if (opts.firstJob && vendor.referredBy && !vendor.firstJobDiscountUsed) return 8;
  // Time-based referrer discount (8% until commissionDiscountUntil)
  if (vendor.commissionDiscountUntil && new Date(vendor.commissionDiscountUntil) > new Date()) return 8;
  return base;
}
function genReferralCode(name) {
  var base = String(name||'VENDOR').replace(/[^A-Za-z0-9]/g,'').toUpperCase().substring(0,6) || 'VENDOR';
  return base + Math.random().toString(36).substring(2,6).toUpperCase();
}
const { PrismaClient } = require('@prisma/client');
const { calculateMemberPrice, getCurrencyForCity, CITY_COUNTRY } = require('../utils/currency');
const prisma = new PrismaClient();
const { authenticate, requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');

function genToken(inquiryId, vendorId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET||'cipher').update(inquiryId+':'+vendorId).digest('hex').substring(0,32);
}

// ── PUBLIC ROUTES ─────────────────────────────────────────────────

router.post('/apply', async (req, res) => {
  try {
    const { name, category, abn, contactName, email, phone, cities, suburbs, description, commissionPct, source, ref } = req.body;
    if (!name || !category || !contactName || !email || !cities) return res.status(400).json({ error: 'Required fields missing' });
    const _newCode = genReferralCode(name);
    const vendor = await prisma.vendor.create({ data: { name, category, contactName, email, phone: phone||'', cities, suburbs: suburbs||'', description: description||'', commissionPct: 10, isActive: false, referredBy: ref || null, referralCode: _newCode } });
    try {
      const { Resend } = require('resend');
      await new Resend(process.env.RESEND_API_KEY).emails.send({ from: 'Consiere <hello@consiere.com.au>', to: 'vendors@consiere.com.au', subject: '[Vendor Application] ' + name + ' — ' + category, html: '<div style="font-family:Arial;padding:24px"><h2>New Vendor Application</h2><p><b>Business:</b> ' + name + '</p><p><b>Category:</b> ' + category + '</p><p><b>Contact:</b> ' + contactName + ' | ' + email + '</p><p><b>Cities:</b> ' + cities + '</p><p><b>ABN:</b> ' + (abn||'not provided') + '</p><p><b>Commission:</b> ' + (commissionPct||10) + '%</p><p>Activate: <a href="https://consiere.com.au/cc-admin">cc-admin</a></p></div>' });
    } catch(e) { console.log('[APPLY EMAIL]', e.message); }
    console.log('[VENDOR APPLY]', name, category);
    res.json({ success: true });
  } catch(e) { console.error('[VENDOR APPLY]', e.message); res.status(500).json({ error: 'Application failed. Please try again.' }); }
});

router.get('/inquiry-brief', async (req, res) => {
  try {
    const { token, id } = req.query;
    if (!token || !id) return res.status(400).json({ error: 'Invalid link' });
    const inq = await prisma.vendorInquiry.findUnique({ where: { id }, include: { vendor: true, request: true } });
    if (!inq) return res.status(404).json({ error: 'Not found' });
    if (token !== genToken(id, inq.vendorId)) return res.status(403).json({ error: 'Invalid token' });
    res.json({ request: { title: inq.request?.title, description: inq.request?.description, category: inq.request?.category, priority: inq.request?.priority, createdAt: inq.request?.createdAt }, vendor: { name: inq.vendor?.name }, status: inq.status });
  } catch(e) { console.error('[INQUIRY BRIEF]', e.message); res.status(500).json({ error: 'Failed' }); }
});

router.post('/inquiry-respond', async (req, res) => {
  try {
    const { token, inquiryId, status, quoteAmount, quoteDetails, availability, earliestDate, validity, contactPerson, declineReason, declineNotes } = req.body;
    if (!token || !inquiryId) return res.status(400).json({ error: 'Invalid request' });
    const inq = await prisma.vendorInquiry.findUnique({ where: { id: inquiryId }, include: { vendor: true, request: true } });
    if (!inq) return res.status(404).json({ error: 'Not found' });
    if (token !== genToken(inquiryId, inq.vendorId)) return res.status(403).json({ error: 'Invalid token' });
    const upd = { status: status || 'RESPONDED' };
    if (quoteAmount) { var _qpct = effectiveCommission(inq.vendor); upd.quoteAmount = parseFloat(quoteAmount); upd.commissionAmt = parseFloat(quoteAmount) * _qpct / 100; upd.vendorAmount = parseFloat(quoteAmount) * (1 - _qpct / 100); }
    if (quoteDetails) upd.quoteDetails = quoteDetails + (contactPerson ? ' | Contact: '+contactPerson : '') + (availability ? ' | '+availability : '') + (validity ? ' | Valid: '+validity : '');
    if (status === 'DECLINED') upd.quoteDetails = 'DECLINED: ' + (declineReason||'No reason') + (declineNotes ? ' — '+declineNotes : '');
    await prisma.vendorInquiry.update({ where: { id: inquiryId }, data: upd });
    if (status === 'QUOTED' && inq.request) {
      await prisma.request.update({ where: { id: inq.request.id }, data: { status: 'IN_PROGRESS', adminNote: 'Quote from '+inq.vendor?.name+': $'+quoteAmount } }).catch(function(e){console.error("[VENDOR]",e&&e.message||e);});
      // Notify client via WhatsApp if they came from WhatsApp
      try {
        const { notifyClientViaWhatsApp } = require('../services/dispatch');
const { notifyQuoteReceived, getPhone } = require('../services/whatsapp_notifications');
        const clientUser = await prisma.user.findUnique({ where: { id: inq.request.userId }, select: { email: true, phone: true } });
        const isWAUser = clientUser?.email?.includes('@whatsapp.cipher');
        const waPhone = isWAUser
          ? '+' + clientUser.email.replace('wa_','').replace('@whatsapp.cipher','')
          : clientUser?.phone || null;
        if (waPhone) {
          const portalUrl = (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal';
          await notifyClientViaWhatsApp(waPhone, inq.vendor?.name || 'Our partner', quoteAmount, inq.request?.description || inq.request?.title || 'Your request', portalUrl);
          console.log('[VENDOR] WhatsApp quote sent to:', waPhone);
        }
      } catch(e) { console.error('[VENDOR WA NOTIFY]', e.message); }
    }
    try {
      const { Resend } = require('resend');
      await new Resend(process.env.RESEND_API_KEY).emails.send({ from: 'Consiere <hello@consiere.com.au>', to: 'vendors@consiere.com.au', subject: (status==='DECLINED'?'[Vendor Declined] ':'[Quote Received] ') + inq.vendor?.name + (quoteAmount?' — $'+quoteAmount+' AUD':''), html: '<div style="font-family:Arial;padding:24px"><h2>Vendor Response</h2><p><b>Vendor:</b> '+inq.vendor?.name+'</p><p><b>Request:</b> '+(inq.request?.title||inq.request?.description)+'</p>'+(quoteAmount?'<p><b>Quote:</b> $'+quoteAmount+' AUD</p>':'')+(quoteDetails?'<p><b>Details:</b> '+quoteDetails+'</p>':'')+'<p><a href="https://consiere.com.au/cc-admin">View in Admin</a></p></div>' });
    } catch(e) {}
    // ── NOTIFY CLIENT when vendor quotes or accepts ─────────────
    if ((status === 'QUOTED' || status === 'ACCEPTED') && inq.request) {
      try {
        const member = await prisma.user.findUnique({ where: { id: inq.request.userId } });
        if (member && member.email) {
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          const statusLabel = status === 'ACCEPTED' ? 'Confirmed' : 'Quote Received';
          const portalUrl = process.env.CC_URL || 'https://consiere.com.au';
          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'hello@consiere.com.au',
            to: member.email,
            subject: '[Consiere] ' + statusLabel + ' — ' + (inq.request.category || 'Your Request'),
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;background:#fff">
              <div style="background:#1c1917;padding:24px 28px;text-align:center">
                <div style="font-family:Georgia,serif;font-size:20px;color:#f0ede8;letter-spacing:3px">Cipher <span style="color:#b87333">Concierge</span></div>
              </div>
              <div style="padding:28px">
                <p style="font-size:15px;color:#1c1917;margin-bottom:8px">Hi ${member.fullName.split(' ')[0]},</p>
                <p style="font-size:14px;color:#44403c;line-height:1.7;margin-bottom:16px">
                  ${status === 'ACCEPTED'
                    ? 'Great news — your request has been <strong>confirmed</strong>. Our vendor partner is ready to proceed.'
                    : 'We have received a quote for your request. Your concierge team is reviewing it now.'}
                </p>
                <div style="background:#faf8f5;border-left:3px solid #b87333;padding:16px 18px;margin:16px 0;border-radius:0 6px 6px 0">
                  <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b87333;margin-bottom:8px">Request Details</div>
                  <div style="font-size:13px;color:#44403c"><strong>Category:</strong> ${inq.request.category || '—'}</div>
                  <div style="font-size:13px;color:#44403c;margin-top:4px"><strong>Request:</strong> ${(inq.request.title || inq.request.description || '').substring(0, 100)}</div>
                  ${quoteAmount ? '<div style="font-size:13px;color:#44403c;margin-top:4px"><strong>Quote:</strong> $' + parseFloat(quoteAmount).toLocaleString('en-AU', {minimumFractionDigits:2}) + ' AUD</div>' : ''}
                  ${quoteDetails ? '<div style="font-size:13px;color:#44403c;margin-top:4px"><strong>Details:</strong> ' + quoteDetails.substring(0,200) + '</div>' : ''}
                  <div style="font-size:13px;color:#44403c;margin-top:4px"><strong>Status:</strong> <span style="color:${status === 'ACCEPTED' ? '#16a34a' : '#b87333'}">${statusLabel}</span></div>
                </div>
                <div style="text-align:center;margin:24px 0">
                  <a href="${portalUrl}/cc-portal" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#b87333,#8a5a2e);color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:600;border-radius:6px">View in My Portal →</a>
                </div>
                <p style="font-size:12px;color:#78716c;line-height:1.6">Your dedicated concierge team will be in touch shortly with next steps. If you have any questions, simply reply to this email or message us on WhatsApp.</p>
              </div>
              <div style="background:#1c1917;padding:16px 28px;text-align:center">
                <div style="font-size:11px;color:rgba(255,255,255,0.3)">Consiere &nbsp;·&nbsp; hello@consiere.com.au</div>
              </div>
            </div>`
          });
          console.log('[VENDOR RESPOND] Client notification sent to:', member.email);
        }
      } catch(emailErr) {
        console.error('[VENDOR RESPOND] Client email error:', emailErr.message);
      }
    }
    // ── UPDATE REQUEST STATUS ─────────────────────────────────────
    if (status === 'ACCEPTED' && inq.request) {
      await prisma.request.update({
        where: { id: inq.request.id },
        data: { status: 'IN_PROGRESS', adminNote: '✓ Confirmed by ' + (inq.vendor?.name||'vendor') + (quoteAmount ? ' — $'+quoteAmount+' AUD' : '') }
      }).catch(function(e){console.error("[VENDOR]",e&&e.message||e);});
    }
    // ─────────────────────────────────────────────────────────────
    console.log('[VENDOR RESPOND]', inq.vendor?.name, status, quoteAmount ? '$'+quoteAmount : '');
    // Auto-handle vendor decline - notify member and redispatch
    if (status === 'DECLINED' && inq.request) {
      try {
        alinaAuto.handleVendorDecline(inquiryId).catch(e=>console.error('[ALINA AUTO]',e.message));
      } catch(e) {}
    }
    // Alina automation
    if (status === 'QUOTED') alinaAuto.notifyMemberOfQuote(inquiryId).catch(e=>console.error('[ALINA AUTO]',e.message));
    if (status === 'ACCEPTED') alinaAuto.sendBookingConfirmation(inquiryId).catch(e=>console.error('[ALINA AUTO]',e.message));
    res.json({ success: true });
  } catch(e) { console.error('[INQUIRY RESPOND]', e.message); res.status(500).json({ error: 'Failed to submit response' }); }
});

// ── Vendor Portal Auth ────────────────────────────────────────────
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function authenticateVendor(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorised' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'cipher');
    if (decoded.type !== 'vendor') return res.status(401).json({ error: 'Invalid token' });
    req.vendorId = decoded.vendorId;
    next();
  } catch(e) { res.status(401).json({ error: 'Invalid or expired token' }); }
}

// Vendor login
router.post('/portal/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const vendor = await prisma.vendor.findFirst({ where: { email: email.toLowerCase() } });
    if (!vendor) return res.status(401).json({ error: 'Invalid credentials' });
    if (!vendor.passwordHash) return res.status(401).json({ error: 'Account not activated. Please contact hello@consiere.com.au' });
    const valid = await bcrypt.compare(password, vendor.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    if (!vendor.isActive) return res.status(403).json({ error: 'Account suspended' });
    const token = jwt.sign({ vendorId: vendor.id, type: 'vendor' }, process.env.JWT_SECRET || 'cipher', { expiresIn: '30d' });
    await prisma.vendor.update({ where: { id: vendor.id }, data: { lastLoginAt: new Date() } });
    res.json({ token, vendor: { id: vendor.id, name: vendor.name, email: vendor.email, category: vendor.category, contactName: vendor.contactName } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vendor portal — get dashboard data
router.get('/portal/dashboard', authenticateVendor, async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { id: req.vendorId },
      include: { inquiries: {
        orderBy: { emailSentAt: 'desc' }, take: 50,
        include: { request: { select: { description: true, title: true, deliveryAddress: true, recipientName: true, recipientPhone: true, deliveryNotes: true, category: true, scheduledAt: true } } }
      }}
    });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const inquiries = vendor.inquiries.map(inq => ({
      ...inq,
      requestTitle: inq.request?.title || inq.quoteDetails || 'Service request',
      requestDescription: inq.request?.description || inq.quoteDetails || '',
      deliveryAddress: inq.request?.deliveryAddress || null,
      recipientName: inq.request?.recipientName || null,
      recipientPhone: inq.request?.recipientPhone || null,
      deliveryNotes: inq.request?.deliveryNotes || null,
      scheduledAt: inq.request?.scheduledAt || null,
    }));
    const stats = {
      total: inquiries.length,
      pending: inquiries.filter(i => i.status === 'SENT').length,
      quoted: inquiries.filter(i => i.status === 'QUOTED').length,
      accepted: inquiries.filter(i => i.status === 'ACCEPTED').length,
      delivered: inquiries.filter(i => i.deliveredAt).length,
      totalRevenue: inquiries.filter(i => i.billAmount).reduce((s,i) => s + (i.billAmount||0), 0),
    };
    res.json({ vendor: { name: vendor.name, email: vendor.email, category: vendor.category, contactName: vendor.contactName, cities: vendor.cities, isActive: vendor.isActive, referralCode: vendor.referralCode, referralCount: vendor.referralCount || 0, referralLink: (process.env.CC_URL||'https://consiere.com.au') + '/vendors?ref=' + (vendor.referralCode||'') }, stats, inquiries });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vendor submit quote — auto emails client with accept link
router.post('/portal/quote/:inquiryId', authenticateVendor, async (req, res) => {
  try {
    const { quoteAmount, quoteDetails, localCurrency } = req.body;
    if (!quoteAmount || !quoteDetails) return res.status(400).json({ error: 'Quote amount and details required' });
    const inquiry = await prisma.vendorInquiry.findUnique({
      where: { id: req.params.inquiryId },
      include: { request: { include: { user: { select: { email: true, fullName: true } } } } }
    });
    if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' });
    if (inquiry.vendorId !== req.vendorId) return res.status(403).json({ error: 'Unauthorised' });

    // Generate secure quote acceptance token
    const crypto = require('crypto');
    const quoteToken = crypto.randomBytes(32).toString('hex');

    // Auto-convert vendor local currency to AUD + 20% international fee
    let audAmount = parseFloat(quoteAmount);
    let currencyNote = '';
    try {
      const vendorRec = await prisma.vendor.findUnique({ where: { id: req.vendorId }, select: { cities: true } });
      const vendorCity = (vendorRec?.cities||'Sydney').split(',')[0].trim();
      const { calculateMemberPrice, getCurrencyForCity } = require('../utils/currency');
      const vendorCurrencyCode = localCurrency || getCurrencyForCity(vendorCity).code;
      if (vendorCurrencyCode !== 'AUD') {
        const converted = await calculateMemberPrice(parseFloat(quoteAmount), vendorCurrencyCode, vendorCity);
        audAmount = converted.totalAUD;
        currencyNote = ' [' + vendorCurrencyCode + ' ' + quoteAmount + ' = A$' + converted.totalAUD + ' incl. 20% fee]';
        console.log('[CURRENCY] Quote converted:', vendorCurrencyCode, quoteAmount, '-> AUD', audAmount);
      }
    } catch(e) { console.error('[CURRENCY QUOTE]', e.message); }
    const updated = await prisma.vendorInquiry.update({
      where: { id: req.params.inquiryId },
      data: { status: 'QUOTED', quoteAmount: audAmount, quoteDetails: quoteDetails + currencyNote, respondedAt: new Date(), quoteToken }
    });

    // Update request status
    await prisma.request.update({ where: { id: inquiry.requestId }, data: { status: 'AWAITING_MEMBER' } }).catch(function(e){console.error("[VENDOR]",e&&e.message||e);});

    const vendor = await prisma.vendor.findUnique({ where: { id: req.vendorId }, select: { name: true } });
    const member = inquiry.request?.user;
    const firstName = (member?.fullName || 'there').split(' ')[0];
    const requestTitle = inquiry.request?.title || inquiry.request?.description?.substring(0,60) || 'Your request';
    const acceptUrl = (process.env.CC_URL || 'https://consiere.com.au') + '/pay?q=' + req.params.inquiryId + '&t=' + quoteToken;
    const portalUrl = (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal';

    // Email client with quote and accept link
    if (member?.email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Consiere <hello@consiere.com.au>',
          to: member.email,
          subject: 'Your quote is ready — ' + requestTitle.substring(0,50),
          html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
            '<div style="background:#1c1917;padding:24px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div></div>' +
            '<div style="padding:32px">' +
            '<h2 style="font-family:Georgia;font-size:22px;color:#1c1917;font-weight:400;margin:0 0 8px">Hi ' + firstName + ', your quote is ready</h2>' +
            '<p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 20px">Alina has received a quote for your request. Please review and confirm to proceed.</p>' +
            '<div style="background:#faf8f5;border:1px solid #e8e0d4;border-radius:8px;padding:20px;margin:0 0 20px">' +
            '<div style="font-size:11px;color:#78716c;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Your Request</div>' +
            '<div style="font-size:15px;font-weight:500;color:#1c1917;margin-bottom:16px">' + requestTitle + '</div>' +
            '<div style="font-size:11px;color:#78716c;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Quote from ' + vendor?.name + '</div>' +
            '<div style="font-size:32px;font-family:Georgia;color:#b87333;font-weight:400;margin-bottom:8px">$' + parseFloat(quoteAmount).toFixed(2) + ' AUD</div>' +
            '<div style="font-size:13px;color:#44403c;line-height:1.7">' + quoteDetails + '</div>' +
            '</div>' +
            '<div style="background:#fff8f0;border:1px solid rgba(184,115,51,0.2);border-radius:8px;padding:14px;margin:0 0 24px;font-size:13px;color:#78716c">' +
            '&#9432; Once you accept and pay, ' + vendor?.name + ' will be confirmed and will proceed with your order.' +
            '</div>' +
            '<div style="text-align:center;margin-bottom:16px">' +
            '<a href="' + acceptUrl + '" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#b87333,#8a5a2e);color:#fff;text-decoration:none;font-weight:600;border-radius:8px;font-size:16px">Accept & Pay $' + parseFloat(quoteAmount).toFixed(2) + ' AUD</a>' +
            '</div>' +
            '<p style="text-align:center;font-size:12px;color:#a8a29e">Or <a href="' + portalUrl + '" style="color:#b87333">view in your portal</a> to manage this request.</p>' +
            '</div>' +
            '<div style="background:#faf8f5;padding:14px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere &middot; hello@consiere.com.au</p></div>' +
            '</div>'
        });
        console.log('[QUOTE] Client email sent to:', member.email);
      } catch(emailErr) { console.error('[QUOTE EMAIL]', emailErr.message); }
    }

    // Notify admin
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>',
        to: 'hello@consiere.com.au',
        subject: '[Quote Sent to Client] ' + (vendor?.name||'Vendor') + ' — $' + quoteAmount,
        html: '<div style="font-family:Arial;padding:24px"><h2>Quote Submitted & Client Notified</h2><p><b>Vendor:</b> ' + (vendor?.name||'') + '</p><p><b>Amount:</b> $' + quoteAmount + ' AUD</p><p><b>Details:</b> ' + quoteDetails + '</p><p><b>Client:</b> ' + (member?.email||'') + '</p><p style="color:#16a34a">✓ Client has been emailed the quote with an Accept & Pay link.</p><p><a href="https://consiere.com.au/cc-admin">View in Admin</a></p></div>'
      });
    } catch(e) {}

    res.json({ success: true, inquiry: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vendor decline inquiry
router.post('/portal/decline/:inquiryId', authenticateVendor, async (req, res) => {
  try {
    const inquiry = await prisma.vendorInquiry.findUnique({ where: { id: req.params.inquiryId } });
    if (!inquiry || inquiry.vendorId !== req.vendorId) return res.status(403).json({ error: 'Unauthorised' });
    await prisma.vendorInquiry.update({ where: { id: req.params.inquiryId }, data: { status: 'DECLINED', respondedAt: new Date() } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vendor mark as delivered + submit bill
router.post('/portal/deliver/:inquiryId', authenticateVendor, async (req, res) => {
  try {
    const { billAmount, deliveryNote } = req.body;
    if (!billAmount) return res.status(400).json({ error: 'Bill amount required' });
    const inquiry = await prisma.vendorInquiry.findUnique({ where: { id: req.params.inquiryId } });
    if (!inquiry || inquiry.vendorId !== req.vendorId) return res.status(403).json({ error: 'Unauthorised' });

    const amount = parseFloat(billAmount);
    // Load the vendor to compute the correct (possibly discounted) commission
    const _billVendor = await prisma.vendor.findUnique({ where: { id: inquiry.vendorId } }).catch(()=>null);
    const _isFirstJob = !!(_billVendor && _billVendor.referredBy && !_billVendor.firstJobDiscountUsed);
    const _pct = effectiveCommission(_billVendor, { firstJob: _isFirstJob });
    const commission = Math.round(amount * (_pct/100) * 100) / 100;
    if (_isFirstJob && _billVendor) { await prisma.vendor.update({ where: { id: _billVendor.id }, data: { firstJobDiscountUsed: true } }).catch(()=>{}); console.log('[REFERRAL] First-job 8% applied + consumed for', _billVendor.name); }
    console.log('[BILLING] Commission', _pct + '% =', commission, 'for vendor', inquiry.vendorId);
    const vendorOwes = Math.max(0, Math.round((commission - 20) * 100) / 100);
    const consierePays = Math.max(0, Math.round((20 - commission) * 100) / 100);
    const clientPaysVendor = Math.max(0, Math.round((amount - 20) * 100) / 100);

    await prisma.vendorInquiry.update({
      where: { id: req.params.inquiryId },
      data: { status: 'DELIVERED', deliveredAt: new Date(), deliveryNote: deliveryNote||'', billAmount: amount, billSubmittedAt: new Date(), commissionAmt: commission }
    });

    // Notify client of delivery
    try {
      const inquiry = await prisma.vendorInquiry.findUnique({
        where: { id: req.params.inquiryId },
        include: { request: { include: { user: { select: { email: true, fullName: true } } } }, vendor: { select: { name: true } } }
      });
      const member = inquiry?.request?.user;
      const firstName = (member?.fullName || 'there').split(' ')[0];
      if (member?.email) {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Consiere <hello@consiere.com.au>',
          to: member.email,
          subject: 'Your order has been delivered! — Consiere',
          html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
            '<div style="background:#1c1917;padding:20px;text-align:center"><div style="color:#b87333;letter-spacing:4px;font-size:11px">CONSIERE</div></div>' +
            '<div style="padding:28px">' +
            '<div style="text-align:center;margin-bottom:20px"><div style="width:56px;height:56px;background:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:24px">✓</div></div>' +
            '<h2 style="font-family:Georgia;font-size:22px;color:#1c1917;font-weight:400;text-align:center;margin:0 0 12px">Your order has been delivered!</h2>' +
            '<p style="color:#44403c;font-size:14px;line-height:1.8;text-align:center;margin:0 0 20px">Hi ' + firstName + ', ' + (inquiry?.vendor?.name||'your provider') + ' has marked your order as delivered.</p>' +
            '<div style="background:#faf8f5;border:1px solid #e8e0d4;border-radius:8px;padding:16px;margin:0 0 20px">' +
            '<div style="font-size:13px;color:#1c1917"><b>Order:</b> ' + (inquiry?.request?.title || 'Your request') + '</div>' +
            (deliveryNote ? '<div style="font-size:13px;color:#44403c;margin-top:8px"><b>Delivery note:</b> ' + deliveryNote + '</div>' : '') +
            '</div>' +
            '<p style="color:#44403c;font-size:13px;line-height:1.8">If you have any questions, reply to this email or contact hello@consiere.com.au</p>' +
            '<div style="text-align:center;margin-top:20px"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/cc-portal" style="display:inline-block;padding:12px 24px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:7px">View in Portal</a></div>' +
            '</div></div>'
        });
        console.log('[DELIVERY] Client notified:', member.email);
      }
    } catch(deliveryEmailErr) { console.error('[DELIVERY EMAIL]', deliveryEmailErr.message); }

    // Notify admin
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      const v = await prisma.vendor.findUnique({ where: { id: req.vendorId }, select: { name: true } });
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>',
        to: 'hello@consiere.com.au',
        subject: '[Delivered] ' + v.name + ' — Bill $' + amount,
        html: '<div style="font-family:Arial;padding:24px"><h2>Order Delivered</h2><p><b>Vendor:</b> ' + v.name + '</p><p><b>Bill:</b> $' + amount + ' AUD</p><p><b>Commission (' + _pct + '%):</b> $' + commission + '</p><p><b>Deposit received:</b> $20.00</p>' +
          (vendorOwes > 0 ? '<p style="color:#dc2626"><b>⚠ Vendor owes Consiere: $' + vendorOwes + '</b> — request bank transfer</p>' : '') +
          (consierePays > 0 ? '<p style="color:#16a34a"><b>↩ Consiere refunds vendor: $' + consierePays + '</b></p>' : '') +
          '<p><b>Client pays vendor directly: $' + clientPaysVendor + '</b></p>' +
          (deliveryNote ? '<p><b>Note:</b> ' + deliveryNote + '</p>' : '') +
          '<p><a href="https://consiere.com.au/cc-admin">View in Admin</a></p></div>'
      });
    } catch(e) {}

    alinaAuto.raiseCommissionInvoice(req.params.inquiryId).catch(e=>console.error('[ALINA AUTO]',e.message));
    res.json({ success: true, commission, vendorOwes, consierePays, clientPaysVendor, message: vendorOwes > 0 ? 'Delivered. Please transfer $' + vendorOwes + ' to Consiere.' : consierePays > 0 ? 'Delivered. Consiere will refund you $' + consierePays : 'Delivered. Commission exactly covered.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin — set vendor password (onboarding)
router.post('/portal/set-password', authenticate, async (req, res) => {
  try {
    const { vendorId, password } = req.body;
    if (!vendorId || !password) return res.status(400).json({ error: 'Vendor ID and password required' });
    const hash = await bcrypt.hash(password, 12);
    await prisma.vendor.update({ where: { id: vendorId }, data: { passwordHash: hash, isVerified: true } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Vendor save bank details
router.post('/portal/bank-details', authenticateVendor, async (req, res) => {
  try {
    const { accountName, bsb, accountNumber, bankName } = req.body;
    if (!accountName || !bsb || !accountNumber) return res.status(400).json({ error: 'Account name, BSB and account number required' });
    await prisma.vendor.update({
      where: { id: req.vendorId },
      data: { bankAccountName: accountName, bankBSB: bsb, bankAccountNum: accountNumber, bankName: bankName||'' }
    });
    // Notify admin
    const vendor = await prisma.vendor.findUnique({ where: { id: req.vendorId }, select: { name: true, email: true } });
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Consiere <hello@consiere.com.au>',
        to: 'hello@consiere.com.au',
        subject: '[Bank Details] ' + vendor.name + ' updated bank account',
        html: '<div style="font-family:Arial;padding:24px"><h2>Vendor Bank Details Updated</h2>' +
          '<p><b>Vendor:</b> ' + vendor.name + ' (' + vendor.email + ')</p>' +
          '<p><b>Account Name:</b> ' + accountName + '</p>' +
          '<p><b>BSB:</b> ' + bsb + '</p>' +
          '<p><b>Account Number:</b> ' + accountNumber + '</p>' +
          '<p><b>Bank:</b> ' + (bankName||'Not specified') + '</p></div>'
      });
    } catch(e) {}
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vendor change password
router.post('/portal/change-password', authenticateVendor, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 12);
    await prisma.vendor.update({ where: { id: req.vendorId }, data: { passwordHash: hash } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── PROTECTED ROUTES — admin only ────────────────────────────────

router.post('/accept-quote', async (req, res) => {
  try {
    const { inquiryId, userId } = req.body;
    if (!inquiryId || !userId) return res.status(400).json({ error: 'Missing fields' });
    
    const inq = await prisma.vendorInquiry.findUnique({
      where: { id: inquiryId },
      include: { vendor: true, request: { include: { user: true } } }
    });
    if (!inq) return res.status(400).json({ error: 'Inquiry not found' });
    if (!inq.quoteAmount) return res.status(400).json({ error: 'No quote amount set' });
    
    // Update status
    await prisma.vendorInquiry.update({ where: { id: inquiryId }, data: { status: 'ACCEPTED', quoteAcceptedAt: new Date() } });
    await prisma.request.update({ where: { id: inq.requestId }, data: { status: 'IN_PROGRESS', adminNote: 'Quote accepted: $' + inq.quoteAmount + ' from ' + inq.vendor?.name } });
    
    // Create Stripe checkout for the full amount
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{ price_data: { currency: 'aud', product_data: { name: inq.request?.title || 'Consiere Service', description: inq.quoteDetails?.substring(0,200) || '' }, unit_amount: Math.round(inq.quoteAmount * 100) }, quantity: 1 }],
      metadata: { inquiryId, userId, type: 'quote_payment', requestId: inq.requestId, vendorId: inq.vendorId },
      success_url: (process.env.CC_URL || 'https://consiere.com.au') + '/pay/success?requestId=' + inq.requestId,
      cancel_url: (process.env.CC_URL || 'https://consiere.com.au') + '/cc-portal',
    });
    
    // Send booking confirmations
    alinaAuto.sendBookingConfirmation(inquiryId).catch(e => console.error('[ALINA AUTO]', e.message));
    
    console.log('[ACCEPT QUOTE] Inquiry:', inquiryId, 'Amount: $' + inq.quoteAmount, 'Checkout:', session.id);
    res.json({ success: true, checkoutUrl: session.url, sessionId: session.id });
  } catch(e) { console.error('[ACCEPT QUOTE ERROR]', e.message); res.status(500).json({ error: e.message }); }
});


router.use(authenticate, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({ orderBy: { category: 'asc' }, include: { _count: { select: { inquiries: true } } } });
    res.json({ vendors });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, category, contactName, email, phone, commissionPct, cities, suburbs, description, isActive, password, sendCredentials } = req.body;
    if (!name || !contactName || !email) return res.status(400).json({ error: 'Name, contact and email required' });
    let passwordHash = null;
    if (password) passwordHash = await bcrypt.hash(password, 12);
    // Geocode the vendor so distance matching works.
    let _vlat = null, _vlng = null;
    try {
      const { geocode } = require('../utils/geo');
      const geoQ = name + ', ' + (suburbs || '') + ' ' + (cities || 'Sydney') + ', Australia';
      const g = await geocode(geoQ);
      if (g) { _vlat = g.lat; _vlng = g.lng; console.log('[VENDOR ONBOARD] Geocoded', name, '->', _vlat, _vlng); }
      else console.log('[VENDOR ONBOARD] Could not geocode', name, '— lat/lng left null');
    } catch(geoErr) { console.error('[VENDOR ONBOARD] geocode error:', geoErr.message); }

    const vendor = await prisma.vendor.create({ data: {
      name, category: category||'OTHER', contactName, email: email.toLowerCase(),
      phone: phone||'', commissionPct: parseFloat(commissionPct)||10,
      cities: cities||'Sydney', suburbs: suburbs||'', description: description||'',
      lat: _vlat, lng: _vlng,
      isActive: isActive !== false, passwordHash, isVerified: !!password
    }});
    if (sendCredentials && password) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const portalUrl = (process.env.CC_URL||'https://consiere.com.au') + '/vendor-portal';
        await resend.emails.send({
          from: 'Consiere <hello@consiere.com.au>',
          to: email,
          subject: 'Welcome to Consiere Vendor Network — Your Login Details',
          html: [
            '<div style="font-family:Arial;max-width:560px;background:#fff;margin:40px auto;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">',
            '<div style="background:#1c1917;padding:24px;text-align:center">',
            '<div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div>',
            '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px">Vendor Partner Network</div>',
            '</div>',
            '<div style="padding:32px">',
            '<h2 style="font-family:Georgia;font-size:22px;color:#1c1917;font-weight:400;margin:0 0 16px">Welcome, ' + contactName + '!</h2>',
            '<p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 24px">Your Consiere vendor account is now active. Use the details below to log in.</p>',
            '<div style="background:#faf8f5;border:1px solid #e8e0d4;border-radius:8px;padding:20px;margin:0 0 20px">',
            '<div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#b87333;margin-bottom:14px">Login Details</div>',
            '<div style="margin-bottom:10px"><div style="font-size:11px;color:#78716c;margin-bottom:3px">Portal URL</div>',
            '<div style="color:#b87333;font-weight:600">' + portalUrl + '</div></div>',
            '<div style="margin-bottom:10px"><div style="font-size:11px;color:#78716c;margin-bottom:3px">Email</div>',
            '<div style="font-weight:600;color:#1c1917">' + email + '</div></div>',
            '<div><div style="font-size:11px;color:#78716c;margin-bottom:3px">Temporary Password</div>',
            '<div style="font-size:22px;font-weight:700;color:#b87333;letter-spacing:4px;font-family:monospace">' + password + '</div></div>',
            '</div>',
            '<div style="background:#fff8f0;border:1px solid rgba(184,115,51,0.2);border-radius:8px;padding:12px 16px;margin:0 0 20px;font-size:13px;color:#78716c">',
            'Please change your password after first login.</div>',
            '<div style="text-align:center">',
            '<a href="' + portalUrl + '" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:7px;font-size:14px">Login to Vendor Portal</a>',
            '</div></div>',
            '<div style="background:#faf8f5;padding:14px;text-align:center;border-top:1px solid #e8e0d4">',
            '<p style="color:#a8a29e;font-size:11px;margin:0">Consiere &middot; hello@consiere.com.au</p>',
            '</div></div>'
          ].join('')
        });
        console.log('[VENDOR ONBOARD] Credentials sent to:', email);
      } catch(emailErr) { console.error('[VENDOR EMAIL]', emailErr.message); }
    }
    res.json({ vendor, credentialsSent: !!(sendCredentials && password) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name, category, contactName, email, phone, commissionPct, cities, description, isActive, isVerified } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (category !== undefined) data.category = category;
    if (contactName !== undefined) data.contactName = contactName;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (commissionPct !== undefined) data.commissionPct = parseFloat(commissionPct);
    if (cities !== undefined) data.cities = cities;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;
    if (isVerified !== undefined) data.isVerified = isVerified;

    // Load the vendor BEFORE update to detect the verify transition + referral
    const _before = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data });

    // ── REFERRAL REWARD: fires ONCE when a referred vendor is first verified ──
    try {
      const _justVerified = isVerified === true && _before && !_before.isVerified;
      if (_justVerified && vendor.referredBy && !vendor.referralRewarded) {
        const referrer = await prisma.vendor.findFirst({ where: { referralCode: vendor.referredBy } });
        if (referrer) {
          const until = new Date(Date.now() + 60*24*60*60*1000); // 60 days
          await prisma.vendor.update({ where: { id: referrer.id }, data: { commissionDiscountUntil: until, referralCount: { increment: 1 } } });
          await prisma.vendor.update({ where: { id: vendor.id }, data: { referralRewarded: true } });
          console.log('[REFERRAL] Reward granted: referrer', referrer.name, '-> 8% until', until.toISOString().slice(0,10));
          try {
            const { sendWA } = require('../services/whatsapp_notifications');
            if (referrer.phone) await sendWA(referrer.phone, '\u{1F91D} *Referral verified!*\n\n' + vendor.name + ' has joined Consiere through your referral.\n\nYou now get *8% commission* (down from 10%) for the next 60 days. Thank you!\n\n_\u2014 Consiere Vendor Team_');
          } catch(waErr) { console.error('[REFERRAL WA]', waErr.message); }
        } else {
          console.log('[REFERRAL] referredBy code', vendor.referredBy, 'matched no referrer — no reward');
        }
      }
    } catch(refErr) { console.error('[REFERRAL]', refErr.message); }

    res.json({ vendor });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await prisma.vendor.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/inquiries/all', async (req, res) => {
  try {
    const inquiries = await prisma.vendorInquiry.findMany({ orderBy: { createdAt: 'desc' }, include: { vendor: true } });
    const totalCommission = inquiries.reduce((s,i) => {
      if (i.commissionAmt) return s + i.commissionAmt;
      if (i.billAmount) return s + Math.round(i.billAmount * ((i.vendor&&i.vendor.commissionPct||10)/100) * 100) / 100;
      return s;
    }, 0);
    res.json({ inquiries, totalCommission, pendingCount: inquiries.filter(i => ['SENT','RESPONDED','QUOTED'].includes(i.status)).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch('/inquiries/:id', async (req, res) => {
  try {
    const { status, quoteAmount, quoteDetails, commissionAmt, notes } = req.body;
    const data = {};
    if (status) data.status = status;
    if (quoteAmount) {
      // Use the vendor's effective (possibly referral-discounted) commission, not a hardcoded 10%.
      const _inq = await prisma.vendorInquiry.findUnique({ where: { id: req.params.id }, include: { vendor: true } });
      const _pct = effectiveCommission(_inq && _inq.vendor);
      data.quoteAmount = parseFloat(quoteAmount);
      data.commissionAmt = parseFloat(quoteAmount) * (_pct/100);
      data.vendorAmount = parseFloat(quoteAmount) * (1 - _pct/100);
    }
    if (quoteDetails) data.quoteDetails = quoteDetails;
    if (commissionAmt) data.commissionAmt = parseFloat(commissionAmt);
    if (notes) data.notes = notes;
    const inquiry = await prisma.vendorInquiry.update({ where: { id: req.params.id }, data, include: { vendor: true } });
    res.json({ inquiry });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Member accepts quote — trigger Stripe payment ──────────



module.exports = router;