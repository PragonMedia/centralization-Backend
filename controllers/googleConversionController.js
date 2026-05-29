const googleConversionService = require("../services/googleConversionService");
const slackService = require("../services/slackService");

async function notifyGoogleConversionFailure(result, source) {
  if (!googleConversionService.shouldNotifyGoogleConversionSlack(result)) return;
  const message = googleConversionService.formatGoogleConversionSlackAlert({
    result,
    source,
  });
  await slackService.sendSlackMessage(message);
}

async function notifyGoogleConversionException(error, source) {
  const message = googleConversionService.formatGoogleConversionSlackAlert({
    source,
    exception: error,
  });
  await slackService.sendSlackMessage(message);
}

async function handleRingbaGoogleConversion(req, res) {
  const source = "Ringba webhook (POST /webhooks/ringba/google-conversion)";
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_body",
        message: "Request body must be a JSON object.",
      });
    }

    const result = await googleConversionService.uploadGoogleClickConversion(req.body);
    await notifyGoogleConversionFailure(result, source);
    return res.status(result.statusCode || 200).json(result);
  } catch (error) {
    await notifyGoogleConversionException(error, source);
    const status = error.response?.status;
    const details = error.response?.data;
    return res.status(500).json({
      ok: false,
      error: "google_conversion_upload_failed",
      message: status ? `Google Ads API error (${status})` : error.message,
      details: details || undefined,
    });
  }
}

async function handleRedTrackGoogleConversion(req, res) {
  const source = "RedTrack postback (GET /webhooks/ringba/google-conversion?rt=1)";
  try {
    const rt = req.query?.rt || req.body?.rt;
    if (rt !== "1") {
      return res.status(200).json({ ok: true, skipped: true, reason: "rt flag not set" });
    }

    const payload = { ...req.query, ...(req.body || {}) };
    delete payload.rt;

    const result = await googleConversionService.uploadGoogleClickConversion(payload);
    await notifyGoogleConversionFailure(result, source);
    return res.status(result.statusCode || 200).json(result);
  } catch (error) {
    await notifyGoogleConversionException(error, source);
    const status = error.response?.status;
    const details = error.response?.data;
    return res.status(500).json({
      ok: false,
      error: "google_conversion_upload_failed",
      message: status ? `Google Ads API error (${status})` : error.message,
      details: details || undefined,
    });
  }
}

module.exports = {
  handleRingbaGoogleConversion,
  handleRedTrackGoogleConversion,
};
