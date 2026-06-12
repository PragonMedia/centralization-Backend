/**
 * Roku ad spend cache — frontend reads cached daily spend; refresh pulls from Roku Ads API.
 */
const rokuAdSpendCacheService = require("../services/rokuAdSpendCacheService");

/**
 * POST /api/v1/roku-ad-spend/refresh
 */
exports.refreshRokuAdSpend = async (req, res) => {
  try {
    const result = await rokuAdSpendCacheService.refreshRokuAdSpendCache({
      trigger: "manual_endpoint",
      verbose: req.query?.verbose === "1" || req.query?.verbose === "true",
    });

    const days = result.payload?.days || [];
    return res.status(200).json({
      success: result.success,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      daysCached: days.length,
      totalSpend: result.payload?.totals?.spend ?? 0,
      accountCount: result.payload?.accounts?.length ?? 0,
      summary: result.summary,
      failedChunks: result.summary?.failedChunks || [],
    });
  } catch (err) {
    console.error("RokuAdSpend refresh error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to refresh Roku ad spend cache.",
    });
  }
};

/**
 * GET /api/v1/roku-ad-spend/cached
 */
exports.getCachedRokuAdSpend = async (req, res) => {
  try {
    const cache = await rokuAdSpendCacheService.getLatestRokuAdSpendCache();
    if (!cache || !cache.payload) {
      return res.status(404).json({
        success: false,
        error: "No cached Roku ad spend yet. Trigger POST /api/v1/roku-ad-spend/refresh first.",
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
    console.error("RokuAdSpend getCached error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch cached Roku ad spend.",
    });
  }
};
