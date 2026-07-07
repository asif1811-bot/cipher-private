require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { notifyRenewalReminder, getPhone } = require('./Cipher/server/services/whatsapp_notifications');
const prisma = new PrismaClient();

async function sendRenewalReminders() {
  console.log('[RENEWAL] Checking upcoming renewals...');
  try {
    // Find users whose subscription renews in ~2 days
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
    const twoDaysFromNow = Math.floor(Date.now()/1000) + (2 * 24 * 60 * 60);
    const oneDayFromNow = Math.floor(Date.now()/1000) + (1 * 24 * 60 * 60);

    for (const sub of subs.data) {
      const renewsAt = sub.current_period_end;
      if (renewsAt >= oneDayFromNow && renewsAt <= twoDaysFromNow) {
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: sub.customer } });
        if (user) {
          const phone = getPhone(user);
          if (phone) {
            const firstName = (user.fullName||'').split(' ')[0] || 'there';
            const amount = sub.items.data[0]?.price?.unit_amount / 100 || 9.99;
            const renewDate = new Date(renewsAt * 1000).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
            await notifyRenewalReminder(phone, firstName, amount, renewDate);
            console.log('[RENEWAL] Reminder sent to:', phone, 'renews:', renewDate);
          }
        }
      }
    }
    console.log('[RENEWAL] Done');
  } catch(e) {
    console.error('[RENEWAL] Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

sendRenewalReminders();
