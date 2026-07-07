'use strict';
require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('./utils/logger');
const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const documentRoutes = require('./routes/documents');
const otpRoutes = require('./routes/otp');
const adminRoutes = require('./routes/admin');
const applicationRoutes = require('./routes/applications');
const chatRoutes = require('./routes/chat');
const { authenticateSocket } = require('./middleware/auth');
const { handleSocketConnection } = require('./socket/chatHandler');

const app = express();
expressWs(app);
app.set('trust proxy', 1); // Trust Cloudflare/Nginx proxy
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', credentials: true }, pingTimeout: 60000 });

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const SECURITY_LOG_FILE = process.env.SECURITY_LOG || './security.log';
const loginAttempts = {};
const activeSessions = {};
const twoFACodes = {};

function secLog(event, data) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n';
  logger.warn('[SEC] ' + event + ' ' + JSON.stringify(data));
  try { fs.appendFileSync(SECURITY_LOG_FILE, entry); } catch(_) {}
}

function getIP(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

const requestCounts = {};
function rateLimit(windowMs, max, message) {
  return (req, res, next) => {
    const ip = getIP(req);
    const now = Date.now();
    if (!requestCounts[ip]) requestCounts[ip] = [];
    requestCounts[ip] = requestCounts[ip].filter(t => now - t < windowMs);
    requestCounts[ip].push(now);
    if (requestCounts[ip].length > max) {
      secLog('RATE_LIMIT', { ip, path: req.path });
      return res.status(429).json({ error: message || 'Too many requests.' });
    }
    next();
  };
}

const LOGIN_MAX = 5, LOGIN_WINDOW = 15*60*1000, LOGIN_LOCKOUT = 30*60*1000;

function loginGuard(req, res, next) {
  const ip = getIP(req);
  const now = Date.now();
  const rec = loginAttempts[ip] || { count: 0, firstAt: now, lockedUntil: 0 };
  if (rec.lockedUntil > now) {
    const mins = Math.ceil((rec.lockedUntil - now) / 60000);
    secLog('LOGIN_BLOCKED', { ip, mins });
    return res.status(429).json({ error: 'Too many failed attempts. Locked for ' + mins + ' minutes.' });
  }
  if (now - rec.firstAt > LOGIN_WINDOW) loginAttempts[ip] = { count: 0, firstAt: now, lockedUntil: 0 };
  req._loginIP = ip;
  next();
}

function recordLoginFailure(ip) {
  const now = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAt: now, lockedUntil: 0 };
  loginAttempts[ip].count++;
  if (loginAttempts[ip].count >= LOGIN_MAX) {
    loginAttempts[ip].lockedUntil = now + LOGIN_LOCKOUT;
    secLog('LOCKOUT', { ip });
  }
}

function recordLoginSuccess(ip, userId, token) {
  loginAttempts[ip] = { count: 0, firstAt: Date.now(), lockedUntil: 0 };
  secLog('LOGIN_OK', { ip, userId });
  activeSessions[hashToken(token)] = { userId, ip, loginAt: new Date().toISOString(), lastSeen: Date.now() };
}

function trackSession(req, _res, next) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const h = hashToken(auth.slice(7));
    if (activeSessions[h]) {
      const ip = getIP(req);
      if (activeSessions[h].ip !== ip) secLog('IP_CHANGE', { userId: activeSessions[h].userId, from: activeSessions[h].ip, to: ip });
      activeSessions[h].lastSeen = Date.now();
    }
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  Object.keys(activeSessions).forEach(h => {
    if (now - activeSessions[h].lastSeen > 30*60*1000) {
      secLog('SESSION_EXPIRED', { userId: activeSessions[h].userId });
      delete activeSessions[h];
    }
  });
}, 60*1000);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use((req, res, next) => {
  if ((req.headers.host || '').includes('cipherprivate.com.au'))
    return res.redirect(301, 'https://cipherprivate.com' + req.originalUrl);
  next();
});
app.use(cors({ origin: '*', credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => { logger.info(req.method + ' ' + req.path); next(); });
app.use(trackSession);


// PWA static files — served before rate limiter
app.get('/manifest.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile('/var/www/cipher-private/manifest.json');
});
app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile('/var/www/cipher-private/sw.js');
});
app.get('/icon-192.png', (_req, res) => { res.sendFile('/var/www/cipher-private/icon-192.png'); });
app.get('/icon-512.png', (_req, res) => { res.sendFile('/var/www/cipher-private/icon-512.png'); });

// Sitemap and robots - before rate limiter
app.get('/sitemap.xml', function(req, res) {
  var xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    '<url><loc>https://consiere.com.au/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>' +
    '<url><loc>https://consiere.com.au/signup</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/privacy</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>' +
    '<url><loc>https://consiere.com.au/terms</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>' +
    '<url><loc>https://consiere.com.au/blog</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/complete-guide-relocating-to-sydney</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/australia-skilled-visa-guide-2025</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/best-suburbs-sydney-expats</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/moving-to-australia-checklist</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/sydney-private-members-clubs-restaurants</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/property-investment-sydney-2025</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/private-aviation-australia-guide</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
    '<url><loc>https://consiere.com.au/blog/luxury-home-management-sydney</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>' +
  '</urlset>';
  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
});
app.get('/robots.txt', function(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  return res.send('User-agent: *\nAllow: /\nDisallow: /cc-portal\nDisallow: /cc-admin\nDisallow: /portal\nDisallow: /admin\nDisallow: /member\nDisallow: /vendors\nAllow: /privacy\nAllow: /terms\nSitemap: https://consiere.com.au/sitemap.xml');
});

app.use(rateLimit(60*1000, 120, 'Too many requests.'));

app.get('/api/health', (_req, res) => res.json({ status: 'operational', ts: new Date().toISOString() }));


app.use('/api/auth/login', rateLimit(15*60*1000, 50, 'Too many login attempts. Please wait.'), loginGuard);
app.use('/api/auth', authRoutes);

app.post('/api/auth/request-2fa', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    let userId;
    try { const d = jwt.verify(auth.slice(7), process.env.JWT_SECRET); userId = d.userId || d.id; }
    catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await prisma.$disconnect();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const existing = twoFACodes[userId];
    if (existing && existing.requestCount >= 3 && Date.now() < existing.windowEnd)
      return res.status(429).json({ error: 'Too many requests. Wait 15 minutes.' });
    const code = crypto.randomInt(100000, 999999).toString();
    twoFACodes[userId] = {
      code, expiresAt: Date.now() + 5*60*1000, attempts: 0,
      requestCount: (existing?.requestCount || 0) + 1,
      windowEnd: existing?.windowEnd || Date.now() + 15*60*1000
    };
    secLog('2FA_SENT', { userId, ip: getIP(req) });
    const KEY = process.env.RESEND_API_KEY;
    if (!KEY || KEY === 'placeholder_add_later') {
      logger.warn('[2FA DEV] Code: ' + code);
      return res.json({ sent: true, dev: true });
    }
    const html = '<div style="background:#0a0a0a;padding:40px;font-family:Arial,sans-serif;max-width:500px;margin:0 auto"><div style="text-align:center;margin-bottom:20px"><div style="color:#c9a96e;font-size:24px">&#9670;</div><div style="color:#c9a96e;font-size:10px;letter-spacing:6px">CIPHER PRIVATE</div></div><p style="color:#f0ede8;font-family:Georgia,serif;font-size:20px;font-weight:300">Your security code</p><p style="color:rgba(240,237,232,0.6);font-size:13px;margin:10px 0 20px">Expires in 5 minutes. Single use only.</p><div style="background:#111;border:1px solid rgba(201,169,110,0.3);padding:24px;text-align:center"><div style="font-family:Courier New,monospace;font-size:36px;font-weight:700;color:#c9a96e;letter-spacing:12px">' + code + '</div></div><p style="color:rgba(240,237,232,0.3);font-size:11px;margin-top:20px">If you did not attempt to log in, contact hello@cipherprivate.com immediately.</p></div>';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'hello@cipherprivate.com', to: [user.email], subject: 'Your Cipher Private Security Code', html })
    });
    res.json(r.ok ? { sent: true } : { sent: false, error: 'Email failed' });
  } catch(e) { logger.error('request-2fa: ' + e.message); res.status(500).json({ error: 'Internal error' }); }
});

app.post('/api/auth/verify-2fa', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const jwt = require('jsonwebtoken');
    let userId;
    try { const d = jwt.verify(auth.slice(7), process.env.JWT_SECRET); userId = d.userId || d.id; }
    catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
    const { code } = req.body;
    if (!code || code.toString().length !== 6) return res.status(400).json({ error: 'Invalid code' });
    const rec = twoFACodes[userId];
    const ip = getIP(req);
    if (!rec) return res.status(400).json({ error: 'No code found. Please request a new one.' });
    if (Date.now() > rec.expiresAt) { delete twoFACodes[userId]; return res.status(400).json({ error: 'Code expired.' }); }
    if (rec.attempts >= 5) { delete twoFACodes[userId]; return res.status(429).json({ error: 'Too many attempts. Request a new code.' }); }
    if (rec.code !== code.toString().trim()) {
      rec.attempts++;
      secLog('2FA_WRONG', { userId, ip, attempt: rec.attempts });
      return res.status(400).json({ error: 'Incorrect code. ' + (5 - rec.attempts) + ' attempts remaining.' });
    }
    delete twoFACodes[userId];
    secLog('2FA_OK', { userId, ip });
    recordLoginSuccess(ip, userId, auth.slice(7));
    res.json({ verified: true });
  } catch(e) { logger.error('verify-2fa: ' + e.message); res.status(500).json({ error: 'Internal error' }); }
});

app.use('/api/documents', rateLimit(60*1000, 30, 'Document limit reached.'));
app.use('/api/otp', rateLimit(60*1000, 10, 'OTP limit reached.'));
app.use('/api/requests', requestRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat', chatRoutes);

const vendorRoutes = require('./routes/vendors');
const { router: pushRoutes } = require('./routes/push');
app.use('/api/vendors', vendorRoutes);
require('./routes/voice')(app);
const payRoutes = require('./routes/pay');
app.use('/api/pay', payRoutes);
app.use('/api/push', pushRoutes);
const cipherbotRoutes = require('./routes/cipherbot');

const stripeRoutes = require('./routes/stripe');
const businessModelRoutes = require('./routes/business_model');
const automationRoutes = require('./routes/automation');
const advancedRoutes = require('./routes/advanced');
const intelligenceRoutes = require('./routes/intelligence');
const wave7Routes = require('./routes/wave7');
const wave8Routes = require('./routes/wave8');
const wave9Routes = require('./routes/wave9');
const uvRoutes = require('./routes/unregistered_vendor');
const complianceRoutes = require('./routes/compliance');
const operationsRoutes = require('./routes/operations');
app.use('/api/stripe', stripeRoutes);
app.use('/api/bm', businessModelRoutes);
app.use('/api/auto', automationRoutes);
app.use('/api/adv', advancedRoutes);
app.use('/api/intel', intelligenceRoutes);
app.use('/api/w7', wave7Routes);
app.use('/api/w8', wave8Routes);
app.use('/api/w9', wave9Routes);
app.use('/api/uv', uvRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/ops', operationsRoutes);

// Gift subscription landing page
app.get('/gift/:code', (req, res) => { res.redirect('/api/adv/gift/' + req.params.code); });

// Testimonials page
app.get('/stories', (req, res) => res.redirect('/api/ops/testimonials/page'));

// Legal pages
// SEO fix: serve privacy/terms as HTML pages (not redirects) so Google can index them
app.get('/terms', (_req, res) => { res.set('Cache-Control','no-store'); res.sendFile('/var/www/cipher-private/terms.html'); });
app.get('/privacy', (_req, res) => { res.set('Cache-Control','no-store'); res.sendFile('/var/www/cipher-private/privacy.html'); });
app.get('/vendor-terms', (_req, res) => { res.redirect('/api/compliance/vendor-agreement'); });

// Unregistered vendor registration page
app.get('/vendor-register', (req, res) => { res.redirect('/api/uv/vendor-register?' + new URLSearchParams(req.query).toString()); });

// Vendor showcase public pages
app.get('/vendors/:slug', async (req, res) => {
  const { getVendorShowcasePage } = require('./Cipher/server/services/wave9_automation');
  const vendor = await getVendorShowcasePage(req.params.slug);
  if (!vendor) return res.status(404).send('<html><body style="font-family:Georgia;text-align:center;padding:60px"><h2>Vendor not found</h2><a href="/">← Back to Consiere</a></body></html>');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${vendor.name} — Consiere Verified Partner</title>
<style>body{font-family:Georgia,serif;background:#f8f4ef;margin:0;padding:0}
.hero{background:#1a1612;color:#fff;padding:60px 20px;text-align:center}
.logo{font-size:11px;letter-spacing:4px;color:#c9a96e;font-family:Arial,sans-serif;margin-bottom:16px}
h1{font-size:32px;margin:0 0 8px;color:#fff}
.badge{display:inline-block;background:#c9a96e;color:#1a1612;padding:6px 16px;border-radius:100px;font-size:12px;font-family:Arial,sans-serif;font-weight:700;margin-top:12px}
.card{background:#fff;border-radius:16px;padding:32px;max-width:600px;margin:40px auto;box-shadow:0 4px 24px rgba(0,0,0,0.06)}
.stat{text-align:center;padding:16px}.stat-num{font-size:32px;font-weight:700;color:#1a1612}.stat-label{font-size:11px;letter-spacing:2px;color:#78716c;font-family:Arial,sans-serif}
.cats{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.cat{background:#f8f4ef;padding:6px 14px;border-radius:100px;font-size:12px;font-family:Arial,sans-serif}
.cta{display:block;background:#c9a96e;color:#1a1612;text-align:center;padding:16px;border-radius:100px;text-decoration:none;font-weight:700;font-family:Arial,sans-serif;margin-top:24px}
</style></head>
<body>
<div class="hero">
  <div class="logo">CONSIERE</div>
  <h1>${vendor.name}</h1>
  <div class="badge">${vendor.badgeEarned ? '✓ Handled by Consiere — Verified Partner' : '⭐ Consiere Partner'}</div>
</div>
<div class="card">
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
    <div class="stat"><div class="stat-num">${vendor.rating}</div><div class="stat-label">RATING</div></div>
    <div class="stat"><div class="stat-num">${vendor.completedJobs}</div><div class="stat-label">JOBS DONE</div></div>
    <div class="stat"><div class="stat-num">${vendor.joinedYear}</div><div class="stat-label">PARTNER SINCE</div></div>
  </div>
  <div class="cats">${(vendor.categories||[]).map(c=>'<span class="cat">'+c+'</span>').join('')}</div>
  <a class="cta" href="https://consiere.com.au">Book via Consiere →</a>
</div>
</body></html>`);
});

// Vendor badge kit page
app.get('/vendor-badge/:vendorId', async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  const vendor = await p.vendor.findUnique({ where: { id: req.params.vendorId }, select: { name: true, badgeEarned: true } });
  await p.$disconnect();
  if (!vendor?.badgeEarned) return res.status(403).send('Badge not yet earned');
  res.send('<html><body style="font-family:Arial;text-align:center;padding:60px;background:#f8f4ef"><h2>Handled by Consiere ✓</h2><p>Download your badge kit:</p><div style="background:#1a1612;color:#c9a96e;padding:24px;border-radius:12px;display:inline-block;font-weight:700;font-size:18px">✓ Handled by Consiere</div><p style="color:#78716c;font-size:12px;margin-top:24px">Copy this badge or <a href="/vendors/' + (req.params.vendorId) + '">view your profile</a></p></body></html>');
});

// Vendor rating page — served directly
app.get('/rate/:requestId', (req, res) => {
  const requestId = req.params.requestId;
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rate your experience — Consiere</title>
<style>
body{font-family:Georgia,serif;background:#f8f4ef;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}
.card{background:#fff;border-radius:16px;padding:40px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
.logo{font-size:13px;letter-spacing:4px;color:#c9a96e;margin-bottom:16px;font-family:Arial,sans-serif}
h2{font-size:20px;color:#1a1612;margin:0 0 8px;font-weight:600}
p{color:#78716c;font-size:13px;margin:0 0 28px;font-family:Arial,sans-serif}
.stars{display:flex;gap:8px;justify-content:center;margin-bottom:24px}
.star{font-size:38px;cursor:pointer;transition:transform 0.15s;opacity:0.3;line-height:1}
.star.active{opacity:1;transform:scale(1.1)}
.star:hover{opacity:0.8}
.btn{background:#c9a96e;color:#fff;border:none;padding:14px 32px;border-radius:100px;font-size:15px;font-weight:600;cursor:pointer;width:100%;font-family:Arial,sans-serif}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.thanks{display:none;padding:20px;background:#16a34a10;border-radius:12px;margin-top:16px}
.thanks-title{color:#16a34a;font-size:18px;font-weight:600;margin-bottom:6px}
.thanks-sub{color:#78716c;font-size:13px;font-family:Arial,sans-serif}
</style>
</head>
<body>
<div class="card">
  <div class="logo">CONSIERE</div>
  <h2>How was your experience?</h2>
  <p>Rate your service so we can keep improving.</p>
  <div class="stars" id="stars">
    <span class="star" data-r="1">★</span>
    <span class="star" data-r="2">★</span>
    <span class="star" data-r="3">★</span>
    <span class="star" data-r="4">★</span>
    <span class="star" data-r="5">★</span>
  </div>
  <button class="btn" id="submitBtn" disabled onclick="submitRating()">Submit Rating</button>
  <div class="thanks" id="thanks">
    <div class="thanks-title">✓ Thank you!</div>
    <div class="thanks-sub">Your feedback helps us serve you better.</div>
  </div>
</div>
<script>
var selected = 0;
document.querySelectorAll('.star').forEach(function(s){
  s.addEventListener('mouseover', function(){
    var r = parseInt(this.dataset.r);
    document.querySelectorAll('.star').forEach(function(x,i){ x.style.opacity = i < r ? '1' : '0.3'; });
  });
  s.addEventListener('mouseout', function(){
    document.querySelectorAll('.star').forEach(function(x,i){ x.style.opacity = i < selected ? '1' : '0.3'; });
  });
  s.addEventListener('click', function(){
    selected = parseInt(this.dataset.r);
    document.querySelectorAll('.star').forEach(function(x,i){ x.classList.toggle('active', i < selected); x.style.opacity = i < selected ? '1' : '0.3'; });
    document.getElementById('submitBtn').disabled = false;
  });
});
function submitRating() {
  if (!selected) return;
  var btn = document.getElementById('submitBtn');
  btn.textContent = 'Submitting...';
  btn.disabled = true;
  fetch('/api/auto/rate/${requestId}', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({rating: selected})
  }).then(function(r){ return r.json(); })
    .then(function(){
      document.getElementById('thanks').style.display = 'block';
      document.getElementById('stars').style.display = 'none';
      btn.style.display = 'none';
    })
    .catch(function(){
      btn.textContent = 'Try again';
      btn.disabled = false;
    });
}
</script>
</body>
</html>`);
});


const whatsappRoutes = require('./routes/whatsapp');
app.use('/api/whatsapp', whatsappRoutes);

app.get('/vendor-respond', (_req, res) => { res.sendFile('/var/www/cipher-private/vendor_response.html'); });

app.use('/api/cipherbot', cipherbotRoutes);



const portalHtml = [
  require('path').join(__dirname, '../../portal.html'),
  require('path').join(__dirname, '../portal.html'),
  require('path').join(process.cwd(), 'portal.html'),
].find(p => require('fs').existsSync(p));



app.get('/member', (_req, res) => {
  res.status(200).sendFile('/var/www/cipher-private/member.html');
});

app.get('/admin', (_req, res) => {
  res.status(200).sendFile('/var/www/cipher-private/admin.html');
});


// Consiere domain routing
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (host.includes('consiere.com.au')) {
    const reqPath = req.path;
    // Allow specific routes to pass through to Express routes
    if (reqPath === '/pay/success' || reqPath === '/pay/cancel') { return res.sendFile(require('path').join(process.cwd(), reqPath === '/pay/success' ? 'pay_success.html' : 'pay_cancel.html')); }
    if (reqPath === '/sitemap.xml' || reqPath === '/robots.txt' || reqPath === '/cc-portal' || reqPath === '/cc-admin' || reqPath.startsWith('/blog') || reqPath.startsWith('/api') || reqPath === '/signup' || reqPath === '/vendors' || reqPath === '/privacy' || reqPath === '/terms' || reqPath === '/vendor-portal' || reqPath === '/vendor-bill' || reqPath === '/pay' || reqPath === '/global-network' || reqPath === '/vendor_register.html') {
      return next();
    }
    const p = require('path').join(process.cwd(), 'cipherconcierge.html');
    if (require('fs').existsSync(p)) {
      const path2 = require('path');
      const reqPath = req.path;
      if (reqPath === '/portal' || reqPath === '/login') {
        res.set('Cache-Control','no-store');
        const pp = path2.join(process.cwd(), 'cc_portal.html');
        if (require('fs').existsSync(pp)) return res.sendFile(pp);
      }
      return res.sendFile(p);
    }
  }
  next();
});


app.get('/cc-portal', (_req, res) => {
  res.set('Cache-Control','no-store');
  res.status(200).sendFile('/var/www/cipher-private/cc_portal.html');
});


// Consiere Admin
app.get('/cc-admin', (_req, res) => { res.setHeader('Cache-Control','no-store,no-cache,must-revalidate'); res.sendFile('/var/www/cipher-private/cc_admin.html'); });

// Blog routes
app.get('/blog', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_index.html'); });

app.get('/blog/australia-skilled-visa-guide-2025', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_visa.html'); });
app.get('/blog/best-suburbs-sydney-expats', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_suburbs.html'); });
app.get('/blog/moving-to-australia-checklist', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_checklist.html'); });
app.get('/blog/sydney-private-members-clubs-restaurants', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_dining.html'); });
app.get('/blog/property-investment-sydney-2025', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_property.html'); });
app.get('/blog/private-aviation-australia-guide', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_aviation.html'); });
app.get('/blog/luxury-home-management-sydney', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_home.html'); });

app.get('/blog/complete-guide-relocating-to-sydney', (_req, res) => { res.sendFile('/var/www/cipher-private/blog_sydney.html'); });





app.get('/signup', (_req, res) => { res.sendFile('/var/www/cipher-private/signup.html'); });
app.get('/vendors', (_req, res) => { res.sendFile('/var/www/cipher-private/vendor_register.html'); });
app.get('/vendor_register.html', (_req, res) => { res.set('Cache-Control','no-store'); res.sendFile('/var/www/cipher-private/vendor_register.html'); });
app.get('/vendor-portal', (_req, res) => { res.set('Cache-Control','no-store'); res.sendFile('/var/www/cipher-private/vendor_portal.html'); });
app.get('/vendor-bill', (_req, res) => { res.sendFile('/var/www/cipher-private/vendor_bill.html'); });
// Privacy and terms routes defined above at startup
app.get('/portal', (_req, res) => {
  res.status(200).sendFile('/var/www/cipher-private/portal.html');
});

const clientHtml = [
  path.join(__dirname, '../../index.html'),
  path.join(__dirname, '../index.html'),
  path.join(process.cwd(), 'index.html'),
].find(p => fs.existsSync(p));

app.get('/global-network', (_req, res) => { res.sendFile('/var/www/cipher-private/global-network.html'); });
app.get('/pay', (_req, res) => { res.sendFile(require('path').join(process.cwd(), 'pay.html')); });

app.get('*', (_req, res) => {
  if (clientHtml && fs.existsSync(clientHtml)) return res.status(200).sendFile(clientHtml);
  res.status(200).json({ status: 'Cipher Private API running' });
});

app.use((err, _req, res, _next) => {
  logger.error('Error: ' + err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

io.use(authenticateSocket);
io.on('connection', socket => handleSocketConnection(io, socket));


// Poll Stripe every 2 minutes for completed payments (webhook fallback)
async function pollStripePayments() {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('YOUR')) return;
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient();
    const pending = await db.vendorInquiry.findMany({
      where: { paymentSessionId: { not: null }, paymentPaidAt: null, status: 'ACCEPTED' },
      include: {
        vendor: { select: { name: true, email: true } },
        request: { include: { user: { select: { email: true, fullName: true } } } }
      },
      take: 10
    });
    for (const inq of pending) {
      try {
        const session = await stripe.checkout.sessions.retrieve(inq.paymentSessionId);
        if (session.payment_status === 'paid') {
          await db.vendorInquiry.update({ where: { id: inq.id }, data: { paymentPaidAt: new Date() } });
          await db.request.update({ where: { id: inq.requestId }, data: { status: 'IN_PROGRESS' } }).catch(()=>{});
          // Send receipts
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          const member = inq.request?.user;
          const firstName = (member?.fullName || 'Member').split(' ')[0];
          const orderRef = inq.request?.orderRef || inq.id.substring(0,8).toUpperCase();
          const isProcurement = ['PROCUREMENT','SHOPPING'].includes((inq.request?.category||'').toUpperCase());
          const amtPaid = isProcurement ? inq.quoteAmount : 10;
          const receiptHtml = '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
            '<div style="background:#1c1917;padding:24px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div><div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px">Payment Receipt</div></div>' +
            '<div style="padding:32px">' +
            '<div style="text-align:center;margin-bottom:20px"><div style="width:52px;height:52px;background:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:22px">&#10003;</div></div>' +
            '<h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;text-align:center;margin:0 0 6px">Payment Confirmed</h2>' +
            '<p style="color:#78716c;font-size:13px;text-align:center;margin:0 0 24px">Thank you, ' + firstName + '. Your order is confirmed.</p>' +
            '<div style="background:#faf8f5;border:1px solid #e8e0d4;border-radius:8px;padding:20px;margin:0 0 20px">' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0ede8"><span style="color:#78716c;font-size:13px">Order reference</span><span style="font-size:13px;font-weight:600;color:#b87333">' + orderRef + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0ede8"><span style="color:#78716c;font-size:13px">Service</span><span style="font-size:13px;color:#1c1917">' + (inq.request?.title||'Service').substring(0,50) + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0ede8"><span style="color:#78716c;font-size:13px">Provider</span><span style="font-size:13px;color:#1c1917">' + (inq.vendor?.name||'') + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="color:#78716c;font-size:13px">Amount paid</span><span style="font-size:16px;font-weight:700;color:#1c1917">$' + parseFloat(amtPaid).toFixed(2) + ' AUD</span></div>' +
            '</div>' +
            (isProcurement ? '<p style="color:#44403c;font-size:13px;line-height:1.8;margin:0 0 16px">Full payment received. You will be notified once delivered.</p>'
              : '<p style="color:#44403c;font-size:13px;line-height:1.8;margin:0 0 16px">Deposit received. Balance of $' + (inq.quoteAmount - 10).toFixed(2) + ' AUD payable to ' + (inq.vendor?.name||'vendor') + ' on delivery.</p>') +
            '</div>' +
            '<div style="background:#faf8f5;padding:14px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere &middot; hello@consiere.com.au</p></div></div>';

          if (member?.email) {
            await resend.emails.send({ from:'Consiere <hello@consiere.com.au>', to: member.email, subject:'Receipt — Order ' + orderRef, html: receiptHtml }).catch(()=>{});
            console.log('[POLL] Receipt sent to client:', member.email);
          }
          if (inq.vendor?.email) {
            await resend.emails.send({
              from:'Consiere <hello@consiere.com.au>', to: inq.vendor.email,
              subject:'[Order Confirmed] ' + orderRef + ' — Proceed with order',
              html: '<div style="font-family:Arial;padding:24px;max-width:500px"><h2>Payment Received</h2><p><b>Order:</b> ' + orderRef + '</p><p><b>Amount:</b> $' + parseFloat(amtPaid).toFixed(2) + ' AUD</p><p><b>Service:</b> ' + (inq.request?.title||'').substring(0,80) + '</p><p style="color:#166534;font-weight:600">&#10003; Please proceed with the order.</p><p><a href="https://consiere.com.au/vendor-portal">Mark as Delivered in Portal</a></p></div>'
            }).catch(()=>{});
            console.log('[POLL] Receipt sent to vendor:', inq.vendor.email);
          }
        }
      } catch(e) { console.error('[POLL] Error checking session:', e.message); }
    }
    await db.$disconnect();
  } catch(e) { console.error('[POLL]', e.message); }
}

// Run every 2 minutes
setInterval(pollStripePayments, 2 * 60 * 1000);
const { runCommissionEnforcement } = require('./services/commission_enforcement');
const alinaAutoInit = require('./services/alina_automation'); // starts vendor chase scheduler

// Run commission enforcement daily at 9am AEST (23:00 UTC)
const now = new Date();
const nextRun = new Date();
nextRun.setUTCHours(23, 0, 0, 0);
if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
const msUntilFirst = nextRun - now;
setTimeout(function scheduleEnforcement() {
  runCommissionEnforcement();
  setInterval(runCommissionEnforcement, 24 * 60 * 60 * 1000);
}, msUntilFirst);
console.log('[COMMISSION CRON] Scheduled, first run in', Math.round(msUntilFirst/3600000), 'hours');

// Also run once on startup after 10 seconds
setTimeout(pollStripePayments, 10000);

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  logger.info('Cipher Private running on port ' + PORT);
  logger.info('Security: Rate limiting ACTIVE | Brute-force ACTIVE | 2FA ACTIVE');
});

module.exports = { app, server, io };

