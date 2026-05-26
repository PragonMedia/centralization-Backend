const googleConversionService = require("../services/googleConversionService");

async function handleRingbaGoogleConversion(req, res) {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_body",
        message: "Request body must be a JSON object.",
      });
    }

    const result = await googleConversionService.uploadGoogleClickConversion(req.body);
    return res.status(result.statusCode || 200).json(result);
  } catch (error) {
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
  try {
    const rt = req.query?.rt || req.body?.rt;
    if (rt !== "1") {
      return res.status(200).json({ ok: true, skipped: true, reason: "rt flag not set" });
    }

    const payload = { ...req.query, ...(req.body || {}) };
    delete payload.rt;

    const result = await googleConversionService.uploadGoogleClickConversion(payload);
    return res.status(result.statusCode || 200).json(result);
  } catch (error) {
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

