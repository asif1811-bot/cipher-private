'use strict';

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
  cors: { origin: '*', credentials: true },
  pingTimeout: 60000,
});

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => { logger.info(req.method + ' ' + req.path); next(); });

app.use('/api/auth',         authRoutes);
app.use('/api/requests',     requestRoutes);
app.use('/api/documents',    documentRoutes);
app.use('/api/otp',          otpRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat',         chatRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'operational', service: 'Cipher Private', timestamp: new Date().toISOString() });
});

// OTP Document Access Page
app.get('/vault/access/:token', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Cipher Private — Secure Document Access</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080808;font-family:'Montserrat',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:520px;width:100%;background:#0f0f0f;border:1px solid rgba(201,169,110,0.2)}
.hdr{padding:40px;text-align:center;border-bottom:1px solid rgba(201,169,110,0.1)}
.diamond{font-size:28px;color:#c9a96e;margin-bottom:12px}
.brand{font-size:9px;letter-spacing:10px;text-transform:uppercase;color:#c9a96e}
.sub{font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#5a4a2a;margin-top:5px}
.body{padding:40px}
.eyebrow{font-size:7px;letter-spacing:4px;text-transform:uppercase;color:#c9a96e;margin-bottom:10px}
h1{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:300;color:#f0ede8;margin-bottom:22px;line-height:1.3}
.doc-box{background:#0a0a0a;border:1px solid rgba(201,169,110,0.15);padding:18px 22px;margin-bottom:22px}
.doc-label{font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#5a4a2a;margin-bottom:7px}
.doc-name{font-size:14px;color:#f0ede8;font-weight:500}
.doc-meta{font-size:9px;color:#666;margin-top:5px}
p{font-size:12px;color:#888;line-height:1.9;margin-bottom:18px}
.otp-row{display:flex;gap:9px;margin:18px 0}
.otp-digit{flex:1;background:#0a0a0a;border:1px solid rgba(201,169,110,0.2);color:#c9a96e;font-size:22px;font-family:'Courier New',monospace;font-weight:700;text-align:center;padding:14px 0;outline:none;transition:border-color 0.2s;border-radius:0;-webkit-appearance:none}
.otp-digit:focus{border-color:#c9a96e;background:#0d0c08}
.btn{width:100%;padding:14px;background:#c9a96e;color:#080808;border:none;font-family:'Montserrat',sans-serif;font-size:9px;letter-spacing:4px;text-transform:uppercase;font-weight:700;cursor:pointer;margin-top:6px;transition:opacity 0.2s}
.btn:hover{opacity:0.88}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.err{background:rgba(231,76,60,0.08);border:1px solid rgba(231,76,60,0.3);color:#e74c3c;padding:11px 14px;font-size:11px;margin-top:10px;display:none}
.ok{background:rgba(46,204,113,0.08);border:1px solid rgba(46,204,113,0.3);color:#2ecc71;padding:14px;font-size:11px;margin-top:10px;text-align:center;display:none}
.note{font-size:10px;color:#444;margin-top:18px;line-height:1.7;border-top:1px solid rgba(201,169,110,0.06);padding-top:14px}
.spinner{text-align:center;padding:20px;color:#c9a96e;font-size:10px;letter-spacing:3px}
.expired{text-align:center;padding:20px}
</style>
</head>
<body>
<div class="card">
  <div class="hdr">
    <div class="diamond">&#9670;</div>
    <div class="brand">Cipher Private</div>
    <div class="sub">Secure Document Access</div>
  </div>
  <div class="body" id="cardBody">
    <div class="spinner" id="loadSpinner">LOADING</div>
    <div id="mainContent" style="display:none">
      <div class="eyebrow">Encrypted Document</div>
      <h1>Enter Your One-Time Code</h1>
      <div class="doc-box">
        <div class="doc-label">Document</div>
        <div class="doc-name" id="docName">Loading...</div>
        <div class="doc-meta" id="docMeta"></div>
      </div>
      <p>Enter the 6-digit code from your email. This code is single-use and bound to your email address.</p>
      <div class="otp-row" id="otpRow">
        <input class="otp-digit" type="number" min="0" max="9" id="d0" oninput="nxt(this,1)" onkeydown="bk(event,this,0)">
        <input class="otp-digit" type="number" min="0" max="9" id="d1" oninput="nxt(this,2)" onkeydown="bk(event,this,1)">
        <input class="otp-digit" type="number" min="0" max="9" id="d2" oninput="nxt(this,3)" onkeydown="bk(event,this,2)">
        <input class="otp-digit" type="number" min="0" max="9" id="d3" oninput="nxt(this,4)" onkeydown="bk(event,this,3)">
        <input class="otp-digit" type="number" min="0" max="9" id="d4" oninput="nxt(this,5)" onkeydown="bk(event,this,4)">
        <input class="otp-digit" type="number" min="0" max="9" id="d5" oninput="chk()" onkeydown="bk(event,this,5)">
      </div>
      <div class="err" id="errMsg"></div>
      <button class="btn" id="verifyBtn" onclick="verify()">Verify &amp; Access Document</button>
      <div class="ok" id="okMsg">&#10003; Verified. Downloading your document...</div>
      <div class="note">All access attempts are logged and auditable. AES-256 encrypted.</div>
    </div>
    <div id="expiredContent" style="display:none" class="expired">
      <div style="font-size:28px;color:#e74c3c;margin-bottom:14px">&#8856;</div>
      <div class="eyebrow" style="margin-bottom:10px">Access Unavailable</div>
      <p id="expiredMsg" style="color:#e74c3c;text-align:center"></p>
    </div>
  </div>
</div>
<script>
var TOKEN = location.pathname.split('/vault/access/')[1];
window.onload = function() {
  fetch('/api/otp/access/' + TOKEN)
    .then(function(r){ return r.json(); })
    .then(function(data) {
      document.getElementById('loadSpinner').style.display = 'none';
      if (data.expired || data.alreadyUsed || data.error) {
        document.getElementById('expiredContent').style.display = 'block';
        document.getElementById('expiredMsg').textContent = data.alreadyUsed
          ? 'This link has already been used. Each link is single-use.'
          : data.expired ? 'This link has expired. Please request a new one.'
          : data.error || 'Invalid link.';
        return;
      }
      document.getElementById('docName').textContent = data.documentName;
      var exp = new Date(data.expiresAt).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'});
      document.getElementById('docMeta').textContent = 'Shared by ' + data.senderName + '  |  Expires ' + exp + ' Sydney';
      document.getElementById('mainContent').style.display = 'block';
      document.getElementById('d0').focus();
    })
    .catch(function() {
      document.getElementById('loadSpinner').style.display = 'none';
      document.getElementById('expiredContent').style.display = 'block';
      document.getElementById('expiredMsg').textContent = 'Unable to load. Please try again or contact Cipher Private.';
    });
};
function getOTP() {
  return ['d0','d1','d2','d3','d4','d5'].map(function(id){ return document.getElementById(id).value; }).join('');
}
function nxt(el, nextIdx) {
  if (el.value.length > 1) el.value = el.value.slice(-1);
  if (el.value && nextIdx <= 5) document.getElementById('d' + nextIdx).focus();
}
function bk(e, el, idx) {
  if (e.key === 'Backspace' && !el.value && idx > 0) document.getElementById('d' + (idx-1)).focus();
  if (e.key === 'Enter') verify();
}
function chk() { if (getOTP().length === 6) verify(); }
function verify() {
  var otp = getOTP();
  if (otp.length !== 6) { showErr('Please enter all 6 digits.'); return; }
  var btn = document.getElementById('verifyBtn');
  btn.disabled = true; btn.textContent = 'VERIFYING...';
  hideErr();
  fetch('/api/otp/verify/' + TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp: otp })
  })
  .then(function(res) {
    if (res.ok) {
      document.getElementById('okMsg').style.display = 'block';
      btn.style.display = 'none';
      document.getElementById('otpRow').style.display = 'none';
      return res.blob().then(function(blob) {
        var docName = document.getElementById('docName').textContent;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = docName; a.click();
        URL.revokeObjectURL(url);
      });
    } else {
      return res.json().then(function(d) {
        showErr(d.error || 'Verification failed. Please check your code.');
        btn.disabled = false; btn.textContent = 'Verify & Access Document';
      });
    }
  })
  .catch(function() {
    showErr('Connection error. Please try again.');
    btn.disabled = false; btn.textContent = 'Verify & Access Document';
  });
}
function showErr(msg) { var e = document.getElementById('errMsg'); e.textContent = msg; e.style.display = 'block'; }
function hideErr() { document.getElementById('errMsg').style.display = 'none'; }
</script>
</body>
</html>`);
});

// Serve index.html for all other routes
const possiblePaths = [
  path.join(__dirname, '../../index.html'),
  path.join(__dirname, '../index.html'),
  path.join(process.cwd(), 'index.html'),
];
const clientHtml = possiblePaths.find(function(p){ return fs.existsSync(p); }) || possiblePaths[0];
logger.info('Serving frontend from: ' + clientHtml);

app.get('*', function(_req, res) {
  if (fs.existsSync(clientHtml)) {
    res.sendFile(clientHtml);
  } else {
    res.json({ status: 'Cipher Private API is running', docs: '/api/health' });
  }
});

app.use(function(err, _req, res, _next) {
  logger.error('Error: ' + err.message);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
});

io.use(authenticateSocket);
io.on('connection', function(socket) { handleSocketConnection(io, socket); });

const PORT = process.env.PORT || 3001;
server.listen(PORT, function() { logger.info('Cipher Private running on port ' + PORT); });
module.exports = { app, server, io };
