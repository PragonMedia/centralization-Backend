/**
 * Accounting controller – revenue from Ringba for frontend display.
 * Fetches all companies from DB and gets each one's revenue from Ringba. No auth required (temporary).
 */
const Company = require("../models/companyModel");
const accountingService = require("../services/accountingService");
const RINGBA_CONFIG = require("../config/ringbaApi");
const accountingRevenueCacheService = require("../services/accountingRevenueCacheService");
const SUPPORTED_PLATFORMS = ["ringba", "retriever"];

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
 * POST /api/v1/accounting/revenue
 * Manual cache refresh endpoint.
 * Rebuilds 2-month rolling accounting data and stores a single latest snapshot.
 */
exports.getRevenue = async (req, res) => {
  try {
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
    // Use body apiToken if provided and non-empty; otherwise use single shared API key from env
    const apiTokenToStore =
      apiToken && typeof apiToken === "string" && apiToken.trim()
        ? apiToken.trim()
        : (RINGBA_CONFIG.API_KEY || "");
    if (!apiTokenToStore) {
      return res.status(400).json({
        success: false,
        error:
          "apiToken was not provided and server has no RINGBA_API_KEY or RINGBA_API_TOKEN set. Set one in .env to auto-insert for new buyers.",
      });
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
