/**
 * State Performance service – fetches Ringba Insights grouped by US state.
 * Filters: RCTV channel, qualified=yes, Paragon - Medicare campaign.
 */
const axios = require("axios");
const RINGBA_CONFIG = require("../config/ringbaApi");

const DEFAULT_BASE_URL = (RINGBA_CONFIG.BASE_URL || "https://api.ringba.com").replace(/\/$/, "");
const STATE_WEEKS_COUNT = 8;
const NO_VALUE = "-no value-";

/**
 * Build Ringba Insights request body for state performance report.
 */
function buildStatePerformanceInsightsBody(reportStart, reportEnd) {
  return {
    reportStart,
    reportEnd,
    groupByColumns: [
      { column: "tag:InboundNumber:State", displayName: "InboundNumber:State" },
    ],
    valueColumns: [
      { column: "callCount", aggregateFunction: null },
      { column: "liveCallCount", aggregateFunction: null },
      { column: "completedCalls", aggregateFunction: null },
      { column: "endedCalls", aggregateFunction: null },
      { column: "connectedCallCount", aggregateFunction: null },
      { column: "payoutCount", aggregateFunction: null },
      { column: "convertedCalls", aggregateFunction: null },
      { column: "nonConnectedCallCount", aggregateFunction: null },
      { column: "duplicateCalls", aggregateFunction: null },
      { column: "blockedCalls", aggregateFunction: null },
      { column: "incompleteCalls", aggregateFunction: null },
      { column: "earningsPerCallGross", aggregateFunction: null },
      { column: "conversionAmount", aggregateFunction: null },
      { column: "payoutAmount", aggregateFunction: null },
      { column: "profitGross", aggregateFunction: null },
      { column: "profitMarginGross", aggregateFunction: null },
      { column: "convertedPercent", aggregateFunction: null },
      { column: "callLengthInSeconds", aggregateFunction: null },
      { column: "avgHandleTime", aggregateFunction: null },
      { column: "totalCost", aggregateFunction: null },
    ],
    orderByColumns: [{ column: "callCount", direction: "desc" }],
    formatTimespans: true,
    formatPercentages: true,
    generateRollups: true,
    maxResultsPerGroup: 1000,
    filters: [
      {
        anyConditionToMatch: [
          {
            column: "tag:User:channel",
            value: "RCTV",
            isNegativeMatch: false,
            comparisonType: "EQUALS",
          },
        ],
      },
      {
        anyConditionToMatch: [
          {
            column: "tag:User:qualified",
            value: "yes",
            isNegativeMatch: false,
            comparisonType: "EQUALS",
          },
        ],
      },
      {
        anyConditionToMatch: [
          {
            column: "campaignName",
            value: "Paragon - Medicare",
            isNegativeMatch: false,
            comparisonType: "EQUALS",
          },
        ],
      },
    ],
    formatTimeZone: "America/New_York",
  };
}

/**
 * Format a UTC date as MM/DD/YYYY for week labels.
 */
function formatWeekLabelDate(d) {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const y = d.getUTCFullYear();
  return `${m}/${day}/${y}`;
}

/**
 * Get the Monday 04:00 UTC that starts the Ringba week containing `utcDate`.
 */
function getWeekStartMonday(utcDate) {
  const d = new Date(
    Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate())
  );
  const dayOfWeek = d.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  d.setUTCHours(4, 0, 0, 0);
  return d;
}

/**
 * Build one 7-day window: Mon 04:00 UTC → next Mon 03:59:59 UTC.
 */
function buildWeekWindow(weekStartMonday) {
  const reportStart = weekStartMonday.toISOString().replace(/\.\d{3}Z$/, "Z");
  const weekEnd = new Date(weekStartMonday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  weekEnd.setUTCHours(3, 59, 59, 0);
  const reportEnd = weekEnd.toISOString().replace(/\.\d{3}Z$/, "Z");

  const labelStart = new Date(weekStartMonday);
  labelStart.setUTCHours(0, 0, 0, 0);
  const labelEnd = new Date(labelStart);
  labelEnd.setUTCDate(labelEnd.getUTCDate() + 6);

  return {
    reportStart,
    reportEnd,
    weekLabel: `${formatWeekLabelDate(labelStart)} - ${formatWeekLabelDate(labelEnd)}`,
  };
}

/**
 * Return 8 consecutive completed weekly windows (oldest first).
 * Each window = Mon 04:00 UTC → next Mon 03:59:59 UTC.
 */
function getStatePerformanceWeekWindows(count = STATE_WEEKS_COUNT) {
  const now = new Date();
  const currentWeekStart = getWeekStartMonday(now);
  const mostRecentCompletedWeekStart = new Date(currentWeekStart);
  mostRecentCompletedWeekStart.setUTCDate(mostRecentCompletedWeekStart.getUTCDate() - 7);

  const weeks = [];
  for (let i = count - 1; i >= 0; i--) {
    const weekStart = new Date(mostRecentCompletedWeekStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - i * 7);
    weeks.push(buildWeekWindow(weekStart));
  }
  return weeks;
}

/**
 * Clean Ringba records to state, earningsPerCallGross, callCount only.
 * Skips rollup row (last record when generateRollups is true).
 */
function cleanStatePerformanceRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return [];

  const dataRecords = records.length > 1 ? records.slice(0, -1) : records;

  return dataRecords
    .map((r) => {
      const state = r["tag:InboundNumber:State"] != null ? String(r["tag:InboundNumber:State"]).trim() : "";
      return {
        state,
        earningsPerCallGross: Number(r.earningsPerCallGross) || 0,
        callCount: Number(r.callCount) || 0,
      };
    })
    .filter((r) => r.state && r.state !== NO_VALUE);
}

/**
 * Fetch state performance from Ringba for one week window.
 */
async function fetchStatePerformanceFromRingba(options = {}) {
  const { accountID, apiToken, reportStart, reportEnd, baseUrl } = options;

  const tokenToUse = (apiToken && String(apiToken).trim()) || "";
  if (!accountID || !tokenToUse) {
    return {
      success: false,
      message: "Missing accountID or apiToken.",
    };
  }

  const url = `${baseUrl || DEFAULT_BASE_URL}/v2/${accountID}/insights`;

  try {
    const body = buildStatePerformanceInsightsBody(reportStart, reportEnd);
    const authHeader =
      process.env.RINGBA_AUTH_SCHEME === "Bearer"
        ? `Bearer ${tokenToUse}`
        : `Token ${tokenToUse}`;

    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      timeout: 20000,
    });

    const data = response.data;
    const first = Array.isArray(data) ? data[0] : data;
    const report = first?.report;
    const allRecords = report?.records || [];

    const states = cleanStatePerformanceRecords(allRecords);

    return {
      success: true,
      reportStart,
      reportEnd,
      rawRecordCount: allRecords.length,
      states,
    };
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    console.error("StatePerformance: Ringba fetch failed", {
      status,
      message: error.message,
      data: data != null ? (typeof data === "string" ? data : JSON.stringify(data).slice(0, 500)) : undefined,
    });
    return {
      success: false,
      message: error.message || "Ringba request failed",
      reportStart,
      reportEnd,
    };
  }
}

/**
 * Fetch all weekly windows sequentially and aggregate results.
 */
async function fetchAllWeeksStatePerformance(options = {}) {
  const { accountID, apiToken, baseUrl, weekCount = STATE_WEEKS_COUNT } = options;
  const windows = getStatePerformanceWeekWindows(weekCount);
  const weeks = [];

  for (const window of windows) {
    const result = await fetchStatePerformanceFromRingba({
      accountID,
      apiToken,
      reportStart: window.reportStart,
      reportEnd: window.reportEnd,
      baseUrl,
    });

    const weekData = {
      weekStart: window.reportStart,
      weekEnd: window.reportEnd,
      weekLabel: window.weekLabel,
      success: result.success,
      rawRecordCount: result.rawRecordCount || 0,
      states: result.states || [],
      message: result.message,
    };

    console.log("StatePerformance week:", {
      weekLabel: weekData.weekLabel,
      rawRecordCount: weekData.rawRecordCount,
      stateCount: weekData.states.length,
      topStates: weekData.states.slice(0, 5),
    });

    weeks.push(weekData);
  }

  const totalStates = weeks.reduce((sum, w) => sum + w.states.length, 0);
  const payload = {
    success: weeks.every((w) => w.success),
    weeks,
    summary: {
      weeksFetched: weeks.length,
      totalStates,
      failedWeeks: weeks.filter((w) => !w.success).map((w) => w.weekLabel),
    },
  };

  console.log("StatePerformance fetch complete:", payload.summary);

  return payload;
}

module.exports = {
  STATE_WEEKS_COUNT,
  buildStatePerformanceInsightsBody,
  getStatePerformanceWeekWindows,
  cleanStatePerformanceRecords,
  fetchStatePerformanceFromRingba,
  fetchAllWeeksStatePerformance,
};
