'use strict';

// City to timezone mapping
const CITY_TIMEZONES = {
  // Australia
  'Sydney': 'Australia/Sydney', 'Melbourne': 'Australia/Melbourne',
  'Brisbane': 'Australia/Brisbane', 'Perth': 'Australia/Perth',
  'Adelaide': 'Australia/Adelaide', 'Canberra': 'Australia/Sydney',
  // India
  'Mumbai': 'Asia/Kolkata', 'Delhi': 'Asia/Kolkata',
  'Bangalore': 'Asia/Kolkata', 'Chennai': 'Asia/Kolkata',
  'Hyderabad': 'Asia/Kolkata', 'Kolkata': 'Asia/Kolkata',
  'Pune': 'Asia/Kolkata',
  // UAE
  'Dubai': 'Asia/Dubai', 'Abu Dhabi': 'Asia/Dubai',
  // Singapore
  'Singapore': 'Asia/Singapore',
  // UK
  'London': 'Europe/London',
  // Canada
  'Toronto': 'America/Toronto', 'Vancouver': 'America/Vancouver',
  'Montreal': 'America/Montreal',
  // USA
  'New York': 'America/New_York', 'Los Angeles': 'America/Los_Angeles',
  'Miami': 'America/New_York', 'Chicago': 'America/Chicago',
  'San Francisco': 'America/Los_Angeles',
  // Europe
  'Paris': 'Europe/Paris', 'Berlin': 'Europe/Berlin',
  'Amsterdam': 'Europe/Amsterdam', 'Rome': 'Europe/Rome',
  'Barcelona': 'Europe/Madrid', 'Madrid': 'Europe/Madrid',
  'Zurich': 'Europe/Zurich', 'Geneva': 'Europe/Zurich',
};

// Business categories with typical operating hours
const CATEGORY_HOURS = {
  CAKE_SHOP:   { open: 9,  close: 20, days: [1,2,3,4,5,6,0] }, // 9am-8pm all week
  BAKERY:      { open: 6,  close: 20, days: [1,2,3,4,5,6,0] }, // 6am-8pm (bakers start early)
  FLORIST:     { open: 8,  close: 19, days: [1,2,3,4,5,6,0] }, // 8am-7pm
  GIFT:        { open: 9,  close: 21, days: [1,2,3,4,5,6,0] }, // 9am-9pm
  GROCERY:     { open: 6,  close: 23, days: [1,2,3,4,5,6,0] }, // 6am-11pm
  PHARMACY:    { open: 8,  close: 22, days: [1,2,3,4,5,6,0] }, // 8am-10pm
  DINING:      { open: 11, close: 23, days: [1,2,3,4,5,6,0] }, // 11am-11pm
  TRANSPORT:   { open: 0,  close: 24, days: [1,2,3,4,5,6,0] }, // 24/7
  HOTEL:       { open: 0,  close: 24, days: [1,2,3,4,5,6,0] }, // 24/7
  AVIATION:    { open: 0,  close: 24, days: [1,2,3,4,5,6,0] }, // 24/7
  MEDICAL:     { open: 0,  close: 24, days: [1,2,3,4,5,6,0] }, // 24/7
  HOME:        { open: 7,  close: 21, days: [1,2,3,4,5,6,0] }, // 7am-9pm
  PROCUREMENT: { open: 9,  close: 20, days: [1,2,3,4,5,6,0] }, // 9am-8pm
};

function getLocalHour(city) {
  const tz = CITY_TIMEZONES[city] || 'Australia/Sydney';
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return local.getHours() + local.getMinutes() / 60;
}

function getLocalDay(city) {
  const tz = CITY_TIMEZONES[city] || 'Australia/Sydney';
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return local.getDay(); // 0=Sun, 1=Mon...6=Sat
}

function isBusinessOpen(city, category, subcategory) {
  const hour = getLocalHour(city);
  const day = getLocalDay(city);
  const cat = subcategory || category || 'PROCUREMENT';
  const hours = CATEGORY_HOURS[cat] || CATEGORY_HOURS['PROCUREMENT'];
  const isOpenHour = hour >= hours.open && hour < hours.close;
  const isOpenDay = hours.days.includes(day);
  return isOpenHour && isOpenDay;
}

function getNextOpenTime(city, category, subcategory) {
  const tz = CITY_TIMEZONES[city] || 'Australia/Sydney';
  const cat = subcategory || category || 'PROCUREMENT';
  const hours = CATEGORY_HOURS[cat] || CATEGORY_HOURS['PROCUREMENT'];
  const localHour = getLocalHour(city);
  
  if (localHour < hours.open) {
    const minsUntil = Math.round((hours.open - localHour) * 60);
    const h = Math.floor(minsUntil / 60);
    const m = minsUntil % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} minutes`;
  }
  // After closing — opens tomorrow
  return `tomorrow at ${hours.open}:00am`;
}

function getSchedulingAdvice(city, category, subcategory) {
  const open = isBusinessOpen(city, category, subcategory);
  const cat = subcategory || category;
  const localHour = getLocalHour(city);
  const tz = CITY_TIMEZONES[city] || 'Australia/Sydney';
  const localTime = new Date().toLocaleString('en-US', { 
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true 
  });

  return {
    isOpen: open,
    localTime,
    city,
    category: cat,
    nextOpen: open ? null : getNextOpenTime(city, category, subcategory),
    message: open 
      ? `Vendors in ${city} are open now (${localTime} local time)` 
      : `It is currently ${localTime} in ${city} — ${cat.toLowerCase().replace(/_/g,' ')} vendors are likely closed. They will open in ${getNextOpenTime(city, category, subcategory)}.`
  };
}

module.exports = { isBusinessOpen, getNextOpenTime, getSchedulingAdvice, getLocalHour, CITY_TIMEZONES };
