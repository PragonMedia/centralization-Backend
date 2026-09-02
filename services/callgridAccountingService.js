/**
 * CallGrid accounting — Paragon Media only.
 * Buyer list = CallGrid stats pivot "BuyerName" (DigiPeak, Centerfield, …),
 * NOT campaign sources / media buyers (Jake Hunter, Addy Jaloudi).
 */
const axios = require("axios");
const Company = require("../models/companyModel");
const callgridLanderService = require("./callgridLanderService");
const { getDaysInRangeUTC, normalizeBuyerName } = require("./accountingService");
const { fetchCallgridPayoutForDay } = require("./callgridStatsReportService");
const {
  PARAGON_ORGANIZATION_ID,
  PARAGON_ORGANIZATION_NAME,
} = require("../config/callgridAccounting");

const MAX_BUYER_LIST_DAYS = 120;
const MAX_REVENUE_RANGE_DAYS = 120;
const BUYER_NAME_PIVOT = "BuyerName";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function roundMoney2(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

function toYmdUtc(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function resolveDateWindow(options = {}, maxDays = MAX_BUYER_LIST_DAYS) {
  const qStart = typeof options.start === "string" ? options.start.trim().slice(0, 10) : "";
  const qEnd = typeof options.end === "string" ? options.end.trim().slice(0, 10) : "";

  if (qStart && qEnd) {
    const a = parseYmd(qStart);
    const b = parseYmd(qEnd);
    if (!a || !b) {
      return { error: "Invalid start/end. Use YYYY-MM-DD." };
    }
    const startDate = new Date(Date.UTC(a.y, a.mo - 1, a.d));
    const endDate = new Date(Date.UTC(b.y, b.mo - 1, b.d));
    if (endDate < startDate) {
      return { error: "end must be on or after start." };
    }
    const spanDays =
      Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (spanDays > maxDays) {
      return { error: `Date range too large (max ${maxDays} days).` };
    }
    return { start: qStart, end: qEnd };
  }

  let days = parseInt(options.days, 10);
  if (Number.isNaN(days) || days < 1) days = 30;
  if (days > maxDays) days = maxDays;

  const now = new Date();
  const endUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const startUtc = new Date(endUtc);
  startUtc.setUTCDate(startUtc.getUTCDate() - (days - 1));

  return { start: toYmdUtc(startUtc), end: toYmdUtc(endUtc), days };
}

function parseBuyerNameFromBucketKey(key) {
  const raw = String(key || "").trim();
  const prefix = `${BUYER_NAME_PIVOT}:`;
  if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
  return raw;
}

function readMetric(bucket, field) {
  const v = bucket?.[field];
  if (v && typeof v === "object" && v.value != null) return v.value;
  return v ?? null;
}

function readFiniteNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickFooterTotals(data) {
  if (!data || typeof data !== "object") return null;
  const ft = data.footerTotals ?? data.report?.footerTotals ?? data.data?.footerTotals;
  return ft && typeof ft === "object" ? ft : null;
}

function getReportConfig() {
  const baseUrl = (process.env.CALLGRID_API_BASE_URL || "https://api.callgrid.com").replace(
    /\/$/,
    ""
  );
  const reportTz = (process.env.CALLGRID_REPORT_TIME_ZONE || "US/Eastern").trim() || "US/Eastern";
  const maxItems = Math.max(
    1,
    parseInt(String(process.env.CALLGRID_STATS_MAX_ITEMS || "2000"), 10) || 2000
  );
  return { baseUrl, reportTz, maxItems };
}

/**
 * POST /api/reports/stats for Paragon org (publisher key).
 */
async function postParagonStats({ startDate, endDate, pivot = BUYER_NAME_PIVOT, apiKey }) {
  const key = apiKey || callgridLanderService.getApiKey();
  if (!key) {
    return {
      success: false,
      error: "CALLGRID_API_KEY is not configured on the server.",
    };
  }

  const { baseUrl, reportTz, maxItems } = getReportConfig();
  const url = `${baseUrl}/api/reports/stats?organizationId=${encodeURIComponent(PARAGON_ORGANIZATION_ID)}`;
  const body = {
    startDate,
    endDate,
    pivot,
    pivot2: "",
    filters: { items: [] },
    page: 0,
    maxItems,
    reportTimeZone: reportTz,
  };

  let response;
  try {
    response = await axios.post(url, body, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      timeout: 120000,
      validateStatus: () => true,
    });
  } catch (err) {
    return {
      success: false,
      error: err.message || "CallGrid stats request failed.",
    };
  }

  if (response.status === 401) {
    return {
      success: false,
      error: "CallGrid 401 — check CALLGRID_API_KEY for Paragon Media org.",
    };
  }

  if (response.status < 200 || response.status >= 300) {
    const snippet =
      typeof response.data === "string"
        ? response.data.slice(0, 300)
        : JSON.stringify(response.data || {}).slice(0, 300);
    return {
      success: false,
      error: `CallGrid stats HTTP ${response.status}: ${snippet}`,
    };
  }

  return {
    success: true,
    data: response.data,
    reportTimeZone: reportTz,
  };
}

function parseBuyerBuckets(data) {
  const buckets = data?.aggregations?.pivot_data?.buckets;
  if (!Array.isArray(buckets)) {
    return { error: "CallGrid stats response missing aggregations.pivot_data.buckets." };
  }

  const records = buckets
    .map((bucket) => {
      const buyerName = parseBuyerNameFromBucketKey(bucket.key);
      if (!buyerName) return null;
      const payout = readFiniteNumber(readMetric(bucket, "total_payout"));
      return {
        buyer: buyerName,
        conversionAmount: payout != null ? String(roundMoney2(payout)) : "",
        completedCalls: readMetric(bucket, "completed_count"),
        liveCalls: readMetric(bucket, "live_count"),
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      String(a.buyer).localeCompare(String(b.buyer), undefined, { sensitivity: "base" })
    );

  const ft = pickFooterTotals(data);
  const totalPayout = readFiniteNumber(ft?.total_payout);

  return { records, totalPayout };
}

function toFiniteMoney(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function loadCallgridBuyersIndex() {
  const companies = await Company.find({ platform: "callgrid" }).lean();
  return companies
    .filter((c) => c.companyName && c.accountID)
    .map((c) => ({
      companyName: c.companyName,
      accountID: c.accountID,
      apiToken: (c.apiToken && String(c.apiToken).trim()) || "",
      normalizedName: normalizeBuyerName(c.companyName),
      platform: "callgrid",
    }))
    .filter((c) => c.normalizedName && c.accountID !== PARAGON_ORGANIZATION_ID);
}

/**
 * Attach buyerConversionAmount from each buyer org's own CallGrid creds (companies collection).
 */
async function enrichRecordsWithBuyerComparison(records, { dayIso, dayLabel, buyersIndex, buyerDayCache, requestDelayMs = 0 }) {
  if (!Array.isArray(records) || !records.length || !Array.isArray(buyersIndex) || !buyersIndex.length) {
    return records || [];
  }

  let buyerFetchCount = 0;
  const enriched = [];

  for (const r of records) {
    const normalizedBuyer = normalizeBuyerName(r.buyer);
    if (!normalizedBuyer) {
      enriched.push(r);
      continue;
    }

    const buyerCompanies = buyersIndex.filter((b) => b.normalizedName === normalizedBuyer);
    if (!buyerCompanies.length) {
      enriched.push(r);
      continue;
    }

    let aggregatedRevenue = 0;
    let hasAtLeastOneSuccess = false;
    const buyerConversionAmountSources = [];

    for (const buyerCompany of buyerCompanies) {
      if (!buyerCompany.apiToken) {
        buyerConversionAmountSources.push({
          platform: "callgrid",
          accountID: buyerCompany.accountID,
          amount: null,
          error: "Missing apiToken on company record.",
        });
        continue;
      }

      const cacheKey = `callgrid:${buyerCompany.accountID}:${dayIso}`;
      let buyerRevenue = buyerDayCache.get(cacheKey);

      if (buyerRevenue === undefined) {
        if (buyerFetchCount > 0 && requestDelayMs > 0) await sleep(requestDelayMs);
        buyerFetchCount += 1;

        const result = await fetchCallgridPayoutForDay({
          organizationId: buyerCompany.accountID,
          apiKey: buyerCompany.apiToken,
          buyer: buyerCompany.companyName,
          dayIso,
        });
        buyerRevenue = result.success && result.revenue != null ? String(result.revenue) : null;
        if (!result.success) {
          buyerDayCache.set(cacheKey, { amount: null, error: result.error || "CallGrid buyer fetch failed." });
        } else {
          buyerDayCache.set(cacheKey, { amount: buyerRevenue, error: null });
        }
      }

      const cached = buyerDayCache.get(cacheKey);
      const numericRevenue = toFiniteMoney(cached?.amount ?? buyerRevenue);
      if (numericRevenue != null) {
        hasAtLeastOneSuccess = true;
        aggregatedRevenue += numericRevenue;
      }

      buyerConversionAmountSources.push({
        platform: "callgrid",
        accountID: buyerCompany.accountID,
        amount: numericRevenue != null ? String(numericRevenue) : null,
        ...(cached?.error ? { error: cached.error } : {}),
      });
    }

    enriched.push({
      ...r,
      buyerConversionAmount: hasAtLeastOneSuccess
        ? String(Number(aggregatedRevenue.toFixed(4)))
        : null,
      buyerConversionAmountSources,
    });
  }

  return enriched;
}

/**
 * Single-day Paragon revenue + BuyerName breakdown.
 */
async function fetchParagonDayRevenue(dayIso, options = {}) {
  const result = await postParagonStats({
    startDate: dayIso,
    endDate: dayIso,
    apiKey: options.apiKey,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const parsed = parseBuyerBuckets(result.data);
  if (parsed.error) {
    return { success: false, error: parsed.error };
  }

  return {
    success: true,
    revenue: parsed.totalPayout != null ? roundMoney2(parsed.totalPayout) : "",
    records: parsed.records,
    reportTimeZone: result.reportTimeZone,
  };
}

/**
 * Paragon daily revenue with records[] per BuyerName (Ringba-compatible shape).
 */
async function getParagonRevenueRange(options = {}) {
  const apiKey = callgridLanderService.getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: "CALLGRID_API_KEY is not configured on the server.",
      revenueByDay: [],
    };
  }

  const window = resolveDateWindow(options, MAX_REVENUE_RANGE_DAYS);
  if (window.error) {
    return { success: false, error: window.error, revenueByDay: [] };
  }

  const includeTodayLive = options.includeTodayLive !== false;
  const enrichBuyers = options.enrichBuyers !== false;
  const requestDelayMs = Math.max(0, options.requestDelayMs ?? 200);
  const buyerCompareDelayMs = Math.max(
    0,
    options.buyerCompareDelayMs ??
      (parseInt(process.env.CALLGRID_BUYER_COMPARE_DELAY_MS || "200", 10) || 200)
  );
  const days = getDaysInRangeUTC(window.start, window.end);
  if (!days || !days.length) {
    return {
      success: false,
      error: "Invalid or empty date range.",
      revenueByDay: [],
    };
  }

  const buyersIndex = enrichBuyers ? await loadCallgridBuyersIndex() : [];
  const buyerDayCache = new Map();
  const { reportTz } = getReportConfig();
  const revenueByDay = [];
  let requestIndex = 0;

  for (const { date, dayLabel, isToday } of days) {
    if (isToday && !includeTodayLive) {
      revenueByDay.push({ day: dayLabel, revenue: "", records: [] });
      continue;
    }

    if (requestIndex > 0 && requestDelayMs > 0) await sleep(requestDelayMs);
    requestIndex += 1;

    const dayIso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    const dayResult = await fetchParagonDayRevenue(dayIso, { apiKey });

    if (!dayResult.success) {
      console.warn("CallGrid accounting: day fetch failed", {
        day: dayLabel,
        dayIso,
        error: dayResult.error,
      });
      revenueByDay.push({ day: dayLabel, revenue: "", records: [], error: dayResult.error });
      continue;
    }

    let records = dayResult.records || [];
    if (enrichBuyers && records.length && buyersIndex.length) {
      records = await enrichRecordsWithBuyerComparison(records, {
        dayIso,
        dayLabel,
        buyersIndex,
        buyerDayCache,
        requestDelayMs: buyerCompareDelayMs,
      });
    }

    revenueByDay.push({
      day: dayLabel,
      revenue: dayResult.revenue !== "" ? dayResult.revenue : "",
      records,
    });
  }

  return {
    success: true,
    source: "callgrid_stats",
    pivot: BUYER_NAME_PIVOT,
    organizationId: PARAGON_ORGANIZATION_ID,
    organizationName: PARAGON_ORGANIZATION_NAME,
    reportTimeZone: reportTz,
    window: { start: window.start, end: window.end },
    buyerCrossCheck: enrichBuyers
      ? {
          enabled: true,
          companiesLoaded: buyersIndex.length,
          companiesWithToken: buyersIndex.filter((b) => b.apiToken).length,
        }
      : { enabled: false },
    revenueByDay,
  };
}

/**
 * Buyers from POST /api/reports/stats with pivot=BuyerName.
 * Matches CallGrid dashboard "BuyerName" tab.
 */
async function listParagonBuyerNames(options = {}) {
  const window = resolveDateWindow(options, MAX_BUYER_LIST_DAYS);
  if (window.error) {
    return {
      success: false,
      error: window.error,
      organizationId: PARAGON_ORGANIZATION_ID,
      organizationName: PARAGON_ORGANIZATION_NAME,
      buyers: [],
    };
  }

  const result = await postParagonStats({
    startDate: window.start,
    endDate: window.end,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      organizationId: PARAGON_ORGANIZATION_ID,
      organizationName: PARAGON_ORGANIZATION_NAME,
      buyers: [],
    };
  }

  const parsed = parseBuyerBuckets(result.data);
  if (parsed.error) {
    return {
      success: false,
      error: parsed.error,
      organizationId: PARAGON_ORGANIZATION_ID,
      organizationName: PARAGON_ORGANIZATION_NAME,
      buyers: [],
    };
  }

  const buyers = (parsed.records || []).map((r) => ({
    buyerName: r.buyer,
    completedCalls: r.completedCalls,
    liveCalls: r.liveCalls,
    totalPayout: r.conversionAmount !== "" ? readFiniteNumber(r.conversionAmount) : null,
  }));

  return {
    success: true,
    source: "callgrid_stats",
    pivot: BUYER_NAME_PIVOT,
    organizationId: PARAGON_ORGANIZATION_ID,
    organizationName: PARAGON_ORGANIZATION_NAME,
    reportTimeZone: result.reportTimeZone,
    window: { start: window.start, end: window.end },
    buyers,
    count: buyers.length,
  };
}

module.exports = {
  listParagonBuyerNames,
  getParagonRevenueRange,
  fetchParagonDayRevenue,
  postParagonStats,
  loadCallgridBuyersIndex,
  enrichRecordsWithBuyerComparison,
  MAX_BUYER_LIST_DAYS,
  MAX_REVENUE_RANGE_DAYS,
  BUYER_NAME_PIVOT,
};
