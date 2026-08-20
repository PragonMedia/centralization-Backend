/**
 * CallGrid Medicare ring-tree API.
 * Base: /api/v1/callgrid-ring-tree
 * Webhook: GET|POST /webhooks/callgrid/tier-rpc
 */
const express = require("express");
const router = express.Router();
const callgridRingTreeTargetController = require("../controllers/callgridRingTreeTargetController");

router.get("/health", callgridRingTreeTargetController.health);
router.get("/status", callgridRingTreeTargetController.status);
router.get("/profiles", callgridRingTreeTargetController.profiles);
router.get("/auth-check", callgridRingTreeTargetController.authCheck);
router.get("/discover", callgridRingTreeTargetController.discover);
router.get("/medicare-groups", callgridRingTreeTargetController.medicareGroups);
router.get("/campaigns/:profileKey/groups", callgridRingTreeTargetController.profileGroups);

router.post("/test/simulate-batch", callgridRingTreeTargetController.simulateBatch);
router.post("/test/single", callgridRingTreeTargetController.simulateSingle);
router.post("/test/reset", callgridRingTreeTargetController.reset);

module.exports = router;
