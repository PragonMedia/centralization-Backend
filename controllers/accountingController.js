/**
 * Accounting controller – revenue from Ringba for frontend display.
 * Auth not required for now; add Bearer token when ready.
 */
const accountingService = require("../services/accountingService");

/**
 * GET /api/v1/accounting/revenue
 * Returns revenue data from Ringba for the frontend. No auth required (temporary).
 * Query: dateFrom, dateTo (ISO), accountId (optional).
 */
exports.getRevenue = async (req, res) => {
  try {
    const { dateFrom, dateTo, accountId } = req.query;
    const result = await accountingService.getRevenueFromRingba({
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
      accountId: accountId?.trim() || undefined,
    });

    if (!result.success) {
      return res.status(200).json({
        success: false,
        message: result.message ?? result.error,
        revenue: null,
      });
    }

    return res.status(200).json({
      success: true,
      revenue: result.revenue,
      currency: result.currency,
      period: result.period,
      data: result.data,
    });
  } catch (err) {
    console.error("Accounting getRevenue error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch revenue.",
    });
  }
};
