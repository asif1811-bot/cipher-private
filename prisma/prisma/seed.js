'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🔑 Seeding Cipher Private database...');

  // Create super admin
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cipherprivate.com.au';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe!Immediately123';

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existing) {
    console.log(`✓ Admin already exists: ${adminEmail}`);
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        fullName: 'Cipher Admin',
        role: 'SUPER_ADMIN',
        isApproved: true,
        isActive: true,
      },
    });

    console.log(`✓ Admin created: ${adminEmail}`);
    console.log(`⚠️  IMPORTANT: Change the admin password immediately after first login!`);
  }

  // Create a demo member (optional — remove in production)
  const demoEmail = 'demo@cipherprivate.com.au';
  const demoExists = await prisma.user.findUnique({ where: { email: demoEmail } });

  if (!demoExists) {
    const demoHash = await bcrypt.hash('Demo!Member123', 12);
    await prisma.user.create({
      data: {
        email: demoEmail,
        passwordHash: demoHash,
        fullName: 'James Harrington',
        phone: '+61 400 000 000',
        role: 'MEMBER',
        memberTier: 'CIPHER_BLACK',
        isApproved: true,
        isActive: true,
      },
    });
    console.log(`✓ Demo member created: ${demoEmail} / Demo!Member123`);
    console.log(`⚠️  Remove the demo account before going live!`);
  }

  console.log('\n✅ Seed complete.');
  console.log('\n📋 Login credentials:');
  console.log(`   Admin:  ${adminEmail} / ${adminPassword}`);
  console.log(`   Member: ${demoEmail} / Demo!Member123`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
