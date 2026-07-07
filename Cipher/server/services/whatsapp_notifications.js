'use strict';
// Centralised WhatsApp notification service
// All client communications route through here

require('dotenv').config();

async function sendWA(to, msg, useTemplate=false) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
  const templateSid = process.env.TWILIO_WHATSAPP_TEMPLATE_SID;
  const vendorTemplateSid = process.env.TWILIO_VENDOR_TEMPLATE_SID;
  if (!sid || sid.includes('YOUR')) { console.log('[WA NOTIFY] Not configured'); return false; }
  try {
    const phone = (to.startsWith('+') ? to : '+' + to).replace(/[\s\-\.\(\)]/g, '');
    const client = require('twilio')(sid, token);
    
    // Try free-form message first, fall back to template on 63016 error
    try {
      await client.messages.create({
        body: msg,
        from,
        to: 'whatsapp:' + phone
      });
      console.log('[WA NOTIFY] Sent to:', phone);
      return true;
    } catch(e) {
      // Error 63016 = outside messaging window, use template
      if (e.code === 63016 && templateSid) {
        // Outside 24hr window - use approved template
        console.log('[WA NOTIFY] Outside window, using template for:', phone);
        try {
          await client.messages.create({
            contentSid: templateSid,
            messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID||null,
            from: process.env.TWILIO_MESSAGING_SERVICE_SID ? undefined : from,
            to: 'whatsapp:' + phone
          });
          console.log('[WA NOTIFY] Template sent to:', phone);
          return true;
        } catch(tmplErr) { console.error('[WA NOTIFY] Template also failed:', tmplErr.message); throw tmplErr; }
      }
      if (e.code === 63024) {
        // Not a WhatsApp user - try SMS instead
        console.log('[WA NOTIFY] Not WhatsApp user, trying SMS for:', phone);
        try {
          await client.messages.create({ body: msg.substring(0,160), from: process.env.TWILIO_SMS_NUMBER||'+18167931476', to: phone });
          console.log('[WA NOTIFY] SMS sent to:', phone);
          return true;
        } catch(smsErr) { console.error('[WA NOTIFY] SMS also failed:', smsErr.message); return false; }
      }
      if (e.code === 21635 || e.code === 21614) {
        // Landline - cannot receive WA or SMS - log only
        console.log('[WA NOTIFY] Landline number, cannot message:', phone);
        return false;
      }
      throw e;
    }
  } catch(e) {
    console.error('[WA NOTIFY] Error:', e.message);
    return false;
  }
}


async function notifyQuoteReceived(phone, vendorName, amount, requestDesc, paymentUrl) {
  const msg =
    '✅ *Quote ready from Consiere*\n\n' +
    'Request: _' + requestDesc.substring(0,80) + '_\n' +
    'Provider: *' + vendorName + '*\n' +
    'Quote: *$' + parseFloat(amount).toFixed(2) + ' AUD*\n\n' +
    '💳 *Pay securely here:*\n' + paymentUrl + '\n\n' +
    '_Quote valid for 24 hours. Reply to this message if you need help._';
  return sendWA(phone, msg);
}

// 2. Payment confirmed — invoice sent after successful payment
async function notifyPaymentConfirmed(phone, amount, description, invoiceUrl, orderRef) {
  const msg =
    '🎉 *Payment confirmed!*\n\n' +
    'Order: *' + (orderRef || 'Consiere') + '*\n' +
    'Amount paid: *$' + parseFloat(amount).toFixed(2) + ' AUD*\n' +
    'Service: _' + description.substring(0,80) + '_\n\n' +
    (invoiceUrl ? '🧾 Your invoice: ' + invoiceUrl + '\n\n' : '') +
    'Alina is now coordinating everything. You\'ll hear from us shortly! 🙌';
  return sendWA(phone, msg);
}

// 3. Subscription activated — after upgrading to $9.99/mo
async function notifySubscriptionActivated(phone, firstName) {
  const msg =
    '🌟 *Welcome to Consiere Unlimited, ' + (firstName||'there') + '!*\n\n' +
    'Your $9.99/month plan is now active.\n\n' +
    '✅ Unlimited requests\n' +
    '✅ All categories — dining, travel, hotels, shopping & more\n' +
    '✅ 24/7 access to Alina\n' +
    '✅ 6 countries covered\n\n' +
    'Just send me a message anytime and I\'ll handle it. What can I do for you today? 😊';
  return sendWA(phone, msg);
}

// 4. Subscription renewal reminder — 2 days before renewal
async function notifyRenewalReminder(phone, firstName, amount, renewalDate) {
  const msg =
    '📅 *Subscription renewal reminder*\n\n' +
    'Hi ' + (firstName||'there') + ', your Consiere Unlimited plan renews in *2 days*.\n\n' +
    'Amount: *$' + parseFloat(amount).toFixed(2) + ' AUD*\n' +
    'Renewal date: *' + renewalDate + '*\n\n' +
    'Your payment method on file will be charged automatically. No action needed!\n\n' +
    '_To cancel, reply CANCEL and we\'ll sort it out._';
  return sendWA(phone, msg);
}

// 5. Subscription payment receipt — after monthly renewal
async function notifySubscriptionRenewed(phone, firstName, amount, nextDate) {
  const msg =
    '✅ *Subscription renewed*\n\n' +
    'Hi ' + (firstName||'there') + '! Your Consiere Unlimited plan has been renewed.\n\n' +
    'Amount charged: *$' + parseFloat(amount).toFixed(2) + ' AUD*\n' +
    'Next renewal: *' + nextDate + '*\n\n' +
    'Alina is here for you 24/7 — just send a message anytime! 🎉';
  return sendWA(phone, msg);
}

// 6. Request completed — when vendor confirms service delivered
async function notifyRequestCompleted(phone, description, vendorName) {
  const msg =
    '✅ *Request completed!*\n\n' +
    '_' + description.substring(0,80) + '_\n\n' +
    'Handled by: *' + vendorName + '*\n\n' +
    'Hope everything went perfectly! Reply if you need anything else — I\'m always here. 😊\n\n' +
    '_— Alina_';
  return sendWA(phone, msg);
}

function getPhone(user) {
  if (user?.email?.includes('@whatsapp.cipher')) {
    return '+' + user.email.replace('wa_','').replace('@whatsapp.cipher','');
  }
  return user?.phone || null;
}

module.exports = {
  sendWA,
  getPhone,
  notifyQuoteReceived,
  notifyPaymentConfirmed,
  notifySubscriptionActivated,
  notifyRenewalReminder,
  notifySubscriptionRenewed,
  notifyRequestCompleted
};
