/**
 * Dynamic Ring Tree Target API + test flow.
 * Base: /api/v1/ring-tree-target
 * Pixel (Ringba): GET /webhooks/ringba/tier-rpc
 */
const express = require("express");
const router = express.Router();
const dynamicRingTreeTargetController = require("../controllers/dynamicRingTreeTargetController");

router.get("/health", dynamicRingTreeTargetController.health);
router.get("/status", dynamicRingTreeTargetController.status);
router.get("/profiles", dynamicRingTreeTargetController.profiles);

router.post("/test/simulate-batch", dynamicRingTreeTargetController.simulateBatch);
router.post("/test/single", dynamicRingTreeTargetController.simulateSingle);
router.post("/test/reset", dynamicRingTreeTargetController.resetTestState);

module.exports = router;
