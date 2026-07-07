require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { filterVendorsByRadius } = require('./Cipher/server/utils/geo');

const TEST_MSG = 'I need a hotel within 1km of Parramatta for 2 nights';

(async () => {
  console.log('=== INQUIRY ===\n ', TEST_MSG, '\n');

  // 1. Category detection (same keyword logic Alina uses)
  const KEYWORDS = { HOTEL:['hotel','suite','room','accommodation','stay','resort'] };
  const lower = TEST_MSG.toLowerCase();
  let category = 'OTHER';
  for (const [cat, words] of Object.entries(KEYWORDS))
    if (words.some(w => lower.includes(w))) { category = cat; break; }
  console.log('1. CLASSIFY -> category:', category);

  // 2. Location parse
  const radiusMatch = /(\d+)\s*km/i.exec(TEST_MSG);
  const radiusKm = radiusMatch ? Number(radiusMatch[1]) : 15;
  const locText = /parramatta/i.test(TEST_MSG) ? 'Parramatta' : 'Sydney';
  console.log('2. LOCATION -> "' + locText + '", radius', radiusKm + 'km');

  // 3. Vendor selection by radius
  const allVendors = await prisma.vendor.findMany({ where: { isActive:true, category } });
  const { origin, inRange } = await filterVendorsByRadius(locText, allVendors, radiusKm);
  console.log('3. SELECT  -> origin', origin ? origin.lat.toFixed(3)+','+origin.lng.toFixed(3):'NULL',
              '| candidates:', allVendors.length, '| in-range:', inRange.length);

  // 4. What WOULD happen next (dry run — no WhatsApp, no call)
  console.log('\n=== DRY RUN: next actions (NOT executed) ===');
  if (!inRange.length) {
    console.log('  -> no in-range vendor: would trigger Google Places discovery');
  } else {
    inRange.forEach(v => {
      console.log('  -> would EMAIL/WA vendor:', v.name, '(' + v._distanceKm + 'km)');
      console.log('     would CALL:', v.phone || '(no phone on record)', '<- call code path reached');
    });
  }
  console.log('\n(No messages sent, no calls placed.)');
  process.exit(0);
})();
