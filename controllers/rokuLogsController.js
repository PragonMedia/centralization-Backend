const RokuLog = require("../models/rokuLogModel");

exports.getAllRokuLogs = async (req, res) => {
  try {
    const rawLimit = req.query?.limit;
    const parsed = rawLimit != null ? parseInt(String(rawLimit), 10) : 100;
    const limit = Number.isFinite(parsed) ? parsed : 100;
    const safeLimit = Math.min(Math.max(limit, 1), 5000);

    const logs = await RokuLog.find({})
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean();

    return res.status(200).json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (err) {
    console.error("RokuLogs: failed to fetch logs:", err);
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
};

