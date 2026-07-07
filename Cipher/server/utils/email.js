'use strict';

const https = require('https');
const logger = require('./logger');

const SITE_URL = process.env.CLIENT_URL || 'https://consiere.com.au';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Consiere';
const FROM_EMAIL = process.env.EMAIL_FROM || 'hello@consiere.com.au';
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`;

// ── SEND VIA RESEND API (HTTPS — never blocked by Railway) ───────────────────
// Uses RESEND_API_KEY env var. Get free key at resend.com (100 emails/day free)
// Falls back to SendGrid API if SENDGRID_API_KEY is set
// Falls back to log-only if neither key is set

const sendEmail = async ({ to, subject, html }, retries = 2) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // ── Try Resend first ──────────────────────────────────────────────────
      if (process.env.RESEND_API_KEY) {
        const body = JSON.stringify({ from: FROM, to: [to], subject, html });
        await httpsPost('api.resend.com', '/emails', process.env.RESEND_API_KEY, body);
        logger.info(`[EMAIL OK via Resend] ${subject} → ${to}`);
        return;
      }

      // ── Try SendGrid API (not SMTP — uses HTTPS) ──────────────────────────
      if (process.env.SENDGRID_API_KEY || process.env.SMTP_PASS) {
        const apiKey = process.env.SENDGRID_API_KEY || process.env.SMTP_PASS;
        const body = JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: FROM_EMAIL, name: FROM_NAME },
          subject,
          content: [{ type: 'text/html', value: html }],
        });
        await httpsPost('api.sendgrid.com', '/v3/mail/send', apiKey, body);
        logger.info(`[EMAIL OK via SendGrid API] ${subject} → ${to}`);
        return;
      }

      // ── No API key — log only ─────────────────────────────────────────────
      logger.warn('[EMAIL SKIPPED] No RESEND_API_KEY or SENDGRID_API_KEY set. Set one in Railway Variables.');
      logger.info('[EMAIL CONTENT] To: ' + to + ' | Subject: ' + subject);
      return;

    } catch (err) {
      logger.error('[EMAIL ATTEMPT ' + (attempt + 1) + ' FAILED] ' + err.message);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
};

// Simple HTTPS POST helper — no SMTP, no ports, just HTTPS
const httpsPost = (host, path, apiKey, body) => new Promise((resolve, reject) => {
  const req = https.request({
    hostname: host,
    port: 443,
    path,
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(data);
      } else {
        reject(new Error('API error ' + res.statusCode + ': ' + data.substring(0, 200)));
      }
    });
  });
  req.on('error', reject);
  req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  req.write(body);
  req.end();
});

// Notify admin
const notifyAdmin = async (subject, html) => {
  if (!ADMIN_EMAIL) return;
  try {
    await sendEmail({ to: ADMIN_EMAIL, subject: '[Cipher Admin] ' + subject, html });
  } catch (err) {
    logger.error('[ADMIN NOTIFY FAILED] ' + err.message);
  }
};

// ── BASE HTML TEMPLATE ────────────────────────────────────────────────────────
const base = (bodyContent, preheader = '') => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Consiere</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080808;font-family:'Helvetica Neue',Arial,sans-serif}
.wrapper{background:#080808;padding:40px 20px}
.container{max-width:600px;margin:0 auto;background:#0f0f0f;border:1px solid rgba(201,169,110,0.2)}
.hdr{padding:48px 40px 36px;text-align:center;border-bottom:1px solid rgba(201,169,110,0.12)}
.body{padding:48px 40px}
.ftr{padding:28px 40px;border-top:1px solid rgba(201,169,110,0.08);background:#0a0a0a;text-align:center;font-size:10px;color:#444;line-height:1.9}
.ftr a{color:#8a6f3e;text-decoration:none}
h1{font-size:26px;color:#f0ede8;font-weight:300;margin:0 0 20px;line-height:1.3}
h2{font-size:10px;color:#c9a96e;font-weight:400;letter-spacing:4px;text-transform:uppercase;margin:0 0 16px}
p{font-size:13px;color:#888;line-height:1.95;margin:0 0 16px}
.gold{color:#c9a96e}.white{color:#f0ede8;font-weight:500}
.divider{height:1px;background:rgba(201,169,110,0.1);margin:28px 0}
.btn{display:inline-block;background:#c9a96e;color:#080808!important;padding:16px 40px;font-size:10px;letter-spacing:4px;text-transform:uppercase;text-decoration:none!important;font-weight:700;margin:8px 0}
.info-box{background:#1a1605;border-left:3px solid #c9a96e;padding:20px 24px;margin:24px 0}
.info-box p{color:#c9a96e;font-size:12px;margin:0}
.otp-box{background:#0a0a0a;border:1px solid rgba(201,169,110,0.3);padding:36px;text-align:center;margin:28px 0}
.otp-code{font-size:52px;font-weight:700;letter-spacing:14px;color:#c9a96e;font-family:'Courier New',monospace;display:block}
.tier-badge{display:inline-block;background:rgba(201,169,110,0.08);border:1px solid rgba(201,169,110,0.3);color:#c9a96e;font-size:9px;letter-spacing:4px;text-transform:uppercase;padding:8px 20px}
.dt{width:100%;border-collapse:collapse;margin:16px 0}
.dt td{padding:8px 0;font-size:12px;border-bottom:1px solid rgba(201,169,110,0.05)}
.dt td:first-child{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#5a4a2a;width:130px}
.dt td:last-child{color:#f0ede8}
.sig-name{font-size:14px;color:#f0ede8;margin-bottom:4px;margin-top:32px}
.sig-title{font-size:9px;color:#8a6f3e;letter-spacing:2px;text-transform:uppercase}
</style></head>
<body><div class="wrapper"><div class="container">
<div class="hdr">
  <div style="color:#c9a96e;font-size:24px;margin-bottom:12px">◆</div>
  <div style="font-size:10px;letter-spacing:10px;text-transform:uppercase;color:#c9a96e">Consiere</div>
  <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#5a4a2a;margin-top:6px">Your Life. Your Cipher. Our Promise.</div>
</div>
<div class="body">${bodyContent}</div>
<div class="ftr">
  <strong style="color:#8a6f3e;letter-spacing:2px;font-size:9px;text-transform:uppercase">Consiere Pty Ltd</strong><br>
  Sydney, NSW, Australia<br><br>
  This message is confidential and intended solely for the named recipient.<br><br>
  <a href="${SITE_URL}/privacy">Privacy Policy</a> &nbsp;·&nbsp;
  <a href="${SITE_URL}/portal">Member Portal</a> &nbsp;·&nbsp;
  <a href="mailto:hello@consiere.com.au">hello@consiere.com.au</a>
</div>
</div></div></body></html>`;

// ── EMAIL FUNCTIONS ───────────────────────────────────────────────────────────

const sendApplicationReceivedEmail = async (application) => {
  const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
  const tierName = tierMap[application.tier] || 'Cipher';
  const firstName = application.fullName.split(' ')[0];

  const html = base(`
    <h2>Application Received</h2>
    <h1>Thank You, <span class="gold">${firstName}.</span></h1>
    <p>Your application for Consiere membership has been received and is now under personal review by our membership director.</p>
    <table class="dt">
      <tr><td>Applied Tier</td><td class="gold">${tierName}</td></tr>
      <tr><td>Status</td><td>Under Review</td></tr>
      <tr><td>Response</td><td>Within 48 business hours</td></tr>
    </table>
    <div class="info-box"><p>We will contact you at this address. Consiere staff will never ask for sensitive personal information via email.</p></div>
    <div class="divider"></div>
    <div class="sig-name">The Membership Team</div><div class="sig-title">Consiere · Sydney, Australia</div>
  `, 'Your Consiere application has been received.');

  await sendEmail({ to: application.email, subject: 'Consiere — Membership Application Received', html });

  await notifyAdmin('New Application: ' + application.fullName, base(`
    <h2>New Membership Application</h2>
    <table class="dt">
      <tr><td>Name</td><td class="white">${application.fullName}</td></tr>
      <tr><td>Email</td><td class="white">${application.email}</td></tr>
      <tr><td>Phone</td><td class="white">${application.phone || 'Not provided'}</td></tr>
      <tr><td>Tier</td><td class="gold">${tierName}</td></tr>
      <tr><td>Referral</td><td class="white">${application.referral || 'None'}</td></tr>
    </table>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Review in Admin Portal</a></div>
  `));

  logger.info('[APPLICATION EMAIL] Sent to: ' + application.email);
};

const sendApplicationApprovedEmail = async (application) => {
  const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
  const tierName = tierMap[application.tier] || 'Cipher';
  const firstName = application.fullName.split(' ')[0];

  const html = base(`
    <h2>Membership Approved</h2>
    <h1>Welcome to <span class="gold">Consiere</span></h1>
    <p>Dear ${firstName},</p>
    <p>We are delighted to confirm that your application for <strong class="white">${tierName}</strong> membership has been approved.</p>
    <div style="text-align:center;margin:28px 0"><div class="tier-badge">${tierName} Member</div></div>
    <p>Your dedicated lifestyle manager will contact you within <strong class="white">24 hours</strong> to arrange your personal onboarding call and provide your secure portal access credentials.</p>
    <div class="info-box"><p>Your login credentials will be sent in a separate secure communication. Consiere staff will never ask for your password.</p></div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}/portal" class="btn">Access Your Member Portal</a></div>
    <div class="divider"></div>
    <div class="sig-name">The Consiere Team</div><div class="sig-title">Consiere · Sydney, Australia</div>
  `, 'Your Consiere membership has been approved.');

  await sendEmail({ to: application.email, subject: 'Consiere — Your ' + tierName + ' Membership Has Been Approved', html });
  logger.info('[APPROVAL EMAIL] Sent to: ' + application.email);
};

const sendWelcomeEmail = async (user) => {
  const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
  const tierName = tierMap[user.memberTier] || 'Cipher';
  const firstName = user.fullName.split(' ')[0];

  const html = base(`
    <h2>Welcome to Consiere</h2>
    <h1>Your Membership is <span class="gold">Now Active</span></h1>
    <p>Dear ${firstName},</p>
    <p>It is our privilege to welcome you to Consiere. Your account is now active and your dedicated lifestyle manager has been notified.</p>
    <div style="text-align:center;margin:28px 0"><div class="tier-badge">${tierName} Member</div></div>
    <p>Your secure member portal gives you access to encrypted live chat with your lifestyle manager, your confidential document vault, and real-time service request tracking.</p>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Access Your Portal Now</a></div>
    <div class="info-box"><p>Consiere staff will never ask for your password. All official communications come exclusively from @consiere.com.au addresses.</p></div>
    <div class="divider"></div>
    <div class="sig-name">The Consiere Team</div><div class="sig-title">Consiere · Sydney, Australia</div>
  `, 'Welcome to Consiere — your ' + tierName + ' membership is now active.');

  await sendEmail({ to: user.email, subject: 'Welcome to Consiere — Your ' + tierName + ' Membership is Active', html });
  logger.info('[WELCOME EMAIL] Sent to: ' + user.email);
};

const sendOTPEmail = async ({ recipientEmail, otp, documentName, senderName, expiresAt, accessToken }) => {
  // Always log OTP as fallback — admin can see it in Railway logs
  logger.info('[OTP FALLBACK] Code: ' + otp + ' | Doc: ' + documentName + ' | Recipient: ' + recipientEmail + ' | Expires: ' + expiresAt);

  const expiry = new Date(expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'long', timeStyle: 'short' });

  const html = base(`
    <h2>Secure Document Share</h2>
    <h1>Encrypted File <span class="gold">Ready for Access</span></h1>
    <p><strong class="white">${senderName}</strong> has shared a confidential document with you through Consiere's AES-256 encrypted vault.</p>
    <div style="background:#0a0a0a;border:1px solid rgba(201,169,110,0.15);padding:20px 24px;margin:24px 0">
      <p style="font-size:10px;color:#5a4a2a;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Document</p>
      <p style="font-size:15px;color:#f0ede8;font-weight:500;margin:0">${documentName}</p>
    </div>
    <p>Enter the one-time passcode below to access this document. This code is single-use and bound to your email address.</p>
    <div class="otp-box">
      <span style="font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#5a4a2a;margin-bottom:16px;display:block">Your One-Time Access Code</span>
      <span class="otp-code">${otp}</span>
      <div style="font-size:10px;color:#555;margin-top:16px;letter-spacing:1px">Expires: ${expiry} (Sydney time)</div>
    </div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}/vault/access/${accessToken}" class="btn">Access Document Securely</a></div>
    <div class="divider"></div>
    <p style="font-size:11px;color:#555">All access attempts are logged and auditable. If you did not expect this document, do not enter the code.</p>
  `, senderName + ' has shared an encrypted document with you.');

  await sendEmail({ to: recipientEmail, subject: 'Consiere — Secure Document: ' + documentName, html });
  logger.info('[OTP EMAIL] Sent to: ' + recipientEmail + ' for doc: ' + documentName);
};

const sendRequestConfirmationEmail = async (user, request) => {
  const refId = request.id.split('-')[0].toUpperCase();
  const times = { CRITICAL: '15 minutes', URGENT: '1 hour', STANDARD: '4 hours' };
  const firstName = user.fullName.split(' ')[0];

  const html = base(`
    <h2>Request Confirmed</h2>
    <h1>We're On It, <span class="gold">${firstName}.</span></h1>
    <p>Your service request has been received. Your lifestyle manager has been notified and will respond within the timeframe below.</p>
    <table class="dt">
      <tr><td>Reference</td><td style="font-family:monospace;letter-spacing:2px;color:#c9a96e">${refId}</td></tr>
      <tr><td>Category</td><td class="white">${request.category}</td></tr>
      <tr><td>Priority</td><td class="gold">${request.priority}</td></tr>
      <tr><td>Response by</td><td class="white">${times[request.priority] || '4 hours'}</td></tr>
    </table>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Track in Your Portal</a></div>
    <div class="divider"></div>
    <div class="sig-name">The Consiere Team</div><div class="sig-title">Consiere · Sydney, Australia</div>
  `, 'Your request [' + refId + '] has been received.');

  await sendEmail({ to: user.email, subject: 'Consiere — Request Received [' + refId + ']', html });

  await notifyAdmin('New Request from ' + user.fullName + ' [' + refId + ']', base(`
    <h2>New Service Request</h2>
    <table class="dt">
      <tr><td>Member</td><td class="white">${user.fullName}</td></tr>
      <tr><td>Email</td><td class="white">${user.email}</td></tr>
      <tr><td>Tier</td><td class="gold">${(user.memberTier || '').replace(/_/g, ' ')}</td></tr>
      <tr><td>Reference</td><td style="font-family:monospace;color:#c9a96e">${refId}</td></tr>
      <tr><td>Category</td><td class="white">${request.category}</td></tr>
      <tr><td>Priority</td><td class="white">${request.priority}</td></tr>
    </table>
    <div class="info-box"><p>${request.description}</p></div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Action in Admin Portal</a></div>
  `));

  logger.info('[REQUEST EMAIL] Sent [' + refId + '] to ' + user.email);
};

const sendRequestStatusEmail = async (user, request, newStatus) => {
  const refId = request.id.split('-')[0].toUpperCase();
  const msgs = {
    IN_PROGRESS: 'Your lifestyle manager is actively working on your request.',
    AWAITING_MEMBER: 'Your lifestyle manager requires additional information. Please log in to your portal or reply to this email.',
    COMPLETED: 'Your request has been fulfilled. Please log in to confirm everything is in order.',
    CANCELLED: 'Your request has been cancelled. Please contact your lifestyle manager if this was in error.',
  };
  const statusDisplay = newStatus.replace(/_/g, ' ');

  const html = base(`
    <h2>Request Update</h2>
    <h1>Status: <span class="gold">${statusDisplay}</span></h1>
    <p>Reference <strong style="font-family:monospace;color:#c9a96e">[${refId}]</strong> has been updated.</p>
    <div class="info-box"><p>${msgs[newStatus] || 'Your request status has been updated.'}</p></div>
    <table class="dt">
      <tr><td>Reference</td><td style="font-family:monospace;color:#c9a96e">${refId}</td></tr>
      <tr><td>New Status</td><td class="gold">${statusDisplay}</td></tr>
      <tr><td>Category</td><td class="white">${request.category || ''}</td></tr>
    </table>
    ${request.adminNote ? '<p style="font-size:12px;color:#888;margin-top:8px"><strong class="white">Note from your manager:</strong><br>' + request.adminNote + '</p>' : ''}
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">View in Your Portal</a></div>
    <div class="divider"></div>
    <div class="sig-name">The Consiere Team</div><div class="sig-title">Consiere · Sydney, Australia</div>
  `, 'Request [' + refId + '] update: ' + statusDisplay);

  await sendEmail({ to: user.email, subject: 'Consiere — Request Update [' + refId + ']: ' + statusDisplay, html });
  logger.info('[STATUS EMAIL] [' + refId + '] → ' + newStatus + ' to ' + user.email);
};

module.exports = {
  sendApplicationReceivedEmail,
  sendApplicationApprovedEmail,
  sendWelcomeEmail,
  sendOTPEmail,
  sendRequestConfirmationEmail,
  sendRequestStatusEmail,
};
