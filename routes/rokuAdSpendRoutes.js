/**
 * Roku ad spend cache routes.
 * Base path: /api/v1/roku-ad-spend
 */
const express = require("express");
const router = express.Router();
const rokuAdSpendController = require("../controllers/rokuAdSpendController");

router.post("/refresh", rokuAdSpendController.refreshRokuAdSpend);
router.get("/cached", rokuAdSpendController.getCachedRokuAdSpend);

module.exports = router;
