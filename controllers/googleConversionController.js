const googleConversionService = require("../services/googleConversionService");
const slackService = require("../services/slackService");

/**
 * Merge body + query. Query `mcc` wins so Ringba/RedTrack can set ?mcc=1 on the URL.
 */
function buildConversionPayload(req) {
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? { ...req.body }
      : {};
  const query = req.query && typeof req.query === "object" ? req.query : {};
  const payload = { ...query, ...body };
  if (query.mcc != null && String(query.mcc).trim() !== "") {
    payload.mcc = query.mcc;
  }
  return payload;
}

async function notifyGoogleConversionFailure(result, source, callID) {
  if (!googleConversionService.shouldNotifyGoogleConversionSlack(result)) return;
  const message = googleConversionService.formatGoogleConversionSlackAlert({
    result,
    source,
    callID,
  });
  await slackService.sendSlackMessage(message);
}

async function notifyGoogleConversionException(error, source, callID) {
  const message = googleConversionService.formatGoogleConversionSlackAlert({
    source,
    exception: error,
    callID,
  });
  await slackService.sendSlackMessage(message);
}

async function handleRingbaGoogleConversion(req, res) {
  const source = "Ringba webhook (POST /webhooks/ringba/google-conversion)";
  const payload = buildConversionPayload(req);
  const callID = googleConversionService.resolveCallId(payload);
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_body",
        message: "Request body must be a JSON object.",
        ...(callID ? { callID } : {}),
      });
    }

    const result = await googleConversionService.uploadGoogleClickConversion(payload);
    await notifyGoogleConversionFailure(result, source, callID);
    return res.status(result.statusCode || 200).json(result);
  } catch (error) {
    await notifyGoogleConversionException(error, source, callID);
    const status = error.statusCode || error.response?.status;
    const details = error.response?.data;
    return res.status(status && status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error:
        error.code === "mcc1_config_missing"
          ? "mcc1_config_missing"
          : "google_conversion_upload_failed",
      message: status ? `Google Ads API error (${status})` : error.message,
      details: details || undefined,
      ...(error.accountKey ? { accountKey: error.accountKey } : {}),
      ...(error.googleCustomerId ? { googleCustomerId: error.googleCustomerId } : {}),
      ...(callID ? { callID } : {}),
    });
  }
}

async function handleRedTrackGoogleConversion(req, res) {
  const source = "RedTrack postback (GET /webhooks/ringba/google-conversion?rt=1)";
  const payloadPreview = buildConversionPayload(req);
  const callID = googleConversionService.resolveCallId(payloadPreview);
  try {
    const rt = req.query?.rt || req.body?.rt;
    if (rt !== "1") {
      return res.status(200).json({ ok: true, skipped: true, reason: "rt flag not set" });
    }

    const payload = { ...payloadPreview };
    delete payload.rt;

    const result = await googleConversionService.uploadGoogleClickConversion(payload);
    await notifyGoogleConversionFailure(result, source, callID);
    return res.status(result.statusCode || 200).json(result);
  } catch (error) {
    await notifyGoogleConversionException(error, source, callID);
    const status = error.statusCode || error.response?.status;
    const details = error.response?.data;
    return res.status(status && status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error:
        error.code === "mcc1_config_missing"
          ? "mcc1_config_missing"
          : "google_conversion_upload_failed",
      message: status ? `Google Ads API error (${status})` : error.message,
      details: details || undefined,
      ...(error.accountKey ? { accountKey: error.accountKey } : {}),
      ...(error.googleCustomerId ? { googleCustomerId: error.googleCustomerId } : {}),
      ...(callID ? { callID } : {}),
    });
  }
}

module.exports = {
  handleRingbaGoogleConversion,
  handleRedTrackGoogleConversion,
};
