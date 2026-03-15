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
 * Build insights request body (same shape as Ringba API: groupBy buyer).
 * Ringba expects payload as an array with one object.
 */
function buildInsightsBody(reportStart, reportEnd) {
  const { reportStart: start, reportEnd: end } = reportStart && reportEnd
    ? { reportStart, reportEnd }
    : getDefaultReportWindow();
  return {
    reportStart: start,
    reportEnd: end,
    groupByColumns: [{ column: "buyer", displayName: "Buyer" }],
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
 * Get 7 calendar days in UTC: today-6 through today (oldest first).
 * Each element is { date (Date at 00:00 UTC), dayLabel: "MM/DD/YYYY", isToday: boolean }.
 */
function getLastSevenDaysUTC() {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayUTC);
    d.setUTCDate(d.getUTCDate() - i);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const dayLabel = `${String(m + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}/${y}`;
    const isToday = i === 0;
    out.push({ date: d, dayLabel, isToday });
  }
  return out;
}

/**
 * Parse a date string (YYYY-MM-DD or ISO) to UTC date at midnight. Returns null if invalid.
 */
function parseUTCDate(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Get calendar days from start to end inclusive (UTC). Each is { date, dayLabel: "MM/DD/YYYY", isToday }.
 */
function getDaysInRangeUTC(startStr, endStr) {
  const startDate = parseUTCDate(startStr);
  const endDate = parseUTCDate(endStr);
  if (!startDate || !endDate || endDate < startDate) return null;
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const out = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const day = cur.getUTCDate();
    const dayLabel = `${String(m + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}/${y}`;
    const isToday = cur.getTime() === todayUTC.getTime();
    out.push({ date: new Date(cur), dayLabel, isToday });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Ringba report day = 4:00 AM UTC on that date through 3:59:59.999 UTC next day.
 */
function getRingbaDayWindow(utcDate) {
  const y = utcDate.getUTCFullYear();
  const m = utcDate.getUTCMonth();
  const d = utcDate.getUTCDate();
  const reportStart = new Date(Date.UTC(y, m, d, 4, 0, 0, 0));
  const reportEnd = new Date(Date.UTC(y, m, d + 1, 3, 59, 59, 999));
  return {
    reportStart: reportStart.toISOString().replace(/\.\d{3}Z$/, "Z"),
    reportEnd: reportEnd.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/**
 * Fetch revenue for the last 7 days (today-6 through today). Only completed days get Ringba data; today gets revenue "".
 * @param {Object} options - { accountID, apiToken, baseUrl? }
 * @returns {Promise<{ success: boolean, revenueByDay?: Array<{ day: string, revenue: number|"" }>, message?: string }>}
 */
async function getRevenueWeekFromRingba(options = {}) {
  const { accountID, apiToken, baseUrl } = options;
  if (!accountID || !apiToken) {
    return {
      success: false,
      message: "Missing accountID or apiToken.",
    };
  }
  const days = getLastSevenDaysUTC();
  const revenueByDay = [];
  for (const { date, dayLabel, isToday } of days) {
    if (isToday) {
      revenueByDay.push({ day: dayLabel, revenue: "", records: [] });
      continue;
    }
    const { reportStart, reportEnd } = getRingbaDayWindow(date);
    const result = await getRevenueFromRingba({
      accountID,
      apiToken,
      reportStart,
      reportEnd,
      baseUrl,
    });
    const revenue =
      result.success && result.revenue != null ? result.revenue : "";
    const records = result.success && Array.isArray(result.records) ? result.records : [];
    revenueByDay.push({ day: dayLabel, revenue, records });
  }
  return { success: true, revenueByDay };
}

/**
 * Fetch revenue for a date range (start through end inclusive). Today (UTC) gets revenue "" and records [].
 * @param {Object} options - { accountID, apiToken, start: "YYYY-MM-DD", end: "YYYY-MM-DD", baseUrl? }
 * @returns {Promise<{ success: boolean, revenueByDay?: Array<{ day: string, revenue: number|"", records: Array<{ buyer, conversionAmount }> }>, message?: string }>}
 */
async function getRevenueRangeFromRingba(options = {}) {
  const { accountID, apiToken, start, end, baseUrl } = options;
  if (!accountID || !apiToken) {
    return {
      success: false,
      message: "Missing accountID or apiToken.",
    };
  }
  const days = getDaysInRangeUTC(start, end);
  if (!days || days.length === 0) {
    return {
      success: false,
      message: "Invalid or empty date range. Use start and end as YYYY-MM-DD with end >= start.",
    };
  }
  const revenueByDay = [];
  for (const { date, dayLabel, isToday } of days) {
    if (isToday) {
      revenueByDay.push({ day: dayLabel, revenue: "", records: [] });
      continue;
    }
    const { reportStart, reportEnd } = getRingbaDayWindow(date);
    const result = await getRevenueFromRingba({
      accountID,
      apiToken,
      reportStart,
      reportEnd,
      baseUrl,
    });
    if (!result.success) {
      console.warn("Accounting: Ringba day failed", { day: dayLabel, message: result.message });
    }
    const revenue =
      result.success && result.revenue != null ? result.revenue : "";
    const records = result.success && Array.isArray(result.records) ? result.records : [];
    revenueByDay.push({ day: dayLabel, revenue, records });
  }
  return { success: true, revenueByDay };
}

/**
 * Fetch insights (revenue/call data) from Ringba.
 * Uses accountID + apiToken (e.g. from companies collection).
 * @param {Object} options - { accountID, apiToken, reportStart?, reportEnd?, baseUrl? }
 * @returns {Promise<{ success: boolean, report?: object, records?: array, revenue?: number, message?: string }>}
 */
async function getRevenueFromRingba(options = {}) {
  const { accountID, apiToken, reportStart, reportEnd, baseUrl } = options;

  const tokenToUse = (apiToken && String(apiToken).trim()) || "";
  if (!accountID || !tokenToUse) {
    console.warn("Accounting: Ringba missing credentials", { hasAccountId: !!accountID, hasToken: !!tokenToUse });
    return {
      success: false,
      message: "Missing accountID or apiToken. Add a company in the companies collection or set RINGBA_API_KEY in .env.",
    };
  }

  const url = `${baseUrl || DEFAULT_BASE_URL}/v2/${accountID}/insights`;

  try {
    const body = buildInsightsBody(reportStart, reportEnd);
    // Ringba Insights: send single object (matches working script: axios.post(url, body, ...))
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
    // Response can be single object { isSuccessful, report: { records } } or array [ { isSuccessful, report } ]
    const first = Array.isArray(data) ? data[0] : data;
    const report = first?.report;
    const allRecords = report?.records || [];

    if (allRecords.length === 0) {
      const isOk = first?.isSuccessful ?? data?.isSuccessful;
      console.warn("Accounting: Ringba insights no records", {
        status: response.status,
        isSuccessful: isOk,
        dataKeys: Array.isArray(data) ? ["array", data.length] : Object.keys(data || {}),
        reportKeys: report ? Object.keys(report) : "no report",
      });
    }

    // Rollup/total row is the last record when generateRollups is true
    const totalRow =
      allRecords.length > 0
        ? allRecords[allRecords.length - 1]
        : null;
    const conversionAmountRaw = totalRow?.conversionAmount ?? null;
    const revenue =
      typeof conversionAmountRaw === "number"
        ? conversionAmountRaw
        : parseFloat(conversionAmountRaw) || null;

    // Records as { buyer, conversionAmount }; exclude "-no value-" and empty buyer
    const NO_VALUE = "-no value-";
    const records = allRecords
      .map((r) => ({
        buyer: r.buyer != null ? r.buyer : "",
        conversionAmount: r.conversionAmount != null ? r.conversionAmount : "",
      }))
      .filter((r) => r.buyer !== NO_VALUE && String(r.buyer).trim() !== "");

    return {
      success: true,
      records,
      conversionAmount: conversionAmountRaw != null ? String(conversionAmountRaw) : null,
      revenue,
      period: { reportStart: body.reportStart, reportEnd: body.reportEnd },
    };
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const message = data?.message ?? data?.error ?? error.message;
    console.warn("Accounting: Ringba insights API error", {
      status,
      message,
      url: error.config?.url,
    });
    return {
      success: false,
      message: status === 401 ? "Invalid Ringba API token." : `Ringba API error: ${message}`,
    };
  }
}

module.exports = {
  getRevenueFromRingba,
  getRevenueWeekFromRingba,
  getRevenueRangeFromRingba,
  getDaysInRangeUTC,
  getDefaultReportWindow,
  buildInsightsBody,
};
