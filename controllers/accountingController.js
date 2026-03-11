/**
 * Accounting controller – revenue from Ringba for frontend display.
 * Fetches all companies from DB and gets each one's revenue from Ringba. No auth required (temporary).
 */
const Company = require("../models/companyModel");
const accountingService = require("../services/accountingService");

/**
 * GET /api/v1/accounting/revenue
 * Fetches revenue for every company in the companies collection.
 * Query: reportStart, reportEnd (ISO, optional – default report window used).
 * Response: { success, companies: [ { companyName, revenue } ] }.
 */
exports.getRevenue = async (req, res) => {
  try {
    const { reportStart, reportEnd } = req.query;

    const companies = await Company.find().lean();
    if (!companies.length) {
      return res.status(200).json({
        success: false,
        message:
          "No companies found. Add documents to the companies collection (run node seedCompanies.js or create via API).",
        companies: [],
      });
    }

    const companiesWithRevenue = [];

    for (const company of companies) {
      const result = await accountingService.getRevenueFromRingba({
        accountID: company.accountID,
        apiToken: company.apiToken,
        reportStart: reportStart?.trim() || undefined,
        reportEnd: reportEnd?.trim() || undefined,
      });

      const revenue =
        result.success && result.revenue != null ? result.revenue : null;

      companiesWithRevenue.push({
        companyName: company.companyName,
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
