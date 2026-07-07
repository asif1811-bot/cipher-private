require('dotenv').config();
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

async function dryRun(category, city, country) {
  console.log('\n=== DRY RUN:', category, '|', city, '|', country, '===');
  if (!GOOGLE_PLACES_KEY) { console.log('  No GOOGLE_PLACES_API_KEY set'); return; }
  const searchTerm = category.toLowerCase();
  const query = searchTerm + ' ' + city + ' ' + country;
  const url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?query=' +
    encodeURIComponent(query) + '&key=' + GOOGLE_PLACES_KEY;
  const r = await fetch(url);
  const d = await r.json();
  if (d.status !== 'OK') { console.log('  Places status:', d.status, d.error_message||''); return; }
  const sorted = (d.results||[]).filter(p => (p.rating||0) >= 3.5)
    .sort((a,b) => (b.rating||0)-(a.rating||0)).slice(0,5);
  console.log('  Found', d.results.length, 'results; top', sorted.length, 'with rating >= 3.5:\n');
  for (const place of sorted) {
    const detailUrl = 'https://maps.googleapis.com/maps/api/place/details/json?place_id=' +
      place.place_id + '&fields=formatted_phone_number,international_phone_number,website,business_status&key=' + GOOGLE_PLACES_KEY;
    const dd = await (await fetch(detailUrl)).json();
    const res = dd.result || {};
    if (res.business_status === 'CLOSED_PERMANENTLY') { console.log('  [skip closed]', place.name); continue; }
    const phone = (res.international_phone_number || res.formatted_phone_number || '').replace(/[^0-9+]/g,'') || '(none)';
    console.log('  •', place.name);
    console.log('     rating :', place.rating||0);
    console.log('     address:', place.formatted_address || place.vicinity || '(none)');
    console.log('     phone  :', phone);
    console.log('     website:', res.website || '(none)');
    console.log('     -> WOULD log as PENDING lead. No message/call sent.\n');
    await new Promise(r => setTimeout(r, 200));
  }
}

(async () => {
  await dryRun('hotel', 'Penrith', 'Australia');
  await dryRun('hotel', 'Mumbai', 'India');
  console.log('\nDone. Nothing was sent, logged, or called.');
  process.exit(0);
})();
