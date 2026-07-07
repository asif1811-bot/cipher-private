'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { sendWelcomeEmail } = require('../utils/email');
const logger = require('../utils/logger');

const router = express.Router();

// Klaviyo list IDs
const KLAVIYO_LISTS = {
  members:  'VrcY7j',  // Consiere Members
  waitlist: 'VxReBe',  // Consiere Waitlist
  email:    'W5hLPc',  // Email List
};

// Add profile to Klaviyo and subscribe to a list
async function addToKlaviyo(email, fullName, listId) {
  try {
    const [firstName, ...rest] = (fullName || '').split(' ');
    const lastName = rest.join(' ');
    const key = process.env.KLAVIYO_API_KEY;
    const headers = {
      'Authorization': 'Klaviyo-API-Key ' + key,
      'Content-Type': 'application/json',
      'revision': '2024-02-15'
    };

    // 1. Create/update profile
    const profileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: {
            email,
            first_name: firstName || '',
            last_name: lastName || '',
            properties: { source: 'Consiere Signup', platform: 'CONSIERE' }
          }
        }
      })
    });
    const profileData = await profileRes.json();
    const profileId = profileData?.data?.id;
    console.log('[KLAVIYO] Profile created:', email, profileId);

    // 2. Subscribe to list
    const targetList = listId || KLAVIYO_LISTS.members;
    if (profileId) {
      await fetch('https://a.klaviyo.com/api/lists/' + targetList + '/relationships/profiles/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: [{ type: 'profile', id: profileId }]
        })
      });
      console.log('[KLAVIYO] Added to list:', targetList);
    }
  } catch(e) {
    console.error('[KLAVIYO] Error:', e.message);
  }
}


const prisma = new PrismaClient();

const SESSION_DURATION_DAYS = 7;

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      // Intentionally vague error to prevent user enumeration
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Account suspended. Please contact support.' });
    }

    // Self-registered members via /signup are auto-approved
    // Only block if explicitly set to not approved AND has a pending application
    // (isApproved check removed to allow self-registration flow)

    // Create session token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: `${SESSION_DURATION_DAYS}d` }
    );

    try {
      await prisma.session.create({
        data: { userId: user.id, token, expiresAt },
      });
    } catch(sessionErr) {
      // Duplicate token — regenerate and retry once
      const newToken = require('jsonwebtoken').sign(
        { userId: user.id, role: user.role, nonce: Date.now() },
        process.env.JWT_SECRET,
        { expiresIn: `${SESSION_DURATION_DAYS}d` }
      );
      await prisma.session.create({
        data: { userId: user.id, token: newToken, expiresAt },
      });
      token = newToken;
    }

    logger.info(`User logged in: ${user.email} (${user.role})`);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        memberTier: user.memberTier,
      },
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  try {
    await prisma.session.delete({ where: { token: req.token } });
    res.json({ message: 'Logged out successfully' });
  } catch {
    res.json({ message: 'Logged out' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    memberTier: user.memberTier,
    createdAt: user.createdAt,
  });
});

// ── POST /api/auth/change-password ──────────────────────────────────────────
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords are required' });
    }

    if (newPassword.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash },
    });

    // Invalidate all other sessions
    await prisma.session.deleteMany({
      where: { userId: req.user.id, token: { not: req.token } },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    logger.error('Change password error', { error: err.message });
    res.status(500).json({ error: 'Failed to change password' });
  }
});


// Waitlist signup — saves to Klaviyo Consiere Waitlist
router.post('/waitlist', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
    await addToKlaviyo(email.toLowerCase(), '', KLAVIYO_LISTS.waitlist);
    console.log('[WAITLIST] Signed up:', email);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Check for duplicate phone number
    if (phone) {
      const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
      const phoneExists = await prisma.user.findFirst({ where: { phone: cleanPhone } });
      if (phoneExists) return res.status(400).json({ error: 'This mobile number is already registered. Please log in or use a different number.' });
    }
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { fullName: fullName.trim(), email: email.toLowerCase(), passwordHash: hash, role: 'MEMBER', memberTier: 'CIPHER', isActive: true, platform: 'CONSIERE' } });
    addToKlaviyo(email.toLowerCase(), fullName.trim());
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({ from: process.env.EMAIL_FROM||'hello@consiere.com.au', to: email, subject: 'Welcome to Consiere', html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f5f0;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#ffffff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">
  <div style="background:#1c1917;padding:32px 40px;text-align:center">
    <div style="font-size:10px;letter-spacing:6px;text-transform:uppercase;color:#b87333;margin-bottom:6px">Consiere</div>
    <div style="font-size:11px;letter-spacing:2px;color:#78716c;text-transform:uppercase">Your life, handled.</div>
  </div>
  <div style="padding:40px">
    <h2 style="font-family:Georgia,serif;font-size:24px;color:#1c1917;font-weight:400;margin:0 0 8px">Welcome, ` + fullName.split(' ')[0] + `.</h2>
    <p style="color:#b87333;font-size:13px;font-style:italic;margin:0 0 24px">Your personal AI concierge is ready.</p>
    <p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 16px">Meet <strong>Alina</strong> — your 24/7 personal concierge. Ask her to book a restaurant, arrange transport, source a gift, coordinate travel, or handle anything else on your list.</p>
    <p style="color:#44403c;font-size:14px;line-height:1.8;margin:0 0 24px">Your plan includes <strong>2 free requests this month</strong>. Upgrade anytime for more.</p>
    <div style="text-align:center;margin:0 0 28px">
      <a href="` + (process.env.CC_URL||'https://consiere.com.au') + `/cc-portal" style="display:inline-block;padding:14px 36px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:14px;letter-spacing:1px">Chat with Alina →</a>
    </div>
    <div style="background:#faf8f5;border-radius:8px;padding:20px 24px;margin:0 0 24px">
      <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#b87333;margin-bottom:12px">What can Alina handle?</div>
      <div style="display:grid;gap:8px">
        <div style="font-size:13px;color:#44403c">🍽️  Restaurant bookings & private dining</div>
        <div style="font-size:13px;color:#44403c">✈️  Travel planning & private aviation</div>
        <div style="font-size:13px;color:#44403c">🚗  Chauffeur & private transport</div>
        <div style="font-size:13px;color:#44403c">🎁  Personal shopping & gift sourcing</div>
        <div style="font-size:13px;color:#44403c">🏥  Medical appointments & specialist referrals</div>
        <div style="font-size:13px;color:#44403c">🏠  Home services & life admin</div>
      </div>
    </div>
    <p style="color:#78716c;font-size:12px;line-height:1.7;margin:0">Questions? Reply to this email or message Alina directly at <a href="mailto:hello@consiere.com.au" style="color:#b87333">hello@consiere.com.au</a></p>
  </div>
  <div style="background:#faf8f5;padding:20px 40px;border-top:1px solid #e8e0d4;text-align:center">
    <p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au · Sydney, Australia</p>
    <p style="color:#a8a29e;font-size:11px;margin:4px 0 0">Cipher Concierge Group Pty Ltd</p>
  </div>
</div></body></html>` });
    } catch(e) { console.log('[WELCOME]', e.message); }
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, memberTier: user.memberTier } });
  } catch(e) { console.error('[REGISTER]', e.message); res.status(500).json({ error: 'Registration failed. Please try again.' }); }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.json({ sent: true });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);
    await prisma.twoFactorCode.upsert({ where: { userId: user.id }, create: { userId: user.id, code, expiresAt: expiry }, update: { code, expiresAt: expiry } });
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: process.env.EMAIL_FROM||'hello@consiere.com.au', to: email, subject: 'Reset your Consiere password', html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f5f0;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:40px auto;background:#ffffff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">
  <div style="background:#1c1917;padding:32px 40px;text-align:center">
    <div style="font-size:10px;letter-spacing:6px;text-transform:uppercase;color:#b87333;margin-bottom:6px">Consiere</div>
    <div style="font-size:11px;letter-spacing:2px;color:#78716c;text-transform:uppercase">Your life, handled.</div>
  </div>
  <div style="padding:40px">
    <h2 style="font-family:Georgia,serif;font-size:22px;color:#1c1917;font-weight:400;margin:0 0 16px">Reset your password</h2>
    <p style="color:#44403c;font-size:14px;line-height:1.7;margin:0 0 24px">We received a request to reset your Consiere password. Use the code below — it expires in 15 minutes.</p>
    <div style="background:#faf8f5;border:1px solid rgba(184,115,51,0.25);border-radius:8px;padding:24px;text-align:center;margin:0 0 24px">
      <div style="font-size:36px;font-weight:700;letter-spacing:12px;color:#b87333;font-family:Georgia,serif">` + code + `</div>
    </div>
    <p style="color:#78716c;font-size:12px;line-height:1.7;margin:0 0 8px">If you did not request this, you can safely ignore this email. Your password will not change.</p>
    <p style="color:#78716c;font-size:12px">This code expires in 15 minutes.</p>
  </div>
  <div style="background:#faf8f5;padding:20px 40px;border-top:1px solid #e8e0d4;text-align:center">
    <p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au · Sydney, Australia</p>
    <p style="color:#a8a29e;font-size:11px;margin:4px 0 0">Cipher Concierge Group Pty Ltd</p>
  </div>
</div></body></html>` });
    res.json({ sent: true });
  } catch(e) { console.error('[FORGOT]', e.message); res.json({ sent: true }); }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'All fields required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(400).json({ error: 'Invalid code' });
    const tfa = await prisma.twoFactorCode.findUnique({ where: { userId: user.id } });
    if (!tfa || tfa.code !== code || new Date() > tfa.expiresAt) return res.status(400).json({ error: 'Invalid or expired code' });
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    await prisma.twoFactorCode.delete({ where: { userId: user.id } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Reset failed' }); }
});


module.exports = router;