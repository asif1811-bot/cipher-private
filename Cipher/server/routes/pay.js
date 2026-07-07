const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Public quote details — no auth, uses token
router.get('/quote-details', async (req, res) => {
  try {
    const { q: inquiryId, t: token } = req.query;
    if (!inquiryId || !token) return res.status(400).json({ error: 'Invalid link' });
    const inquiry = await prisma.vendorInquiry.findUnique({
      where: { id: inquiryId },
      include: {
        vendor: { select: { name: true } },
        request: { select: { title: true, description: true, category: true, orderRef: true } }
      }
    });
    if (!inquiry) return res.status(404).json({ error: 'Quote not found or expired' });
    if (inquiry.quoteToken !== token) return res.status(403).json({ error: 'Invalid or expired link' });
    res.json({
      inquiryId: inquiry.id,
      vendorName: inquiry.vendor?.name,
      quoteAmount: inquiry.quoteAmount,
      quoteDetails: inquiry.quoteDetails,
      requestTitle: inquiry.request?.title || inquiry.request?.description?.substring(0,80),
      category: inquiry.request?.category,
      orderRef: inquiry.request?.orderRef,
      status: inquiry.status,
      paid: !!inquiry.paymentPaidAt
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Public checkout — no auth, uses token
router.post('/checkout', async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const { q: inquiryId, t: token } = req.body;
    if (!inquiryId || !token) return res.status(400).json({ error: 'Invalid request' });
    const inquiry = await prisma.vendorInquiry.findUnique({
      where: { id: inquiryId },
      include: {
        vendor: { select: { name: true, email: true } },
        request: { include: { user: { select: { email: true, fullName: true } } } }
      }
    });
    if (!inquiry) return res.status(404).json({ error: 'Quote not found' });
    if (inquiry.quoteToken !== token) return res.status(403).json({ error: 'Invalid link' });
    if (inquiry.paymentPaidAt) return res.status(400).json({ error: 'Already paid' });

    const isProcurement = ['PROCUREMENT','SHOPPING'].includes((inquiry.request?.category||'').toUpperCase());
    const payAmount = isProcurement ? Math.round(inquiry.quoteAmount * 100) : 1000;
    const orderRef = inquiry.request?.orderRef || inquiryId.substring(0,8).toUpperCase();
    const memberEmail = inquiry.request?.user?.email;
    const title = inquiry.request?.title || 'Consiere Service';
    const baseUrl = process.env.CC_URL || 'https://consiere.com.au';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: memberEmail,
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: 'Consiere — ' + title.substring(0,60),
            description: (isProcurement ? 'Full payment. ' : '$10 booking deposit. Balance paid to vendor. ') + 'Order ref: ' + orderRef,
          },
          unit_amount: payAmount,
        },
        quantity: 1,
      }],
      metadata: { inquiryId, type: 'quote_payment', orderRef },
      success_url: baseUrl + '/pay?q=' + inquiryId + '&t=' + token + '&paid=1',
      cancel_url: baseUrl + '/pay?q=' + inquiryId + '&t=' + token,
    });

    await prisma.vendorInquiry.update({
      where: { id: inquiryId },
      data: { paymentSessionId: session.id, quoteAcceptedAt: new Date(), status: 'ACCEPTED' }
    });

    res.json({ url: session.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
