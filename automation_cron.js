'use strict';
require('dotenv').config();
const {
  recoverAbandonedRequests,
  runWinBack,
  runRenewalIntervention,
  runInactiveReengagement,
  runLoyaltyUpgrades,
  runVendorPerformanceCheck,
  runSmartBroadcast,
  runOnboardingSequence,
  runAutoPaymentRelease,
  sendDailyHealthReport
} = require('./Cipher/server/services/automation_engine');

const job = process.argv[2];
console.log('[CRON]', new Date().toISOString(), 'Running:', job);

const jobs = {
  'health-report':     sendDailyHealthReport,
  'abandoned':         recoverAbandonedRequests,
  'win-back':          runWinBack,
  'renewal':           runRenewalIntervention,
  'inactive':          runInactiveReengagement,
  'loyalty':           runLoyaltyUpgrades,
  'vendor-score':      runVendorPerformanceCheck,
  'smart-broadcast':   runSmartBroadcast,
  'onboarding':        runOnboardingSequence,
  'auto-release':      runAutoPaymentRelease,
};

if (!job || !jobs[job]) {
  console.log('Available jobs:', Object.keys(jobs).join(', '));
  process.exit(1);
}

jobs[job]()
  .then(() => { console.log('[CRON]', job, 'completed'); process.exit(0); })
  .catch(e => { console.error('[CRON ERROR]', e.message); process.exit(1); });

// Advanced automation jobs
const adv = require('./Cipher/server/services/advanced_automation');
const advJobs = {
  'birthday':              adv.runBirthdayAnniversaryCheck,
  'sla-check':             adv.runSLACheck,
  'churn':                 adv.runChurnPrediction,
  'revenue-forecast':      adv.runRevenueForecast,
  'demand-heatmap':        adv.runDemandHeatmapReport,
  'seasonal':              adv.runSeasonalForecast,
  'vendor-capacity-reset': adv.resetWeeklyVendorCapacity,
  'fx-refresh':            adv.getFxRates,
};
Object.assign(jobs, advJobs);

// Intelligence layer jobs
const intel = require('./Cipher/server/services/intelligence_layer');
const intelJobs = {
  'conv-insights':   intel.weeklyInsightReport,
  'corporate-intel': intel.runCorporateIntelligenceReport,
  'city-launch':     intel.checkCityLaunchTrigger,
};
Object.assign(jobs, intelJobs);

// Wave 7 jobs
const w7 = require('./Cipher/server/services/wave7_automation');
const w7Jobs = {
  'weekly-digest':    w7.runWeeklyDigest,
  'smart-redispatch': w7.runSmartRedispatch,
  'predictive':       w7.runPredictiveEngine,
  'annual-reviews':   w7.runAnnualReviews,
  'vendor-gaps':      w7.checkVendorGaps,
  'competitor-intel': w7.runCompetitorIntelligence,
};
Object.assign(jobs, w7Jobs);

// Wave 8 jobs
const w8 = require('./Cipher/server/services/wave8_automation');
const w8Jobs = {
  'credits-expiry':    w8.runCreditsExpiryCheck,
  'asset-reminders':   w8.runAssetReminders,
  'vendor-bonus':      w8.runVendorBonusCheck,
  'pr-milestones':     w8.checkAndFirePRMilestones,
  'event-calendar':    w8.runEventCalendarCuration,
  'waitlist-priority': w8.sendWaitlistPriorityOffer,
};
Object.assign(jobs, w8Jobs);

// Wave 9 jobs
const w9 = require('./Cipher/server/services/wave9_automation');
const w9Jobs = {
  'weekly-content':    w9.generateWeeklyContent,
  'dna-profiles':      w9.runDNAProfilesForAll,
  'vendor-health-all': w9.runAllVendorHealthScores,
};
Object.assign(jobs, w9Jobs);

// Unregistered vendor expiry check
const uvSvc = require('./Cipher/server/services/unregistered_vendor');
jobs['expired-vendor-check'] = uvSvc.runExpiredVendorCheck;

// Operations engine jobs
const opsEngine = require('./Cipher/server/services/operations_engine');
const opsJobs = {
  'health-check':       opsEngine.runDailyHealthCheck,
  'proactive-checkins': opsEngine.runProactiveCheckins,
};
Object.assign(jobs, opsJobs);
