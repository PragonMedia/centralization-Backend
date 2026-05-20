const Company = require("../models/companyModel");
const AccountingRevenueCache = require("../models/accountingRevenueCacheModel");
const accountingService = require("./accountingService");
const RINGBA_CONFIG = require("../config/ringbaApi");

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

function resolveCompanyApiToken(company, platform) {
  const token = (company.apiToken && company.apiToken.trim()) || "";
  if (token) return token;
  if (platform === "retriever") return (process.env.RETREAVER_API_KEY || "").trim();
  if (platform === "ringba") return RINGBA_CONFIG.API_KEY || "";
  return "";
}

async function buildRevenuePayloadForWindow({ startDate, endDate, endDateTimeIso }) {
  const companies = await Company.find().lean();
  if (!companies.length) {
    return {
      success: true,
      companies: [],
      message:
        "No companies found. Add documents to the companies collection (run node seedCompanies.js or create via API).",
    };
  }

  const buyersIndex = companies
    .filter((c) => {
      const platform =
        (typeof c.platform === "string" ? c.platform.trim().toLowerCase() : "") ||
        "ringba";
      return (
        (platform === "ringba" || platform === "retriever" || platform === "callgrid") &&
        c.companyName &&
        c.accountID
      );
    })
    .map((c) => {
      const platform =
        (typeof c.platform === "string" ? c.platform.trim().toLowerCase() : "") ||
        "ringba";
      return {
        companyName: c.companyName,
        accountID: c.accountID,
        platform,
        apiToken: resolveCompanyApiToken(c, platform),
        normalizedName: accountingService.normalizeBuyerName(c.companyName),
      };
    });

  const companiesWithRevenue = [];
  for (const company of companies) {
    const platform =
      (typeof company.platform === "string"
        ? company.platform.trim().toLowerCase()
        : "") || "ringba";
    const apiToken = resolveCompanyApiToken(company, platform);

    let result;
    if (platform === "retriever") {
      result = await accountingService.getRevenueRangeFromRetriever({
        accountID: company.accountID,
        apiKey: apiToken,
        start: startDate,
        end: endDate,
        includeTodayLive: true,
        currentReportEnd: endDateTimeIso,
      });
    } else if (platform === "callgrid") {
      if (!apiToken) {
        result = {
          success: false,
          message: "Missing apiToken for CallGrid company.",
        };
      } else {
        result = await accountingService.getRevenueRangeFromCallgrid({
          accountID: company.accountID,
          apiKey: apiToken,
          companyName: company.companyName,
          start: startDate,
          end: endDate,
          includeTodayLive: true,
        });
      }
    } else {
      const isPGNMBase =
        accountingService.normalizeBuyerName(company.companyName) === "pgnm";
      result = await accountingService.getRevenueRangeFromRingba({
        accountID: company.accountID,
        apiToken,
        start: startDate,
        end: endDate,
        buyersIndex: isPGNMBase ? buyersIndex : [],
        includeTodayLive: true,
        currentReportEnd: endDateTimeIso,
      });
    }

    companiesWithRevenue.push({
      companyName: company.companyName,
      accountID: company.accountID,
      net: company.net || "",
      platform,
      revenue:
        result.success && Array.isArray(result.revenueByDay)
          ? result.revenueByDay
          : [],
    });
  }

  return {
    success: true,
    companies: companiesWithRevenue,
  };
}

async function refreshRevenueCache(options = {}) {
  const trigger = (options.trigger || "manual").trim() || "manual";
  const windowData = getRollingTwoMonthWindow();
  const payload = await buildRevenuePayloadForWindow(windowData);

  await AccountingRevenueCache.deleteMany({});
  const cache = await AccountingRevenueCache.create({
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
  };
}

async function getLatestRevenueCache() {
  return AccountingRevenueCache.findOne({ cacheKey: "latest" }).lean();
}

module.exports = {
  refreshRevenueCache,
  getLatestRevenueCache,
  getRollingTwoMonthWindow,
};
