const express = require("express");
const googleConversionController = require("../controllers/googleConversionController");
const dynamicRingTreeTargetController = require("../controllers/dynamicRingTreeTargetController");

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

module.exports = router;

