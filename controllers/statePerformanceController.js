/**
 * State Performance controller – Ringba state insights for frontend display.
 */
const statePerformanceCacheService = require("../services/statePerformanceCacheService");
const statePerformanceService = require("../services/statePerformanceService");

/**
 * POST /api/v1/state-performance/refresh
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

    const days = result.payload?.days || [];
    const channels = result.payload?.channels || [];
    const sampleDay = days.length > 0 ? days[days.length - 1] : null;

    return res.status(200).json({
      success: result.payload?.success ?? false,
      daysFetched: days.length,
      channelsDiscovered: channels.length,
      channels,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      sampleDay: sampleDay
        ? {
            day: sampleDay.day,
            totalStateCount: sampleDay.total?.states?.length || 0,
            topTotalStates: (sampleDay.total?.states || []).slice(0, 5),
            channelBreakdown: (sampleDay.channels || []).map((c) => ({
              channel: c.channel,
              stateCount: c.states?.length || 0,
            })),
          }
        : null,
      failedDays: result.payload?.summary?.failedDays || [],
      failedChannelDays: result.payload?.summary?.failedChannelDays || [],
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

/**
 * GET /api/v1/state-performance/channels
 * Live channel list from Ringba (full rolling 2-month discovery window).
 */
exports.getStatePerformanceChannels = async (req, res) => {
  try {
    const creds = statePerformanceCacheService.resolveRingbaCredentials();
    if (!creds.success) {
      return res.status(400).json({ success: false, error: creds.message, channels: [] });
    }

    const windowData = statePerformanceService.getRollingTwoMonthWindow();
    const result = await statePerformanceService.listChannelsFromRingba({
      accountID: creds.accountID,
      apiToken: creds.apiToken,
      baseUrl: creds.baseUrl,
      startDate: windowData.startDate,
      endDateTimeIso: windowData.endDateTimeIso,
    });

    return res.status(result.success ? 200 : 400).json({
      success: result.success,
      channels: result.channels || [],
      reportStart: result.reportStart || null,
      reportEnd: result.reportEnd || null,
      error: result.message,
    });
  } catch (err) {
    console.error("StatePerformance getChannels error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch channels from Ringba.",
      channels: [],
    });
  }
};