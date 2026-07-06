/**
 * RedTrack API proxy.
 * Base: /api/v1/redtrack
 */
const express = require("express");
const router = express.Router();
const redtrackController = require("../controllers/redtrackController");

router.get("/traffic-channels", redtrackController.getTrafficChannels);

module.exports = router;
