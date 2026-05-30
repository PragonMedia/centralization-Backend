/**
 * State Performance controller – Ringba state insights for frontend display.
 */
const statePerformanceCacheService = require("../services/statePerformanceCacheService");

/**
 * POST /api/v1/state-performance/refresh
 * Fetch 8 weeks from Ringba, clean, console.log, return summary.
 */
exports.refreshStatePerformance = async (req, res) => {
  try {
    const result = await statePerformanceCacheService.refreshStatePerformanceCache({
      trigger: "manual_endpoint",
    });

    if (!result.success && result.message) {
      return res.status(400).json({
        success: false,
        error: result.message,
      });
    }

    const weeks = result.payload?.weeks || [];
    const totalStates = weeks.reduce((sum, w) => sum + (w.states?.length || 0), 0);
    const sampleWeek = weeks.length > 0 ? weeks[weeks.length - 1] : null;

    return res.status(200).json({
      success: result.payload?.success ?? false,
      weeksFetched: weeks.length,
      totalStates,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      sampleWeek: sampleWeek
        ? {
            weekLabel: sampleWeek.weekLabel,
            stateCount: sampleWeek.states?.length || 0,
            topStates: (sampleWeek.states || []).slice(0, 5),
          }
        : null,
      failedWeeks: result.payload?.summary?.failedWeeks || [],
    });
  } catch (err) {
    console.error("StatePerformance refresh error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to refresh state performance data.",
    });
  }
};

/**
 * GET /api/v1/state-performance/cached
 * Read cached payload from Mongo (phase 2).
 */
exports.getCachedStatePerformance = async (req, res) => {
  try {
    const cache = await statePerformanceCacheService.getLatestStatePerformanceCache();
    if (!cache || !cache.payload) {
      return res.status(404).json({
        success: false,
        error: "No cached state performance yet. Trigger POST /api/v1/state-performance/refresh first.",
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
    console.error("StatePerformance getCached error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch cached state performance.",
    });
  }
};
