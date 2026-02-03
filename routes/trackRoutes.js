const express = require("express");
const router = express.Router();
const ringbaTriggerTrackingService = require("../services/ringbaTriggerTrackingService");

/**
 * POST /api/v1/track/ringba-trigger
 * Call from lander when Ringba API is triggered (e.g. step 2 "Continue").
 * Body: { domain: string } (required). Optional: route (not yet used for aggregation).
 * File: logs/ringba-trigger-counts.json. Auto-deleted/reset if older than 3 days.
 */
router.post("/ringba-trigger", (req, res) => {
  const domain = req.body?.domain ?? req.query?.domain;
  const domainStr = String(domain ?? "").trim();
  if (!domainStr) {
    return res.status(400).json({ error: "domain is required" });
  }
  const count = ringbaTriggerTrackingService.incrementCount(domainStr);
  return res.status(200).json({ ok: true, domain: domainStr, count });
});

/**
 * GET /api/v1/track/ringba-trigger
 * Returns current counts: { "sample.com": 5, "sample1.com": 12, ... }
 */
router.get("/ringba-trigger", (req, res) => {
  const counts = ringbaTriggerTrackingService.getCounts();
  return res.status(200).json(counts);
});

module.exports = router;
