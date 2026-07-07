require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const req = await p.request.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!req) { console.log('No requests found'); return; }
  
  const uvr = await p.unregisteredVendorRequest.create({
    data: {
      requestId: req.id,
      vendorName: 'Sydney Fine Dining Co.',
      vendorPhone: '+61412345678',
      googlePlaceId: 'test_place_' + Date.now(),
      googleRating: 4.9,
      category: 'DINING',
      city: 'Sydney',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      status: 'OUTREACHED'
    }
  });
  
  console.log('✅ Test token created (15 min window)');
  console.log('URL: https://consiere.com.au/vendor-register?token=' + uvr.registrationToken);
  await p.$disconnect();
}
run().catch(console.error);
