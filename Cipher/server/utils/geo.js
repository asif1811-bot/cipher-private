'use strict';
const GEO_KEY = process.env.GOOGLE_PLACES_API_KEY;
const _cache = new Map();

async function geocode(text) {
  if (!text) return null;
  const key = String(text).trim().toLowerCase();
  if (_cache.has(key)) return _cache.get(key);
  if (!GEO_KEY) { console.error('[GEO] No GOOGLE_MAPS_API_KEY set'); return null; }
  try {
    const q = encodeURIComponent(text + ', Australia');
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + q + '&region=au&key=' + GEO_KEY;
    const r = await fetch(url);
    const d = await r.json();
    if (d.status !== 'OK' || !d.results || !d.results.length) { _cache.set(key, null); return null; }
    const loc = d.results[0].geometry.location;
    const out = { lat: loc.lat, lng: loc.lng };
    _cache.set(key, out);
    return out;
  } catch (e) { console.error('[GEO] error:', e.message); return null; }
}

function distanceKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function filterVendorsByRadius(locationText, vendors, radiusKm) {
  const origin = await geocode(locationText);
  if (!origin) return { origin: null, inRange: [] };
  const inRange = [];
  for (const v of vendors) {
    if (v.lat == null || v.lng == null) continue;
    const dist = distanceKm(origin, { lat: v.lat, lng: v.lng });
    if (dist <= radiusKm) { v._distanceKm = Math.round(dist*10)/10; inRange.push(v); }
  }
  inRange.sort((x,y) => (x._distanceKm||0) - (y._distanceKm||0));
  return { origin, inRange };
}

async function geocodeFull(text) {
  if (!text || !GEO_KEY) return null;
  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(text) + '&region=au&key=' + GEO_KEY;
    const r = await fetch(url);
    const d = await r.json();
    if (d.status !== 'OK' || !d.results || !d.results.length) return null;
    const res = d.results[0];
    return { lat: res.geometry.location.lat, lng: res.geometry.location.lng, address: res.formatted_address };
  } catch (e) { console.error('[GEO FULL] error:', e.message); return null; }
}

// Country-aware geocode. country = 2-letter code (AU, IN, US, GB, CA, SG, ...).
const _COUNTRY_NAMES = {AU:'Australia',IN:'India',US:'United States',CA:'Canada',GB:'United Kingdom',SG:'Singapore',AE:'UAE',NZ:'New Zealand',JP:'Japan',FR:'France',DE:'Germany',TH:'Thailand',MY:'Malaysia',ID:'Indonesia',PH:'Philippines',KR:'South Korea',CN:'China',HK:'Hong Kong',QA:'Qatar',BH:'Bahrain',SA:'Saudi Arabia',ZA:'South Africa',BR:'Brazil',MX:'Mexico'};
async function geocodeCountry(text, country) {
  if (!text || !GEO_KEY) return null;
  const cc = (country || 'AU').toUpperCase();
  const name = _COUNTRY_NAMES[cc] || 'Australia';
  const key = (cc + '|' + String(text).trim().toLowerCase());
  if (_cache.has(key)) return _cache.get(key);
  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' +
      encodeURIComponent(text + ', ' + name) + '&region=' + cc.toLowerCase() + '&key=' + GEO_KEY;
    const r = await fetch(url);
    const d = await r.json();
    if (d.status !== 'OK' || !d.results || !d.results.length) { _cache.set(key, null); return null; }
    const res = d.results[0];
    const out = { lat: res.geometry.location.lat, lng: res.geometry.location.lng, address: res.formatted_address };
    _cache.set(key, out);
    return out;
  } catch (e) { console.error('[GEO COUNTRY] error:', e.message); return null; }
}

module.exports = { geocode, geocodeCountry, geocodeFull, distanceKm, filterVendorsByRadius };
