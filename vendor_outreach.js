require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const vendors = [
  { name: 'Bennelong Restaurant', email: 'reservations@bennelong.com.au', category: 'Fine Dining' },
  { name: 'Aria Restaurant', email: 'reservations@ariarestaurant.com.au', category: 'Fine Dining' },
  { name: 'Rockpool Bar & Grill', email: 'sydney@rockpool.com', category: 'Fine Dining' },
  { name: 'Chiswick Restaurant', email: 'functions@chiswick.com.au', category: 'Fine Dining' },
  { name: 'Catalina Rose Bay', email: 'info@catalinarosebay.com.au', category: 'Fine Dining' },
  { name: 'Bondi Icebergs Dining Room', email: 'events@idrb.com', category: 'Fine Dining' },
  { name: 'Nour Restaurant', email: 'hello@nour.com.au', category: 'Fine Dining' },
  { name: 'Saint Peter', email: 'hello@saintpeter.com.au', category: 'Fine Dining' },
  { name: 'Cafe Sydney', email: 'reservations@cafesydney.com', category: 'Fine Dining' },
  { name: 'Firedoor', email: 'hello@firedoor.com.au', category: 'Fine Dining' },
  { name: 'Sokyo at The Star', email: 'sokyo@star.com.au', category: 'Fine Dining' },
  { name: 'Flying Fish', email: 'events@flyingfish.com.au', category: 'Fine Dining' },
  { name: 'Cottage Point Inn', email: 'info@cottagepointinn.com.au', category: 'Fine Dining' },
  { name: 'Pilu at Freshwater', email: 'info@pilurestaurant.com.au', category: 'Fine Dining' },
  { name: 'Doyles on the Beach', email: 'bookings@doyles.com.au', category: 'Seafood' },
  { name: 'Ormeggio at the Spit', email: 'info@ormeggio.com.au', category: 'Fine Dining' },
  { name: 'Quay Restaurant', email: 'reservations@quay.com.au', category: 'Fine Dining' },
  { name: 'Sixpenny', email: 'hello@sixpenny.com.au', category: 'Fine Dining' },
  { name: 'Allta Restaurant', email: 'info@allta.com.au', category: 'Fine Dining' },
  { name: 'Steersons Steakhouse', email: 'reservations@steersons.com.au', category: 'Steakhouse' },
  { name: 'Longrain Sydney', email: 'bookings@longrain.com', category: 'Fine Dining' },
  { name: 'Barrio Cellar', email: 'hello@barriocellar.com.au', category: 'Fine Dining' },
  { name: 'Temporada', email: 'info@temporada.com.au', category: 'Fine Dining' },
  { name: 'Pilot Restaurant', email: 'info@pilotrestaurant.com.au', category: 'Fine Dining' },
  { name: 'Aubergine Restaurant', email: 'info@aubergine.com.au', category: 'Fine Dining' },
  { name: 'Ottoman Cuisine', email: 'info@ottoman.com.au', category: 'Fine Dining' },
  { name: 'Morks', email: 'eat@morks.com.au', category: 'Fine Dining' },
  { name: 'Esca at Bimbadgen', email: 'esca@bimbadgen.com.au', category: 'Fine Dining' },
  { name: 'Chauffeured Solutions', email: 'info@chauffeuredsolutions.com.au', category: 'Luxury Chauffeur' },
  { name: 'Chauffeur For All', email: 'bookings@chauffeurforall.com', category: 'Luxury Chauffeur' },
  { name: 'Blacklane Australia', email: 'australia@blacklane.com', category: 'Luxury Chauffeur' },
  { name: 'EVO Chauffeured Transport', email: 'bookings@evotransport.com.au', category: 'Luxury Chauffeur' },
  { name: 'Australian Chauffeurs', email: 'info@australianchauffeurs.com.au', category: 'Luxury Chauffeur' },
  { name: 'Priority Limousines', email: 'bookings@prioritylimousines.com.au', category: 'Luxury Chauffeur' },
  { name: 'Presidential Chauffeured Cars', email: 'info@presidentialcars.com.au', category: 'Luxury Chauffeur' },
  { name: 'Silver Service', email: 'corporate@silverservice.com.au', category: 'Premium Transport' },
  { name: 'Canberra Chauffeurs', email: 'info@canberrachauffeurs.com.au', category: 'Luxury Chauffeur' },
  { name: 'Pace Migration', email: 'info@pacemigration.com.au', category: 'Migration' },
  { name: 'Bay Migration Solution', email: 'info@baymigration.com.au', category: 'Migration' },
  { name: 'IME Advisors', email: 'sydney@imeadvisors.com', category: 'Migration' },
  { name: 'Asia Pacific Group', email: 'sydney@apg.edu.au', category: 'Migration' },
  { name: 'Work Visa Lawyers', email: 'sydney@workvisalawyers.com.au', category: 'Migration' },
  { name: 'OzVisa Migration', email: 'info@ozvisa.com.au', category: 'Migration' },
  { name: 'Priority Migration', email: 'hello@prioritymigration.com.au', category: 'Migration' },
  { name: 'Park Hyatt Sydney', email: 'sydney.park@hyatt.com', category: 'Luxury Hotel' },
  { name: 'Capella Sydney', email: 'reservations.sydney@capellahotels.com', category: 'Luxury Hotel' },
  { name: 'Crown Towers Sydney', email: 'sydney.reservations@crownhotels.com.au', category: 'Luxury Hotel' },
  { name: 'The Langham Sydney', email: 'reservations.sydney@langhamhotels.com', category: 'Luxury Hotel' },
  { name: 'Four Seasons Sydney', email: 'sydney@fourseasons.com', category: 'Luxury Hotel' },
  { name: 'InterContinental Sydney', email: 'sydney@ihg.com', category: 'Luxury Hotel' },
  { name: 'Sofitel Sydney Wentworth', email: 'reservations@sofitelsydneywentworth.com.au', category: 'Luxury Hotel' },
  { name: 'The Fullerton Hotel Sydney', email: 'sydney@fullertonhotels.com', category: 'Luxury Hotel' },
  { name: 'W Sydney', email: 'wSydney@whotels.com', category: 'Luxury Hotel' },
  { name: 'Hotel Realm Canberra', email: 'reservations@hotelrealm.com.au', category: 'Luxury Hotel' },
  { name: 'QT Canberra', email: 'canberra@qthotels.com.au', category: 'Luxury Hotel' },
  { name: 'Hyatt Hotel Canberra', email: 'canberra.park@hyatt.com', category: 'Luxury Hotel' },
  { name: 'Hotel Kurrajong Canberra', email: 'stay@hotelkurrajong.com.au', category: 'Luxury Hotel' },
  { name: 'Emirates One&Only Wolgan Valley', email: 'reservations@oneandonlywolganvalley.com', category: 'Luxury Hotel' },
  { name: 'Jettly Australia', email: 'australia@jettly.com', category: 'Private Aviation' },
  { name: 'Fly Corporate', email: 'charter@flycorporate.com.au', category: 'Private Aviation' },
  { name: 'Sydney Seaplanes', email: 'reservations@sydneyseaplanes.com', category: 'Private Aviation' },
  { name: 'Execujet Australia', email: 'sydney@execujet.com', category: 'Private Aviation' },
  { name: 'Air Charter Service', email: 'australia@aircharterservice.com', category: 'Private Aviation' },
  { name: 'Qantas Private Aviation', email: 'private@qantas.com.au', category: 'Private Aviation' },
  { name: 'Luxury Escapes', email: 'partnerships@luxuryescapes.com', category: 'Luxury Travel' },
  { name: 'Virtuoso Australia', email: 'australia@virtuoso.com', category: 'Luxury Travel' },
  { name: 'Abercrombie & Kent', email: 'australia@abercrombiekent.com', category: 'Luxury Travel' },
  { name: 'Signature Luxury Travel', email: 'info@signatureluxurytravel.com.au', category: 'Luxury Travel' },
  { name: 'Doltone House', email: 'events@doltone.com.au', category: 'Events' },
  { name: 'Sydney Opera House Events', email: 'events@sydneyoperahouse.com', category: 'Events' },
  { name: 'Luna Park Sydney', email: 'events@lunaparksydney.com', category: 'Events' },
  { name: 'Fantasea Cruising', email: 'info@fantasea.com.au', category: 'Events' },
  { name: 'Shangri-La Events Sydney', email: 'events.sydney@shangri-la.com', category: 'Events' },
  { name: 'Taronga Zoo Corporate', email: 'corporate@taronga.org.au', category: 'Events' },
  { name: 'National Convention Centre', email: 'events@ncc.com.au', category: 'Events' },
  { name: "Jim's Cleaning Sydney", email: 'sydney@jimscleaning.com.au', category: 'Home Services' },
  { name: 'Maid2Match Sydney', email: 'sydney@maid2match.com.au', category: 'Home Services' },
  { name: 'Fantastic Services', email: 'sydney@fantasticservices.com', category: 'Home Services' },
  { name: 'Absolute Domestics', email: 'sydney@absolutedomestics.com.au', category: 'Home Services' },
  { name: 'Crown Relocations Sydney', email: 'sydney@crownrelo.com', category: 'Relocation' },
  { name: 'Santa Fe Relocation', email: 'australia@santaferelo.com', category: 'Relocation' },
  { name: 'Allied Pickfords', email: 'sydney@alliedpickfords.com.au', category: 'Relocation' },
  { name: 'Grace Removals', email: 'sydney@grace.com.au', category: 'Relocation' },
  { name: 'Kent Relocation Group', email: 'sydney@kent.com.au', category: 'Relocation' },
  { name: 'McGrath Estate Agents', email: 'pm@mcgrath.com.au', category: 'Property Management' },
  { name: 'BresicWhitney', email: 'pm@bresicwhitney.com.au', category: 'Property Management' },
  { name: 'Belle Property', email: 'pm@belleproperty.com', category: 'Property Management' },
  { name: 'CBRE Residential PM', email: 'sydney.residential@cbre.com', category: 'Property Management' },
  { name: 'Next Practice Sydney', email: 'sydney@nextpracticehealth.com', category: 'Medical' },
  { name: 'Priority Healthcare', email: 'info@priorityhealthcare.com.au', category: 'Medical' },
  { name: 'The Manse Medical', email: 'info@themansemedical.com.au', category: 'Medical' },
  { name: 'Boatique Sydney', email: 'info@boatiquesydneyboathire.com.au', category: 'Yacht & Marine' },
  { name: 'Sydney Boat Hire', email: 'info@sydneyboathire.com.au', category: 'Yacht & Marine' },
  { name: 'Sydney Harbour Luxe Charters', email: 'info@sydneyharbourluxecharters.com.au', category: 'Yacht & Marine' },
  { name: 'Fraser Yachts Australia', email: 'australia@fraseryachts.com', category: 'Yacht & Marine' },
  { name: 'Sydney Harbour Escapes', email: 'info@sydneyharbourescapes.com.au', category: 'Yacht & Marine' },
  { name: 'Captain Cook Cruises', email: 'info@captaincook.com.au', category: 'Yacht & Marine' },
  { name: 'Pearsons Florist', email: 'hello@pearsonsflorist.com.au', category: 'Personal Shopping' },
  { name: 'Lush Flower Co', email: 'hello@lushflowerco.com.au', category: 'Personal Shopping' },
  { name: 'Grandiflora', email: 'info@grandiflora.net', category: 'Personal Shopping' },
  { name: 'Cartier Sydney', email: 'sydney@cartier.com', category: 'Personal Shopping' },
  { name: 'Tiffany & Co Sydney', email: 'sydney@tiffany.com', category: 'Personal Shopping' },
  { name: 'Hardy Brothers Jewellers', email: 'info@hardybrothers.com.au', category: 'Personal Shopping' },
  { name: 'Global Protective Services', email: 'info@globalprotective.com.au', category: 'Security' },
  { name: 'Wilson Security', email: 'info@wilsonsecurity.com.au', category: 'Security' },
  { name: 'SecureCorps', email: 'info@securecorps.com.au', category: 'Security' },
  { name: 'Off Duty Officers', email: 'info@offdutynow.com.au', category: 'Security' },
  { name: 'ENDOTA Spa', email: 'info@endotaspa.com.au', category: 'Wellness & Spa' },
  { name: 'The Day Spa Sydney', email: 'info@thedayspasydney.com.au', category: 'Wellness & Spa' },
  { name: 'Chuan Spa Langham', email: 'chuanspa.sydney@langhamhotels.com', category: 'Wellness & Spa' },
  { name: 'Crown Spa Sydney', email: 'spa.sydney@crownhotels.com.au', category: 'Wellness & Spa' },
  { name: 'Pet Angel', email: 'info@petangel.com.au', category: 'Pet Services' },
  { name: 'Mad Paws', email: 'hello@madpaws.com.au', category: 'Pet Services' },
  { name: 'The Vet Sydney', email: 'info@thevetsydney.com.au', category: 'Pet Services' },
];

function buildEmail(vendor) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f0eb;font-family:Arial,sans-serif">
<div style="max-width:580px;margin:40px auto;background:#fff;border:1px solid #e2dbd3;border-radius:8px;overflow:hidden">
  <div style="background:#1a1612;padding:28px 32px;text-align:center">
    <div style="font-size:10px;letter-spacing:6px;color:#c9a96e;text-transform:uppercase;font-family:Georgia,serif">Consiere</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px">Your life, handled.</div>
  </div>
  <div style="padding:36px 32px">
    <p style="font-size:14px;color:#1a1612;font-weight:600;margin:0 0 20px">Dear ${vendor.name} Team,</p>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0 0 16px">My name is Asif, founder of <strong>Consiere</strong> — a personal AI concierge service launching across Australia, UAE, Singapore, India, Canada and the USA.</p>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0 0 16px">Our members send one message to Alina, our AI concierge, and she handles everything — restaurant bookings, transport, hotels, shopping, home services and more. When a member needs ${vendor.category} services, we connect them directly with partners like you.</p>
    <div style="background:#faf7f3;border:1px solid #e2dbd3;border-radius:6px;padding:20px 24px;margin:20px 0">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a96e;margin-bottom:12px">How the partnership works</div>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Zero upfront cost</strong> — free to join. We charge 10% commission on completed bookings only.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Qualified leads only</strong> — every client has confirmed their request. No tyre-kickers.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>Simple quoting</strong> — we send you the request, you quote. Client pays us, we pay you within 2 business days.</p>
      <p style="font-size:12px;color:#44403c;line-height:1.8;margin:4px 0">&#10003; <strong>You stay in control</strong> — accept or decline any request. No lock-in, no minimums.</p>
    </div>
    <div style="border-left:3px solid #c9a96e;padding:14px 18px;margin:20px 0;background:#fffdf9">
      <p style="font-size:13px;color:#44403c;line-height:1.9;margin:0"><strong>A candid note from our founder:</strong><br>We are in our early stages and it may take a little time before your first Consiere client comes through. But we are building this properly and our goal is to become the leading concierge platform across 6 countries. To get there, we need partners who share our commitment to exceptional service.</p>
      <p style="font-size:13px;color:#44403c;line-height:1.9;margin:12px 0 0">What we ask of our vendor partners is simple: <strong>when we send you a client, please give them priority.</strong> These are members who expect the best. Your reputation and ours grow together.</p>
    </div>
    <p style="font-size:13px;color:#44403c;line-height:1.9;margin:20px 0">I would love to have <strong>${vendor.name}</strong> as part of our network. Joining takes less than 5 minutes.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="https://consiere.com.au/vendors" style="display:inline-block;padding:14px 40px;background:#1a1612;color:#fff;text-decoration:none;font-size:13px;font-weight:600;border-radius:4px">Register as a Vendor Partner &rarr;</a>
    </div>
    <p style="font-size:12px;color:#78716c;margin:20px 0">If you have any questions, simply reply to this email and I will personally respond.</p>
    <p style="font-size:13px;color:#1a1612;margin:24px 0 2px">Warm regards,</p>
    <p style="font-size:14px;color:#1a1612;font-weight:600;margin:0">Asif</p>
    <p style="font-size:12px;color:#78716c;margin:2px 0">Founder, Consiere</p>
    <p style="font-size:12px;color:#c9a96e;margin:2px 0">hello@consiere.com.au &middot; consiere.com.au</p>
  </div>
  <div style="background:#faf7f3;padding:16px 32px;border-top:1px solid #e2dbd3;text-align:center">
    <p style="font-size:11px;color:#a8a29e;margin:0">Consiere &middot; hello@consiere.com.au &middot; Sydney, Australia</p>
    <p style="font-size:10px;color:#c4bdb6;margin:4px 0 0">To opt out, reply with "unsubscribe".</p>
  </div>
</div></body></html>`;
}

async function sendAll() {
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('DRY RUN — no emails sent\n');
    vendors.forEach((v,i) => console.log(`${i+1}. ${v.name} → ${v.email}`));
    console.log(`\nTotal: ${vendors.length} vendors`);
    return;
  }
  console.log(`\nStarting vendor outreach — ${vendors.length} vendors\n`);
  let sent=0, failed=0;
  for (const vendor of vendors) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const result = await resend.emails.send({
        from: 'Asif at Consiere <hello@consiere.com.au>',
        to: vendor.email,
        replyTo: 'hello@consiere.com.au',
        subject: 'Partnership invitation — Consiere concierge network',
        html: buildEmail(vendor),
      });
      if (result.error) { console.log('FAILED  ' + vendor.name + ': ' + result.error.message); failed++; }
      else { console.log('SENT    ' + vendor.name + ' → ' + vendor.email); sent++; }
    } catch(e) { console.log('ERROR   ' + vendor.name + ': ' + e.message); failed++; }
  }
  console.log('\n═══════════════════════');
  console.log('Sent:   ' + sent);
  console.log('Failed: ' + failed);
}

sendAll().catch(console.error);
