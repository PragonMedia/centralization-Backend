/**
 * CallGrid accounting controller — Paragon Media only.
 */
const callgridAccountingService = require("../services/callgridAccountingService");
const callgridAccountingRevenueCacheService = require("../services/callgridAccountingRevenueCacheService");

const revenueRefreshJob = {
  inProgress: false,
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastTrigger: null,
};

/**
 * GET /api/v1/callgrid-accounting/buyers
 * Paragon CallGrid buyers (stats pivot BuyerName — DigiPeak, Centerfield, …).
 * Query: optional days (default 30, max 120), or start + end as YYYY-MM-DD.
 */
exports.getBuyers = async (req, res) => {
  try {
    const payload = await callgridAccountingService.listParagonBuyerNames({
      days: req.query?.days,
      start: req.query?.start,
      end: req.query?.end,
    });

    if (!payload.success) {
      const status = /401|not configured/i.test(payload.error || "") ? 500 : 400;
      return res.status(status).json(payload);
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("CallGrid accounting getBuyers error:", err);
    const status = err.status && Number.isFinite(err.status) ? err.status : 500;
    return res.status(status).json({
      success: false,
      error: err.message || "Failed to fetch CallGrid buyers.",
      buyers: [],
    });
  }
};

/**
 * GET /api/v1/callgrid-accounting/revenue
 * Live Paragon daily revenue with BuyerName records (no cache).
 * Query: days (default 7, max 120), or start + end YYYY-MM-DD; includeToday=0 to skip today.
 */
exports.getRevenueLive = async (req, res) => {
  try {
    const includeTodayRaw = String(req.query?.includeToday || "1").trim().toLowerCase();
    const includeTodayLive = !["0", "false", "no"].includes(includeTodayRaw);
    const enrichBuyers = !["0", "false", "no"].includes(
      String(req.query?.enrichBuyers ?? "1").trim().toLowerCase()
    );
    const requestDelayMs = Math.max(
      0,
      parseInt(String(req.query?.requestDelayMs || process.env.CALLGRID_CACHE_REQUEST_DELAY_MS || "200"), 10) || 200
    );

    const payload = await callgridAccountingService.getParagonRevenueRange({
      days: req.query?.days,
      start: req.query?.start,
      end: req.query?.end,
      includeTodayLive,
      enrichBuyers,
      requestDelayMs,
    });

    if (!payload.success) {
      const status = /401|not configured/i.test(payload.error || "") ? 500 : 400;
      return res.status(status).json(payload);
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("CallGrid accounting getRevenueLive error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to fetch CallGrid revenue.",
      revenueByDay: [],
    });
  }
};

/**
 * POST /api/v1/callgrid-accounting/revenue
 * Refresh CallGrid-only accounting cache (2-month rolling window).
 */
exports.refreshRevenue = async (req, res) => {
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
          message: "CallGrid accounting revenue cache refresh already in progress.",
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
          await callgridAccountingRevenueCacheService.refreshRevenueCache({
            trigger: "manual_endpoint_async",
          });
          revenueRefreshJob.lastSuccessAt = new Date().toISOString();
        } catch (error) {
          revenueRefreshJob.lastError = error?.message || "Unknown refresh error.";
          console.error("CallGrid accounting refreshRevenue async error:", error);
        } finally {
          revenueRefreshJob.inProgress = false;
          revenueRefreshJob.finishedAt = new Date().toISOString();
        }
      })();
      return res.status(202).json({
        success: true,
        message:
          "CallGrid accounting revenue cache refresh started in background. Poll GET /api/v1/callgrid-accounting/revenue/refresh-status.",
        inProgress: true,
        startedAt: revenueRefreshJob.startedAt,
      });
    }

    const refreshed = await callgridAccountingRevenueCacheService.refreshRevenueCache({
      trigger: "manual_endpoint",
    });
    const company = refreshed.payload?.companies?.[0];
    const daysWithRecords =
      company?.revenue?.filter((r) => Array.isArray(r.records) && r.records.length > 0).length || 0;

    return res.status(200).json({
      success: true,
      message: "CallGrid accounting revenue cache refreshed.",
      refreshedAt: refreshed.cache?.refreshedAt || null,
      windowStart: refreshed.windowData?.startDate || null,
      windowEnd: refreshed.windowData?.endDateTimeIso || null,
      daysWithBuyerRecords: daysWithRecords,
      preservedDays: refreshed.preservedDays || 0,
    });
  } catch (err) {
    console.error("CallGrid accounting refreshRevenue error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to refresh CallGrid accounting revenue cache.",
    });
  }
};

/**
 * GET /api/v1/callgrid-accounting/revenue/refresh-status
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
 * GET /api/v1/callgrid-accounting/revenue/cached
 */
exports.getCachedRevenue = async (_req, res) => {
  try {
    const cache = await callgridAccountingRevenueCacheService.getLatestRevenueCache();
    if (!cache || !cache.payload) {
      return res.status(404).json({
        success: false,
        error:
          "No cached CallGrid accounting revenue yet. Trigger POST /api/v1/callgrid-accounting/revenue first.",
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
    console.error("CallGrid accounting getCachedRevenue error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch cached CallGrid accounting revenue.",
    });
  }
};
