'use strict';

// ── GLOBAL CITY & SUBURB/AREA MAPPING ────────────────────────────────────
const GLOBAL_AREAS = {
  // ── INDIA ──────────────────────────────────────────────────────────────
  'mumbai':       { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'malad':        { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'malad east':   { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'malad west':   { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'pimpri':       { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'andheri':      { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'bandra':       { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'borivali':     { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'kandivali':    { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'goregaon':     { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'juhu':         { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'versova':      { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'film city':    { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'film city road':{ city:'Mumbai', country:'IN', state:'Maharashtra' },
  'swapnalok':    { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'powai':        { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'thane':        { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'navi mumbai':  { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'worli':        { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'lower parel':  { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'dadar':        { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'kurla':        { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'dharavi':      { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'colaba':       { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'nariman point':{ city:'Mumbai', country:'IN', state:'Maharashtra' },
  'churchgate':   { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'fort':         { city:'Mumbai', country:'IN', state:'Maharashtra' },
  'delhi':        { city:'Delhi', country:'IN', state:'Delhi' },
  'new delhi':    { city:'Delhi', country:'IN', state:'Delhi' },
  'gurgaon':      { city:'Delhi', country:'IN', state:'Haryana' },
  'gurugram':     { city:'Delhi', country:'IN', state:'Haryana' },
  'noida':        { city:'Delhi', country:'IN', state:'UP' },
  'connaught place':{ city:'Delhi', country:'IN', state:'Delhi' },
  'bangalore':    { city:'Bangalore', country:'IN', state:'Karnataka' },
  'bengaluru':    { city:'Bangalore', country:'IN', state:'Karnataka' },
  'koramangala':  { city:'Bangalore', country:'IN', state:'Karnataka' },
  'whitefield':   { city:'Bangalore', country:'IN', state:'Karnataka' },
  'indiranagar':  { city:'Bangalore', country:'IN', state:'Karnataka' },
  'chennai':      { city:'Chennai', country:'IN', state:'Tamil Nadu' },
  'madras':       { city:'Chennai', country:'IN', state:'Tamil Nadu' },
  'hyderabad':    { city:'Hyderabad', country:'IN', state:'Telangana' },
  'pune':         { city:'Pune', country:'IN', state:'Maharashtra' },
  'kolkata':      { city:'Kolkata', country:'IN', state:'West Bengal' },
  'calcutta':     { city:'Kolkata', country:'IN', state:'West Bengal' },
  'ahmedabad':    { city:'Ahmedabad', country:'IN', state:'Gujarat' },
  'jaipur':       { city:'Jaipur', country:'IN', state:'Rajasthan' },
  'goa':          { city:'Goa', country:'IN', state:'Goa' },
  // Indian PIN codes pattern — 4-6 digits
  '400097':       { city:'Mumbai', country:'IN', state:'Maharashtra' },
  '400001':       { city:'Mumbai', country:'IN', state:'Maharashtra' },
  '110001':       { city:'Delhi', country:'IN', state:'Delhi' },
  '560001':       { city:'Bangalore', country:'IN', state:'Karnataka' },
  '600001':       { city:'Chennai', country:'IN', state:'Tamil Nadu' },

  // ── UAE ────────────────────────────────────────────────────────────────
  'dubai':        { city:'Dubai', country:'AE', state:'Dubai' },
  'abu dhabi':    { city:'Abu Dhabi', country:'AE', state:'Abu Dhabi' },
  'sharjah':      { city:'Sharjah', country:'AE', state:'Sharjah' },
  'palm jumeirah':{ city:'Dubai', country:'AE', state:'Dubai' },
  'downtown dubai':{ city:'Dubai', country:'AE', state:'Dubai' },
  'marina':       { city:'Dubai', country:'AE', state:'Dubai' },
  'jbr':          { city:'Dubai', country:'AE', state:'Dubai' },
  'deira':        { city:'Dubai', country:'AE', state:'Dubai' },
  'bur dubai':    { city:'Dubai', country:'AE', state:'Dubai' },
  'jumeirah':     { city:'Dubai', country:'AE', state:'Dubai' },
  'business bay': { city:'Dubai', country:'AE', state:'Dubai' },
  'difc':         { city:'Dubai', country:'AE', state:'Dubai' },

  // ── SINGAPORE ─────────────────────────────────────────────────────────
  'singapore':    { city:'Singapore', country:'SG', state:'Singapore' },
  'orchard':      { city:'Singapore', country:'SG', state:'Singapore' },
  'marina bay':   { city:'Singapore', country:'SG', state:'Singapore' },
  'sentosa':      { city:'Singapore', country:'SG', state:'Singapore' },
  'cbd singapore':{ city:'Singapore', country:'SG', state:'Singapore' },

  // ── UK ─────────────────────────────────────────────────────────────────
  'london':       { city:'London', country:'GB', state:'England' },
  'mayfair':      { city:'London', country:'GB', state:'England' },
  'chelsea':      { city:'London', country:'GB', state:'England' },
  'kensington':   { city:'London', country:'GB', state:'England' },
  'canary wharf': { city:'London', country:'GB', state:'England' },
  'soho':         { city:'London', country:'GB', state:'England' },
  'manchester':   { city:'Manchester', country:'GB', state:'England' },
  'edinburgh':    { city:'Edinburgh', country:'GB', state:'Scotland' },
  'glasgow':      { city:'Glasgow', country:'GB', state:'Scotland' },

  // ── CANADA ─────────────────────────────────────────────────────────────
  'toronto':      { city:'Toronto', country:'CA', state:'Ontario' },
  'north york':   { city:'Toronto', country:'CA', state:'Ontario' },
  'scarborough':  { city:'Toronto', country:'CA', state:'Ontario' },
  'etobicoke':    { city:'Toronto', country:'CA', state:'Ontario' },
  'downtown toronto':{ city:'Toronto', country:'CA', state:'Ontario' },
  'vancouver':    { city:'Vancouver', country:'CA', state:'BC' },
  'burnaby':      { city:'Vancouver', country:'CA', state:'BC' },
  'richmond bc':  { city:'Vancouver', country:'CA', state:'BC' },
  'montreal':     { city:'Montreal', country:'CA', state:'Quebec' },
  'calgary':      { city:'Calgary', country:'CA', state:'Alberta' },
  'ottawa':       { city:'Ottawa', country:'CA', state:'Ontario' },

  // ── USA ────────────────────────────────────────────────────────────────
  'new york':     { city:'New York', country:'US', state:'NY' },
  'manhattan':    { city:'New York', country:'US', state:'NY' },
  'brooklyn':     { city:'New York', country:'US', state:'NY' },
  'los angeles':  { city:'Los Angeles', country:'US', state:'CA' },
  'beverly hills':{ city:'Los Angeles', country:'US', state:'CA' },
  'miami':        { city:'Miami', country:'US', state:'FL' },
  'miami beach':  { city:'Miami', country:'US', state:'FL' },
  'chicago':      { city:'Chicago', country:'US', state:'IL' },
  'san francisco':{ city:'San Francisco', country:'US', state:'CA' },
  'las vegas':    { city:'Las Vegas', country:'US', state:'NV' },
  'houston':      { city:'Houston', country:'US', state:'TX' },
  'dallas':       { city:'Dallas', country:'US', state:'TX' },
  'boston':       { city:'Boston', country:'US', state:'MA' },
  'seattle':      { city:'Seattle', country:'US', state:'WA' },
  'washington dc':{ city:'Washington DC', country:'US', state:'DC' },

  // ── EUROPE ─────────────────────────────────────────────────────────────
  'paris':        { city:'Paris', country:'FR', state:'Ile-de-France' },
  'cannes':       { city:'Cannes', country:'FR', state:'PACA' },
  'monaco':       { city:'Monaco', country:'MC', state:'Monaco' },
  'berlin':       { city:'Berlin', country:'DE', state:'Berlin' },
  'amsterdam':    { city:'Amsterdam', country:'NL', state:'NH' },
  'barcelona':    { city:'Barcelona', country:'ES', state:'Catalonia' },
  'madrid':       { city:'Madrid', country:'ES', state:'Madrid' },
  'rome':         { city:'Rome', country:'IT', state:'Lazio' },
  'milan':        { city:'Milan', country:'IT', state:'Lombardy' },
  'zurich':       { city:'Zurich', country:'CH', state:'Zurich' },
  'geneva':       { city:'Geneva', country:'CH', state:'Geneva' },
};

// Country code → full name map
const COUNTRY_NAMES = {
  IN:'India', AE:'UAE', SG:'Singapore', GB:'United Kingdom', CA:'Canada',
  US:'United States', FR:'France', DE:'Germany', NL:'Netherlands',
  ES:'Spain', IT:'Italy', CH:'Switzerland', MC:'Monaco', AU:'Australia'
};

// ── DETECT LOCATION FROM TEXT ─────────────────────────────────────────────
function detectGlobalLocation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  
  // Sort by length descending — match longer/more specific first
  const keys = Object.keys(GLOBAL_AREAS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) {
      return { area: key, ...GLOBAL_AREAS[key] };
    }
  }
  return null;
}

// ── CHECK IF VENDOR SERVES THIS CITY ─────────────────────────────────────
function vendorServesCity(vendor, city, country) {
  if (!city) return false;
  const vc = (vendor.cities || '').toLowerCase();
  const vs = (vendor.suburbs || '').toLowerCase();
  const cityLower = city.toLowerCase();
  
  // Check if vendor explicitly covers this city
  if (vc.includes(cityLower) || vs.includes(cityLower)) return true;
  
  // Country-level fallback only for nationwide vendors
  if (country && (vc.includes('nationwide') || vc.includes('global') || vc.includes('worldwide'))) return true;
  
  return false;
}

module.exports = { detectGlobalLocation, vendorServesCity, GLOBAL_AREAS, COUNTRY_NAMES };
