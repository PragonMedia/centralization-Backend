/**
 * Accounting service – fetches insights/revenue from Ringba Insights API.
 * Uses credentials from DB (companies collection). POST to /v2/{accountID}/insights with Token auth.
 */
const axios = require("axios");
const RINGBA_API_CONFIG = require("../config/ringbaApi");

const DEFAULT_BASE_URL = (RINGBA_API_CONFIG.BASE_URL || "https://api.ringba.com").replace(/\/$/, "");
const RETREAVER_BASE_URL = (process.env.RETREAVER_API_BASE_URL || "https://api.retreaver.com").replace(/\/$/, "");
const RETREAVER_API_KEY = (process.env.RETREAVER_API_KEY || "").trim();
const RETREAVER_MAX_PAGES = Number(process.env.RETREAVER_MAX_PAGES || 50);

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
 * Build insights request body for buyer accounts (e.g. DigiPeak).
 * groupBy campaignName, payout-focused columns; rollup last record has payoutAmount.
 */
function buildInsightsBodyBuyer(reportStart, reportEnd) {
  const { reportStart: start, reportEnd: end } = reportStart && reportEnd
    ? { reportStart, reportEnd }
    : getDefaultReportWindow();
  return {
    reportStart: start,
    reportEnd: end,
    groupByColumns: [{ column: "campaignName", displayName: "Campaign" }],
    valueColumns: [
      { column: "callCount", aggregateFunction: null },
      { column: "completedCalls", aggregateFunction: null },
      { column: "endedCalls", aggregateFunction: null },
      { column: "payoutCount", aggregateFunction: null },
      { column: "duplicateCalls", aggregateFunction: null },
      { column: "payoutPerCall", aggregateFunction: null },
      { column: "payoutAmount", aggregateFunction: null },
      { column: "callLengthInSeconds", aggregateFunction: null },
      { column: "avgHandleTime", aggregateFunction: null },
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

function toRetreaverDateTime(isoString) {
  return String(isoString || "")
    .replace(/\.\d{3}Z$/, "+00:00")
    .replace(/Z$/, "+00:00");
}

function normalizeRetrieverBuyerLabel(value) {
  if (value == null) return "";
  const trimmed = String(value).trim();
  return trimmed;
}

function getRetrieverBuyerLabel(call) {
  const afidLabel = normalizeRetrieverBuyerLabel(call?.afid);
  if (afidLabel) return afidLabel;

  const affiliateIdLabel = normalizeRetrieverBuyerLabel(call?.affiliate_id);
  if (affiliateIdLabel) return affiliateIdLabel;

  const targetLabel = normalizeRetrieverBuyerLabel(
    call?.target_id ?? call?.system_target_id
  );
  if (targetLabel) return targetLabel;

  const campaignLabel = normalizeRetrieverBuyerLabel(
    call?.campaign_id ?? call?.system_campaign_id
  );
  if (campaignLabel) return campaignLabel;

  return "retriever";
}

/**
 * Normalize buyer name for matching: lowercase and remove spaces.
 * e.g. "Digi Peak" / "DIGIPEAK" / "digi peak" -> "digipeak".
 */
function normalizeBuyerName(name) {
  if (!name || typeof name !== "string") return "";
  return name.toLowerCase().replace(/\s+/g, "");
}

async function getBuyerComparisonRevenueForDay(options = {}) {
  const {
    buyerCompany,
    reportStart,
    reportEnd,
    ringbaBaseUrl,
  } = options;

  if (!buyerCompany || !buyerCompany.accountID) return null;
  const platform =
    (typeof buyerCompany.platform === "string"
      ? buyerCompany.platform.trim().toLowerCase()
      : "") || "ringba";

  if (platform === "retriever") {
    const retrieverResult = await getRevenueFromRetreaverDay({
      accountID: buyerCompany.accountID,
      apiKey: buyerCompany.apiToken,
      reportStart,
      reportEnd,
    });
    return retrieverResult.success && retrieverResult.revenue != null
      ? String(retrieverResult.revenue)
      : null;
  }

  const ringbaResult = await getRevenueFromRingba({
    accountID: buyerCompany.accountID,
    apiToken: buyerCompany.apiToken,
    reportStart,
    reportEnd,
    baseUrl: ringbaBaseUrl,
    useBuyerPayload: true,
  });
  return ringbaResult.success && ringbaResult.revenue != null
    ? String(ringbaResult.revenue)
    : null;
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
 * @param {Object} options - { accountID, apiToken, start: "YYYY-MM-DD", end: "YYYY-MM-DD", baseUrl?, buyersIndex? }
 * buyersIndex: optional array of { accountID, apiToken, normalizedName } for buyer Ringba accounts (to compare buyerConversionAmount).
 * @returns {Promise<{ success: boolean, revenueByDay?: Array<{ day: string, revenue: number|"", records: Array<{ buyer, conversionAmount, buyerConversionAmount? }> }>, message?: string }>}
 */
async function getRevenueRangeFromRingba(options = {}) {
  const {
    accountID,
    apiToken,
    start,
    end,
    baseUrl,
    buyersIndex,
    includeTodayLive = false,
    currentReportEnd = "",
  } = options;
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
  const buyerDayCache = new Map();
  for (const { date, dayLabel, isToday } of days) {
    if (isToday && !includeTodayLive) {
      revenueByDay.push({ day: dayLabel, revenue: "", records: [] });
      continue;
    }
    const { reportStart, reportEnd } =
      isToday && includeTodayLive
        ? {
            reportStart: new Date(
              Date.UTC(
                date.getUTCFullYear(),
                date.getUTCMonth(),
                date.getUTCDate(),
                4,
                0,
                0,
                0
              )
            )
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            reportEnd:
              (typeof currentReportEnd === "string" && currentReportEnd.trim()) ||
              new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          }
        : getRingbaDayWindow(date);
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

    let enrichedRecords = records;

    if (Array.isArray(records) && records.length > 0 && Array.isArray(buyersIndex) && buyersIndex.length > 0) {
      enrichedRecords = [];
      for (const r of records) {
        const normalizedBuyer = normalizeBuyerName(r.buyer);
        if (!normalizedBuyer) {
          enrichedRecords.push(r);
          continue;
        }

        const buyerCompany = buyersIndex.find(
          (b) => b.normalizedName === normalizedBuyer && b.accountID !== accountID
        );

        if (!buyerCompany) {
          enrichedRecords.push(r);
          continue;
        }

        const cacheKey = `${buyerCompany.accountID}:${dayLabel}`;
        let buyerRevenue = buyerDayCache.get(cacheKey);

        if (buyerRevenue === undefined) {
          const buyerResult = await getBuyerComparisonRevenueForDay({
            buyerCompany,
            reportStart,
            reportEnd,
            ringbaBaseUrl: baseUrl,
          });
          buyerRevenue = buyerResult;
          buyerDayCache.set(cacheKey, buyerRevenue);
        }

        enrichedRecords.push({
          ...r,
          buyerConversionAmount: buyerRevenue,
        });
      }
    }

    revenueByDay.push({ day: dayLabel, revenue, records: enrichedRecords });
  }
  return { success: true, revenueByDay };
}

async function getRevenueFromRetreaverDay(options = {}) {
  const {
    accountID,
    apiKey,
    reportStart,
    reportEnd,
    baseUrl,
  } = options;

  const envRetreaverKey = (process.env.RETREAVER_API_KEY || RETREAVER_API_KEY || "").trim();
  const keyToUse = (apiKey && String(apiKey).trim()) || envRetreaverKey;
  if (!accountID || !keyToUse) {
    return {
      success: false,
      message: "Missing Retreaver accountID or apiKey.",
    };
  }

  const endpoint = `${baseUrl || RETREAVER_BASE_URL}/calls.json`;
  const createdAtStart = toRetreaverDateTime(reportStart);
  const createdAtEnd = toRetreaverDateTime(reportEnd);

  try {
    const allCalls = [];
    let page = 1;

    while (page <= RETREAVER_MAX_PAGES) {
      const response = await axios.get(endpoint, {
        params: {
          api_key: keyToUse,
          company_id: accountID,
          created_at_start: createdAtStart,
          created_at_end: createdAtEnd,
          sort_by: "created_at",
          order: "asc",
          page,
        },
        timeout: 20000,
      });

      const rows = Array.isArray(response.data) ? response.data : [];
      if (rows.length === 0) break;
      allCalls.push(...rows);
      page += 1;
    }

    let revenue = 0;
    const buyerTotals = new Map();
    for (const row of allCalls) {
      const call = row?.call && typeof row.call === "object" ? row.call : row;
      const payoutRaw = call?.payout;
      const payoutNum =
        typeof payoutRaw === "number"
          ? payoutRaw
          : parseFloat(payoutRaw);
      if (Number.isFinite(payoutNum)) revenue += payoutNum;
      const buyer = getRetrieverBuyerLabel(call);
      const existing = buyerTotals.get(buyer) || 0;
      const increment = Number.isFinite(payoutNum) ? payoutNum : 0;
      buyerTotals.set(buyer, existing + increment);
    }

    const records = Array.from(buyerTotals.entries()).map(([buyer, total]) => ({
      buyer,
      conversionAmount: Number(total.toFixed(4)).toString(),
    }));

    return {
      success: true,
      revenue: Number(revenue.toFixed(2)),
      records,
      period: { reportStart, reportEnd },
    };
  } catch (error) {
    const providedKey = (apiKey && String(apiKey).trim()) || "";
    const fallbackKey = envRetreaverKey;
    const canRetryWithEnv =
      Boolean(providedKey) &&
      Boolean(fallbackKey) &&
      providedKey !== fallbackKey;
    if (canRetryWithEnv) {
      return getRevenueFromRetreaverDay({
        ...options,
        apiKey: fallbackKey,
      });
    }
    const status = error.response?.status;
    const data = error.response?.data;
    const message = data?.message ?? data?.error ?? error.message;
    return {
      success: false,
      message: status === 401 ? "Invalid Retreaver API key." : `Retreaver API error: ${message}`,
    };
  }
}

/**
 * Retriever adapter (live Retreaver-backed): mirrors Ringba revenue contract.
 * @param {Object} options - { accountID, start: "YYYY-MM-DD", end: "YYYY-MM-DD", apiKey?, baseUrl? }
 * @returns {Promise<{ success: boolean, revenueByDay?: Array<{ day: string, revenue: number|"", records: Array }>, message?: string }>}
 */
async function getRevenueRangeFromRetriever(options = {}) {
  const {
    accountID,
    start,
    end,
    apiKey,
    baseUrl,
    includeTodayLive = false,
    currentReportEnd = "",
  } = options;
  if (!accountID) {
    return {
      success: false,
      message: "Missing accountID.",
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
    if (isToday && !includeTodayLive) {
      revenueByDay.push({ day: dayLabel, revenue: "", records: [] });
      continue;
    }
    const { reportStart, reportEnd } =
      isToday && includeTodayLive
        ? {
            reportStart: new Date(
              Date.UTC(
                date.getUTCFullYear(),
                date.getUTCMonth(),
                date.getUTCDate(),
                4,
                0,
                0,
                0
              )
            )
              .toISOString()
              .replace(/\.\d{3}Z$/, "Z"),
            reportEnd:
              (typeof currentReportEnd === "string" && currentReportEnd.trim()) ||
              new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          }
        : getRingbaDayWindow(date);
    const result = await getRevenueFromRetreaverDay({
      accountID,
      apiKey,
      reportStart,
      reportEnd,
      baseUrl,
    });

    revenueByDay.push({
      day: dayLabel,
      revenue: result.success && result.revenue != null ? result.revenue : "",
      records: result.success && Array.isArray(result.records) ? result.records : [],
    });
  }

  return { success: true, revenueByDay };
}

/**
 * Public payload for Retriever GET test endpoint (live Retreaver-backed).
 */
async function getRetrieverTestData(options = {}) {
  const accountID = (options.accountID || process.env.RETREAVER_COMPANY_ID || "").trim();
  if (!accountID) {
    return {
      success: false,
      source: "retreaver_live",
      error: "Missing accountID. Provide query ?accountID=... or set RETREAVER_COMPANY_ID.",
    };
  }
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  todayUTC.setUTCDate(todayUTC.getUTCDate() - 1); // test last completed day
  const dayLabel = `${String(todayUTC.getUTCMonth() + 1).padStart(2, "0")}/${String(todayUTC.getUTCDate()).padStart(2, "0")}/${todayUTC.getUTCFullYear()}`;
  const { reportStart, reportEnd } = getRingbaDayWindow(todayUTC);
  const result = await getRevenueFromRetreaverDay({
    accountID,
    reportStart,
    reportEnd,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });
  if (!result.success) {
    return {
      success: false,
      source: "retreaver_live",
      error: result.message,
    };
  }
  return {
    success: true,
    source: "retreaver_live",
    period: {
      day: dayLabel,
      generatedAt: now.toISOString(),
      reportStart,
      reportEnd,
    },
    records: result.records,
    revenue: result.revenue,
  };
}

/**
 * Fetch insights (revenue/call data) from Ringba.
 * Uses accountID + apiToken (e.g. from companies collection).
 * @param {Object} options - { accountID, apiToken, reportStart?, reportEnd?, baseUrl?, useBuyerPayload? }
 * useBuyerPayload: true = use buyer-style body (groupBy campaignName, payoutAmount); for buyer Ringba accounts.
 * @returns {Promise<{ success: boolean, report?: object, records?: array, revenue?: number, message?: string }>}
 */
async function getRevenueFromRingba(options = {}) {
  const { accountID, apiToken, reportStart, reportEnd, baseUrl, useBuyerPayload } = options;

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
    const body = useBuyerPayload
      ? buildInsightsBodyBuyer(reportStart, reportEnd)
      : buildInsightsBody(reportStart, reportEnd);
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
    // Primary metric: conversionAmount (our PGNM view). Fallback: payoutAmount (buyer view / sample response).
    const conversionAmountRaw =
      totalRow?.conversionAmount != null
        ? totalRow.conversionAmount
        : totalRow?.payoutAmount != null
        ? totalRow.payoutAmount
        : null;
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

/** Max calendar-day span for Ringba buyer dropdown / list endpoints (single insights call). */
const MAX_ACCOUNTING_BUYER_LIST_DAYS = 120;

/**
 * Distinct buyer labels from Ringba Insights for one account over a UTC calendar range (inclusive).
 * Uses one grouped-by-buyer request with reportStart = first day's Ringba window start,
 * reportEnd = last day's Ringba window end.
 */
async function listRingbaBuyersForDateRange(options = {}) {
  const { accountID, apiToken, start, end, baseUrl } = options;
  const startDate = parseUTCDate(start);
  const endDate = parseUTCDate(end);
  if (!startDate || !endDate || endDate < startDate) {
    return {
      success: false,
      message:
        "Invalid date range. Use start and end as YYYY-MM-DD (UTC calendar days) with end >= start.",
    };
  }
  const spanDays =
    Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (spanDays > MAX_ACCOUNTING_BUYER_LIST_DAYS) {
    return {
      success: false,
      message: `Date range too large (max ${MAX_ACCOUNTING_BUYER_LIST_DAYS} days).`,
    };
  }
  const { reportStart } = getRingbaDayWindow(startDate);
  const { reportEnd } = getRingbaDayWindow(endDate);
  const result = await getRevenueFromRingba({
    accountID,
    apiToken,
    reportStart,
    reportEnd,
    baseUrl,
    useBuyerPayload: false,
  });
  if (!result.success) {
    return {
      success: false,
      message: result.message || "Ringba insights request failed.",
    };
  }
  const unique = new Set();
  for (const r of result.records || []) {
    const b = r.buyer != null ? String(r.buyer).trim() : "";
    if (b && b !== "-no value-") unique.add(b);
  }
  const buyers = [...unique].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  const ymd = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;
  return {
    success: true,
    source: "ringba_insights",
    buyers,
    window: { start: ymd(startDate), end: ymd(endDate) },
    period: result.period,
  };
}

module.exports = {
  getRevenueFromRingba,
  getRevenueWeekFromRingba,
  getRevenueRangeFromRingba,
  getRevenueRangeFromRetriever,
  getRevenueFromRetreaverDay,
  getRetrieverTestData,
  normalizeBuyerName,
  getDaysInRangeUTC,
  getDefaultReportWindow,
  buildInsightsBody,
  MAX_ACCOUNTING_BUYER_LIST_DAYS,
  listRingbaBuyersForDateRange,
};
