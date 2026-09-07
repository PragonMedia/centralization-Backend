const callgridGtgBlockService = require("../services/callgridGtgBlockService");

/**
 * CallGrid pixel: block inbound number when gtg=1.
 * POST (also accepts GET for easy pixel/browser tests).
 * Body/query: phoneNumber (or CallerId), gtg
 */
async function handleGtgBlock(req, res) {
  try {
    const result = await callgridGtgBlockService.handleGtgBlock(
      req.query || {},
      req.body || {}
    );
    // Always 200 so CallGrid does not retry the pixel.
    return res.status(200).json(result);
  } catch (err) {
    console.error("[callgrid-gtg-block] handler error:", err);
    return res.status(200).json({
      ok: true,
      status: "error",
      message: err.message || "Server error",
      blocked: false,
    });
  }
}

module.exports = {
  handleGtgBlock,
};
