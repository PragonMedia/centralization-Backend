/**
 * State Performance routes.
 * Base path: /api/v1/state-performance
 */
const express = require("express");
const router = express.Router();
const statePerformanceController = require("../controllers/statePerformanceController");

router.post("/refresh", statePerformanceController.refreshStatePerformance);
router.get("/cached", statePerformanceController.getCachedStatePerformance);
router.get("/channels", statePerformanceController.getStatePerformanceChannels);

module.exports = router;
