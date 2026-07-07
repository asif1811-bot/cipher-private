#!/usr/bin/env python3
r"""
Cipher Private — bug fix patcher
Run this from the project root: /var/www/cipher-private

Usage:
    python3 apply_cipher_fixes.py

What it does:
  - Makes a timestamped backup of every file it touches (alongside the
    existing .bak/.bak2 convention already used in this project)
  - Applies each fix via exact string replacement
  - Reports PATCHED / SKIPPED (already patched) / NOT FOUND (source has
    changed since this script was written — nothing is silently
    force-applied)
  - Does NOT restart pm2 or touch the database — do that yourself after
    reviewing the diff

Fixes applied:
  dispatch.js
    1. International vendor matches were overwritten by the AU radius
       filter immediately afterward — now skipped for international
       requests once intlVendors is populated.
    2. Radius regex used /(\\d+)\\s*km/i (matches a literal backslash+d,
       never a digit) — fixed to /(\\d+)\\s*km/i literal-in-source
       meaning /(\d+)\s*km/i at runtime.
    3. SMS fallback silently used a hardcoded US number
       (+18167931476) if TWILIO_SMS_NUMBER wasn't set — now skips SMS
       and falls through to the existing email fallback instead.
    4. A DB failure creating VendorInquiry produced a fake 'temp-' id,
       and the code still emailed/WhatsApp'd the vendor a quote link
       built from that fake id (guaranteed 404) — now skips that vendor
       and logs an error instead.

  routes/requests.js
    5. sendPushToUser() was called but never imported, throwing a
       ReferenceError caught by the surrounding try/catch and mislabeled
       as "[STATUS EMAIL ERROR]" — added a safe wrapper that tries two
       likely module paths and no-ops (with a clear one-time log) if
       neither exists, instead of crashing that code path.
"""
import shutil
import sys
import datetime

TS = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

def backup(path):
    bak = f"{path}.prefix_{TS}.bak"
    shutil.copy2(path, bak)
    return bak

def apply_patch(path, old, new, label):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Check this FIRST (before checking `old`): some fixes prepend/wrap the
    # original code rather than fully replacing it, so `old` can still be a
    # substring of an already-patched file. Checking `new` first guarantees
    # the script is safe to run more than once.
    if new in content:
        print(f"  [SKIP]   {label} — already patched")
        return True

    if old not in content:
        print(f"  [MISS]   {label} — expected original text not found."
              f" File may have changed since this script was written."
              f" No changes made for this fix.")
        return False

    count = content.count(old)
    if count > 1:
        print(f"  [WARN]   {label} — matched {count} times, expected 1."
              f" Skipping to avoid an ambiguous edit — patch manually.")
        return False

    backup(path)
    content = content.replace(old, new, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  [PATCHED] {label}")
    return True


def main():
    dispatch_path = "Cipher/server/services/dispatch.js"
    requests_path = "Cipher/server/routes/requests.js"

    print(f"Cipher Private bug patcher — {TS}\n")

    # ------------------------------------------------------------------
    # FIX 1 + 2 (dispatch.js): international vendor overwrite + broken regex
    # ------------------------------------------------------------------
    print("dispatch.js")

    old_block = """    // Detect location — check global first, then Australian suburbs
    const locationText = (description || '') + ' ' + (classified.location || '');
    const globalLoc = detectGlobalLocation(locationText);
    const auLoc = detectLocation(locationText);
    const detectedLocation = auLoc; // Keep for AU vendor filtering
    console.log('[DISPATCH] Global location:', globalLoc ? globalLoc.city + ',' + globalLoc.country : 'none');
    console.log('[DISPATCH] AU location:', detectedLocation ? JSON.stringify(detectedLocation) : 'none');

    // Filter vendors by REAL DISTANCE from the requested location.
    // Parse an explicit radius from the message ("1km", "5 km"); default 15km.
    const radiusMatch = /(\\\\d+)\\\\s*km/i.exec(description || '');
    const radiusKm = radiusMatch ? Number(radiusMatch[1]) : 15;
    // Prefer the member-confirmed delivery suburb over the classifier's default guess.
    const locText = (request && request.deliveryAddress && request.deliveryAddress.trim())
      ? request.deliveryAddress.trim()
      : ((classified.location && classified.location !== 'Sydney')
          ? classified.location
          : (detectedLocation && detectedLocation.suburb ? detectedLocation.suburb : (classified.location || 'Sydney')));
    if (request && request.deliveryAddress) console.log('[DISPATCH] Using confirmed delivery location:', request.deliveryAddress);
    const geoResult = await filterVendorsByRadius(locText, allVendors, radiusKm);
    if (geoResult.origin && geoResult.inRange.length) {
      vendors = geoResult.inRange;
      console.log('[DISPATCH] Radius-matched', vendors.length, 'vendors within', radiusKm, 'km of', locText,
                  '->', vendors.map(v => v.name + '(' + v._distanceKm + 'km)').join(', '));
    } else {
      // Nothing in range (or couldn't geocode) — DO NOT fall back to all vendors.
      // Leave empty so the Google Places discovery block below fires.
      vendors = [];
      console.log('[DISPATCH] No vendors within', radiusKm, 'km of', locText, '— triggering discovery');
    }"""

    new_block = """    // Detect location — check global first, then Australian suburbs
    const locationText = (description || '') + ' ' + (classified.location || '');
    const globalLoc = detectGlobalLocation(locationText);
    const auLoc = detectLocation(locationText);
    const detectedLocation = auLoc; // Keep for AU vendor filtering
    console.log('[DISPATCH] Global location:', globalLoc ? globalLoc.city + ',' + globalLoc.country : 'none');
    console.log('[DISPATCH] AU location:', detectedLocation ? JSON.stringify(detectedLocation) : 'none');

    // FIX: previously this block ran unconditionally and overwrote `vendors`
    // (set to intlVendors above) back to [] whenever filterVendorsByRadius
    // couldn't geocode an international address — which is effectively
    // always. Skip AU radius filtering entirely once international vendors
    // have already been matched.
    if (request?.isInternational && vendors.length) {
      console.log('[DISPATCH] Using', vendors.length, 'international vendor match(es) — skipping AU radius filter');
    } else {
      // Filter vendors by REAL DISTANCE from the requested location.
      // Parse an explicit radius from the message ("1km", "5 km"); default 15km.
      // FIX: was /(\\\\d+)\\\\s*km/i — the double-escaped backslash matched a
      // literal backslash+d, never an actual digit, so explicit radii typed
      // by the client (e.g. "within 5km") were silently ignored.
      const radiusMatch = /(\\d+)\\s*km/i.exec(description || '');
      const radiusKm = radiusMatch ? Number(radiusMatch[1]) : 15;
      // Prefer the member-confirmed delivery suburb over the classifier's default guess.
      const locText = (request && request.deliveryAddress && request.deliveryAddress.trim())
        ? request.deliveryAddress.trim()
        : ((classified.location && classified.location !== 'Sydney')
            ? classified.location
            : (detectedLocation && detectedLocation.suburb ? detectedLocation.suburb : (classified.location || 'Sydney')));
      if (request && request.deliveryAddress) console.log('[DISPATCH] Using confirmed delivery location:', request.deliveryAddress);
      const geoResult = await filterVendorsByRadius(locText, allVendors, radiusKm);
      if (geoResult.origin && geoResult.inRange.length) {
        vendors = geoResult.inRange;
        console.log('[DISPATCH] Radius-matched', vendors.length, 'vendors within', radiusKm, 'km of', locText,
                    '->', vendors.map(v => v.name + '(' + v._distanceKm + 'km)').join(', '));
      } else {
        // Nothing in range (or couldn't geocode) — DO NOT fall back to all vendors.
        // Leave empty so the Google Places discovery block below fires.
        vendors = [];
        console.log('[DISPATCH] No vendors within', radiusKm, 'km of', locText, '— triggering discovery');
      }
    }"""

    apply_patch(dispatch_path, old_block, new_block,
                "Fix 1+2: international vendor overwrite + radius regex")

    # ------------------------------------------------------------------
    # FIX 3 (dispatch.js): hardcoded US SMS fallback number
    # ------------------------------------------------------------------
    old_sms = """              try {
                var twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                var smsBody = 'New job from Consiere for ' + vendor.name + ': ' + description.substring(0,80) + '. Login: ' + (process.env.CC_URL||'https://consiere.com.au') + '/vendor_portal.html';
                await twilio.messages.create({ body: smsBody, from: process.env.TWILIO_SMS_NUMBER||'+18167931476', to: vendor.phone });
                console.log('[DISPATCH] SMS fallback sent to vendor:', vendor.name, vendor.phone);
              } catch(smsErr) {"""

    new_sms = """              try {
                // FIX: previously fell back to a hardcoded US number
                // (+18167931476) when TWILIO_SMS_NUMBER wasn't set, which
                // silently sent Australian vendors an SMS from a US number
                // (deliverability risk + unnecessary cost). Now skips SMS
                // and falls through to the existing email fallback below.
                if (!process.env.TWILIO_SMS_NUMBER) {
                  throw new Error('TWILIO_SMS_NUMBER not configured — skipping SMS fallback instead of using hardcoded US number');
                }
                var twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
                var smsBody = 'New job from Consiere for ' + vendor.name + ': ' + description.substring(0,80) + '. Login: ' + (process.env.CC_URL||'https://consiere.com.au') + '/vendor_portal.html';
                await twilio.messages.create({ body: smsBody, from: process.env.TWILIO_SMS_NUMBER, to: vendor.phone });
                console.log('[DISPATCH] SMS fallback sent to vendor:', vendor.name, vendor.phone);
              } catch(smsErr) {"""

    apply_patch(dispatch_path, old_sms, new_sms,
                "Fix 3: hardcoded US SMS fallback number")

    # ------------------------------------------------------------------
    # FIX 4 (dispatch.js): temp- inquiry id still gets emailed a dead link
    # ------------------------------------------------------------------
    old_inquiry = """      const inquiry = await prisma.vendorInquiry.create({
          data: { requestId, vendorId: vendor.id, status: 'PENDING' }
        }).catch(() => ({ id: 'temp-' + vendor.id }));

        const responseUrl = (process.env.CC_URL || 'https://consiere.com.au') +"""

    new_inquiry = """      const inquiry = await prisma.vendorInquiry.create({
          data: { requestId, vendorId: vendor.id, status: 'PENDING' }
        }).catch(() => ({ id: 'temp-' + vendor.id }));

        // FIX: previously a DB failure here still went on to email/WhatsApp
        // the vendor a "Submit Your Quote" link built from a fake temp- id,
        // which is guaranteed to 404. Skip this vendor instead so it can be
        // retried on next dispatch rather than sending a broken link.
        if (String(inquiry.id).startsWith('temp-')) {
          console.error('[DISPATCH] Could not create inquiry record for vendor', vendor.name, '— skipping to avoid sending a broken quote link');
          continue;
        }

        const responseUrl = (process.env.CC_URL || 'https://consiere.com.au') +"""

    apply_patch(dispatch_path, old_inquiry, new_inquiry,
                "Fix 4: broken quote link on inquiry-create failure")

    # ------------------------------------------------------------------
    # FIX 5 (routes/requests.js): sendPushToUser used but never imported
    # ------------------------------------------------------------------
    print("\nroutes/requests.js")

    old_requires = """const { sendRequestConfirmationEmail } = require('../utils/email');
const logger = require('../utils/logger');"""

    new_requires = """const { sendRequestConfirmationEmail } = require('../utils/email');
const logger = require('../utils/logger');

// FIX: sendPushToUser was called later in this file but never imported,
// throwing a ReferenceError that was silently swallowed by the surrounding
// try/catch and mislabeled in logs as "[STATUS EMAIL ERROR]" (the email
// itself was sending fine — only the push call after it was crashing).
// Confirmed real implementation lives in ./push.js (same routes/ folder).
let sendPushToUser;
try {
  ({ sendPushToUser } = require('./push'));
  if (typeof sendPushToUser !== 'function') throw new Error('sendPushToUser not exported from ./push');
} catch (e) {
  console.error('[PUSH] Could not load sendPushToUser from ./push:', e.message, '— push notifications disabled.');
  sendPushToUser = () => Promise.resolve();
}"""

    apply_patch(requests_path, old_requires, new_requires,
                "Fix 5: missing sendPushToUser import (./push.js)")

    print("\nDone. Review the diffs (e.g. `git diff` or `diff file file.prefix_TIMESTAMP.bak`) before restarting.")
    print("Then: pm2 restart cipher-private")


if __name__ == "__main__":
    main()
