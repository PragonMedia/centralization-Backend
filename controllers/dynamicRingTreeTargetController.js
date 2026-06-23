/**
 * Dynamic Ring Tree Target — pixel ingest + test helpers.
 */
const dynamicRingTreeTargetService = require("../services/dynamicRingTreeTargetService");
const CFG = require("../config/dynamicRingTreeTarget");

exports.health = async (req, res) => {
  return res.status(200).json(dynamicRingTreeTargetService.getHealthPayload());
};

exports.status = async (req, res) => {
  try {
    const profileKey =
      typeof req.query?.profile === "string"
        ? req.query.profile.trim().toLowerCase()
        : typeof req.query?.vertical === "string"
          ? req.query.vertical.trim().toLowerCase()
          : undefined;
    const payload = await dynamicRingTreeTargetService.getStatus(profileKey);
    return res.status(200).json(payload);
  } catch (err) {
    console.error("RingTreeTarget status error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

exports.profiles = async (req, res) => {
  const profiles = Object.values(CFG.getProfiles()).map((p) => ({
    key: p.key,
    label: p.label,
    enabled: p.enabled,
    configured: CFG.isProfileConfigured(p),
    targetNamePrefix: p.targetNamePrefix,
    tiers: (p.tiers || []).map((t) => ({ name: t.name, pingTreeId: t.pingTreeId || null })),
  }));
  return res.status(200).json({ ok: true, profiles });
};

/** Ringba tracking pixel — GET/POST query params */
exports.handleTierRpcPixel = async (req, res) => {
  try {
    const result = await dynamicRingTreeTargetService.handlePixelIngest(req.query || {}, req.body || {});
    const statusCode = result.ok === false && result.status === "invalid_payload" ? 400 : 200;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error("RingTreeTarget pixel error:", err);
    return res.status(500).json({ ok: false, status: "error", message: err.message });
  }
};

/** POST /api/v1/ring-tree-target/test/simulate-batch */
exports.simulateBatch = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await dynamicRingTreeTargetService.simulateTestBatch({
      profileKey: body.profile || body.vertical || body.profileKey || "fe",
      targetId: body.targetId || body.target_id,
      targetName: body.targetName,
      count: body.count,
      revenuePerCall: body.revenuePerCall ?? body.revenue,
    });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error("RingTreeTarget simulateBatch error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

/** POST /api/v1/ring-tree-target/test/single */
exports.simulateSingle = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const q = {
      vertical: body.profile || body.vertical || "fe",
      callId: body.callId || `test-single-${Date.now()}`,
      targetId: body.targetId || body.target_id,
      targetName: body.targetName,
      callerPhone: body.callerPhone || "+15551234567",
      revenue: body.revenue ?? "25",
    };
    const result = await dynamicRingTreeTargetService.handlePixelIngest(q, {});
    return res.status(200).json(result);
  } catch (err) {
    console.error("RingTreeTarget simulateSingle error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

/** POST /api/v1/ring-tree-target/test/reset */
exports.resetTestState = async (req, res) => {
  try {
    const profileKey =
      typeof req.query?.profile === "string"
        ? req.query.profile.trim().toLowerCase()
        : typeof req.body?.profile === "string"
          ? req.body.profile.trim().toLowerCase()
          : undefined;
    const result = await dynamicRingTreeTargetService.resetProfileState(profileKey);
    return res.status(200).json(result);
  } catch (err) {
    console.error("RingTreeTarget reset error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
