require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { filterVendorsByRadius } = require('./Cipher/server/utils/geo');

(async () => {
  const allVendors = await prisma.vendor.findMany({
    where: { isActive: true, category: 'HOTEL' }
  });
  console.log('Active HOTEL vendors in DB:', allVendors.length);

  for (const radius of [1, 5, 15]) {
    const { origin, inRange } = await filterVendorsByRadius('Parramatta', allVendors, radius);
    console.log('\n--- within ' + radius + 'km of Parramatta (origin ' +
      (origin ? origin.lat.toFixed(3) + ',' + origin.lng.toFixed(3) : 'NULL') + ') ---');
    if (!inRange.length) console.log('  (none) -> would trigger discovery');
    inRange.forEach(v => console.log('  ' + v.name + ' — ' + v._distanceKm + 'km'));
  }
  process.exit(0);
})();
