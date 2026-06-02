/**
 * State Performance cache – Ringba fetch + Mongo snapshot in `statePerformance` collection.
 * Credentials from .env via config/ringbaApi.js. Does not use accounting collections.
 */
const StatePerformanceCache = require("../models/statePerformanceCacheModel");
const RINGBA_CONFIG = require("../config/ringbaApi");
const statePerformanceService = require("./statePerformanceService");

function resolveRingbaCredentials() {
  const accountID = RINGBA_CONFIG.ACCOUNT_ID;
  const apiToken = RINGBA_CONFIG.API_KEY;
  const baseUrl = RINGBA_CONFIG.BASE_URL.replace(/\/$/, "");

  if (!accountID || !apiToken) {
    return {
      success: false,
      message: "Missing RINGBA_ACCOUNT_ID or RINGBA_API_KEY / RINGBA_API_TOKEN in .env.",
    };
  }

  return {
    success: true,
    accountID,
    apiToken,
    baseUrl,
  };
}

async function getLatestStatePerformanceCache() {
  return StatePerformanceCache.findOne({ cacheKey: "latest" }).lean();
}

/**
 * Fetch from Ringba, overwrite `statePerformance` collection with latest snapshot.
 */
async function refreshStatePerformanceCache(options = {}) {
  const trigger = (options.trigger || "manual").trim() || "manual";

  const creds = resolveRingbaCredentials();
  if (!creds.success) {
    return { success: false, message: creds.message };
  }

  const windowData = statePerformanceService.getRollingTwoMonthWindow();
  const payload = await statePerformanceService.fetchAllDaysStatePerformance({
    accountID: creds.accountID,
    apiToken: creds.apiToken,
    baseUrl: creds.baseUrl,
    startDate: windowData.startDate,
    endDate: windowData.endDate,
    endDateTimeIso: windowData.endDateTimeIso,
  });

  console.log("StatePerformance cache refresh summary:", payload.summary);

  const firstDay = payload.days?.[0];
  const lastDay = payload.days?.[payload.days.length - 1];

  await StatePerformanceCache.deleteMany({});
  const cache = await StatePerformanceCache.create({
    cacheKey: "latest",
    windowStart: firstDay ? new Date(firstDay.reportStart) : new Date(`${windowData.startDate}T00:00:00.000Z`),
    windowEnd: lastDay ? new Date(lastDay.reportEnd) : new Date(windowData.endDateTimeIso),
    timezone: "America/New_York",
    trigger,
    refreshedAt: new Date(),
    payload,
  });

  return {
    success: payload.success,
    payload,
    cache,
    trigger,
    windowStart: firstDay?.reportStart || `${windowData.startDate}T00:00:00Z`,
    windowEnd: lastDay?.reportEnd || windowData.endDateTimeIso,
  };
}

module.exports = {
  resolveRingbaCredentials,
  getLatestStatePerformanceCache,
  refreshStatePerformanceCache,
};