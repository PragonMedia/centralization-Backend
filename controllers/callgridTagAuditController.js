const callgridTagAuditService = require("../services/callgridTagAuditService");

/**
 * CallGrid pixel: POST (also accepts GET for easy browser/pixel tests).
 * Body/query: angle, channel, qualified, adaccount, key, phoneNumber, mb
 */
async function handleTagAudit(req, res) {
  try {
    const result = await callgridTagAuditService.handleTagAudit(
      req.query || {},
      req.body || {}
    );
    // Always 200 so CallGrid does not retry the pixel.
    return res.status(200).json(result);
  } catch (err) {
    console.error("[callgrid-tag-audit] handler error:", err);
    return res.status(200).json({
      ok: true,
      status: "error",
      message: err.message || "Server error",
      missing: [],
      notified: false,
    });
  }
}

module.exports = {
  handleTagAudit,
};
