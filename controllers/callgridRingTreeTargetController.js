const callgridRingTreeTargetService = require("../services/callgridRingTreeTargetService");

exports.health = async (req, res) => {
  return res.status(200).json(callgridRingTreeTargetService.getHealthPayload());
};

exports.status = async (req, res) => {
  try {
    const payload = await callgridRingTreeTargetService.getStatus();
    return res.status(200).json(payload);
  } catch (err) {
    console.error("CallGrid ring-tree status error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

exports.medicareGroups = async (req, res) => {
  try {
    const payload = await callgridRingTreeTargetService.listMedicareGroups();
    return res.status(payload.ok ? 200 : 502).json(payload);
  } catch (err) {
    console.error("CallGrid ring-tree medicare-groups error:", err);
    return res.status(502).json({ ok: false, error: err.message, groups: [] });
  }
};

exports.profiles = async (req, res) => {
  return res.status(200).json({
    ok: true,
    profiles: callgridRingTreeTargetService.listProfilesConfig(),
  });
};

exports.authCheck = async (req, res) => {
  try {
    const payload = await callgridRingTreeTargetService.verifyAuth();
    return res.status(payload.ok ? 200 : 502).json(payload);
  } catch (err) {
    console.error("CallGrid ring-tree auth-check error:", err);
    return res.status(502).json({ ok: false, error: err.message });
  }
};

exports.discover = async (req, res) => {
  try {
    const payload = await callgridRingTreeTargetService.discoverAllCampaigns({
      logToConsole: true,
    });
    return res.status(payload.ok ? 200 : 502).json(payload);
  } catch (err) {
    console.error("CallGrid ring-tree discover error:", err);
    return res.status(502).json({ ok: false, error: err.message });
  }
};

exports.profileGroups = async (req, res) => {
  try {
    const profileKey = String(req.params.profileKey || "").trim().toLowerCase();
    const payload = await callgridRingTreeTargetService.listProfileGroups(profileKey);
    return res.status(payload.ok ? 200 : 404).json(payload);
  } catch (err) {
    console.error("CallGrid ring-tree profile-groups error:", err);
    return res.status(502).json({ ok: false, error: err.message });
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    const result = await callgridRingTreeTargetService.handleWebhookIngest(
      req.query || {},
      req.body || {},
      req.headers || {}
    );
    const statusCode =
      result.status === "unauthorized"
        ? 401
        : result.ok === false && result.status === "invalid_payload"
          ? 400
          : 200;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error("CallGrid ring-tree webhook error:", err);
    return res.status(500).json({ ok: false, status: "error", message: err.message });
  }
};

exports.simulateSingle = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await callgridRingTreeTargetService.simulateSingle(body);
    return res.status(result.ok === false && result.status === "invalid_payload" ? 400 : 200).json(result);
  } catch (err) {
    console.error("CallGrid ring-tree simulateSingle error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

exports.simulateBatch = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await callgridRingTreeTargetService.simulateBatch(body);
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error("CallGrid ring-tree simulateBatch error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

exports.reset = async (req, res) => {
  try {
    const result = await callgridRingTreeTargetService.resetState();
    return res.status(200).json(result);
  } catch (err) {
    console.error("CallGrid ring-tree reset error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
