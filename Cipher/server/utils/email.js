'use strict';

const nodemailer = require('nodemailer');
const logger = require('./logger');

// Create transporter with connection timeout settings
const createTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER || 'apikey', pass: process.env.SMTP_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  pool: false,
  tls: { rejectUnauthorized: false },
});

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Cipher Private'}" <${process.env.EMAIL_FROM || 'noreply@cipherprivate.com'}>`;
const SITE_URL = process.env.CLIENT_URL || 'https://cipherprivate.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// Base HTML email template
const base = (content, preheader = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Cipher Private</title>
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}&nbsp;</div>` : ''}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrapper{background:#080808;padding:40px 20px}
.container{max-width:600px;margin:0 auto;background:#0f0f0f;border:1px solid rgba(201,169,110,0.2)}
.header{padding:48px 40px 36px;text-align:center;border-bottom:1px solid rgba(201,169,110,0.12);background:linear-gradient(180deg,#0a0a0a 0%,#0f0f0f 100%)}
.logo-diamond{font-size:24px;color:#c9a96e;display:block;margin-bottom:12px}
.logo-name{font-size:10px;letter-spacing:10px;text-transform:uppercase;color:#c9a96e;display:block}
.logo-tagline{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#5a4a2a;margin-top:6px;display:block}
.body{padding:48px 40px}
.footer{padding:28px 40px;border-top:1px solid rgba(201,169,110,0.08);background:#0a0a0a;text-align:center}
.footer p{font-size:10px;color:#444;line-height:1.9}
.footer a{color:#8a6f3e;text-decoration:none}
h1{font-size:26px;color:#f0ede8;font-weight:300;margin:0 0 20px;line-height:1.3}
h2{font-size:10px;color:#c9a96e;font-weight:400;letter-spacing:4px;text-transform:uppercase;margin:0 0 16px}
p{font-size:13px;color:#888;line-height:1.95;margin:0 0 16px}
.gold{color:#c9a96e}
.white{color:#f0ede8;font-weight:500}
.divider{height:1px;background:rgba(201,169,110,0.1);margin:28px 0}
.btn{display:inline-block;background:#c9a96e;color:#080808!important;padding:16px 40px;font-size:10px;letter-spacing:4px;text-transform:uppercase;text-decoration:none!important;font-weight:700;margin:8px 0}
.info-box{background:#1a1605;border-left:3px solid #c9a96e;padding:20px 24px;margin:24px 0}
.info-box p{color:#c9a96e;font-size:12px;margin:0}
.otp-box{background:#0a0a0a;border:1px solid rgba(201,169,110,0.3);padding:36px;text-align:center;margin:28px 0}
.otp-label{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#5a4a2a;margin-bottom:16px;display:block}
.otp-code{font-size:52px;font-weight:700;letter-spacing:14px;color:#c9a96e;font-family:'Courier New',monospace;display:block}
.tier-badge{display:inline-block;background:rgba(201,169,110,0.08);border:1px solid rgba(201,169,110,0.3);color:#c9a96e;font-size:9px;letter-spacing:4px;text-transform:uppercase;padding:8px 20px}
.feature-list{margin:20px 0;padding:0;list-style:none}
.feature-list li{font-size:12px;color:#888;padding:8px 0;border-bottom:1px solid rgba(201,169,110,0.05);line-height:1.6}
.detail-table{width:100%;border-collapse:collapse;margin:16px 0}
.detail-table td{padding:8px 0;font-size:12px;border-bottom:1px solid rgba(201,169,110,0.05)}
.detail-table td:first-child{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#5a4a2a;width:130px;padding-right:16px}
.detail-table td:last-child{color:#f0ede8}
.sig{margin-top:32px}
.sig-name{font-size:14px;color:#f0ede8;margin-bottom:4px}
.sig-title{font-size:9px;color:#8a6f3e;letter-spacing:2px;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrapper">
<div class="container">
<div class="header">
  <span class="logo-diamond">◆</span>
  <span class="logo-name">Cipher Private</span>
  <span class="logo-tagline">Your Life. Your Cipher. Our Promise.</span>
</div>
<div class="body">${content}</div>
<div class="footer">
  <p>
    <strong style="color:#8a6f3e;letter-spacing:2px;font-size:9px;text-transform:uppercase">Cipher Private Pty Ltd</strong><br>
    Sydney, NSW, Australia<br><br>
    This message is confidential and intended solely for the named recipient.<br>
    If you received this in error, please delete it immediately.<br><br>
    <a href="${SITE_URL}/privacy">Privacy Policy</a> &nbsp;·&nbsp;
    <a href="${SITE_URL}">cipherprivate.com</a> &nbsp;·&nbsp;
    <a href="mailto:concierge@cipherprivate.com">concierge@cipherprivate.com</a>
  </p>
</div>
</div>
</div>
</body>
</html>`;

// Send with retry logic
const sendEmail = async (mailOptions, retries = 2) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const transporter = createTransporter();
      const result = await transporter.sendMail(mailOptions);
      logger.info(`Email sent: ${mailOptions.subject} → ${mailOptions.to}`);
      return result;
    } catch (err) {
      logger.error(`Email attempt ${i + 1} failed: ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
};

// Notify admin of important events
const notifyAdmin = async (subject, bodyHtml) => {
  if (!ADMIN_EMAIL) { logger.warn('ADMIN_EMAIL not set — skipping admin notification'); return; }
  await sendEmail({ from: FROM, to: ADMIN_EMAIL, subject: `[Cipher Admin] ${subject}`, html: base(bodyHtml) });
};

// ── EMAIL FUNCTIONS ───────────────────────────────────────────────────────────

const sendApplicationReceivedEmail = async (application) => {
  const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
  const tierName = tierMap[application.tier] || 'Cipher';

  const html = base(`
    <h2>Application Received</h2>
    <h1>Thank You,<br><span class="gold">${application.fullName.split(' ')[0]}.</span></h1>
    <p>Your application for Cipher Private membership has been received and is now under personal review by our membership director.</p>
    <table class="detail-table">
      <tr><td>Applied Tier</td><td class="gold">${tierName}</td></tr>
      <tr><td>Status</td><td>Under Review</td></tr>
      <tr><td>Response Time</td><td>Within 48 business hours</td></tr>
    </table>
    <p>All applications are treated with the utmost discretion and protected under Australia's Privacy Act 1988.</p>
    <div class="info-box"><p>We will contact you directly at this email address. Cipher Private staff will never ask for sensitive personal information via email.</p></div>
    <div class="divider"></div>
    <div class="sig"><div class="sig-name">The Membership Team</div><div class="sig-title">Cipher Private · Sydney, Australia</div></div>
  `, `Your Cipher Private application has been received — we'll be in touch within 48 hours.`);

  await sendEmail({ from: FROM, to: application.email, subject: 'Cipher Private — Membership Application Received', html });

  // Notify admin
  await notifyAdmin(`New Application: ${application.fullName}`, `
    <h2>New Membership Application</h2>
    <p>A new membership application has been submitted.</p>
    <table class="detail-table">
      <tr><td>Name</td><td class="white">${application.fullName}</td></tr>
      <tr><td>Email</td><td class="white">${application.email}</td></tr>
      <tr><td>Phone</td><td class="white">${application.phone || 'Not provided'}</td></tr>
      <tr><td>Tier</td><td class="gold">${tierName}</td></tr>
      <tr><td>Referral</td><td class="white">${application.referral || 'None'}</td></tr>
      <tr><td>Submitted</td><td class="white">${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}</td></tr>
    </table>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Review in Admin Portal</a></div>
  `);

  logger.info(`Application emails sent: ${application.email}`);
};

const sendApplicationApprovedEmail = async (application) => {
  const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
  const tierName = tierMap[application.tier] || 'Cipher';

  const html = base(`
    <h2>Membership Approved</h2>
    <h1>Welcome to<br><span class="gold">Cipher Private</span></h1>
    <p>Dear ${application.fullName.split(' ')[0]},</p>
    <p>We are delighted to confirm that your application for <strong class="white">${tierName}</strong> membership has been approved.</p>
    <div style="text-align:center;margin:28px 0"><div class="tier-badge">${tierName} Member</div></div>
    <p>Your dedicated lifestyle manager will contact you within <strong class="white">24 hours</strong> to arrange your personal onboarding call and provide your secure portal access credentials.</p>
    <div class="info-box"><p><strong>Security Note:</strong> Your login credentials will be sent in a separate secure communication. Cipher Private staff will never ask for your password.</p></div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Visit cipherprivate.com</a></div>
    <div class="divider"></div>
    <div class="sig"><div class="sig-name">The Cipher Private Team</div><div class="sig-title">Cipher Private · Sydney, Australia</div></div>
  `, `Congratulations — your Cipher Private ${tierName} membership has been approved.`);

  await sendEmail({ from: FROM, to: application.email, subject: `Cipher Private — Your ${tierName} Membership Has Been Approved`, html });
  logger.info(`Approval email sent: ${application.email}`);
};

const sendWelcomeEmail = async (user) => {
  const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
  const tierName = tierMap[user.memberTier] || 'Cipher';
  const featuresMap = {
    CIPHER: ['Dedicated lifestyle manager (business hours)', 'Up to 40 concierge requests per month', 'Travel planning & restaurant reservations', 'Event ticketing & access', 'Secure document vault — AES-256 encrypted', 'OTP-secured confidential document sharing', 'Cipher Journal — quarterly intelligence'],
    CIPHER_BLACK: ['Dedicated lifestyle manager — 24/7 priority access', 'Unlimited concierge requests', 'Private aviation sourcing & coordination', 'Medical concierge & specialist access', 'Estate management up to 2 properties', 'Unlimited encrypted document vault', 'End-to-end encrypted live chat', 'Annual Cipher Black exclusive member event', 'Annual security & privacy consultation'],
    CIPHER_SOVEREIGN: ['Senior director as personal point of contact', 'All Cipher Black services — fully expanded', 'Family office support & governance', 'Personal security coordination', 'Multiple property & estate stewardship', 'Philanthropic & legacy planning support', 'Global network access & curated introductions'],
  };
  const features = featuresMap[user.memberTier] || featuresMap.CIPHER;

  const html = base(`
    <h2>Welcome to Cipher Private</h2>
    <h1>Your Membership<br>is <span class="gold">Now Active</span></h1>
    <p>Dear ${user.fullName.split(' ')[0]},</p>
    <p>It is our privilege to welcome you to Cipher Private. Your account is now active and your dedicated lifestyle manager has been notified of your membership.</p>
    <div style="text-align:center;margin:28px 0"><div class="tier-badge">${tierName} Member</div></div>
    <div class="divider"></div>
    <h2>Your Membership Includes</h2>
    <ul class="feature-list">${features.map(f => `<li>◆ &nbsp;${f}</li>`).join('')}</ul>
    <div class="divider"></div>
    <h2>Access Your Member Portal</h2>
    <p>Your secure member portal gives you access to encrypted live chat with your lifestyle manager, your confidential document vault, and real-time service request tracking.</p>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Access Your Portal Now</a></div>
    <div class="info-box"><p><strong>Security:</strong> Cipher Private staff will never ask for your password. All official communications come exclusively from @cipherprivate.com addresses.</p></div>
    <div class="divider"></div>
    <div class="sig"><div class="sig-name">The Cipher Private Team</div><div class="sig-title">Cipher Private · Sydney, Australia</div></div>
  `, `Welcome to Cipher Private — your ${tierName} membership is now active.`);

  await sendEmail({ from: FROM, to: user.email, subject: `Welcome to Cipher Private — Your ${tierName} Membership is Active`, html });
  logger.info(`Welcome email sent: ${user.email}`);
};

const sendOTPEmail = async ({ recipientEmail, otp, documentName, senderName, expiresAt, accessToken }) => {
  const expiry = new Date(expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'long', timeStyle: 'short' });
  const html = base(`
    <h2>Secure Document Share</h2>
    <h1>Encrypted File<br><span class="gold">Ready for Access</span></h1>
    <p><strong class="white">${senderName}</strong> has shared a confidential document with you through Cipher Private's AES-256 encrypted vault.</p>
    <div style="background:#0a0a0a;border:1px solid rgba(201,169,110,0.15);padding:20px 24px;margin:24px 0">
      <p style="font-size:10px;color:#5a4a2a;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Document</p>
      <p style="font-size:15px;color:#f0ede8;font-weight:500;margin:0">${documentName}</p>
    </div>
    <p>Enter the one-time passcode below to access this document. This code is single-use and bound to your email address.</p>
    <div class="otp-box">
      <span class="otp-label">Your One-Time Access Code</span>
      <span class="otp-code">${otp}</span>
      <div style="font-size:10px;color:#555;margin-top:16px;letter-spacing:1px">Expires: ${expiry} (Sydney time)</div>
    </div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}/vault/access/${accessToken}" class="btn">Access Document Securely</a></div>
    <div class="divider"></div>
    <p style="font-size:11px;color:#555">All access attempts are logged, timestamped, and auditable. If you did not expect this document, do not enter the code and contact ${senderName} immediately.</p>
  `, `${senderName} has shared an encrypted document with you via Cipher Private.`);

  await sendEmail({ from: FROM, to: recipientEmail, subject: `Cipher Private — Secure Document: ${documentName}`, html });
  logger.info(`OTP email sent to ${recipientEmail} for: ${documentName}`);
};

const sendRequestConfirmationEmail = async (user, request) => {
  const refId = request.id.split('-')[0].toUpperCase();
  const times = { CRITICAL: '15 minutes', URGENT: '1 hour', STANDARD: '4 hours' };

  const html = base(`
    <h2>Request Confirmed</h2>
    <h1>We're On It,<br><span class="gold">${user.fullName.split(' ')[0]}.</span></h1>
    <p>Your service request has been received and logged. Your lifestyle manager has been notified and will respond within the timeframe below.</p>
    <table class="detail-table">
      <tr><td>Reference</td><td style="font-family:monospace;letter-spacing:2px;color:#c9a96e">${refId}</td></tr>
      <tr><td>Category</td><td class="white">${request.category}</td></tr>
      <tr><td>Priority</td><td class="gold">${request.priority}</td></tr>
      <tr><td>Response by</td><td class="white">${times[request.priority] || '4 hours'}</td></tr>
    </table>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Track in Your Portal</a></div>
    <div class="divider"></div>
    <div class="sig"><div class="sig-name">The Cipher Private Team</div><div class="sig-title">Cipher Private · Sydney, Australia</div></div>
  `, `Your request [${refId}] has been received — we're on it.`);

  await sendEmail({ from: FROM, to: user.email, subject: `Cipher Private — Request Received [${refId}]`, html });

  // Notify admin
  await notifyAdmin(`New Request from ${user.fullName} [${refId}]`, `
    <h2>New Service Request</h2>
    <table class="detail-table">
      <tr><td>Member</td><td class="white">${user.fullName}</td></tr>
      <tr><td>Email</td><td class="white">${user.email}</td></tr>
      <tr><td>Tier</td><td class="gold">${(user.memberTier || '').replace(/_/g,' ')}</td></tr>
      <tr><td>Reference</td><td style="font-family:monospace;color:#c9a96e">${refId}</td></tr>
      <tr><td>Category</td><td class="white">${request.category}</td></tr>
      <tr><td>Priority</td><td class="white">${request.priority}</td></tr>
    </table>
    <div class="info-box"><p>${request.description}</p></div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Action in Admin Portal</a></div>
  `);

  logger.info(`Request confirmation sent [${refId}] to ${user.email}`);
};

const sendRequestStatusEmail = async (user, request, newStatus) => {
  const refId = request.id.split('-')[0].toUpperCase();
  const msgs = {
    IN_PROGRESS: 'Your lifestyle manager is actively working on your request. You will be contacted directly with updates.',
    AWAITING_MEMBER: 'Your lifestyle manager requires additional information to proceed. Please log in to your portal or reply to this email.',
    COMPLETED: 'Your request has been fulfilled to completion. Please log in to confirm everything is in order.',
    CANCELLED: 'Your request has been cancelled. Please contact your lifestyle manager if this was in error.',
  };
  const statusDisplay = newStatus.replace(/_/g, ' ');

  const html = base(`
    <h2>Request Update</h2>
    <h1>Status: <span class="gold">${statusDisplay}</span></h1>
    <p>Reference <strong style="font-family:monospace;color:#c9a96e">[${refId}]</strong> has been updated.</p>
    <div class="info-box"><p>${msgs[newStatus] || 'Your request status has been updated.'}</p></div>
    <table class="detail-table">
      <tr><td>Reference</td><td style="font-family:monospace;color:#c9a96e">${refId}</td></tr>
      <tr><td>New Status</td><td class="gold">${statusDisplay}</td></tr>
      <tr><td>Category</td><td class="white">${request.category || ''}</td></tr>
    </table>
    ${request.adminNote ? `<p style="font-size:12px;color:#888;margin-top:8px"><strong class="white">Note from your manager:</strong><br>${request.adminNote}</p>` : ''}
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">View in Your Portal</a></div>
    <div class="divider"></div>
    <div class="sig"><div class="sig-name">The Cipher Private Team</div><div class="sig-title">Cipher Private · Sydney, Australia</div></div>
  `, `Request [${refId}] update: ${statusDisplay}`);

  await sendEmail({ from: FROM, to: user.email, subject: `Cipher Private — Request Update [${refId}]: ${statusDisplay}`, html });
  logger.info(`Status update sent to ${user.email} [${refId}] → ${newStatus}`);
};

module.exports = {
  sendApplicationReceivedEmail,
  sendApplicationApprovedEmail,
  sendWelcomeEmail,
  sendOTPEmail,
  sendRequestConfirmationEmail,
  sendRequestStatusEmail,
};
