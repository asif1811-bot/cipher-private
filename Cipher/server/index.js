\'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
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
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  },
  pingTimeout: 60000,
});

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Security
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'operational', service: 'Cipher Private API', timestamp: new Date().toISOString() });
});

// ── OTP Document Access Page ──────────────────────────────────────────────────
app.get('/vault/access/:token', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Cipher Private — Secure Document Access</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#080808;font-family:'Montserrat',sans-serif;color:#f0ede8}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{max-width:520px;width:100%;background:#0f0f0f;border:1px solid rgba(201,169,110,0.2)}
.card-header{padding:40px;text-align:center;border-bottom:1px solid rgba(201,169,110,0.1)}
.logo-mark{font-size:28px;color:#c9a96e;margin-bottom:12px}
.logo-name{font-size:9px;letter-spacing:10px;text-transform:uppercase;color:#c9a96e}
.logo-sub{font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#5a4a2a;margin-top:6px}
.card-body{padding:40px}
.eyebrow{font-size:8px;letter-spacing:4px;text-transform:uppercase;color:#c9a96e;margin-bottom:12px}
h1{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:300;margin-bottom:24px;line-height:1.3}
.doc-box{background:#0a0a0a;border:1px solid rgba(201,169,110,0.15);padding:20px 24px;margin-bottom:24px}
.doc-label{font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#5a4a2a;margin-bottom:8px}
.doc-name{font-size:15px;color:#f0ede8;font-weight:500}
.doc-meta{font-size:10px;color:#666;margin-top:6px;letter-spacing:1px}
p{font-size:12px;color:#888;line-height:1.9;margin-bottom:20px}
.otp-input-row{display:flex;gap:10px;margin:20px 0}
.otp-digit{flex:1;background:#0a0a0a;border:1px solid rgba(201,169,110,0.2);color:#c9a96e;font-size:24px;font-family:'Courier New',monospace;font-weight:700;text-align:center;padding:16px 0;outline:none;transition:border-color 0.2s;-webkit-appearance:none;border-radius:0}
.otp-digit:focus{border-color:#c9a96e;background:#0d0c08}
.btn{width:100%;padding:16px;background:#c9a96e;color:#080808;border:none;font-family:'Montserrat',sans-serif;font-size:10px;letter-spacing:4px;text-transform:uppercase;font-weight:700;cursor:pointer;margin-top:8px;transition:opacity 0.2s}
.btn:hover{opacity:0.9}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.error{background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.3);color:#e74c3c;padding:12px 16px;font-size:11px;margin-top:12px;display:none}
.success{background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.3);color:#2ecc71;padding:16px;font-size:11px;margin-top:12px;text-align:center;display:none}
.security-note{font-size:10px;color:#444;margin-top:20px;line-height:1.7;border-top:1px solid rgba(201,169,110,0.06);padding-top:16px}
.spinner{display:none;text-align:center;padding:20px;color:#c9a96e;font-size:11px;letter-spacing:2px}
.expired{text-align:center;padding:20px}
.expired p{color:#e74c3c}
</style>
</head>
<body>
<div class="card">
  <div class="card-header">
    <div class="logo-mark">◆</div>
    <div class="logo-name">Cipher Private</div>
    <div class="logo-sub">Secure Document Access</div>
  </div>
  <div class="card-body" id="cardBody">
    <div class="spinner" id="loadingSpinner">LOADING · PLEASE WAIT</div>
    <div id="mainContent" style="display:none">
      <div class="eyebrow">Encrypted Document</div>
      <h1>Enter Your <br>One-Time Code</h1>
      <div class="doc-box">
        <div class="doc-label">Document</div>
        <div class="doc-name" id="docName">Loading...</div>
        <div class="doc-meta" id="docMeta"></div>
      </div>
      <p>Enter the 6-digit code from your email to access this document. This code is single-use and bound to your email address.</p>
      <div class="otp-input-row" id="otpRow">
        <input class="otp-digit" type="number" min="0" max="9" maxlength="1" id="d0" oninput="moveNext(this,1)" onkeydown="handleKey(event,this,0)">
        <input class="otp-digit" type="number" min="0" max="9" maxlength="1" id="d1" oninput="moveNext(this,2)" onkeydown="handleKey(event,this,1)">
        <input class="otp-digit" type="number" min="0" max="9" maxlength="1" id="d2" oninput="moveNext(this,3)" onkeydown="handleKey(event,this,2)">
        <input class="otp-digit" type="number" min="0" max="9" maxlength="1" id="d3" oninput="moveNext(this,4)" onkeydown="handleKey(event,this,3)">
        <input class="otp-digit" type="number" min="0" max="9" maxlength="1" id="d4" oninput="moveNext(this,5)" onkeydown="handleKey(event,this,4)">
        <input class="otp-digit" type="number" min="0" max="9" maxlength="1" id="d5" oninput="submitIfComplete()" onkeydown="handleKey(event,this,5)">
      </div>
      <div class="error" id="errorMsg"></div>
      <button class="btn" id="verifyBtn" onclick="verifyOTP()">Verify & Access Document</button>
      <div class="success" id="successMsg">
        ✓ &nbsp;Verified. Downloading your document now...
      </div>
      <div class="security-note">
        🔒 &nbsp;All access attempts are logged, timestamped, and auditable. This link is single-use and bound to your email address. AES-256 encrypted.
      </div>
    </div>
    <div id="expiredContent" style="display:none" class="expired">
      <div style="font-size:32px;margin-bottom:16px">⊘</div>
      <div class="eyebrow" style="margin-bottom:12px">Access Unavailable</div>
      <p id="expiredMsg" style="color:#e74c3c"></p>
    </div>
  </div>
</div>

<script>
const TOKEN = location.pathname.split('/vault/access/')[1];

// Load document info on page load
window.onload = async () => {
  document.getElementById('loadingSpinner').style.display = 'block';
  try {
    const res = await fetch('/api/otp/access/' + TOKEN);
    const data = await res.json();
    document.getElementById('loadingSpinner').style.display = 'none';

    if (!res.ok || data.expired || data.alreadyUsed) {
      document.getElementById('expiredContent').style.display = 'block';
      document.getElementById('expiredMsg').textContent = data.alreadyUsed
        ? 'This access link has already been used. Each link is single-use for security.'
        : data.expired
          ? 'This access link has expired. Please ask the sender to generate a new one.'
          : data.error || 'This link is invalid.';
      return;
    }

    document.getElementById('docName').textContent = data.documentName;
    const exp = new Date(data.expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('docMeta').textContent = 'Shared by ' + data.senderName + '  ·  Expires ' + exp + ' (Sydney)';
    document.getElementById('mainContent').style.display = 'block';
    document.getElementById('d0').focus();
  } catch (e) {
    document.getElementById('loadingSpinner').style.display = 'none';
    document.getElementById('expiredContent').style.display = 'block';
    document.getElementById('expiredMsg').textContent = 'Unable to load document. Please try again or contact Cipher Private.';
  }
};

function getOTP() {
  return ['d0','d1','d2','d3','d4','d5'].map(id => document.getElementById(id).value).join('');
}

function moveNext(el, nextIdx) {
  // Only keep last digit if multiple typed
  if (el.value.length > 1) el.value = el.value.slice(-1);
  if (el.value && nextIdx <= 5) document.getElementById('d' + nextIdx).focus();
}

function handleKey(e, el, idx) {
  if (e.key === 'Backspace' && !el.value && idx > 0) {
    document.getElementById('d' + (idx - 1)).focus();
  }
  if (e.key === 'Enter') verifyOTP();
}

function submitIfComplete() {
  if (getOTP().length === 6) verifyOTP();
}

async function verifyOTP() {
  const otp = getOTP();
  if (otp.length !== 6) {
    showError('Please enter all 6 digits of your access code.');
    return;
  }

  const btn = document.getElementById('verifyBtn');
  btn.disabled = true;
  btn.textContent = 'VERIFYING...';
  hideError();

  try {
    const res = await fetch('/api/otp/verify/' + TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp })
    });

    if (res.ok) {
      // Download the document
      document.getElementById('successMsg').style.display = 'block';
      btn.style.display = 'none';
      document.getElementById('otpRow').style.display = 'none';

      // Stream download
      const blob = await res.blob();
      const docName = document.getElementById('docName').textContent;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = docName;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      showError(data.error || 'Verification failed. Please check your code and try again.');
      btn.disabled = false;
      btn.textContent = 'Verify & Access Document';
    }
  } catch (e) {
    showError('Connection error. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Verify & Access Document';
  }
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}
</script>
</body>
</html>`);
});

// Serve the website for all other routes
// Look for index.html in multiple locations (root, client/public, or ../index.html)
const possibleHtmlPaths = [
  path.join(__dirname, '../../index.html'),        // repo root (Cipher/server -> root)
  path.join(__dirname, '../index.html'),            // one level up
  path.join(__dirname, '../client/public/index.html'), // legacy path
  path.join(process.cwd(), 'index.html'),          // cwd root
];
const clientHtml = possibleHtmlPaths.find(p => fs.existsSync(p)) || possibleHtmlPaths[0];
logger.info(`Serving frontend from: ${clientHtml}`);

app.get('*', (_req, res) => {
  if (fs.existsSync(clientHtml)) {
    res.sendFile(clientHtml);
  } else {
    logger.warn('index.html not found, searched: ' + possibleHtmlPaths.join(', '));
    res.json({ status: 'Cipher Private API is running', docs: '/api/health' });
  }
});

// Error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
});

// Socket.IO
io.use(authenticateSocket);
io.on('connection', (socket) => handleSocketConnection(io, socket));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Cipher Private running on port ${PORT}`);
});

module.exports = { app, server, io };
