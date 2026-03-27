/**
 * Accounting controller – revenue from Ringba for frontend display.
 * Fetches all companies from DB and gets each one's revenue from Ringba. No auth required (temporary).
 */
const Company = require("../models/companyModel");
const accountingService = require("../services/accountingService");
const RINGBA_CONFIG = require("../config/ringbaApi");

/**
 * POST /api/v1/accounting/revenue
 * Body: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" } (UTC dates; inclusive range).
 * Fetches revenue for every company for each day in range. Today (UTC) gets revenue "".
 * Response: { success, companies: [ { companyName, revenue: [ { day: "MM/DD/YYYY", revenue: number|"" } ] } ] }.
 */
exports.getRevenue = async (req, res) => {
  try {
    const { start, end } = req.body || {};
    const startStr = typeof start === "string" ? start.trim() : "";
    const endStr = typeof end === "string" ? end.trim() : "";
    if (!startStr || !endStr) {
      return res.status(400).json({
        success: false,
        error: "Request body must include start and end dates (e.g. { \"start\": \"2026-03-08\", \"end\": \"2026-03-14\" }).",
      });
    }
    const daysInRange = accountingService.getDaysInRangeUTC(startStr, endStr);
    if (!daysInRange || daysInRange.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid date range. Use start and end as YYYY-MM-DD with end >= start.",
      });
    }

    const companies = await Company.find().lean();
    if (!companies.length) {
      return res.status(200).json({
        success: false,
        message:
          "No companies found. Add documents to the companies collection (run node seedCompanies.js or create via API).",
        companies: [],
      });
    }

    // Build buyer index from all companies (normalized companyName -> Ringba account)
    const buyersIndex = companies
      .filter((c) => c.companyName && c.accountID)
      .map((c) => ({
        companyName: c.companyName,
        accountID: c.accountID,
        apiToken: (c.apiToken && c.apiToken.trim()) || RINGBA_CONFIG.API_KEY || "",
        normalizedName: accountingService.normalizeBuyerName(c.companyName),
      }));

    const companiesWithRevenue = [];

    for (const company of companies) {
      const apiToken = (company.apiToken && company.apiToken.trim()) || RINGBA_CONFIG.API_KEY || "";
      const result = await accountingService.getRevenueRangeFromRingba({
        accountID: company.accountID,
        apiToken,
        start: startStr,
        end: endStr,
        buyersIndex,
      });

      const revenue =
        result.success && Array.isArray(result.revenueByDay)
          ? result.revenueByDay
          : [];

      companiesWithRevenue.push({
        companyName: company.companyName,
        accountID: company.accountID,
        net: company.net || "",
        revenue,
      });
    }

    return res.status(200).json({
      success: true,
      companies: companiesWithRevenue,
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
 * GET /api/v1/accounting/companies
 * List all companies (companyName, accountID; apiToken not returned).
 */
exports.listCompanies = async (req, res) => {
  try {
    const companies = await Company.find()
      .select("companyName accountID net createdAt")
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
    const { companyName, accountID, apiToken, net } = req.body || {};
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
    });
    return res.status(201).json({
      success: true,
      company: {
        _id: company._id,
        companyName: company.companyName,
        accountID: company.accountID,
        net: company.net || "",
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
    const { companyName, accountID, apiToken, net } = req.body || {};
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
    if (Object.keys(updates).length === 0) {
      return res.status(200).json({
        success: true,
        company: {
          _id: company._id,
          companyName: company.companyName,
          accountID: company.accountID,
          net: company.net || "",
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
