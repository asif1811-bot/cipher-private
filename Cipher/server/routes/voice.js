'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const VOICE_FROM = process.env.TWILIO_VOICE_NUMBER || '+18167931476';
const CC_URL = process.env.CC_URL || 'https://consiere.com.au';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const activeCalls = {};

function getSystemPrompt(vendorName, category, requestDesc, regLink) {
  return `You are Alina, an AI assistant calling on behalf of Consiere — the world's first AI-powered global concierge service. You are calling ${vendorName}.

CONVERSATION FLOW — follow this naturally:
1. Opening: "Hi, is this ${vendorName}?"
2. After they confirm: "Great! I am Alina, AI assistant calling from Consiere — the world's first AI-powered concierge service. We help you generate more business not just locally but across the world. Would you like to be part of this global community?"
3. After they say yes: "Wonderful! Our service fee is just 10% of the total bill value from the client. All you need to do is register on our website consiere.com.au forward slash vendors and follow the instructions. For more information you can also WhatsApp us on plus 61 4 1 3 5 3 6 7 0 0."
4. If they have questions: Answer naturally and keep it brief.
5. To close: "Thank you so much for your time. We look forward to having you on Consiere. Have a wonderful day!"

RULES:
- Keep each response SHORT — 2-3 sentences max for phone
- Sound warm, human, and enthusiastic
- If they say not interested, thank them politely and say goodbye
- If asked if you are AI say "Yes, I am Alina, the AI assistant for Consiere"
- The registration link is: consiere.com.au/vendors
- WhatsApp contact: plus 61 4 1 3 5 3 6 7 0 0`;
}

async function getAlinaReply(history, systemPrompt) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, system: systemPrompt, messages: history })
    });
    const d = await r.json();
    return d.content?.[0]?.text || 'Thank you for your time. Have a great day!';
  } catch(e) { return 'Thank you for your time. Have a wonderful day!'; }
}

module.exports = function(app) {

  // 1. Initiate outbound call
  app.post('/api/voice/call-vendor', async (req, res) => {
    try {
      const { vendorPhone, vendorName, category, requestDesc, requestId } = req.body;
      if (!vendorPhone || !vendorName) return res.status(400).json({ error: 'vendorPhone and vendorName required' });
      const internalKey = req.headers['x-internal-call'];
      const isInternal = internalKey === (process.env.JWT_SECRET || 'fallback-change-me');
      if (!isInternal && (!req.user || req.user.role !== 'ADMIN')) return res.status(401).json({ error: 'Unauthorized' });
      const phone = '+' + String(vendorPhone).replace(/[^\d]/g, '');
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const regLink = CC_URL + '/vendor_register.html';
      const sessionId = 'vs_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      activeCalls[sessionId] = { vendorName, category: category||'SERVICE', requestDesc: requestDesc||'service request', regLink, phone, requestId, history: [], status: 'calling' };
      const call = await twilio.calls.create({
        to: phone, from: VOICE_FROM,
        url: CC_URL + '/api/voice/twiml/' + sessionId,
        statusCallback: CC_URL + '/api/voice/status/' + sessionId,
        statusCallbackMethod: 'POST', timeout: 30
      });
      activeCalls[sessionId].callSid = call.sid;
      console.log('[VOICE] Calling:', vendorName, phone, 'SID:', call.sid);
      await prisma.vendorCallLog.create({ data: { vendorPhone: phone, vendorName, category: category||'SERVICE', requestId: requestId||null, callSid: call.sid, status: 'initiated' } }).catch(function(){});
      res.json({ success: true, callSid: call.sid, sessionId });
    } catch(e) { console.error('[VOICE]', e.message); res.status(500).json({ error: e.message }); }
  });

  // 2. TwiML - Alina delivers the opening script, then gathers speech so the vendor can
  // actually respond -- previously this ended in <Hangup/> with no <Gather>, so the AI
  // conversation loop in /respond below was built but structurally unreachable: every call
  // played the announcement and hung up before the vendor could ever say a word.
  app.post('/api/voice/twiml/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeCalls[sessionId];
    const vendorName = session ? session.vendorName : 'there';
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-AU-Standard-C" language="en-AU">Hello, is this ${vendorName}?</Say>
  <Pause length="2"/>
  <Say voice="Google.en-AU-Standard-C" language="en-AU">This is Alina, the A.I. concierge from Consiere, a partner you are registered with.</Say>
  <Pause length="1"/>
  <Say voice="Google.en-AU-Standard-C" language="en-AU">We have a client request we would like your help with. Details have been sent to you by message and email.</Say>
  <Gather input="speech" action="${CC_URL}/api/voice/respond/${sessionId}" method="POST" speechTimeout="3" timeout="10" language="en-AU">
    <Say voice="Google.en-AU-Standard-C" language="en-AU">If you are able to assist and would like to quote, you can tell me now, or reply to the message or open your vendor portal instead. Thank you very much.</Say>
  </Gather>
  <Say voice="Google.en-AU-Standard-C" language="en-AU">Thank you for your time. Have a great day!</Say>
  <Hangup/>
</Response>`);
  });

  // 3. Handle vendor speech response - AI generates reply
  app.post('/api/voice/respond/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = activeCalls[sessionId];
    const speechResult = req.body.SpeechResult || '';
    console.log('[VOICE] Vendor said:', speechResult.substring(0,80));

    if (!session) {
      res.type('text/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Google.en-AU-Standard-C">Thank you. Goodbye!</Say><Hangup/></Response>`);
    }

    session.history.push({ role: 'user', content: speechResult });
    const systemPrompt = getSystemPrompt(session.vendorName, session.category, session.requestDesc, session.regLink);
    const reply = await getAlinaReply(session.history, systemPrompt);
    session.history.push({ role: 'assistant', content: reply });
    console.log('[VOICE] Alina:', reply.substring(0,80));

    // Save to transcript
    const transcript = session.history.map(function(h){ return (h.role==='user'?'Vendor':'Alina') + ': ' + h.content; }).join('\
');
    await prisma.vendorCallLog.updateMany({ where: { callSid: session.callSid }, data: { transcript } }).catch(function(){});

    const endPhrases = ['have a great day', 'goodbye', 'take care', 'thank you for your time', 'not interested', 'all the best'];
    const shouldEnd = endPhrases.some(function(p){ return reply.toLowerCase().includes(p); });

    res.type('text/xml');
    if (shouldEnd) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-AU-Standard-C" language="en-AU">${reply}</Say>
  <Hangup/>
</Response>`);
      delete activeCalls[sessionId];
    } else {
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-AU-Standard-C" language="en-AU">${reply}</Say>
  <Gather input="speech" action="${CC_URL}/api/voice/respond/${sessionId}" method="POST" speechTimeout="3" timeout="10" language="en-AU">
  </Gather>
  <Say voice="Google.en-AU-Standard-C" language="en-AU">Thank you for your time. Have a great day!</Say>
  <Hangup/>
</Response>`);
    }
  });

  // 4. Status callback
  app.post('/api/voice/status/:sessionId', async (req, res) => {
    const { CallStatus, CallSid } = req.body;
    console.log('[VOICE STATUS]', CallSid, CallStatus);
    await prisma.vendorCallLog.updateMany({ where: { callSid: CallSid }, data: { status: CallStatus } }).catch(function(){});
    if (CallStatus === 'completed' || CallStatus === 'failed') delete activeCalls[req.params.sessionId];
    res.sendStatus(200);
  });

  // 5. Call logs
  app.get('/api/voice/logs', async (req, res) => {
    try {
      const logs = await prisma.vendorCallLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
      res.json({ logs });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
};
