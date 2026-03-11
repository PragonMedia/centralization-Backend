/**
 * Accounting controller – revenue from Ringba for frontend display.
 */
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const accountingService = require("../services/accountingService");

async function getUserFromToken(req) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
    if (!decoded?.userId) return null;
    const user = await User.findById(decoded.userId);
    return user ? { email: user.email, role: user.role, userId: user._id.toString() } : null;
  } catch (err) {
    return null;
  }
}

/**
 * GET /api/v1/accounting/revenue
 * Returns revenue data from Ringba for the frontend. Requires auth.
 * Query: dateFrom, dateTo (ISO), accountId (optional).
 */
exports.getRevenue = async (req, res) => {
  try {
    const loggedInUser = await getUserFromToken(req);
    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Please provide a valid token.",
      });
    }

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
