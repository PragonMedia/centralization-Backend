/**
 * Accounting controller – revenue from Ringba for frontend display.
 * Fetches all companies from DB and gets each one's revenue from Ringba. No auth required (temporary).
 */
const Company = require("../models/companyModel");
const accountingService = require("../services/accountingService");
const RINGBA_CONFIG = require("../config/ringbaApi");
const accountingRevenueCacheService = require("../services/accountingRevenueCacheService");
const callgridReportService = require("../services/callgridReportService");
const callgridStatsReportService = require("../services/callgridStatsReportService");
const SUPPORTED_PLATFORMS = ["ringba", "retriever", "callgrid"];

/** Map Company docs (platform=callgrid) to stats/calls buyer rows. */
function mapCallgridCompaniesToBuyers(companies) {
  return companies.map((c) => ({
    buyer: c.companyName,
    organizationId: c.accountID,
    apiKey: (c.apiToken && String(c.apiToken).trim()) || "",
  }));
}

async function loadCallgridBuyersFromDb(accountIDFilter) {
  const query = { platform: "callgrid" };
  if (accountIDFilter) query.accountID = accountIDFilter;
  const companies = await Company.find(query).lean();
  return mapCallgridCompaniesToBuyers(companies);
}
const revenueRefreshJob = {
  inProgress: false,
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastTrigger: null,
};

exports.getRetrieverTestData = async (req, res) => {
  try {
    const payload = await accountingService.getRetrieverTestData({
      accountID: typeof req.query?.accountID === "string" ? req.query.accountID.trim() : "",
    });
    return res.status(payload.success ? 200 : 400).json(payload);
  } catch (err) {
    console.error("Accounting getRetrieverTestData error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch Retriever test data.",
    });
  }
};

/**
 * GET /api/v1/accounting/callgrid/test-data
 * Loads buyers from companies with platform=callgrid (apiToken + accountID = organizationId).
 * Query: rangeStart, rangeEnd, accountID (optional filter), format=full, source=calls.
 */
exports.getCallgridTestData = async (req, res) => {
  try {
    const accountIDFilter =
      typeof req.query?.accountID === "string" ? req.query.accountID.trim() : "";
    const buyers = await loadCallgridBuyersFromDb(accountIDFilter || undefined);
    if (!buyers.length) {
      return res.status(404).json({
        success: false,
        source: "callgrid_stats",
        error: accountIDFilter
          ? `No CallGrid company found for accountID ${accountIDFilter}. Add via POST /api/v1/accounting/companies with platform callgrid.`
          : "No CallGrid companies found. Add buyers via POST /api/v1/accounting/companies with platform callgrid (accountID = CallGrid organizationId, apiToken = API key).",
      });
    }

    const rangeStart = typeof req.query?.rangeStart === "string" ? req.query.rangeStart.trim() : "";
    const rangeEnd = typeof req.query?.rangeEnd === "string" ? req.query.rangeEnd.trim() : "";
    const source = String(req.query?.source || "stats").trim().toLowerCase();
    const reportOpts = {
      buyers,
      rangeStart: rangeStart || undefined,
      rangeEnd: rangeEnd || undefined,
    };

    if (source === "calls" || source === "legacy") {
      const firstPageOnly = ["1", "true", "yes"].includes(
        String(req.query?.firstPageOnly || "").trim().toLowerCase()
      );
      const maxPages = Math.max(1, parseInt(String(req.query?.maxPages || "300"), 10) || 300);
      const maxItems = Math.max(1, parseInt(String(req.query?.maxItems || "100"), 10) || 100);
      const template = typeof req.query?.template === "string" ? req.query.template.trim() : "";
      const uiVendors = typeof req.query?.uiVendors === "string" ? req.query.uiVendors.trim() : "";

      const payload = await callgridReportService.fetchBuyersByDayReport({
        ...reportOpts,
        firstPageOnly,
        maxPages,
        maxItems,
        groupBy: typeof req.query?.groupBy === "string" ? req.query.groupBy.trim() : "",
        template: template || undefined,
        uiVendors: uiVendors || undefined,
      });
      return res.status(payload.success ? 200 : 400).json(payload);
    }

    const reportTz =
      typeof req.query?.reportTimeZone === "string" && req.query.reportTimeZone.trim()
        ? req.query.reportTimeZone.trim()
        : undefined;
    const pivot = typeof req.query?.pivot === "string" && req.query.pivot.trim() ? req.query.pivot.trim() : undefined;
    const requestDelayMs = Math.max(
      0,
      parseInt(String(req.query?.requestDelayMs || "200"), 10) || 200
    );
    const format = String(req.query?.format || "").trim().toLowerCase();
    const minimal = !["full", "verbose", "1", "true", "yes"].includes(format);

    let statsMaxItems;
    if (req.query?.maxItems != null && String(req.query.maxItems).trim() !== "") {
      const n = parseInt(String(req.query.maxItems), 10);
      if (Number.isFinite(n) && n >= 1) statsMaxItems = n;
    }

    const payload = await callgridStatsReportService.fetchDashboardBuyersStatsReport({
      ...reportOpts,
      reportTimeZone: reportTz,
      pivot,
      requestDelayMs,
      minimal,
      ...(statsMaxItems != null ? { maxItems: statsMaxItems } : {}),
    });
    return res.status(payload.success ? 200 : 400).json(payload);
  } catch (err) {
    console.error("Accounting getCallgridTestData error:", err);
    return res.status(500).json({
      success: false,
      source: "callgrid_stats",
      error: "Failed to fetch CallGrid test data.",
    });
  }
};

/**
 * POST /api/v1/accounting/revenue
 * Manual cache refresh endpoint.
 * Rebuilds 2-month rolling accounting data and stores a single latest snapshot.
 */
exports.getRevenue = async (req, res) => {
  const waitRaw =
    (typeof req.query?.wait === "string" ? req.query.wait : "") ||
    (typeof req.body?.wait === "string" ? req.body.wait : "");
  const waitForCompletion = ["1", "true", "yes"].includes(
    String(waitRaw || "").trim().toLowerCase()
  );
  try {
    if (!waitForCompletion) {
      if (revenueRefreshJob.inProgress) {
        return res.status(202).json({
          success: true,
          message: "Accounting revenue cache refresh already in progress.",
          inProgress: true,
          startedAt: revenueRefreshJob.startedAt,
          lastSuccessAt: revenueRefreshJob.lastSuccessAt,
          lastError: revenueRefreshJob.lastError,
        });
      }
      revenueRefreshJob.inProgress = true;
      revenueRefreshJob.startedAt = new Date().toISOString();
      revenueRefreshJob.finishedAt = null;
      revenueRefreshJob.lastError = null;
      revenueRefreshJob.lastTrigger = "manual_endpoint_async";
      (async () => {
        try {
          await accountingRevenueCacheService.refreshRevenueCache({
            trigger: "manual_endpoint_async",
          });
          revenueRefreshJob.lastSuccessAt = new Date().toISOString();
        } catch (error) {
          revenueRefreshJob.lastError = error?.message || "Unknown refresh error.";
          console.error("Accounting getRevenue async refresh error:", error);
        } finally {
          revenueRefreshJob.inProgress = false;
          revenueRefreshJob.finishedAt = new Date().toISOString();
        }
      })();
      return res.status(202).json({
        success: true,
        message:
          "Accounting revenue cache refresh started in background. Poll GET /api/v1/accounting/revenue/refresh-status.",
        inProgress: true,
        startedAt: revenueRefreshJob.startedAt,
      });
    }

    const refreshed = await accountingRevenueCacheService.refreshRevenueCache({
      trigger: "manual_endpoint",
    });
    return res.status(200).json({
      success: true,
      message: "Accounting revenue cache refreshed.",
      refreshedAt: refreshed.cache?.refreshedAt || null,
      windowStart: refreshed.windowData?.startDate || null,
      windowEnd: refreshed.windowData?.endDateTimeIso || null,
      companiesCount: refreshed.payload?.companies?.length || 0,
    });
  } catch (err) {
    console.error("Accounting getRevenue error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch revenue.",
    });
  }
};

/**
 * GET /api/v1/accounting/revenue/refresh-status
 * Reports manual refresh background job state.
 */
exports.getRevenueRefreshStatus = async (_req, res) => {
  return res.status(200).json({
    success: true,
    inProgress: revenueRefreshJob.inProgress,
    startedAt: revenueRefreshJob.startedAt,
    finishedAt: revenueRefreshJob.finishedAt,
    lastSuccessAt: revenueRefreshJob.lastSuccessAt,
    lastError: revenueRefreshJob.lastError,
    lastTrigger: revenueRefreshJob.lastTrigger,
  });
};

/**
 * GET /api/v1/accounting/revenue/cached
 * Fast read endpoint for frontend consumption.
 */
exports.getCachedRevenue = async (req, res) => {
  try {
    const cache = await accountingRevenueCacheService.getLatestRevenueCache();
    if (!cache || !cache.payload) {
      return res.status(404).json({
        success: false,
        error: "No cached accounting revenue yet. Trigger POST /api/v1/accounting/revenue first.",
      });
    }
    return res.status(200).json({
      ...cache.payload,
      cacheMeta: {
        refreshedAt: cache.refreshedAt,
        windowStart: cache.windowStart,
        windowEnd: cache.windowEnd,
        trigger: cache.trigger,
      },
    });
  } catch (err) {
    console.error("Accounting getCachedRevenue error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch cached revenue.",
    });
  }
};

function toYmdUtc(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * GET /api/v1/accounting/ringba/pgnm/buyers
 * Lightweight Ringba Insights buyer list for the PGNM Ringba account (dropdowns).
 * Query: optional `days` (default 30, max 120), or `start` + `end` as YYYY-MM-DD (UTC).
 */
exports.getPgnmRingbaBuyers = async (req, res) => {
  try {
    const maxDays = accountingService.MAX_ACCOUNTING_BUYER_LIST_DAYS || 120;
    let startStr;
    let endStr;
    const qStart = typeof req.query?.start === "string" ? req.query.start.trim() : "";
    const qEnd = typeof req.query?.end === "string" ? req.query.end.trim() : "";
    if (qStart && qEnd) {
      startStr = qStart.slice(0, 10);
      endStr = qEnd.slice(0, 10);
    } else {
      let days = parseInt(req.query?.days, 10);
      if (Number.isNaN(days) || days < 1) days = 30;
      if (days > maxDays) days = maxDays;
      const now = new Date();
      const endUtc = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      const startUtc = new Date(endUtc);
      startUtc.setUTCDate(startUtc.getUTCDate() - (days - 1));
      startStr = toYmdUtc(startUtc);
      endStr = toYmdUtc(endUtc);
    }

    const companies = await Company.find().lean();
    const pgnm = companies.find((c) => {
      if (accountingService.normalizeBuyerName(c.companyName) !== "pgnm") return false;
      const platform =
        (typeof c.platform === "string" ? c.platform.trim().toLowerCase() : "") || "ringba";
      if (platform !== "ringba") return false;
      return Boolean(c.accountID);
    });

    if (!pgnm) {
      return res.status(404).json({
        success: false,
        error:
          "No Ringba PGNM company found. Add a company whose name normalizes to PGNM with platform ringba.",
      });
    }

    const apiToken = (pgnm.apiToken && String(pgnm.apiToken).trim()) || RINGBA_CONFIG.API_KEY;
    if (!apiToken) {
      return res.status(500).json({
        success: false,
        error: "PGNM has no apiToken and RINGBA_API_KEY / RINGBA_API_TOKEN is unset.",
      });
    }

    const payload = await accountingService.listRingbaBuyersForDateRange({
      accountID: pgnm.accountID,
      apiToken,
      start: startStr,
      end: endStr,
      baseUrl: RINGBA_CONFIG.BASE_URL,
    });

    if (!payload.success) {
      const msg = payload.message || "Failed to list buyers from Ringba.";
      const unauthorized = /invalid ringba api token/i.test(msg);
      return res.status(unauthorized ? 401 : 400).json({
        success: false,
        error: msg,
      });
    }

    return res.status(200).json({
      success: true,
      source: payload.source,
      buyers: payload.buyers,
      window: payload.window,
      insightsPeriod: payload.period,
    });
  } catch (err) {
    console.error("Accounting getPgnmRingbaBuyers error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch PGNM Ringba buyers.",
    });
  }
};

/**
 * GET /api/v1/accounting/companies
 * List all companies (companyName, accountID; apiToken not returned).
 */
exports.listCompanies = async (req, res) => {
  try {
    const companies = await Company.find()
      .select("companyName accountID net platform createdAt")
      .lean();
    return res.status(200).json({
      success: true,
      companies,
    });
  } catch (err) {
    console.error("Accounting listCompanies error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to list companies.",
    });
  }
};

/**
 * POST /api/v1/accounting/companies
 * Create a new company. Body: { companyName, accountID }. apiToken is optional;
 * when omitted, the server auto-inserts RINGBA_API_KEY / RINGBA_API_TOKEN from env (single shared API for all buyers).
 */
exports.createCompany = async (req, res) => {
  try {
    const { companyName, accountID, apiToken, net, platform } = req.body || {};
    let normalizedPlatform = "ringba";
    if (platform !== undefined) {
      if (typeof platform !== "string" || !platform.trim()) {
        return res.status(400).json({
          success: false,
          error: "platform must be a non-empty string when provided.",
        });
      }
      normalizedPlatform = platform.trim().toLowerCase();
      if (!SUPPORTED_PLATFORMS.includes(normalizedPlatform)) {
        return res.status(400).json({
          success: false,
          error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}.`,
        });
      }
    }

    if (
      !companyName ||
      typeof companyName !== "string" ||
      !companyName.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "companyName is required and must be a non-empty string.",
      });
    }
    if (!accountID || typeof accountID !== "string" || !accountID.trim()) {
      return res.status(400).json({
        success: false,
        error: "accountID is required and must be a non-empty string.",
      });
    }
    let apiTokenToStore = "";
    if (normalizedPlatform === "callgrid") {
      if (!apiToken || typeof apiToken !== "string" || !apiToken.trim()) {
        return res.status(400).json({
          success: false,
          error:
            "apiToken is required for platform callgrid (CallGrid API key for this organization). accountID should be the CallGrid organizationId.",
        });
      }
      apiTokenToStore = apiToken.trim();
    } else {
      const fallbackTokenFromEnv =
        normalizedPlatform === "retriever"
          ? (process.env.RETREAVER_API_KEY || "").trim()
          : (RINGBA_CONFIG.API_KEY || "");
      apiTokenToStore =
        apiToken && typeof apiToken === "string" && apiToken.trim()
          ? apiToken.trim()
          : fallbackTokenFromEnv;
      if (!apiTokenToStore) {
        return res.status(400).json({
          success: false,
          error:
            normalizedPlatform === "retriever"
              ? "apiToken was not provided and server has no RETREAVER_API_KEY set. Set one in .env to auto-insert for Retriever buyers."
              : "apiToken was not provided and server has no RINGBA_API_KEY or RINGBA_API_TOKEN set. Set one in .env to auto-insert for Ringba buyers.",
        });
      }
    }
    const existing = await Company.findOne({
      accountID: accountID.trim(),
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "A company with this accountID already exists.",
      });
    }
    const company = await Company.create({
      companyName: companyName.trim(),
      accountID: accountID.trim(),
      apiToken: apiTokenToStore,
      net: typeof net === "string" ? net.trim() : "",
      platform: normalizedPlatform,
    });
    return res.status(201).json({
      success: true,
      company: {
        _id: company._id,
        companyName: company.companyName,
        accountID: company.accountID,
        net: company.net || "",
        platform: company.platform || "ringba",
        createdAt: company.createdAt,
      },
    });
  } catch (err) {
    if (err.name === "MongoError" && err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "A company with this accountID already exists.",
      });
    }
    console.error("Accounting createCompany error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to create company.",
    });
  }
};

/**
 * PUT /api/v1/accounting/companies/:accountID
 * Update a company by accountID. Body: { companyName?, accountID?, apiToken?, net? } (all optional; only provided fields are updated).
 */
exports.updateCompany = async (req, res) => {
  try {
    const { accountID: paramAccountID } = req.params;
    const { companyName, accountID, apiToken, net, platform } = req.body || {};
    if (!paramAccountID || !paramAccountID.trim()) {
      return res.status(400).json({
        success: false,
        error: "accountID is required in the URL.",
      });
    }
    const company = await Company.findOne({
      accountID: paramAccountID.trim(),
    });
    if (!company) {
      return res.status(404).json({
        success: false,
        error: "Company not found for the given accountID.",
      });
    }
    const updates = {};
    if (companyName !== undefined) {
      if (typeof companyName !== "string" || !companyName.trim()) {
        return res.status(400).json({
          success: false,
          error: "companyName must be a non-empty string.",
        });
      }
      updates.companyName = companyName.trim();
    }
    if (accountID !== undefined) {
      if (typeof accountID !== "string" || !accountID.trim()) {
        return res.status(400).json({
          success: false,
          error: "accountID must be a non-empty string.",
        });
      }
      const taken = await Company.findOne({
        accountID: accountID.trim(),
        _id: { $ne: company._id },
      });
      if (taken) {
        return res.status(409).json({
          success: false,
          error: "Another company already uses this accountID.",
        });
      }
      updates.accountID = accountID.trim();
    }
    if (apiToken !== undefined) {
      if (typeof apiToken !== "string" || !apiToken.trim()) {
        return res.status(400).json({
          success: false,
          error: "apiToken must be a non-empty string.",
        });
      }
      updates.apiToken = apiToken.trim();
    }
    if (net !== undefined) {
      if (typeof net !== "string") {
        return res.status(400).json({
          success: false,
          error: "net must be a string.",
        });
      }
      updates.net = net.trim();
    }
    if (platform !== undefined) {
      if (typeof platform !== "string" || !platform.trim()) {
        return res.status(400).json({
          success: false,
          error: "platform must be a non-empty string.",
        });
      }
      const normalizedPlatform = platform.trim().toLowerCase();
      if (!SUPPORTED_PLATFORMS.includes(normalizedPlatform)) {
        return res.status(400).json({
          success: false,
          error: `platform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}.`,
        });
      }
      updates.platform = normalizedPlatform;
    }

    const effectivePlatform = (
      updates.platform ||
      company.platform ||
      "ringba"
    )
      .trim()
      .toLowerCase();
    if (effectivePlatform === "callgrid") {
      const tokenAfter =
        updates.apiToken !== undefined ? updates.apiToken : company.apiToken || "";
      if (!tokenAfter || !String(tokenAfter).trim()) {
        return res.status(400).json({
          success: false,
          error:
            "apiToken is required for platform callgrid. Provide CallGrid API key in request body.",
        });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(200).json({
        success: true,
        company: {
          _id: company._id,
          companyName: company.companyName,
          accountID: company.accountID,
          net: company.net || "",
          platform: company.platform || "ringba",
          createdAt: company.createdAt,
          updatedAt: company.updatedAt,
        },
      });
    }
    Object.assign(company, updates);
    await company.save();
    return res.status(200).json({
      success: true,
      company: {
        _id: company._id,
        companyName: company.companyName,
        accountID: company.accountID,
        net: company.net || "",
        platform: company.platform || "ringba",
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      },
    });
  } catch (err) {
    if (err.name === "MongoError" && err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Another company already uses this accountID.",
      });
    }
    console.error("Accounting updateCompany error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to update company.",
    });
  }
};

/**
 * DELETE /api/v1/accounting/companies/:accountID
 * Delete a company by accountID.
 */
exports.deleteCompany = async (req, res) => {
  try {
    const { accountID } = req.params;
    if (!accountID || !accountID.trim()) {
      return res.status(400).json({
        success: false,
        error: "accountID is required in the URL.",
      });
    }
    const company = await Company.findOneAndDelete({
      accountID: accountID.trim(),
    });
    if (!company) {
      return res.status(404).json({
        success: false,
        error: "Company not found for the given accountID.",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Company deleted.",
      company: {
        _id: company._id,
        companyName: company.companyName,
        accountID: company.accountID,
        net: company.net || "",
        platform: company.platform || "ringba",
      },
    });
  } catch (err) {
    console.error("Accounting deleteCompany error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to delete company.",
    });
  }
};
