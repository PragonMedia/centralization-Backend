const CallgridAccountingRevenueCache = require("../models/callgridAccountingRevenueCacheModel");
const callgridAccountingService = require("./callgridAccountingService");
const {
  PARAGON_ORGANIZATION_ID,
  PARAGON_ORGANIZATION_NAME,
} = require("../config/callgridAccounting");

function toIsoNoMs(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getRollingTwoMonthWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 2);
  return {
    startDate: toIsoNoMs(start).slice(0, 10),
    endDate: toIsoNoMs(now).slice(0, 10),
    endDateTimeIso: toIsoNoMs(now),
  };
}

function dayHasBuyerData(row) {
  return Array.isArray(row?.records) && row.records.length > 0;
}

function mergePreservingGoodDays(newPayload, previousPayload) {
  if (!previousPayload || !Array.isArray(previousPayload.companies)) {
    return { payload: newPayload, preservedDays: 0 };
  }
  if (!newPayload || !Array.isArray(newPayload.companies)) {
    return { payload: newPayload, preservedDays: 0 };
  }

  const prevByKey = new Map();
  for (const company of previousPayload.companies) {
    const key = company.accountID || company.companyName;
    if (key) prevByKey.set(String(key), company);
  }

  let preservedDays = 0;
  const companies = newPayload.companies.map((company) => {
    const prev =
      prevByKey.get(String(company.accountID || "")) ||
      prevByKey.get(String(company.companyName || ""));
    if (!prev || !Array.isArray(prev.revenue) || !Array.isArray(company.revenue)) {
      return company;
    }

    const prevByDay = new Map(
      prev.revenue.filter((row) => row && row.day).map((row) => [row.day, row])
    );
    const revenue = company.revenue.map((row) => {
      if (dayHasBuyerData(row)) return row;
      const previousRow = prevByDay.get(row?.day);
      if (dayHasBuyerData(previousRow)) {
        preservedDays += 1;
        return previousRow;
      }
      return row;
    });

    return { ...company, revenue };
  });

  return {
    payload: { ...newPayload, companies },
    preservedDays,
  };
}

async function buildRevenuePayloadForWindow({ startDate, endDate, includeTodayLive = true }) {
  const requestDelayMs = Math.max(
    0,
    parseInt(process.env.CALLGRID_CACHE_REQUEST_DELAY_MS || "200", 10) || 200
  );

  const result = await callgridAccountingService.getParagonRevenueRange({
    start: startDate,
    end: endDate,
    includeTodayLive,
    requestDelayMs,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || "CallGrid Paragon revenue fetch failed.",
      companies: [],
      organizationId: PARAGON_ORGANIZATION_ID,
      organizationName: PARAGON_ORGANIZATION_NAME,
      platform: "callgrid",
    };
  }

  const company = {
    companyName: PARAGON_ORGANIZATION_NAME,
    accountID: PARAGON_ORGANIZATION_ID,
    platform: "callgrid",
    revenue: result.revenueByDay || [],
  };

  return {
    success: true,
    source: "callgrid_stats",
    pivot: callgridAccountingService.BUYER_NAME_PIVOT,
    organizationId: PARAGON_ORGANIZATION_ID,
    organizationName: PARAGON_ORGANIZATION_NAME,
    platform: "callgrid",
    reportTimeZone: result.reportTimeZone,
    companies: [company],
  };
}

async function refreshRevenueCache(options = {}) {
  const trigger = (options.trigger || "manual").trim() || "manual";
  const windowData = getRollingTwoMonthWindow();
  const previousCache = await CallgridAccountingRevenueCache.findOne({
    cacheKey: "latest",
  }).lean();
  const freshPayload = await buildRevenuePayloadForWindow(windowData);
  const { payload, preservedDays } = mergePreservingGoodDays(
    freshPayload,
    previousCache?.payload
  );

  if (preservedDays > 0) {
    console.warn("CallGrid accounting: preserved prior cache days after empty/failed refresh", {
      preservedDays,
      trigger,
    });
  }

  await CallgridAccountingRevenueCache.deleteMany({});
  const cache = await CallgridAccountingRevenueCache.create({
    cacheKey: "latest",
    windowStart: new Date(`${windowData.startDate}T00:00:00.000Z`),
    windowEnd: new Date(windowData.endDateTimeIso),
    timezone: "America/New_York",
    trigger,
    refreshedAt: new Date(),
    payload,
  });

  return {
    cache,
    payload,
    windowData,
    preservedDays,
  };
}

async function getLatestRevenueCache() {
  return CallgridAccountingRevenueCache.findOne({ cacheKey: "latest" }).lean();
}

module.exports = {
  refreshRevenueCache,
  getLatestRevenueCache,
  getRollingTwoMonthWindow,
  mergePreservingGoodDays,
};
