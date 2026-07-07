'use strict';

// Country to currency mapping
const COUNTRY_CURRENCY = {
  AU: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  IN: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  AE: { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  SG: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  GB: { code: 'GBP', symbol: '£', name: 'British Pound' },
  CA: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  US: { code: 'USD', symbol: 'US$', name: 'US Dollar' },
  FR: { code: 'EUR', symbol: '€', name: 'Euro' },
  DE: { code: 'EUR', symbol: '€', name: 'Euro' },
  NL: { code: 'EUR', symbol: '€', name: 'Euro' },
  ES: { code: 'EUR', symbol: '€', name: 'Euro' },
  IT: { code: 'EUR', symbol: '€', name: 'Euro' },
  CH: { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  NZ: { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  JP: { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  HK: { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  TH: { code: 'THB', symbol: '฿', name: 'Thai Baht' },
};

const CITY_COUNTRY = {
  'Sydney': 'AU', 'Melbourne': 'AU', 'Brisbane': 'AU', 'Perth': 'AU',
  'Mumbai': 'IN', 'Delhi': 'IN', 'Bangalore': 'IN', 'Chennai': 'IN',
  'Hyderabad': 'IN', 'Pune': 'IN', 'Kolkata': 'IN',
  'Dubai': 'AE', 'Abu Dhabi': 'AE', 'Sharjah': 'AE',
  'Singapore': 'SG',
  'London': 'GB', 'Manchester': 'GB', 'Edinburgh': 'GB',
  'Toronto': 'CA', 'Vancouver': 'CA', 'Montreal': 'CA',
  'New York': 'US', 'Los Angeles': 'US', 'Miami': 'US', 'Chicago': 'US',
  'Paris': 'FR', 'Berlin': 'DE', 'Amsterdam': 'NL',
  'Barcelona': 'ES', 'Madrid': 'ES', 'Rome': 'IT', 'Milan': 'IT',
  'Zurich': 'CH', 'Geneva': 'CH',
};

// Fetch live exchange rates from free API
async function getLiveRates(baseCurrency) {
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/' + baseCurrency);
    if (!r.ok) throw new Error('Rate fetch failed');
    const d = await r.json();
    return d.rates;
  } catch(e) {
    console.error('[CURRENCY] Live rates failed, using fallback:', e.message);
    // Fallback rates (approximate, updated periodically)
    const FALLBACK = {
      AUD: 1,
      INR: 55.0,   // 1 AUD ≈ 55 INR
      AED: 2.45,   // 1 AUD ≈ 2.45 AED
      SGD: 1.05,   // 1 AUD ≈ 1.05 SGD
      GBP: 0.52,   // 1 AUD ≈ 0.52 GBP
      CAD: 0.90,   // 1 AUD ≈ 0.90 CAD
      USD: 0.65,   // 1 AUD ≈ 0.65 USD
      EUR: 0.60,   // 1 AUD ≈ 0.60 EUR
      CHF: 0.58,   // 1 AUD ≈ 0.58 CHF
      NZD: 1.09,   // 1 AUD ≈ 1.09 NZD
    };
    return FALLBACK;
  }
}

// Convert vendor local currency to AUD (what member pays)
async function convertToAUD(amount, fromCurrency) {
  if (fromCurrency === 'AUD') return { aud: amount, rate: 1, display: 'A$' + amount.toFixed(2) };
  try {
    const rates = await getLiveRates('AUD');
    const rate = rates[fromCurrency];
    if (!rate) throw new Error('No rate for ' + fromCurrency);
    const aud = amount / rate;
    return {
      aud: Math.round(aud * 100) / 100,
      rate,
      localAmount: amount,
      localCurrency: fromCurrency,
      display: 'A$' + aud.toFixed(2) + ' (approx. ' + fromCurrency + ' ' + amount.toFixed(0) + ')'
    };
  } catch(e) {
    console.error('[CURRENCY]', e.message);
    return { aud: amount, rate: 1, display: 'A$' + amount.toFixed(2), error: e.message };
  }
}

// Convert AUD to local currency (what vendor sees)
async function convertFromAUD(audAmount, toCurrency, city) {
  const country = city ? CITY_COUNTRY[city] : null;
  const currency = COUNTRY_CURRENCY[country] || COUNTRY_CURRENCY['AU'];
  const targetCurrency = toCurrency || currency.code;
  
  if (targetCurrency === 'AUD') return { local: audAmount, currency: 'AUD', symbol: 'A$', display: 'A$' + audAmount.toFixed(2) };
  
  try {
    const rates = await getLiveRates('AUD');
    const rate = rates[targetCurrency];
    if (!rate) throw new Error('No rate for ' + targetCurrency);
    const local = audAmount * rate;
    const sym = COUNTRY_CURRENCY[country]?.symbol || targetCurrency;
    return {
      local: Math.round(local),
      currency: targetCurrency,
      symbol: sym,
      rate,
      display: sym + Math.round(local).toLocaleString()
    };
  } catch(e) {
    return { local: audAmount, currency: 'AUD', symbol: 'A$', display: 'A$' + audAmount.toFixed(2) };
  }
}

// Get currency info for a city
function getCurrencyForCity(city) {
  const country = CITY_COUNTRY[city] || 'AU';
  return COUNTRY_CURRENCY[country] || COUNTRY_CURRENCY['AU'];
}

// Add international fee (20%) and convert
async function calculateMemberPrice(vendorQuoteLocal, vendorCurrency, city) {
  // Convert vendor quote to AUD
  const base = await convertToAUD(vendorQuoteLocal, vendorCurrency);
  // Add 20% international service fee
  const withFee = base.aud * 1.20;
  return {
    vendorQuoteLocal: vendorQuoteLocal,
    vendorCurrency,
    baseAUD: base.aud,
    feeAUD: Math.round((withFee - base.aud) * 100) / 100,
    totalAUD: Math.round(withFee * 100) / 100,
    rate: base.rate,
    display: 'A$' + withFee.toFixed(2) + ' (incl. 20% international service fee)',
    breakdown: vendorCurrency !== 'AUD'
      ? vendorCurrency + ' ' + vendorQuoteLocal + ' + 20% fee = A$' + withFee.toFixed(2)
      : 'A$' + withFee.toFixed(2)
  };
}

module.exports = { convertToAUD, convertFromAUD, getCurrencyForCity, calculateMemberPrice, COUNTRY_CURRENCY, CITY_COUNTRY, getLiveRates };
