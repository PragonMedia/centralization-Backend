/**
 * Accounting controller – revenue/insights from Ringba for frontend display.
 * Uses companies collection for accountID + apiToken. No auth required (temporary).
 */
const Company = require("../models/companyModel");
const accountingService = require("../services/accountingService");

/**
 * GET /api/v1/accounting/revenue
 * Fetches Ringba insights for a company. Company from DB: by accountID or companyName (query), else first company.
 * Query: accountID, companyName, reportStart, reportEnd (ISO).
 */
exports.getRevenue = async (req, res) => {
  try {
    const { accountID, companyName, reportStart, reportEnd } = req.query;

    let company = null;
    if (accountID && accountID.trim()) {
      company = await Company.findOne({ accountID: accountID.trim() });
    } else if (companyName && companyName.trim()) {
      company = await Company.findOne({
        companyName: new RegExp(`^${companyName.trim()}$`, "i"),
      });
    }
    if (!company) {
      company = await Company.findOne();
    }

    if (!company) {
      return res.status(200).json({
        success: false,
        message:
          "No company found. Add a document to the companies collection (run node seedCompanies.js or create via API).",
        revenue: null,
      });
    }

    const result = await accountingService.getRevenueFromRingba({
      accountID: company.accountID,
      apiToken: company.apiToken,
      reportStart: reportStart?.trim() || undefined,
      reportEnd: reportEnd?.trim() || undefined,
    });

    if (!result.success) {
      return res.status(200).json({
        success: false,
        message: result.message,
        revenue: null,
      });
    }

    return res.status(200).json({
      success: true,
      revenue: result.revenue,
      period: result.period,
      report: result.report,
      records: result.records,
    });
  } catch (err) {
    console.error("Accounting getRevenue error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch revenue.",
    });
  }
};
