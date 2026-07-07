
// ============================================
// VENDOR COMMISSION ENFORCEMENT SYSTEM
// ============================================

const { PrismaClient } = require('@prisma/client');
const { Resend } = require('resend');

async function runCommissionEnforcement() {
  const prisma = new PrismaClient();
  const resend = new Resend(process.env.RESEND_API_KEY);
  
  try {
    console.log('[COMMISSION CRON] Starting daily enforcement check...');
    
    // Find all completed inquiries where commission is unpaid and overdue
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 15); // 15 days ago
    
    const overdueInquiries = await prisma.vendorInquiry.findMany({
      where: {
        status: { in: ['DELIVERED', 'COMPLETED'] },
        commissionAmt: { gt: 0 },
        paymentPaidAt: null,
        updatedAt: { lt: cutoffDate }
      },
      include: {
        vendor: true,
        request: { select: { title: true, description: true } }
      }
    });
    
    console.log('[COMMISSION CRON] Found', overdueInquiries.length, 'overdue commissions');
    
    // Group by vendor
    const vendorMap = {};
    for (const inq of overdueInquiries) {
      if (!vendorMap[inq.vendorId]) {
        vendorMap[inq.vendorId] = { vendor: inq.vendor, inquiries: [] };
      }
      vendorMap[inq.vendorId].inquiries.push(inq);
    }
    
    // Process each vendor with overdue commissions
    for (const [vendorId, data] of Object.entries(vendorMap)) {
      const { vendor, inquiries } = data;
      const totalOwed = inquiries.reduce((sum, i) => sum + (i.commissionAmt || 0), 0);
      
      // Suspend vendor if not already suspended
      if (vendor.isActive) {
        await prisma.vendor.update({
          where: { id: vendorId },
          data: { isActive: false }
        });
        console.log('[COMMISSION CRON] SUSPENDED vendor:', vendor.name, 'owes $'+totalOwed.toFixed(2));
      }
      
      // Send daily reminder email to vendor
      const inquiryList = inquiries.map(i => 
        '• ' + (i.request?.title || i.request?.description?.substring(0,50) || 'Service') + 
        ' — Commission: $' + (i.commissionAmt || 0).toFixed(2) + ' AUD'
      ).join('\n');
      
      const paymentLink = (process.env.CC_URL || 'https://consiere.com.au') + '/vendor-portal';
      
      try {
        await resend.emails.send({
          from: 'Alina at Consiere <hello@consiere.com.au>',
          to: vendor.email,
          subject: '⚠️ Outstanding Commission — Your Account is Temporarily Suspended',
          html: '<div style="font-family:Arial;max-width:600px;margin:40px auto;padding:32px;border:1px solid #e8e0d4;border-radius:8px">' +
            '<div style="background:#1c1917;padding:20px;text-align:center;border-radius:8px 8px 0 0;margin:-32px -32px 24px"><div style="color:#b87333;font-size:11px;letter-spacing:4px">CONSIERE</div></div>' +
            '<h2 style="font-family:Georgia;color:#1c1917;font-weight:400">Hi ' + vendor.name + ',</h2>' +
            '<p style="color:#44403c;font-size:14px;line-height:1.8">I am Alina, your Consiere concierge coordinator. I am reaching out because your account has an outstanding commission balance that is preventing me from sending you new client requests.</p>' +
            '<div style="background:#fef3cd;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:20px 0">' +
            '<p style="color:#92400e;font-weight:600;margin:0 0 8px">Outstanding Commission: $' + totalOwed.toFixed(2) + ' AUD</p>' +
            '<pre style="color:#92400e;font-size:13px;margin:0;white-space:pre-wrap">' + inquiryList + '</pre>' +
            '</div>' +
            '<p style="color:#44403c;font-size:14px;line-height:1.8">Until this balance is cleared, I am unable to send you new service requests from our members. Please settle your outstanding commission to resume receiving bookings.</p>' +
            '<div style="text-align:center;margin:28px 0">' +
            '<a href="' + paymentLink + '" style="display:inline-block;padding:14px 32px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:15px">Pay Outstanding Commission →</a>' +
            '</div>' +
            '<p style="color:#78716c;font-size:13px">If you believe this is an error or have already made payment, please contact us at <a href="mailto:hello@consiere.com.au" style="color:#b87333">hello@consiere.com.au</a></p>' +
            '<p style="color:#78716c;font-size:13px">— Alina<br><em>Consiere AI Concierge</em></p>' +
            '</div>'
        });
        console.log('[COMMISSION CRON] Reminder email sent to:', vendor.email, '— owes $'+totalOwed.toFixed(2));
      } catch(emailErr) {
        console.error('[COMMISSION CRON] Email error for', vendor.name, ':', emailErr.message);
      }
    }
    
    // Also check: reactivate vendors who have paid all commissions
    const suspendedVendors = await prisma.vendor.findMany({
      where: { isActive: false },
      include: {
        inquiries: {
          where: {
            status: { in: ['DELIVERED', 'COMPLETED'] },
                commissionAmt: { gt: 0 }
          }
        }
      }
    });
    
    for (const vendor of suspendedVendors) {
      if (vendor.inquiries.length === 0) {
        // All paid — reactivate
        await prisma.vendor.update({ where: { id: vendor.id }, data: { isActive: true } });
        console.log('[COMMISSION CRON] REACTIVATED vendor:', vendor.name, '— all commissions paid');
        
        // Send reactivation email
        try {
          await resend.emails.send({
            from: 'Alina at Consiere <hello@consiere.com.au>',
            to: vendor.email,
            subject: '✅ Account Reactivated — You will receive new requests',
            html: '<div style="font-family:Arial;max-width:600px;margin:40px auto;padding:32px;border:1px solid #e8e0d4;border-radius:8px">' +
              '<h2 style="font-family:Georgia;color:#1c1917;font-weight:400">Hi ' + vendor.name + ',</h2>' +
              '<p style="color:#44403c;font-size:14px;line-height:1.8">Great news — your account has been reactivated! Your commission payment has been received and I will now resume sending you new client requests.</p>' +
              '<p style="color:#44403c;font-size:14px">Thank you for being a Consiere partner. — Alina</p>' +
              '</div>'
          });
        } catch(e) {}
      }
    }
    
    console.log('[COMMISSION CRON] Daily enforcement complete');
  } catch(err) {
    console.error('[COMMISSION CRON ERROR]', err.message);
  } finally {
    await prisma.$disconnect();
  }
}


// ── Daily admin digest ───────────────────────────────────────────
async function sendAdminDailyDigest() {
  try {
    const { Resend } = require('resend');
    const rs = new Resend(process.env.RESEND_API_KEY);
    const yesterday = new Date(Date.now() - 24*60*60*1000);
    const [newReqs, completedReqs, newMembers, pendingInquiries, overdueCommissions] = await Promise.all([
      prisma.request.count({ where: { createdAt: { gt: yesterday } } }),
      prisma.request.count({ where: { status: 'COMPLETED', updatedAt: { gt: yesterday } } }),
      prisma.user.count({ where: { createdAt: { gt: yesterday }, role: 'MEMBER' } }),
      prisma.vendorInquiry.count({ where: { status: { in: ['SENT','CHASED'] } } }),
      prisma.vendorInquiry.count({ where: { status: { in: ['DELIVERED','COMPLETED'] }, commissionAmt: { gt: 0 }, paymentPaidAt: null } })
    ]);
    const recentRequests = await prisma.request.findMany({
      where: { createdAt: { gt: yesterday } },
      include: { user: { select: { fullName: true } } },
      take: 10, orderBy: { createdAt: 'desc' }
    });
    const reqList = recentRequests.map(r => '<li style="margin:4px 0;font-size:13px;color:#44403c">' + (r.user?.fullName||'Member') + ' — ' + (r.title||r.description||'').substring(0,60) + ' <span style="color:#b87333">(' + r.status + ')</span></li>').join('');
    await rs.emails.send({
      from: 'Alina at Consiere <hello@consiere.com.au>',
      to: 'hello@consiere.com.au',
      subject: 'Daily Digest — Consiere ' + new Date().toLocaleDateString('en-AU', {weekday:'long',day:'numeric',month:'long'}),
      html: '<div style="font-family:Arial;max-width:600px;margin:40px auto;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden">' +
        '<div style="background:#1c1917;padding:20px;text-align:center"><span style="color:#b87333;font-size:11px;letter-spacing:4px">CONSIERE — DAILY DIGEST</span></div>' +
        '<div style="padding:28px">' +
        '<table style="width:100%;border-collapse:collapse">' +
        '<tr><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:13px">New requests (24hrs)</td><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:16px;font-weight:700;color:#b87333;text-align:right">' + newReqs + '</td></tr>' +
        '<tr><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:13px">Completed requests</td><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:16px;font-weight:700;color:#22c55e;text-align:right">' + completedReqs + '</td></tr>' +
        '<tr><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:13px">New members</td><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:16px;font-weight:700;text-align:right">' + newMembers + '</td></tr>' +
        '<tr><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:13px">Pending vendor inquiries</td><td style="padding:10px;border-bottom:1px solid #f5f5f4;font-size:16px;font-weight:700;color:#f59e0b;text-align:right">' + pendingInquiries + '</td></tr>' +
        '<tr><td style="padding:10px;font-size:13px">Overdue commissions</td><td style="padding:10px;font-size:16px;font-weight:700;color:#ef4444;text-align:right">' + overdueCommissions + '</td></tr>' +
        '</table>' +
        (reqList ? '<h3 style="font-family:Georgia;color:#1c1917;font-weight:400;margin-top:24px">Recent Requests</h3><ul style="padding-left:16px;margin:0">' + reqList + '</ul>' : '') +
        '<div style="text-align:center;margin:24px 0"><a href="' + (process.env.CC_URL||'https://consiere.com.au') + '/cc-admin" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px">Open Admin Panel</a></div>' +
        '</div></div>'
    });
    console.log('[DAILY DIGEST] Sent to admin');
  } catch(e) { console.error('[DAILY DIGEST]', e.message); }
}

module.exports = { runCommissionEnforcement, sendAdminDailyDigest };
