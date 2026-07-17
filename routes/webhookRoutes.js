const express = require("express");
const googleConversionController = require("../controllers/googleConversionController");
const dynamicRingTreeTargetController = require("../controllers/dynamicRingTreeTargetController");
const ringbaFakeTargetPingController = require("../controllers/ringbaFakeTargetPingController");

const router = express.Router();

router.post(
  "/ringba/google-conversion",
  googleConversionController.handleRingbaGoogleConversion
);

router.get(
  "/ringba/google-conversion",
  googleConversionController.handleRedTrackGoogleConversion
);

router.get("/ringba/tier-rpc", dynamicRingTreeTargetController.handleTierRpcPixel);
router.post("/ringba/tier-rpc", dynamicRingTreeTargetController.handleTierRpcPixel);

// Separate pixels per campaign (path locks vertical; body does not need vertical)
router.get(
  "/ringba/tier-rpc/:vertical",
  dynamicRingTreeTargetController.handleTierRpcPixelForVertical
);
router.post(
  "/ringba/tier-rpc/:vertical",
  dynamicRingTreeTargetController.handleTierRpcPixelForVertical
);

router.get(
  "/ringba/fake-target-ping",
  ringbaFakeTargetPingController.handleFakeTargetPing
);
router.post(
  "/ringba/fake-target-ping",
  ringbaFakeTargetPingController.handleFakeTargetPing
);

module.exports = router;

