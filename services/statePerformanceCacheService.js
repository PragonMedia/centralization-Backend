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

  const payload = await statePerformanceService.fetchAllWeeksStatePerformance({
    accountID: creds.accountID,
    apiToken: creds.apiToken,
    baseUrl: creds.baseUrl,
  });

  console.log("StatePerformance cache refresh summary:", payload.summary);

  const firstWeek = payload.weeks[0];
  const lastWeek = payload.weeks[payload.weeks.length - 1];

  await StatePerformanceCache.deleteMany({});
  const cache = await StatePerformanceCache.create({
    cacheKey: "latest",
    windowStart: firstWeek ? new Date(firstWeek.weekStart) : new Date(),
    windowEnd: lastWeek ? new Date(lastWeek.weekEnd) : new Date(),
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
    windowStart: firstWeek?.weekStart || null,
    windowEnd: lastWeek?.weekEnd || null,
  };
}

module.exports = {
  resolveRingbaCredentials,
  getLatestStatePerformanceCache,
  refreshStatePerformanceCache,
};
