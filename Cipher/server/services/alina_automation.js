// ================================================================
// ALINA AUTOMATION ENGINE v2 — ALGORITHMIC STATE MACHINE
// ================================================================
"use strict";
const { PrismaClient } = require("@prisma/client");
const { Resend } = require("resend");
const { sendWA } = require("./whatsapp_notifications");
// Lazy load dispatch to avoid circular dependency
let _dispatch = null;
const getDispatch = () => { if(!_dispatch) _dispatch = require("./dispatch"); return _dispatch; };

const prisma = new PrismaClient();
const CC_URL = process.env.CC_URL || "https://consiere.com.au";

const STATES = {
  REQUEST: { RECEIVED: "RECEIVED", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" },
  INQUIRY: { SENT: "SENT", QUOTED: "QUOTED", ACCEPTED: "ACCEPTED", DECLINED: "DECLINED", DELIVERED: "DELIVERED" }
};

const rs = () => new Resend(process.env.RESEND_API_KEY);
const memberPhone = (u) => u && u.phone ? u.phone : (u && u.email && u.email.includes("@whatsapp.cipher") ? "+" + u.email.replace("wa_","").replace("@whatsapp.cipher","") : null);
const firstName = (u) => ((u && u.fullName) || "there").split(" ")[0];
const log = (fn, msg) => console.log("[ALINA v2]", fn, msg);
const err = (fn, e) => console.error("[ALINA v2 ERROR]", fn, (e && e.message) || e);

async function sendEmail(to, subject, html) {
  if (!to || to.includes("@whatsapp.cipher")) return;
  return rs().emails.send({ from: "Alina at Consiere <hello@consiere.com.au>", to, subject, html }).catch(e => err("email", e));
}

async function wa(phone, msg, vendorName) {
  if (!phone) return;
  var sent = await sendWA(phone, msg).then(function(){return true;}).catch(function(){return false;});
  if(!sent) {
    // Try vendor template for 63016 (outside window) - sendWA already handles this
    // SMS fallback for landlines and non-WA numbers
    try {
      var twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({ body: msg.replace(/[*_~`]/g,'').replace(/\n/g,' ').substring(0,160), from: process.env.TWILIO_SMS_NUMBER||'+18167931476', to: phone });
      log("sms_fallback", "SMS sent to: " + phone);
    } catch(smsE) {
      // Both WA and SMS failed - send email if vendor name known
      log("all_comms_failed", "Could not reach: " + phone + " - " + (smsE.message||''));
    }
  }
  return sent;
}

function tmpl(title, bodyHtml, btnText, btnUrl) {
  var btn = btnUrl ? '<div style="text-align:center;margin:24px 0"><a href="' + btnUrl + '" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px">' + btnText + '</a></div>' : "";
  return '<div style="font-family:Arial;max-width:560px;margin:40px auto;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden"><div style="background:#1c1917;padding:20px;text-align:center"><span style="color:#b87333;font-size:11px;letter-spacing:4px">CONSIERE</span></div><div style="padding:28px"><h2 style="font-family:Georgia;color:#1c1917;font-weight:400">' + title + '</h2>' + bodyHtml + btn + '<p style="color:#78716c;font-size:12px">— Alina, Consiere AI Concierge</p></div><div style="background:#faf8f5;padding:12px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au</p></div></div>';
}

// 0. VALIDATE vendor business status via Google Places weekly
async function validateVendorStatus() {
  try {
    const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
    if (!GOOGLE_KEY) return;
    const vendors = await prisma.vendor.findMany({ where: { isActive: true }, select: { id: true, name: true, cities: true } });
    let deactivated = 0;
    for (const v of vendors.slice(0, 5)) { // Check 5 per run to avoid API quota
      try {
        const searchUrl = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=' + encodeURIComponent(v.name + ' ' + (v.cities||'')) + '&inputtype=textquery&fields=business_status,place_id,name&key=' + GOOGLE_KEY;
        const res = await fetch(searchUrl);
        const data = await res.json();
        const place = data.candidates?.[0];
        if (place?.business_status === 'CLOSED_PERMANENTLY') {
          await prisma.vendor.update({ where: { id: v.id }, data: { isActive: false, description: '[AUTO-DEACTIVATED: Permanently closed per Google Places ' + new Date().toISOString().split('T')[0] + ']' } });
          log('validateVendor', 'Auto-deactivated permanently closed: ' + v.name);
          deactivated++;
        }
      } catch(e) { /* skip individual errors */ }
    }
    if (deactivated > 0) log('validateVendor', 'Deactivated ' + deactivated + ' permanently closed vendors');
  } catch(e) { err('validateVendorStatus', e); }
}

// 1. CHASE unresponded vendors after 4 hours
async function chaseUnrespondedVendors() {
  try {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const stale = await prisma.vendorInquiry.findMany({
      where: { status: "SENT", emailSentAt: { lt: cutoff }, vendor: { isActive: true } },
      include: { vendor: true, request: { include: { user: true } } }
    });
    for (const inq of stale) {
      if (!inq.vendor || !inq.vendor.email) continue;
      const title = (inq.request && (inq.request.title || inq.request.description)) ? (inq.request.title || inq.request.description).substring(0,60) : "Service Request";
      const url = CC_URL + "/vendor-respond?id=" + inq.id;
      await sendEmail(inq.vendor.email, "[Action Required] Client waiting — " + title,
        tmpl("Client Still Waiting", '<p style="color:#44403c;font-size:14px;line-height:1.8">A client has been waiting 4 hours for your quote on: <strong>' + title + '</strong>. Please respond or decline so we can assist the client.</p>', "Respond Now", url));
      if (inq.vendor.phone) {
        var chaseMsg = "Reminder from Consiere: client waiting for your quote on *" + title + "*. Please respond: " + url;
        var chaseOk = await sendWA(inq.vendor.phone, chaseMsg).catch(function(){return false;});
        if (!chaseOk && process.env.TWILIO_VENDOR_TEMPLATE_SID) {
          try {
            var twilioCh = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await twilioCh.messages.create({
              contentSid: process.env.TWILIO_VENDOR_TEMPLATE_SID,
              contentVariables: JSON.stringify({"1": inq.vendor.name||"Vendor", "2": title.substring(0,60), "3": url}),
              messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
              to: "whatsapp:" + inq.vendor.phone
            });
            log("chaseVendor", "Template chase sent to: " + inq.vendor.phone);
          } catch(tmplErr) { err("chaseVendor", tmplErr); }
        }
      }
      await prisma.vendorInquiry.update({ where: { id: inq.id }, data: { emailSentAt: new Date() } }).catch(function(){});
      log("chase", "Chased: " + inq.vendor.name);
    }
  } catch(e) { err("chaseUnrespondedVendors", e); }
}

// 2. NOTIFY member when vendor quotes
async function notifyMemberOfQuote(inquiryId) {
  try {
    const inq = await prisma.vendorInquiry.findUnique({ where: { id: inquiryId }, include: { vendor: true, request: { include: { user: true } } } });
    if (!inq || !inq.request || !inq.request.user) return;
    const m = inq.request.user;
    const fn = firstName(m);
    const title = (inq.request.title || (inq.request.description || "").substring(0,60)) || "Request";
    const vendorName = (inq.vendor && inq.vendor.name) || "our partner";
    const amt = inq.quoteAmount ? "$" + parseFloat(inq.quoteAmount).toFixed(2) + " AUD" : "";
    var quoteHtml = inq.quoteAmount ? '<div style="background:#faf8f5;border-left:3px solid #b87333;padding:14px;margin:16px 0"><p style="font-size:20px;font-weight:700;color:#b87333;margin:0">' + amt + '</p>' + (inq.quoteDetails ? '<p style="font-size:13px;color:#44403c;margin-top:6px">' + inq.quoteDetails.substring(0,200) + '</p>' : "") + '</div>' : "";
    await sendEmail(m.email, "Quote Ready — " + title,
      tmpl("Your quote is ready, " + fn, '<p style="color:#44403c;font-size:14px">I have a quote from <strong>' + vendorName + '</strong> for your request.</p>' + quoteHtml + '<p style="color:#44403c;font-size:14px">Log in to accept and confirm your booking.</p>', "View & Accept Quote", CC_URL + "/cc-portal"));
    await wa(memberPhone(m), "Hi " + fn + "! Quote ready from *" + vendorName + "*" + (amt ? " — *" + amt + "*" : "") + ". Log in to accept: " + CC_URL + "/cc-portal");
    log("notifyMemberOfQuote", "Sent to: " + m.email);
  } catch(e) { err("notifyMemberOfQuote", e); }
}

// 3. BOOKING confirmation to both sides
async function sendBookingConfirmation(inquiryId) {
  try {
    const inq = await prisma.vendorInquiry.findUnique({ where: { id: inquiryId }, include: { vendor: true, request: { include: { user: true } } } });
    if (!inq) return;
    const m = inq.request && inq.request.user;
    const v = inq.vendor;
    const fn = firstName(m);
    const title = inq.request ? (inq.request.title || (inq.request.description || "").substring(0,60)) : "Request";
    const vName = (v && v.name) || "our partner";
    const amt = inq.quoteAmount ? "$" + parseFloat(inq.quoteAmount).toFixed(2) + " AUD" : "";
    await sendEmail(m && m.email, "Booking Confirmed — " + title,
      tmpl("Booking Confirmed", '<p style="color:#44403c;font-size:14px;line-height:1.8">Hi ' + fn + ', your booking with <strong>' + vName + '</strong> is confirmed.' + (amt ? " Amount: <strong>" + amt + "</strong>" : "") + '</p>' + (inq.quoteDetails ? '<p style="color:#44403c;font-size:13px">' + inq.quoteDetails.substring(0,200) + '</p>' : "") + '<p style="color:#44403c;font-size:14px">The vendor will contact you to finalise details.</p>', "View Portal", CC_URL + "/cc-portal"));
    await wa(memberPhone(m), "Booking confirmed! *" + title + "* with *" + vName + "* is all set." + (inq.quoteDetails ? "\n" + inq.quoteDetails.substring(0,100) : ""));
    await sendEmail(v && v.email, "[Booking Confirmed] Please proceed — " + title,
      tmpl("Booking Confirmed", '<p style="color:#44403c;font-size:14px">Hi ' + vName + ', the client confirmed. Please proceed with: <strong>' + title + '</strong>.' + (amt ? " Amount: " + amt : "") + '</p><p style="color:#78716c;font-size:12px">Commission invoice raised on delivery.</p>', null, null));
    if (v && v.phone) await wa(v.phone, "Booking confirmed! Proceed with: *" + title + "*" + (amt ? " (" + amt + ")" : ""));
    log("sendBookingConfirmation", "Confirmed for: " + title);
  } catch(e) { err("sendBookingConfirmation", e); }
}

// 4. COMMISSION invoice on delivery
async function raiseCommissionInvoice(inquiryId) {
  try {
    const inq = await prisma.vendorInquiry.findUnique({ where: { id: inquiryId }, include: { vendor: true, request: { include: { user: true } } } });
    if (!inq || !inq.commissionAmt || inq.commissionAmt <= 0 || inq.paymentPaidAt) return;
    const v = inq.vendor;
    const m = inq.request && inq.request.user;
    const title = inq.request ? (inq.request.title || (inq.request.description || "").substring(0,60)) : "Service";
    const fn = firstName(m);
    const vName = (v && v.name) || "vendor";
    var dueDate = new Date(Date.now() + 15*24*60*60*1000);
    var due = dueDate.toLocaleDateString("en-AU", {day:"numeric",month:"long",year:"numeric"});
    await sendEmail(v && v.email, "Commission Invoice — $" + inq.commissionAmt.toFixed(2) + " AUD due " + due,
      tmpl("Commission Invoice", '<p style="color:#44403c;font-size:14px">Hi ' + vName + ', thank you for completing <strong>' + title + '</strong>.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr style="background:#faf8f5"><td style="padding:10px;font-size:13px">Service</td><td style="padding:10px;font-size:13px;text-align:right">' + title + '</td></tr><tr><td style="padding:10px;font-size:13px">Commission</td><td style="padding:10px;font-size:13px;text-align:right">$' + inq.commissionAmt.toFixed(2) + ' AUD</td></tr><tr style="border-top:2px solid #b87333"><td style="padding:12px;font-weight:700">Due by</td><td style="padding:12px;color:#ef4444;font-weight:700;text-align:right">' + due + '</td></tr></table><p style="color:#78716c;font-size:12px">Late payment results in account suspension.</p>', "Pay Commission", CC_URL + "/vendor-portal"));
    await sendEmail(m && m.email, "Your booking is complete — " + title,
      tmpl("All done, " + fn + "!", '<p style="color:#44403c;font-size:14px;line-height:1.8">Your request <strong>' + title + '</strong> has been completed by <strong>' + vName + '</strong>. Hope everything went perfectly!</p>', "Leave Feedback", CC_URL + "/cc-portal"));
    await wa(memberPhone(m), "Hi " + fn + "! Your booking is complete. Hope everything went well!");
    log("raiseCommissionInvoice", "Invoice sent: $" + inq.commissionAmt.toFixed(2));
  } catch(e) { err("raiseCommissionInvoice", e); }
}

// 5. HANDLE vendor decline + auto-redispatch
async function handleVendorDecline(inquiryId) {
  try {
    const inq = await prisma.vendorInquiry.findUnique({ where: { id: inquiryId }, include: { vendor: true, request: { include: { user: true, inquiries: true } } } });
    if (!inq || !inq.request) return;
    const title = inq.request.title || (inq.request.description || "").substring(0,60) || "Request";
    const active = inq.request.inquiries.filter(function(i){ return i.id !== inquiryId && ["SENT","QUOTED","ACCEPTED"].indexOf(i.status) > -1; });
    log("handleVendorDecline", (inq.vendor && inq.vendor.name) + " declined. Active: " + active.length);
    if (active.length === 0) {
      const m = inq.request.user;
      const fn = firstName(m);
      await sendEmail(m && m.email, "Update on your request — " + title,
        tmpl("Still Working on It, " + fn, '<p style="color:#44403c;font-size:14px;line-height:1.8">I am sourcing additional partners for <strong>' + title + '</strong> and will update you shortly.</p>', "View Portal", CC_URL + "/cc-portal"));
      await wa(memberPhone(m), "Hi " + fn + "! Still working on your *" + title + "* request. Finding more options now.");
      await prisma.request.update({ where: { id: inq.requestId }, data: { status: "RECEIVED", adminNote: "All vendors declined — auto redispatching" } }).catch(function(){});
      setTimeout(function() {
        getDispatch().dispatchToVendors(inq.requestId, inq.request.description || title, inq.request.category || "GENERAL", inq.request.userId).catch(function(e){ err("redispatch", e); });
        log("handleVendorDecline", "Auto-redispatched: " + inq.requestId);
      }, 5000);
    }
  } catch(e) { err("handleVendorDecline", e); }
}

// 6. NPS after completion
async function sendNPSRequest(requestId) {
  try {
    const req = await prisma.request.findUnique({ where: { id: requestId }, include: { user: true } });
    if (!req || !req.user) return;
    const m = req.user;
    const fn = firstName(m);
    const title = req.title || (req.description || "").substring(0,60) || "Request";
    await sendEmail(m.email, "How did we do? — " + title,
      tmpl("How was your experience, " + fn + "?", '<p style="color:#44403c;font-size:14px;line-height:1.8">Your request for <strong>' + title + '</strong> is complete. Your feedback helps us serve you better!</p>', "Leave Feedback", CC_URL + "/cc-portal"));
    await wa(memberPhone(m), "Hi " + fn + "! Your booking is done. How did we do? " + CC_URL + "/cc-portal");
    log("sendNPSRequest", "NPS sent to: " + m.email);
  } catch(e) { err("sendNPSRequest", e); }
}

// 7. AUTO-COMPLETE delivered requests after 24hrs
async function autoCompleteDeliveredRequests() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const delivered = await prisma.vendorInquiry.findMany({
      where: { status: "DELIVERED", deliveredAt: { lt: cutoff } },
      include: { request: { include: { user: true } } }
    });
    for (const inq of delivered) {
      if (!inq.request || inq.request.status === "COMPLETED") continue;
      await prisma.request.update({ where: { id: inq.requestId }, data: { status: "COMPLETED", completedAt: new Date(), autoCompleted: true } }).catch(function(){});
      await raiseCommissionInvoice(inq.id).catch(function(e){ err("autoComplete-invoice", e); });
      await sendNPSRequest(inq.requestId).catch(function(e){ err("autoComplete-NPS", e); });
      log("autoCompleteDeliveredRequests", "Auto-completed: " + inq.requestId);
    }
  } catch(e) { err("autoCompleteDeliveredRequests", e); }
}

// 8. NOTIFY member on status change
async function notifyMemberStatusUpdate(requestId, status) {
  try {
    if (!status || status === "RECEIVED") return;
    const req = await prisma.request.findUnique({ where: { id: requestId }, include: { user: true } });
    if (!req || !req.user) return;
    const m = req.user;
    const fn = firstName(m);
    const title = req.title || (req.description || "").substring(0,50) || "Request";
    var msgs = { IN_PROGRESS: "is now in progress", COMPLETED: "has been completed", CANCELLED: "has been cancelled", AWAITING_MEMBER: "needs your attention" };
    var statusMsg = msgs[status] || ("updated to " + status);
    await wa(memberPhone(m), "Hi " + fn + "! Your request *" + title + "* " + statusMsg + ". View: " + CC_URL + "/cc-portal");
    if (status === "AWAITING_MEMBER") {
      await sendEmail(m.email, "Action Required — " + title,
        tmpl("Your Input Needed, " + fn, '<p style="color:#44403c;font-size:14px;line-height:1.8">Your request for <strong>' + title + '</strong> needs your attention. Please log in for details.</p>', "View Now", CC_URL + "/cc-portal"));
    }
    log("notifyMemberStatusUpdate", m.email + " " + status);
  } catch(e) { err("notifyMemberStatusUpdate", e); }
}

// 9. CHECK stale RECEIVED requests (24hrs, no vendor response)
async function checkStaleReceivedRequests() {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stale = await prisma.request.findMany({
      where: { status: "RECEIVED", createdAt: { lt: cutoff }, inquiries: { none: { status: { in: ["QUOTED","ACCEPTED"] } } } },
      include: { user: true }
    });
    for (const req of stale) {
      const m = req.user;
      const fn = firstName(m);
      const title = req.title || (req.description || "").substring(0,60) || "Request";
      await sendEmail(m && m.email, "Update on your request — " + title,
        tmpl("Still Working On It, " + fn, '<p style="color:#44403c;font-size:14px;line-height:1.8">I am still sourcing partners for <strong>' + title + '</strong>. I will update you shortly with options.</p>', "View Portal", CC_URL + "/cc-portal"));
      await wa(memberPhone(m), "Hi " + fn + "! Still working on your *" + title + "* request. Finding the best partner for you.");
      await prisma.request.update({ where: { id: req.id }, data: { adminNote: "Stale 24hrs — member notified" } }).catch(function(){});
      log("checkStaleReceivedRequests", "Notified: " + (m && m.email) + " for: " + title);
    }
    // Also fix IN_PROGRESS requests where all inquiries are DECLINED
    var brokenRequests = await prisma.request.findMany({
      where: { status: "IN_PROGRESS", inquiries: { every: { status: { in: ["DECLINED","FAILED"] } } } },
      include: { user: true }
    });
    for (var br of brokenRequests) {
      await prisma.request.update({ where: { id: br.id }, data: { status: "RECEIVED", adminNote: "Auto-reset: all vendors declined, seeking new vendors" } }).catch(function(){});
      log("checkStaleReceivedRequests", "Reset broken IN_PROGRESS request: " + br.id);
    }
  } catch(e) { err("checkStaleReceivedRequests", e); }
}

// 10. VENDOR SCORING ALGORITHM — Smart ranking by response rate, recency, verification
async function scoreAndRankVendors(vendors, requestData) {
  try {
    var scored = await Promise.all(vendors.map(async function(v) {
      var score = 50;
      var total = await prisma.vendorInquiry.count({ where: { vendorId: v.id } }).catch(function(){ return 0; });
      var responded = await prisma.vendorInquiry.count({ where: { vendorId: v.id, status: { in: ["QUOTED","ACCEPTED","DELIVERED"] } } }).catch(function(){ return 0; });
      var responseRate = total > 0 ? responded / total : 0.5;
      score += responseRate * 30;
      var lastJob = await prisma.vendorInquiry.findFirst({ where: { vendorId: v.id, status: "DELIVERED" }, orderBy: { deliveredAt: "desc" }, select: { deliveredAt: true } }).catch(function(){ return null; });
      if (lastJob && lastJob.deliveredAt) {
        var daysSince = (Date.now() - new Date(lastJob.deliveredAt).getTime()) / (1000 * 60 * 60 * 24);
        score += Math.max(0, 20 - daysSince);
      }
      if (v.isVerified) score += 10;
      var recentDeclines = await prisma.vendorInquiry.count({ where: { vendorId: v.id, status: "DECLINED", updatedAt: { gt: new Date(Date.now() - 7*24*60*60*1000) } } }).catch(function(){ return 0; });
      score -= recentDeclines * 15;
      return { vendor: v, score: Math.round(score) };
    }));
    scored.sort(function(a,b){ return b.score - a.score; });
    if (scored.length > 0) log("scoreAndRankVendors", "Top: " + scored[0].vendor.name + " score:" + scored[0].score);
    return scored.map(function(s){ return s.vendor; });
  } catch(e) { err("scoreAndRankVendors", e); return vendors; }
}

// SCHEDULERS - Singleton guard prevents duplicate intervals on multiple requires
if (!global.__alinaSchedulersStarted) {
  global.__alinaSchedulersStarted = true;
  setInterval(chaseUnrespondedVendors, 30 * 60 * 1000);
  setInterval(autoCompleteDeliveredRequests, 60 * 60 * 1000);
  setInterval(checkStaleReceivedRequests, 6 * 60 * 60 * 1000);
  setInterval(remindUnpaidDeposits, 2 * 60 * 60 * 1000);
  console.log("[ALINA v2] Deposit reminder: every 2 hours");
  console.log("[ALINA v2] Vendor chase: every 30 mins");
  console.log("[ALINA v2] Auto-complete: every hour");
  console.log("[ALINA v2] Stale checker: every 6 hours");
}


// ESCALATE requests with no quotes after 8 hours
async function escalateUnquotedRequests() {
  try {
    var cutoff8h = new Date(Date.now() - 8 * 60 * 60 * 1000);
    var stale = await prisma.request.findMany({
      where: { status: "RECEIVED", createdAt: { lt: cutoff8h },
        inquiries: { none: { status: { in: ["QUOTED","ACCEPTED"] } } }
      },
      include: { user: true }
    });
    for (var req of stale) {
      var title = req.title || (req.description || "").substring(0,60) || "Request";
      // Alert admin
      await sendEmail("hello@consiere.com.au",
        "[ESCALATION] No vendor quote after 8hrs — " + title,
        tmpl("Escalation Alert", '<p style="color:#ef4444;font-size:14px;font-weight:600">No vendor has quoted on this request after 8 hours.</p><p style="color:#44403c;font-size:14px"><b>Request:</b> ' + title + '<br><b>Member:</b> ' + ((req.user && req.user.fullName) || "Unknown") + '<br><b>Category:</b> ' + (req.category || "Unknown") + '</p><p style="color:#44403c;font-size:14px">Please review and manually assign a vendor or contact the member.</p>', "View in Admin", CC_URL + "/cc-admin"));
      log("escalateUnquotedRequests", "Escalated to admin: " + title);
    }
  } catch(e) { err("escalateUnquotedRequests", e); }
}

// Run escalation every 2 hours
if (!global.__alinaEscalationStarted) {
  global.__alinaEscalationStarted = true;
  setInterval(escalateUnquotedRequests, 2 * 60 * 60 * 1000);
  console.log("[ALINA v2] Escalation checker: every 2 hours");
  setInterval(validateVendorStatus, 7*24*60*60*1000);
  log("scheduler", "Vendor validator: weekly");
}


// REMIND member about unpaid deposit (runs in stale checker)
async function remindUnpaidDeposits() {
  try {
    var cutoff2h = new Date(Date.now() - 2 * 60 * 60 * 1000);
    var unpaid = await prisma.request.findMany({
      where: { depositPaid: false, paymentUrl: { not: null }, status: "RECEIVED", createdAt: { lt: cutoff2h } },
      include: { user: true }
    });
    for (var req of unpaid) {
      var m = req.user;
      var fn = firstName(m);
      var title = req.title || (req.description || "").substring(0,50) || "your request";
      await wa(memberPhone(m), "Hi " + fn + "! Just a reminder — your $10 deposit for *" + title + "* is still pending. Pay here to confirm your booking: " + req.paymentUrl);
      await sendEmail(m && m.email, "Deposit reminder — " + title,
        tmpl("Don't forget your deposit, " + fn, '<p style="color:#44403c;font-size:14px;line-height:1.8">Your request for <strong>' + title + '</strong> is waiting for your $10 deposit to get started.</p>', "Pay $10 Deposit", req.paymentUrl));
      log("remindUnpaidDeposits", "Reminded: " + (m && m.email));
    }
  } catch(e) { err("remindUnpaidDeposits", e); }
}

module.exports = { chaseUnrespondedVendors, notifyMemberOfQuote, raiseCommissionInvoice, sendBookingConfirmation, handleVendorDecline, sendNPSRequest, autoCompleteDeliveredRequests, notifyMemberStatusUpdate, checkStaleReceivedRequests, scoreAndRankVendors, escalateUnquotedRequests, remindUnpaidDeposits };
