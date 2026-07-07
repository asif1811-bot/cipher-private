require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { geocode } = require('./Cipher/server/utils/geo');

(async () => {
  const vendors = await prisma.vendor.findMany({ where: { OR: [{ lat: null }, { lng: null }] } });
  console.log('Backfilling', vendors.length, 'vendors...');
  for (const v of vendors) {
    const q = v.name + ', ' + (v.suburbs || '') + ' ' + (v.cities || 'Sydney') + ', Australia';
    const g = await geocode(q);
    if (g) {
      await prisma.vendor.update({ where: { id: v.id }, data: { lat: g.lat, lng: g.lng } });
      console.log('OK  ', v.name, '->', g.lat, g.lng);
    } else {
      console.log('SKIP', v.name, '(no geocode result)');
    }
    await new Promise(r => setTimeout(r, 200)); // gentle on the API
  }
  console.log('Done.');
  process.exit(0);
})();
