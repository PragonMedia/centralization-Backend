const mongoose = require("mongoose");
const ringbaFakeTargetPingService = require("../services/ringbaFakeTargetPingService");

async function handleFakeTargetPing(req, res) {
  try {
    const result = await ringbaFakeTargetPingService.handleFakeTargetPing(
      req.query || {},
      req.body || {},
      req.headers || {}
    );
    return res.status(result.httpStatus).json(result.body);
  } catch (err) {
    console.error("[fake-target-ping] handler error:", err);
    return res.status(200).json(ringbaFakeTargetPingService.getRejectResponse());
  }
}

async function getPings(req, res) {
  try {
    const { pings, pagination } = await ringbaFakeTargetPingService.listPings(
      req.query || {}
    );
    return res.status(200).json({
      success: true,
      count: pings.length,
      pings,
      pagination,
    });
  } catch (err) {
    console.error("[fake-target-ping] list error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
    });
  }
}

async function getPingById(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: "Invalid ping id" });
    }

    const ping = await ringbaFakeTargetPingService.getPingById(id);
    if (!ping) {
      return res.status(404).json({ success: false, error: "Ping not found" });
    }

    return res.status(200).json({ success: true, ping });
  } catch (err) {
    console.error("[fake-target-ping] get by id error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
    });
  }
}

module.exports = {
  handleFakeTargetPing,
  getPings,
  getPingById,
};
