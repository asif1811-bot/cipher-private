'use strict';

const nodemailer = require('nodemailer');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

transporter.verify((error) => {
  if (error) logger.error('Email config error:', { error: error.message });
  else logger.info('Email service ready');
});

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Cipher Private'}" <${process.env.EMAIL_FROM || 'noreply@cipherprivate.com'}>`;
const SITE_URL = process.env.CLIENT_URL || 'https://cipherprivate.com';

const base = (content, preheader = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">${preheader ? `<span style="display:none;max-height:0;overflow:hidden">${preheader}</span>` : ''}<style>*{box-sizing:border-box}body{margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif}.wrapper{background:#080808;padding:40px 20px}.container{max-width:600px;margin:0 auto;background:#0f0f0f;border:1px solid rgba(201,169,110,0.15)}.header{padding:48px 40px 36px;text-align:center;border-bottom:1px solid rgba(201,169,110,0.12);background:linear-gradient(180deg,#0a0a0a,#0f0f0f)}.logo-mark{font-size:28px;color:#c9a96e;letter-spacing:2px;margin-bottom:10px}.logo-name{font-size:11px;letter-spacing:10px;text-transform:uppercase;color:#c9a96e;display:block}.logo-tagline{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#5a4a2a;margin-top:6px;display:block}.body{padding:48px 40px}.footer{padding:28px 40px;border-top:1px solid rgba(201,169,110,0.08);background:#0a0a0a;text-align:center}.footer p{font-size:10px;color:#444;line-height:1.9;margin:0}.footer a{color:#8a6f3e;text-decoration:none}h1{font-size:26px;color:#f0ede8;font-weight:300;margin:0 0 20px;letter-spacing:0.5px;line-height:1.3}h2{font-size:11px;color:#c9a96e;font-weight:400;letter-spacing:4px;text-transform:uppercase;margin:0 0 16px}p{font-size:13px;color:#888;line-height:1.95;margin:0 0 16px}.gold{color:#c9a96e}.white{color:#f0ede8}.divider{height:1px;background:rgba(201,169,110,0.1);margin:28px 0}.btn{display:inline-block;background:#c9a96e;color:#080808!important;padding:16px 40px;font-size:10px;letter-spacing:4px;text-transform:uppercase;text-decoration:none!important;font-weight:700;margin:8px 0}.info-box{background:#1a1605;border-left:3px solid #c9a96e;padding:20px 24px;margin:24px 0}.info-box p{margin:0;color:#c9a96e;font-size:12px}.otp-box{background:#0a0a0a;border:1px solid rgba(201,169,110,0.3);padding:36px;text-align:center;margin:28px 0}.otp-label{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#5a4a2a;margin-bottom:16px;display:block}.otp-code{font-size:48px;font-weight:700;letter-spacing:14px;color:#c9a96e;font-family:'Courier New',monospace;display:block}.tier-badge{display:inline-block;background:rgba(201,169,110,0.08);border:1px solid rgba(201,169,110,0.3);color:#c9a96e;font-size:9px;letter-spacing:4px;text-transform:uppercase;padding:6px 16px}.feature-list{margin:20px 0;padding:0;list-style:none}.feature-list li{font-size:12px;color:#888;padding:8px 0;border-bottom:1px solid rgba(201,169,110,0.05)}.sig-name{font-size:14px;color:#f0ede8;margin-bottom:4px}.sig-title{font-size:10px;color:#8a6f3e;letter-spacing:2px;text-transform:uppercase}</style></head><body><div class="wrapper"><div class="container"><div class="header"><div class="logo-mark">◆</div><span class="logo-name">Cipher Private</span><span class="logo-tagline">Your Life. Your Cipher. Our Promise.</span></div><div class="body">${content}</div><div class="footer"><p><strong style="color:#8a6f3e;letter-spacing:2px;font-size:9px;text-transform:uppercase">Cipher Private Pty Ltd</strong><br>Sydney, NSW, Australia &nbsp;·&nbsp; ABN XX XXX XXX XXX<br><br>This message is confidential and intended solely for the named recipient.<br><br><a href="${SITE_URL}/privacy">Privacy Policy</a> &nbsp;·&nbsp; <a href="${SITE_URL}">cipherprivate.com</a> &nbsp;·&nbsp; <a href="mailto:concierge@cipherprivate.com">concierge@cipherprivate.com</a></p></div></div></div></body></html>`;

const notifyAdmin = async (subject, body) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  try {
    await transporter.sendMail({ from: FROM, to: adminEmail, subject: `[Cipher Admin] ${subject}`, html: base(body) });
  } catch (e) { logger.error('Admin notify failed', { error: e.message }); }
};

const sendApplicationReceivedEmail = async (application) => {
  const tierMap = { CIPHER: 'Cipher — AUD $18,000 p.a.', CIPHER_BLACK: 'Cipher Black — AUD $48,000 p.a.', CIPHER_SOVEREIGN: 'Cipher Sovereign — Bespoke' };
  const tierName = tierMap[application.tier] || application.tier;
  const html = base(`
    <h2>Application Received</h2>
    <h1>Thank You,<br><span class="gold">${application.fullName.split(' ')[0]}.</span></h1>
    <p>Your application for Cipher Private membership has been received and is now under personal review by our membership director.</p>
    <div class="info-box"><p>Membership applied for: <strong>${tierName}</strong></p></div>
    <p>You will receive a response within <strong style="color:#f0ede8">48 business hours</strong>. All applications are treated with the utmost discretion and protected under Australia's Privacy Act 1988.</p>
    <div class="divider"></div>
    <div style="margin-top:24px"><div class="sig-name">The Membership Team</div><div class="sig-title">Cipher Private · Sydney</div></div>
  `, 'Your Cipher Private membership application has been received.');

  await transporter.sendMail({ from: FROM, to: application.email, subject: 'Cipher Private — Membership Application Received', html });

  await notifyAdmin(`New Application: ${application.fullName}`, `
    <h2>New Membership Application</h2>
    <p><span class="gold">Name:</span> <span class="white">${application.fullName}</span></p>
    <p><span class="gold">Email:</span> <span class="white">${application.email}</span></p>
    <p><span class="gold">Phone:</span> <span class="white">${application.phone || 'Not provided'}</span></p>
    <p><span class="gold">Tier:</span> <span class="white">${tierName}</span></p>
    <p><span class="gold">Referral:</span> <span class="white">${application.referral || 'None'}</span></p>
    <p><span class="gold">Submitted:</span> <span class="white">${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}</span></p>
    <div class="divider"></div>
    <a href="${SITE_URL}" class="btn">Review in Admin Portal</a>
  `);

  logger.info(`Application emails sent for ${application.email}`);
};

const sendWelcomeEmail = async (user) => {
  const tierMap = { CIPHER: 'Cipher', CIPHER_BLACK: 'Cipher Black', CIPHER_SOVEREIGN: 'Cipher Sovereign' };
  const tierName = tierMap[user.memberTier] || 'Cipher';
  const featuresMap = {
    CIPHER: ['Dedicated lifestyle manager (business hours)', 'Up to 40 concierge requests per month', 'Travel planning & restaurant reservations', 'Secure document vault — AES-256 encrypted', 'OTP-secured confidential document sharing', 'Cipher Journal — quarterly intelligence report'],
    CIPHER_BLACK: ['Dedicated lifestyle manager — 24/7 priority', 'Unlimited concierge requests', 'Private aviation sourcing & coordination', 'Medical concierge & specialist access', 'Estate management (up to 2 properties)', 'Unlimited encrypted document vault', 'End-to-end encrypted live chat', 'Annual Cipher Black member event', 'Annual security & privacy consultation'],
    CIPHER_SOVEREIGN: ['Senior director as personal point of contact', 'All Cipher Black services fully expanded', 'Family office support & governance', 'Personal security coordination', 'Multiple property stewardship', 'Philanthropic & legacy planning', 'Global network access & introductions'],
  };
  const features = featuresMap[user.memberTier] || featuresMap.CIPHER;

  const html = base(`
    <h2>Welcome to</h2>
    <h1>Cipher Private</h1>
    <p>Dear ${user.fullName.split(' ')[0]},</p>
    <p>It is our privilege to welcome you to Cipher Private. Your membership has been approved and your account is now active. Your dedicated lifestyle manager will contact you within <strong style="color:#f0ede8">24 hours</strong> to arrange your personal onboarding call.</p>
    <div style="text-align:center;margin:32px 0"><div class="tier-badge">${tierName} Member</div></div>
    <div class="divider"></div>
    <h2>Your Membership Includes</h2>
    <ul class="feature-list">${features.map(f => `<li>◆ &nbsp;${f}</li>`).join('')}</ul>
    <div class="divider"></div>
    <h2>Access Your Member Portal</h2>
    <p>Your secure portal gives you access to live encrypted chat with your lifestyle manager, your confidential document vault, and real-time request tracking.</p>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Access Your Portal Now</a></div>
    <div class="divider"></div>
    <div class="info-box"><p><strong>Security:</strong> Cipher Private staff will never ask for your password. All communications will only come from @cipherprivate.com addresses.</p></div>
    <div style="margin-top:32px"><div class="sig-name">The Cipher Private Team</div><div class="sig-title">Cipher Private · Sydney, Australia</div></div>
  `, `Welcome to Cipher Private — your ${tierName} membership is now active.`);

  await transporter.sendMail({ from: FROM, to: user.email, subject: `Welcome to Cipher Private — ${tierName} Membership Active`, html });
  logger.info(`Welcome email sent to ${user.email}`);
};

const sendOTPEmail = async ({ recipientEmail, otp, documentName, senderName, expiresAt, accessToken }) => {
  const expiry = new Date(expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'long', timeStyle: 'short' });
  const html = base(`
    <h2>Secure Document Share</h2>
    <h1>Encrypted File<br><span class="gold">Ready for Access</span></h1>
    <p><strong style="color:#f0ede8">${senderName}</strong> has shared a confidential document with you through Cipher Private's military-grade encrypted vault.</p>
    <div style="background:#0a0a0a;border:1px solid rgba(201,169,110,0.15);padding:20px 24px;margin:24px 0">
      <p style="margin:0;font-size:10px;color:#5a4a2a;letter-spacing:2px;text-transform:uppercase">Document</p>
      <p style="margin:6px 0 0;font-size:14px;color:#f0ede8;font-weight:500">${documentName}</p>
    </div>
    <p>Enter the one-time passcode below to access this document. This code is single-use and bound to your email address.</p>
    <div class="otp-box">
      <span class="otp-label">Your One-Time Access Code</span>
      <span class="otp-code">${otp}</span>
      <div style="font-size:10px;color:#555;margin-top:14px;letter-spacing:1px">Expires: ${expiry} (Sydney time)</div>
    </div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}/vault/access/${accessToken}" class="btn">Access Document Securely</a></div>
    <div class="divider"></div>
    <p style="font-size:11px;color:#555">All access attempts are logged, timestamped, and auditable. If you did not expect this document, do not enter the code and contact the sender immediately.</p>
  `, `${senderName} has shared an encrypted document with you.`);

  await transporter.sendMail({ from: FROM, to: recipientEmail, subject: `Cipher Private — Encrypted Document: ${documentName}`, html });
  logger.info(`OTP email sent to ${recipientEmail} for: ${documentName}`);
};

const sendRequestConfirmationEmail = async (user, request) => {
  const refId = request.id.split('-')[0].toUpperCase();
  const times = { CRITICAL: '15 minutes', URGENT: '1 hour', STANDARD: '4 hours' };

  const html = base(`
    <h2>Request Confirmed</h2>
    <h1>We're On It,<br><span class="gold">${user.fullName.split(' ')[0]}.</span></h1>
    <p>Your service request has been logged and your lifestyle manager has been notified.</p>
    <div style="background:#0a0a0a;border:1px solid rgba(201,169,110,0.12);padding:24px;margin:24px 0">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;font-size:10px;color:#5a4a2a;letter-spacing:2px;text-transform:uppercase;width:120px">Reference</td><td style="padding:6px 0;font-size:13px;color:#f0ede8;font-family:monospace;letter-spacing:2px">${refId}</td></tr>
        <tr><td style="padding:6px 0;font-size:10px;color:#5a4a2a;letter-spacing:2px;text-transform:uppercase">Category</td><td style="padding:6px 0;font-size:13px;color:#f0ede8">${request.category}</td></tr>
        <tr><td style="padding:6px 0;font-size:10px;color:#5a4a2a;letter-spacing:2px;text-transform:uppercase">Priority</td><td style="padding:6px 0;font-size:13px;color:#c9a96e">${request.priority}</td></tr>
        <tr><td style="padding:6px 0;font-size:10px;color:#5a4a2a;letter-spacing:2px;text-transform:uppercase">Response by</td><td style="padding:6px 0;font-size:13px;color:#f0ede8">${times[request.priority] || '4 hours'}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">Track in Portal</a></div>
  `);

  await transporter.sendMail({ from: FROM, to: user.email, subject: `Cipher Private — Request Received [${refId}]`, html });

  await notifyAdmin(`New Request from ${user.fullName} [${refId}]`, `
    <h2>New Service Request</h2>
    <p><span class="gold">Member:</span> <span class="white">${user.fullName}</span></p>
    <p><span class="gold">Tier:</span> <span class="white">${user.memberTier?.replace('_',' ')}</span></p>
    <p><span class="gold">Category:</span> <span class="white">${request.category}</span></p>
    <p><span class="gold">Priority:</span> <span class="white">${request.priority}</span></p>
    <p><span class="gold">Request:</span> <span class="white">${request.description}</span></p>
    <a href="${SITE_URL}" class="btn">View in Admin Portal</a>
  `);

  logger.info(`Request confirmation sent [${refId}] to ${user.email}`);
};

const sendRequestStatusEmail = async (user, request, newStatus) => {
  const refId = request.id.split('-')[0].toUpperCase();
  const msgs = {
    IN_PROGRESS: 'Your lifestyle manager is actively working on your request.',
    AWAITING_MEMBER: 'Your lifestyle manager needs additional information. Please check the portal.',
    COMPLETED: 'Your request has been fulfilled. Please log in to confirm.',
    CANCELLED: 'Your request has been cancelled. Contact your lifestyle manager if this was in error.',
  };

  const html = base(`
    <h2>Request Update</h2>
    <h1>Status: <span class="gold">${newStatus.replace('_', ' ')}</span></h1>
    <p>Reference <strong style="color:#f0ede8;font-family:monospace">[${refId}]</strong> has been updated.</p>
    <div class="info-box"><p>${msgs[newStatus] || 'Your request has been updated.'}</p></div>
    <div style="text-align:center;margin:28px 0"><a href="${SITE_URL}" class="btn">View in Portal</a></div>
  `);

  await transporter.sendMail({ from: FROM, to: user.email, subject: `Cipher Private — Request Update [${refId}]: ${newStatus.replace('_',' ')}`, html });
  logger.info(`Status update sent to ${user.email} [${refId}] → ${newStatus}`);
};

module.exports = { sendApplicationReceivedEmail, sendWelcomeEmail, sendOTPEmail, sendRequestConfirmationEmail, sendRequestStatusEmail };
