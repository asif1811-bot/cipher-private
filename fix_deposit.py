f = '/var/www/cipher-private/Cipher/server/routes/stripe.js'
c = open(f).read()

old = """      // Handle deposit payment
      if (session.metadata?.type === 'deposit' && session.metadata?.requestId) {
        await prisma.request.update({
          where: { id: session.metadata.requestId },
          data: { depositPaid: true, depositSessionId: session.id, status: 'IN_PROGRESS' }
        }).catch(e => console.error('[DEPOSIT WEBHOOK]', e.message));
        console.log('[DEPOSIT] Paid for request:', session.metadata.requestId);
      }
    }"""

new = """      // Handle deposit payment
      if (session.metadata?.type === 'deposit' && session.metadata?.requestId) {
        try {
          const reqId = session.metadata.requestId;
          const paidAmt = (session.amount_total || 1000) / 100;
          const updatedReq = await prisma.request.update({
            where: { id: reqId },
            data: { depositPaid: true, depositSessionId: session.id, status: 'IN_PROGRESS' },
            include: { user: { select: { email: true, fullName: true, phone: true } }, inquiries: { include: { vendor: { select: { name: true, email: true, phone: true } } } } }
          });
          console.log('[DEPOSIT] Paid for request:', reqId, '$'+paidAmt);
          const member = updatedReq.user;
          const firstName = (member?.fullName || 'Member').split(' ')[0];
          const reqTitle = updatedReq.title || updatedReq.description?.substring(0, 60) || 'Service Request';
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          if (member?.email && !member.email.includes('@whatsapp.cipher')) {
            await resend.emails.send({
              from: 'Consiere <hello@consiere.com.au>',
              to: member.email,
              subject: 'Payment Received — ' + reqTitle,
              html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;background:#fff;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden"><div style="background:#1c1917;padding:24px;text-align:center"><div style="font-size:10px;letter-spacing:6px;color:#b87333;text-transform:uppercase">Consiere</div></div><div style="padding:32px"><h2 style="font-family:Georgia;font-size:20px;color:#1c1917;font-weight:400;margin:0 0 16px">Payment Received ✓</h2><p style="color:#44403c;font-size:14px;line-height:1.8">Hi ' + firstName + ',</p><p style="color:#44403c;font-size:14px;line-height:1.8">Your $' + paidAmt.toFixed(2) + ' AUD deposit has been received and your request is confirmed.</p><div style="background:#faf8f5;border-radius:8px;padding:16px;margin:20px 0"><p style="color:#1c1917;font-size:13px;font-weight:600;margin:0 0 6px">Request: ' + reqTitle + '</p><p style="color:#78716c;font-size:13px;margin:0">Amount paid: $' + paidAmt.toFixed(2) + ' AUD</p></div><p style="color:#44403c;font-size:13px;line-height:1.8">Your vendor has been notified and will confirm shortly.</p><div style="text-align:center;margin-top:24px"><a href="https://consiere.com.au/cc-portal" style="display:inline-block;padding:12px 28px;background:#b87333;color:#fff;text-decoration:none;font-weight:600;border-radius:6px;font-size:13px">View My Request</a></div></div><div style="background:#faf8f5;padding:14px;text-align:center;border-top:1px solid #e8e0d4"><p style="color:#a8a29e;font-size:11px;margin:0">Consiere · hello@consiere.com.au</p></div></div>'
            });
            console.log('[DEPOSIT] Receipt email sent to:', member.email);
          }
          const memberPhone = member?.phone || (member?.email?.includes('@whatsapp.cipher') ? '+' + member.email.replace('wa_','').replace('@whatsapp.cipher','') : null);
          if (memberPhone) { await sendWA(memberPhone, '✅ *Payment received — $' + paidAmt.toFixed(2) + ' AUD*\\n\\n*Request:* ' + reqTitle + '\\n\\nYour booking is confirmed. Your vendor will reach out shortly.').catch(()=>{}); console.log('[DEPOSIT] WA receipt sent to member'); }
          for (const inq of updatedReq.inquiries || []) {
            if (inq.vendor?.email) { await resend.emails.send({ from: 'Consiere <hello@consiere.com.au>', to: inq.vendor.email, subject: '[Payment Confirmed] Please proceed — ' + reqTitle, html: '<div style="font-family:Arial;max-width:560px;margin:40px auto;padding:32px;border:1px solid #e8e0d4;border-radius:8px"><h2 style="font-family:Georgia;color:#1c1917;font-weight:400">Deposit Received — Please Proceed</h2><p style="color:#44403c;font-size:14px">Hi ' + inq.vendor.name + ', the client has paid their $' + paidAmt.toFixed(2) + ' AUD deposit for: <strong>' + reqTitle + '</strong>. Please proceed with the booking.</p><p style="color:#78716c;font-size:13px">Contact us at hello@consiere.com.au with any questions.</p></div>' }).catch(e => console.error('[DEPOSIT] Vendor email error:', e.message)); console.log('[DEPOSIT] Vendor notified:', inq.vendor.name); }
          }
          await sendWA('+61413536700', '💰 *Deposit received!*\\n\\n*Request:* ' + reqTitle + '\\n*Amount:* $' + paidAmt.toFixed(2) + ' AUD\\n*Member:* ' + (member?.fullName || member?.email)).catch(()=>{});
        } catch(e) { console.error('[DEPOSIT WEBHOOK ERROR]', e.message); }
      }
    }"""

if old in c:
    c = c.replace(old, new)
    open(f, 'w').write(c)
    print('FIXED: deposit webhook now sends emails + WhatsApp')
else:
    print('NOT FOUND - checking...')
    idx = c.find("type === 'deposit'")
    print('deposit handler at char:', idx)
    print(c[idx-50:idx+200])
