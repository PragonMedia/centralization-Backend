const redtrackService = require("../services/redtrackService");

function enrichChannel(source) {
  return {
    ...source,
    platform: redtrackService.getTrafficChannelPlatform(source.title),
  };
}

/**
 * GET /api/v1/redtrack/traffic-channels
 * Query: grouped=true — bucket by GG (google) / FB (facebook) / other
 */
exports.getTrafficChannels = async (req, res) => {
  try {
    if (!process.env.REDTRACK_API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "REDTRACK_API_KEY is not configured",
      });
    }

    const grouped = ["1", "true", "yes"].includes(
      String(req.query?.grouped ?? "").trim().toLowerCase()
    );

    if (grouped) {
      const result = await redtrackService.getGroupedTrafficChannels();
      return res.status(200).json({
        ok: true,
        grouped: true,
        counts: result.counts,
        google: result.google.map(enrichChannel),
        facebook: result.facebook.map(enrichChannel),
        other: result.other.map(enrichChannel),
      });
    }

    const sources = await redtrackService.getAllTrafficSources();
    const channels = sources.map(enrichChannel);

    return res.status(200).json({
      ok: true,
      count: channels.length,
      channels,
    });
  } catch (err) {
    const upstreamStatus = err.response?.status;
    const upstreamError =
      err.response?.data?.error ||
      err.response?.data?.message ||
      err.message;

    console.error("RedTrack getTrafficChannels error:", {
      message: err.message,
      upstreamStatus,
      upstreamError,
      path: "/sources",
    });

    // RedTrack often returns 500 when api_key is invalid/expired (not 401).
    if (upstreamStatus === 500) {
      return res.status(502).json({
        ok: false,
        error: "RedTrack API returned an error",
        upstream: "redtrack",
        upstreamStatus,
        upstreamError,
        hint:
          "Verify REDTRACK_API_KEY in .env matches RedTrack → Tools → Integrations → General. Run: node scripts/test-redtrack-key.js",
      });
    }

    const status = upstreamStatus || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: upstreamError,
      upstream: upstreamStatus ? "redtrack" : undefined,
      upstreamStatus,
    });
  }
};
