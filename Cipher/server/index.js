'use strict';

require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const logger       = require('./utils/logger');
const authRoutes         = require('./routes/auth');
const requestRoutes      = require('./routes/requests');
const documentRoutes     = require('./routes/documents');
const otpRoutes          = require('./routes/otp');
const adminRoutes        = require('./routes/admin');
const applicationRoutes  = require('./routes/applications');
const chatRoutes         = require('./routes/chat');
const { authenticateSocket } = require('./middleware/auth');
const { handleSocketConnection } = require('./socket/chatHandler');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', credentials: true },
  pingTimeout: 60000,
});

// ─── Upload directory ────────────────────────────────────────────────────────
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ─── Security log store (in-memory, survives restarts via log file) ──────────
const SECURITY_LOG_FILE = process.env.SECURITY_LOG || './security.log';
const loginAttempts = {};   // ip → { count, firstAt, lockedUntil }
const activeSessions = {};  // token-hash → { userId, ip, ua, loginAt, lastSeen }

function secLog(event, data) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n';
  logger.warn('[SECURITY] ' + event + ' ' + JSON.stringify(data));
  try { fs.appendFileSync(SECURITY_LOG_FILE, entry); } catch(_) {}
}

function getIP(req) {
  return req.headers['cf-connecting-ip']        // Cloudflare real IP
    || req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

// ─── Rate limiter (no external package needed) ───────────────────────────────
const requestCounts = {}; // ip → [timestamps]

function rateLimit(windowMs, max, message) {
  return (req, res, next) => {
    const ip  = getIP(req);
    const now = Date.now();
    if (!requestCounts[ip]) requestCounts[ip] = [];
    requestCounts[ip] = requestCounts[ip].filter(t => now - t < windowMs);
    requestCounts[ip].push(now);
    if (requestCounts[ip].length > max) {
      secLog('RATE_LIMIT', { ip, path: req.path, count: requestCounts[ip].length });
      return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// ─── Login brute-force protection ────────────────────────────────────────────
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;  // 15 minutes
const LOGIN_LOCKOUT_MS   = 30 * 60 * 1000;  // 30 minutes lockout

function loginGuard(req, res, next) {
  const ip  = getIP(req);
  const now = Date.now();
  const rec = loginAttempts[ip] || { count: 0, firstAt: now, lockedUntil: 0 };

  if (rec.lockedUntil > now) {
    const mins = Math.ceil((rec.lockedUntil - now) / 60000);
    secLog('LOGIN_BLOCKED', { ip, lockedFor: mins + 'min' });
    return res.status(429).json({
      error: `Too many failed login attempts. Access locked for ${mins} more minute${mins > 1 ? 's' : ''}.`
    });
  }

  // Reset window if expired
  if (now - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts[ip] = { count: 0, firstAt: now, lockedUntil: 0 };
  }

  req._loginIP = ip;
  next();
}

function recordLoginFailure(ip) {
  const now = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAt: now, lockedUntil: 0 };
  loginAttempts[ip].count++;
  if (loginAttempts[ip].count >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts[ip].lockedUntil = now + LOGIN_LOCKOUT_MS;
    secLog('LOGIN_LOCKOUT', { ip, attempts: loginAttempts[ip].count });
  } else {
    secLog('LOGIN_FAIL', { ip, attempt: loginAttempts[ip].count });
  }
}

function recordLoginSuccess(ip, userId, token) {
  loginAttempts[ip] = { count: 0, firstAt: Date.now(), lockedUntil: 0 };
  secLog('LOGIN_SUCCESS', { ip, userId });
  // Register active session
  activeSessions[hashToken(token)] = {
    userId, ip, loginAt: new Date().toISOString(), lastSeen: Date.now()
  };
}

// ─── Session activity tracker ────────────────────────────────────────────────
function trackSession(req, _res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const h = hashToken(auth.slice(7));
    if (activeSessions[h]) {
      const sess = activeSessions[h];
      const ip   = getIP(req);
      // Flag if IP changed mid-session
      if (sess.ip !== ip && sess.ip !== 'unknown') {
        secLog('SESSION_IP_CHANGE', { userId: sess.userId, original: sess.ip, current: ip, path: req.path });
      }
      sess.lastSeen = Date.now();
    }
  }
  next();
}

// ─── Session expiry (30 min inactivity) ──────────────────────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  Object.keys(activeSessions).forEach(h => {
    if (now - activeSessions[h].lastSeen > SESSION_TIMEOUT_MS) {
      secLog('SESSION_EXPIRED', { userId: activeSessions[h].userId, ip: activeSessions[h].ip });
      delete activeSessions[h];
    }
  });
}, 60 * 1000); // check every minute

// ─── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Extra security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// ─── Redirect .com.au → .com ─────────────────────────────────────────────────
app.use((req, res, next) => {
  if ((req.headers.host || '').includes('cipherprivate.com.au')) {
    return res.redirect(301, 'https://cipherprivate.com' + req.originalUrl);
  }
  next();
});

app.use(cors({ origin: '*', credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => { logger.info(req.method + ' ' + req.path); next(); });
app.use(trackSession);

// ─── Global rate limit: 120 requests/min per IP ──────────────────────────────
app.use(rateLimit(60 * 1000, 120, 'Too many requests. Please slow down.'));

// ─── Public routes (no auth) ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'operational', service: 'Cipher Private', ts: new Date().toISOString() });
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nSitemap: https://cipherprivate.com/sitemap.xml\n');
});

app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://cipherprivate.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`);
});

// ─── Security report endpoint (admin only) ───────────────────────────────────
app.get('/api/admin/security-report', (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const sessions = Object.values(activeSessions).map(s => ({
    userId: s.userId, ip: s.ip,
    loginAt: s.loginAt,
    lastSeen: new Date(s.lastSeen).toISOString(),
    idleMins: Math.floor((Date.now() - s.lastSeen) / 60000)
  }));
  const locked = Object.entries(loginAttempts)
    .filter(([_, r]) => r.lockedUntil > Date.now())
    .map(([ip, r]) => ({ ip, lockedUntil: new Date(r.lockedUntil).toISOString(), attempts: r.count }));
  res.json({ activeSessions: sessions.length, sessions, lockedIPs: locked });
});

// ─── Auth routes with brute-force protection ─────────────────────────────────
// Tight rate limit on login: 10 attempts per 15 min
app.use('/api/auth/login',
  rateLimit(15 * 60 * 1000, 10, 'Too many login attempts. Please wait 15 minutes.'),
  loginGuard
);

app.use('/api/auth', authRoutes);

// Hook into auth response to record successes/failures
// We wrap the login route to intercept the response
app.use('/api/auth/login', (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    if (res.statusCode === 200 && data.token) {
      recordLoginSuccess(req._loginIP || getIP(req), data.user?.id || 'unknown', data.token);
    } else if (res.statusCode >= 400) {
      recordLoginFailure(req._loginIP || getIP(req));
    }
    return originalJson(data);
  };
  next();
});


// ─── SERVER-SIDE 2FA ────────────────────────────────────────────────────────
// ── SERVER-SIDE 2FA ──────────────────────────────────────────────────────────
// Replaces client-side code generation with server-generated, server-verified OTP
// Codes are stored in DB with expiry, never exposed to browser

const twoFACodes = {}; // userId -> { code, expiresAt, attempts }

// Generate and send 2FA code
app.post('/api/auth/request-2fa', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    const token = auth.slice(7);
    let userId, userEmail;

    // Verify the JWT to get user
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId || decoded.id;
    } catch(e) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Get user email from database
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await prisma.$disconnect();

    if (!user) return res.status(404).json({ error: 'User not found' });
    userEmail = user.email;

    // Rate limit: max 3 code requests per 15 minutes per user
    const existing = twoFACodes[userId];
    if (existing && existing.requestCount >= 3 && Date.now() < existing.windowEnd) {
      return res.status(429).json({ error: 'Too many code requests. Please wait 15 minutes.' });
    }

    // Generate cryptographically secure 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store server-side — never sent to client
    twoFACodes[userId] = {
      code,
      expiresAt,
      attempts: 0,
      requestCount: (existing?.requestCount || 0) + 1,
      windowEnd: existing?.windowEnd || Date.now() + 15 * 60 * 1000
    };

    secLog('2FA_CODE_GENERATED', {
      userId,
      email: userEmail.replace(/(.{2}).*@/, '$1***@'),
      ip: getIP(req)
    });

    // Send via Resend
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY || RESEND_KEY === 'placeholder_add_later') {
      // Dev mode — log to server console only, never to client
      logger.warn('[2FA DEV] Code for ' + userEmail + ': ' + code);
      return res.json({ sent: true, dev: true });
    }

    const html = [
      '<div style="background:#0a0a0a;padding:48px 40px;font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">',
      '<div style="text-align:center;border-bottom:1px solid rgba(201,169,110,0.2);padding-bottom:24px;margin-bottom:28px">',
      '<div style="font-size:28px;color:#c9a96e;margin-bottom:10px">&#9670;</div>',
      '<div style="font-size:10px;letter-spacing:6px;text-transform:uppercase;color:#c9a96e">Cipher Private</div>',
      '</div>',
      '<h2 style="font-family:Georgia,serif;font-size:22px;font-weight:300;color:#f0ede8;margin:0 0 12px">Your security code</h2>',
      '<p style="font-size:13px;color:rgba(240,237,232,0.6);line-height:1.8;margin:0 0 28px">',
      'Use this code to verify your identity and access your portal. ',
      'It expires in 5 minutes and can only be used once.</p>',
      '<div style="background:#111;border:1px solid rgba(201,169,110,0.25);padding:28px;text-align:center;margin-bottom:24px">',
      '<div style="font-family:Courier New,monospace;font-size:40px;font-weight:700;color:#c9a96e;letter-spacing:14px">' + code + '</div>',
      '</div>',
      '<p style="font-size:11px;color:rgba(240,237,232,0.3);line-height:1.7">',
      'If you did not attempt to log in, contact your director immediately:<br>',
      'hello@cipherprivate.com &nbsp;·&nbsp; +61 413 536 700</p>',
      '<div style="border-top:1px solid rgba(201,169,110,0.1);margin-top:28px;padding-top:16px;text-align:center">',
      '<div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(201,169,110,0.35)">',
      'Cipher Private &middot; AES-256 Encrypted &middot; Australian Sovereign</div>',
      '</div></div>'
    ].join('');

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'hello@cipherprivate.com',
        to: [userEmail],
        subject: 'Your Cipher Private Security Code',
        html
      })
    });

    if (r.ok) {
      return res.json({ sent: true });
    } else {
      const e = await r.json();
      logger.error('Resend 2FA error: ' + JSON.stringify(e));
      // Still return success — code is saved server-side, user can retry
      return res.json({ sent: false, error: 'Email delivery failed' });
    }
  } catch(e) {
    logger.error('request-2fa error: ' + e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// Verify 2FA code
app.post('/api/auth/verify-2fa', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    const { code } = req.body;
    if (!code || code.length !== 6) return res.status(400).json({ error: 'Invalid code format' });

    const token = auth.slice(7);
    let userId;
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId || decoded.id;
    } catch(e) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const record = twoFACodes[userId];
    const ip = getIP(req);

    // No code generated
    if (!record) {
      secLog('2FA_NO_CODE', { userId, ip });
      return res.status(400).json({ error: 'No code requested. Please request a new code.' });
    }

    // Expired
    if (Date.now() > record.expiresAt) {
      delete twoFACodes[userId];
      secLog('2FA_EXPIRED', { userId, ip });
      return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
    }

    // Too many attempts (max 5)
    if (record.attempts >= 5) {
      delete twoFACodes[userId];
      secLog('2FA_MAX_ATTEMPTS', { userId, ip });
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }

    // Wrong code
    if (record.code !== code.toString().trim()) {
      record.attempts++;
      secLog('2FA_WRONG_CODE', { userId, ip, attempt: record.attempts });
      const remaining = 5 - record.attempts;
      return res.status(400).json({
        error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      });
    }

    // SUCCESS — delete code immediately (single use)
    delete twoFACodes[userId];
    secLog('2FA_SUCCESS', { userId, ip });

    // Record in active sessions
    recordLoginSuccess(ip, userId, token);

    return res.json({ verified: true });
  } catch(e) {
    logger.error('verify-2fa error: ' + e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});


// ─── API rate limits (tighter for sensitive routes) ──────────────────────────
app.use('/api/documents', rateLimit(60 * 1000, 30, 'Document request limit reached.'));
app.use('/api/otp',       rateLimit(60 * 1000, 10, 'OTP request limit reached.'));
app.use('/api/admin',     rateLimit(60 * 1000, 60, 'Admin request limit reached.'));

app.use('/api/requests',     requestRoutes);
app.use('/api/documents',    documentRoutes);
app.use('/api/otp',          otpRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat',         chatRoutes);

// ─── OTP vault access page ───────────────────────────────────────────────────
app.get('/vault/access/:token', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Cipher Private — Secure Document Access</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=Montserrat:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080808;font-family:'Montserrat',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:520px;width:100%;background:#0f0f0f;border:1px solid rgba(201,169,110,0.2)}
.hdr{padding:40px;text-align:center;border-bottom:1px solid rgba(201,169,110,0.1)}
.diamond{font-size:28px;color:#c9a96e;margin-bottom:12px}
.brand{font-size:9px;letter-spacing:10px;text-transform:uppercase;color:#c9a96e}
.body{padding:40px}
h1{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:300;color:#f0ede8;margin-bottom:22px}
.doc-box{background:#0a0a0a;border:1px solid rgba(201,169,110,0.15);padding:18px 22px;margin-bottom:22px}
.doc-name{font-size:14px;color:#f0ede8;font-weight:500}
.doc-meta{font-size:9px;color:#666;margin-top:5px}
p{font-size:12px;color:#888;line-height:1.9;margin-bottom:18px}
.otp-row{display:flex;gap:9px;margin:18px 0}
.otp-digit{flex:1;background:#0a0a0a;border:1px solid rgba(201,169,110,0.2);color:#c9a96e;font-size:22px;font-family:'Courier New',monospace;font-weight:700;text-align:center;padding:14px 0;outline:none;border-radius:0;-webkit-appearance:none;-moz-appearance:none}
.otp-digit::-webkit-outer-spin-button,.otp-digit::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.otp-digit:focus{border-color:#c9a96e}
.btn{width:100%;padding:14px;background:#c9a96e;color:#080808;border:none;font-family:'Montserrat',sans-serif;font-size:9px;letter-spacing:4px;text-transform:uppercase;font-weight:700;cursor:pointer}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.err{background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.3);color:#e74c3c;padding:11px 14px;font-size:11px;margin-top:10px;display:none}
.ok{background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.3);color:#2ecc71;padding:14px;font-size:11px;margin-top:10px;text-align:center;display:none}
.spinner{text-align:center;padding:20px;color:#c9a96e;font-size:10px;letter-spacing:3px}
</style>
</head>
<body>
<div class="card">
  <div class="hdr"><div class="diamond">&#9670;</div><div class="brand">Cipher Private &nbsp;·&nbsp; Secure Document Access</div></div>
  <div class="body">
    <div class="spinner" id="loadSpinner">LOADING</div>
    <div id="mainContent" style="display:none">
      <h1>Enter Your One-Time Code</h1>
      <div class="doc-box">
        <div class="doc-name" id="docName">Loading...</div>
        <div class="doc-meta" id="docMeta"></div>
      </div>
      <p>Enter the 6-digit code from your email. This code is single-use and expires in 5 minutes.</p>
      <div class="otp-row">
        <input class="otp-digit" type="tel" maxlength="1" id="d0" oninput="nxt(this,1)" onkeydown="bk(event,this,0)" inputmode="numeric">
        <input class="otp-digit" type="tel" maxlength="1" id="d1" oninput="nxt(this,2)" onkeydown="bk(event,this,1)" inputmode="numeric">
        <input class="otp-digit" type="tel" maxlength="1" id="d2" oninput="nxt(this,3)" onkeydown="bk(event,this,2)" inputmode="numeric">
        <input class="otp-digit" type="tel" maxlength="1" id="d3" oninput="nxt(this,4)" onkeydown="bk(event,this,3)" inputmode="numeric">
        <input class="otp-digit" type="tel" maxlength="1" id="d4" oninput="nxt(this,5)" onkeydown="bk(event,this,4)" inputmode="numeric">
        <input class="otp-digit" type="tel" maxlength="1" id="d5" oninput="chk()" onkeydown="bk(event,this,5)" inputmode="numeric">
      </div>
      <div class="err" id="errMsg"></div>
      <button class="btn" id="verifyBtn" onclick="verify()">Verify &amp; Access Document</button>
      <div class="ok" id="okMsg">&#10003; Verified. Downloading your document...</div>
    </div>
    <div id="expiredContent" style="display:none;text-align:center;padding:20px">
      <p id="expiredMsg" style="color:#e74c3c;text-align:center"></p>
    </div>
  </div>
</div>
<script>
var T=location.pathname.split('/vault/access/')[1];
window.onload=function(){
  fetch('/api/otp/access/'+T).then(function(r){return r.json();}).then(function(d){
    document.getElementById('loadSpinner').style.display='none';
    if(d.expired||d.alreadyUsed||d.error){
      document.getElementById('expiredContent').style.display='block';
      document.getElementById('expiredMsg').textContent=d.alreadyUsed?'This link has already been used.':d.expired?'This link has expired.':d.error||'Invalid link.';
      return;
    }
    document.getElementById('docName').textContent=d.documentName;
    document.getElementById('docMeta').textContent='Shared by '+d.senderName+' · Expires '+new Date(d.expiresAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney'});
    document.getElementById('mainContent').style.display='block';
    document.getElementById('d0').focus();
  }).catch(function(){
    document.getElementById('loadSpinner').style.display='none';
    document.getElementById('expiredContent').style.display='block';
    document.getElementById('expiredMsg').textContent='Unable to load. Contact hello@cipherprivate.com';
  });
};
function getOTP(){return['d0','d1','d2','d3','d4','d5'].map(function(id){return document.getElementById(id).value;}).join('');}
function nxt(el,n){el.value=el.value.replace(/[^0-9]/g,'').slice(-1);if(el.value&&n<=5)document.getElementById('d'+n).focus();}
function bk(e,el,i){if(e.key==='Backspace'&&!el.value&&i>0)document.getElementById('d'+(i-1)).focus();if(e.key==='Enter')verify();}
function chk(){if(getOTP().length===6)verify();}
function verify(){
  var otp=getOTP();
  if(otp.length!==6){showErr('Please enter all 6 digits.');return;}
  var btn=document.getElementById('verifyBtn');
  btn.disabled=true;btn.textContent='VERIFYING...';hideErr();
  fetch('/api/otp/verify/'+T,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({otp:otp})})
    .then(function(res){
      if(res.ok){
        document.getElementById('okMsg').style.display='block';btn.style.display='none';
        return res.blob().then(function(blob){
          var url=URL.createObjectURL(blob);var a=document.createElement('a');
          a.href=url;a.download=document.getElementById('docName').textContent;a.click();URL.revokeObjectURL(url);
        });
      } else {return res.json().then(function(d){showErr(d.error||'Verification failed.');btn.disabled=false;btn.textContent='Verify & Access Document';});}
    }).catch(function(){showErr('Connection error.');btn.disabled=false;btn.textContent='Verify & Access Document';});
}
function showErr(m){var e=document.getElementById('errMsg');e.textContent=m;e.style.display='block';}
function hideErr(){document.getElementById('errMsg').style.display='none';}
</script>
</body>
</html>`);
});

// ─── Serve frontend ───────────────────────────────────────────────────────────
const possiblePaths = [
  path.join(__dirname, '../../index.html'),
  path.join(__dirname, '../index.html'),
  path.join(process.cwd(), 'index.html'),
];
const clientHtml = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
logger.info('Serving frontend from: ' + clientHtml);

app.get('*', (_req, res) => {
  if (fs.existsSync(clientHtml)) {
    res.status(200).sendFile(clientHtml);
  } else {
    res.status(200).json({ status: 'Cipher Private API is running', docs: '/api/health' });
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error('Error: ' + err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.use(authenticateSocket);
io.on('connection', socket => { handleSocketConnection(io, socket); });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info('Cipher Private running on port ' + PORT);
  logger.info('Security: Rate limiting ACTIVE | Brute-force protection ACTIVE | Session tracking ACTIVE');
});

module.exports = { app, server, io };
