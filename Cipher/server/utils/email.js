'use strict';

const nodemailer = require('nodemailer');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Cipher Private'}" <${process.env.EMAIL_FROM || 'noreply@cipherprivate.com.au'}>`;

// ── Email Templates ──────────────────────────────────────────────────────────

const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { background:#0a0a0a; font-family:'Helvetica Neue',Arial,sans-serif; margin:0; padding:0; }
  .container { max-width:600px; margin:0 auto; background:#111111; }
  .header { padding:40px; text-align:center; border-bottom:1px solid rgba(201,169,110,0.2); }
  .logo { font-size:10px; letter-spacing:6px; text-transform:uppercase; color:#c9a96e; }
  .logo-name { font-size:22px; letter-spacing:8px; color:#f5f3ef; display:block; margin-top:6px; }
  .body { padding:40px; }
  .footer { padding:24px 40px; border-top:1px solid rgba(201,169,110,0.1); }
  .footer p { font-size:10px; color:#555; line-height:1.8; margin:0; }
  h1 { font-size:24px; color:#f5f3ef; font-weight:300; margin:0 0 16px; }
  p { font-size:13px; color:#a8a8a8; line-height:1.9; margin:0 0 16px; }
  .otp-box { background:#1a1605; border:1px solid rgba(201,169,110,0.3); padding:28px; text-align:center; margin:24px 0; }
  .otp-code { font-size:42px; font-weight:700; letter-spacing:12px; color:#c9a96e; font-family:monospace; }
  .otp-label { font-size:9px; letter-spacing:3px; text-transform:uppercase; color:#8a6f3e; margin-bottom:12px; }
  .btn { display:inline-block; background:#c9a96e; color:#0a0a0a; padding:14px 32px; font-size:10px; letter-spacing:3px; text-transform:uppercase; text-decoration:none; font-weight:700; margin:16px 0; }
  .divider { height:1px; background:rgba(201,169,110,0.1); margin:24px 0; }
  .warning { font-size:10px; color:#666; font-style:italic; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">
      <span>◆</span>
      <span class="logo-name">CIPHER PRIVATE</span>
    </div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>Cipher Private Pty Ltd · Sydney, NSW, Australia<br>
    This message is intended solely for the named recipient. If you received this in error, please delete it immediately and notify us.<br>
    <a href="https://cipherprivate.com.au/privacy" style="color:#c9a96e;text-decoration:none">Privacy Policy</a> &nbsp;·&nbsp;
    <a href="https://cipherprivate.com.au" style="color:#c9a96e;text-decoration:none">cipherprivate.com.au</a></p>
  </div>
</div>
</body>
</html>
`;

// ── Send Functions ───────────────────────────────────────────────────────────

const sendWelcomeEmail = async (user) => {
  const html = baseTemplate(`
    <h1>Welcome to Cipher Private, ${user.fullName.split(' ')[0]}.</h1>
    <p>Your membership application has been approved. You now have access to the Cipher Private member portal.</p>
    <div class="divider"></div>
    <p><strong style="color:#c9a96e">Your membership tier:</strong> ${user.memberTier.replace('_', ' ')}</p>
    <p>Your dedicated lifestyle manager will contact you within 24 hours to arrange your onboarding call.</p>
    <a href="${process.env.CLIENT_URL}/portal" class="btn">Access Your Portal</a>
    <div class="divider"></div>
    <p class="warning">For your security, never share your login credentials with anyone, including Cipher Private staff. We will never ask for your password.</p>
  `);

  await transporter.sendMail({
    from: FROM,
    to: user.email,
    subject: 'Welcome to Cipher Private — Your Access is Ready',
    html,
  });

  logger.info(`Welcome email sent to ${user.email}`);
};

const sendOTPEmail = async ({ recipientEmail, otp, documentName, senderName, expiresAt, accessToken }) => {
  const expiry = new Date(expiresAt).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const html = baseTemplate(`
    <h1>Secure Document Access</h1>
    <p><strong style="color:#f5f3ef">${senderName}</strong> has shared an encrypted document with you via Cipher Private's secure vault.</p>
    <p><strong style="color:#c9a96e">Document:</strong> ${documentName}</p>
    <div class="divider"></div>
    <div class="otp-box">
      <div class="otp-label">Your One-Time Access Code</div>
      <div class="otp-code">${otp}</div>
    </div>
    <a href="${process.env.CLIENT_URL}/vault/access/${accessToken}" class="btn">Access Encrypted Document</a>
    <div class="divider"></div>
    <p class="warning">⏱ This code expires: ${expiry} (Sydney time)<br>
    This code is single-use and tied to your email address. All access attempts are logged and audited.<br>
    If you did not expect this document, do not enter the code and contact Cipher Private immediately.</p>
  `);

  await transporter.sendMail({
    from: FROM,
    to: recipientEmail,
    subject: `Cipher Private — Secure Document: ${documentName}`,
    html,
  });

  logger.info(`OTP email sent to ${recipientEmail} for document ${documentName}`);
};

const sendRequestConfirmationEmail = async (user, request) => {
  const html = baseTemplate(`
    <h1>Request Received</h1>
    <p>Your service request has been logged and your lifestyle manager has been notified. We will respond within the timeframes below.</p>
    <div class="otp-box" style="text-align:left">
      <p style="margin:0 0 8px"><strong style="color:#c9a96e">Request ID:</strong> <span style="color:#f5f3ef;font-family:monospace">${request.id.split('-')[0].toUpperCase()}</span></p>
      <p style="margin:0 0 8px"><strong style="color:#c9a96e">Category:</strong> <span style="color:#f5f3ef">${request.category}</span></p>
      <p style="margin:0 0 8px"><strong style="color:#c9a96e">Priority:</strong> <span style="color:#f5f3ef">${request.priority}</span></p>
      <p style="margin:0"><strong style="color:#c9a96e">Summary:</strong> <span style="color:#f5f3ef">${request.description.substring(0, 120)}${request.description.length > 120 ? '...' : ''}</span></p>
    </div>
    <p><strong style="color:#f5f3ef">Response times:</strong> Critical — 15 min · Urgent — 1 hour · Standard — 4 hours</p>
    <a href="${process.env.CLIENT_URL}/portal/requests" class="btn">View Request Status</a>
  `);

  await transporter.sendMail({
    from: FROM,
    to: user.email,
    subject: `Cipher Private — Request Received [${request.id.split('-')[0].toUpperCase()}]`,
    html,
  });
};

const sendApplicationReceivedEmail = async (application) => {
  const html = baseTemplate(`
    <h1>Application Received</h1>
    <p>Dear ${application.fullName.split(' ')[0]},</p>
    <p>Thank you for your interest in Cipher Private. Your application for <strong style="color:#c9a96e">${application.tier.replace('_', ' ')}</strong> membership has been received and is under review.</p>
    <p>Our membership director will review your application and respond privately within <strong style="color:#f5f3ef">48 business hours</strong>.</p>
    <div class="divider"></div>
    <p class="warning">All applications are treated with strict confidentiality. Your information will not be shared with third parties.</p>
  `);

  await transporter.sendMail({
    from: FROM,
    to: application.email,
    subject: 'Cipher Private — Membership Application Received',
    html,
  });
};

module.exports = {
  sendWelcomeEmail,
  sendOTPEmail,
  sendRequestConfirmationEmail,
  sendApplicationReceivedEmail,
};
