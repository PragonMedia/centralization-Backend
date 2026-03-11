/**
 * Accounting service – fetches insights/revenue from Ringba Insights API.
 * Uses credentials from DB (companies collection). POST to /v2/{accountID}/insights with Token auth.
 */
const axios = require("axios");
const RINGBA_API_CONFIG = require("../config/ringbaApi");

const DEFAULT_BASE_URL = (RINGBA_API_CONFIG.BASE_URL || "https://api.ringba.com").replace(/\/$/, "");

/**
 * Default report window: today 4:00 AM UTC to tomorrow 3:59:59.999 UTC (matches Ringba dev console).
 */
function getDefaultReportWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 4, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  end.setUTCHours(3, 59, 59, 999);
  return {
    reportStart: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
    reportEnd: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/**
 * Build insights request body (same shape as Ringba dev console).
 */
function buildInsightsBody(reportStart, reportEnd) {
  const { reportStart: start, reportEnd: end } = reportStart && reportEnd
    ? { reportStart, reportEnd }
    : getDefaultReportWindow();
  return {
    reportStart: start,
    reportEnd: end,
    groupByColumns: [{ column: "campaignName", displayName: "Campaign" }],
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
    filters: [],
    formatTimeZone: "America/New_York",
  };
}

/**
 * Fetch insights (revenue/call data) from Ringba.
 * Uses accountID + apiToken (e.g. from companies collection).
 * @param {Object} options - { accountID, apiToken, reportStart?, reportEnd?, baseUrl? }
 * @returns {Promise<{ success: boolean, report?: object, records?: array, revenue?: number, message?: string }>}
 */
async function getRevenueFromRingba(options = {}) {
  const { accountID, apiToken, reportStart, reportEnd, baseUrl } = options;

  if (!accountID || !apiToken) {
    return {
      success: false,
      message: "Missing accountID or apiToken. Add a company in the companies collection or pass in request.",
    };
  }

  const url = `${baseUrl || DEFAULT_BASE_URL}/v2/${accountID}/insights`;

  try {
    const body = buildInsightsBody(reportStart, reportEnd);
    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiToken}`,
      },
      timeout: 20000,
    });

    const report = response.data?.report;
    const allRecords = report?.records || [];

    // Rollup/total row is the last record when generateRollups is true
    const totalRow =
      allRecords.length > 0
        ? allRecords[allRecords.length - 1]
        : null;
    const recordsOnly = totalRow ? [totalRow] : [];

    const conversionAmountRaw = totalRow?.conversionAmount ?? null;
    const revenue =
      typeof conversionAmountRaw === "number"
        ? conversionAmountRaw
        : parseFloat(conversionAmountRaw) || null;

    return {
      success: true,
      records: recordsOnly,
      conversionAmount: conversionAmountRaw != null ? String(conversionAmountRaw) : null,
      revenue,
      period: { reportStart: body.reportStart, reportEnd: body.reportEnd },
    };
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const message = data?.message ?? data?.error ?? error.message;
    console.warn("Accounting: Ringba insights API error", { status, message });
    return {
      success: false,
      message: status === 401 ? "Invalid Ringba API token." : `Ringba API error: ${message}`,
    };
  }
}

module.exports = {
  getRevenueFromRingba,
  getDefaultReportWindow,
  buildInsightsBody,
};
