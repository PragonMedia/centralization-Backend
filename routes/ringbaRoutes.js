const express = require("express");
const router = express.Router();
const ringbaController = require("../controllers/ringbaController");

/**
 * Ringba Webhook Routes
 * 
 * These routes handle webhook requests from Ringba and forward
 * conversions to Google Campaign Manager 360 (CM360)
 * 
 * Rate limiting: NONE - This endpoint must capture all requests
 * (150-200 req/sec expected from Ringba account)
 */

// POST /ringba/conversion
// Receives conversion data from Ringba and forwards to CM360
router.post("/conversion", ringbaController.handleRingbaConversion);

module.exports = router;

