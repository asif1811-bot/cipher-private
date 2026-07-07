'use strict';
const { PrismaClient } = require('@prisma/client');
const { geocodeFull } = require('../Cipher/server/utils/geo');
const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');
const AU = /sydney|melbourne|brisbane|perth|adelaide|gold coast|australia|canberra|hobart|darwin|newcastle|wollongong|geelong/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const vendors = await prisma.vendor.findMany({ where: { address: null }, select: { id:true, name:true, cities:true, lat:true, lng:true } });
  console.log((COMMIT?'[COMMIT]':'[DRY-RUN]'), 'vendors missing address:', vendors.length, '\n');
  let updated=0, skipped=0, missed=0;
  for (const v of vendors) {
    if (!AU.test(v.cities || '')) { console.log('SKIP (non-AU):', v.name, '['+v.cities+']'); skipped++; continue; }
    const q = v.name + ', ' + (v.cities ? v.cities.split(',')[0] : 'Sydney') + ', Australia';
    const g = await geocodeFull(q);
    await sleep(220);
    if (!g) { console.log('NO MATCH:', v.name, '→', q); missed++; continue; }
    console.log((COMMIT?'WRITE ':'would: '), v.name, '→', g.address);
    if (COMMIT) {
      await prisma.vendor.update({ where: { id: v.id }, data: { address: g.address, ...(v.lat==null?{lat:g.lat,lng:g.lng}:{}) } });
      updated++;
    }
  }
  console.log('\nDone.', COMMIT?('updated: '+updated):('would update: '+(vendors.length-skipped-missed)), '| skipped non-AU:', skipped, '| no match:', missed);
  process.exit(0);
})();
