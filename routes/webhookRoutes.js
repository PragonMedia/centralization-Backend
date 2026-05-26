const express = require("express");
const googleConversionController = require("../controllers/googleConversionController");

const router = express.Router();

router.post(
  "/ringba/google-conversion",
  googleConversionController.handleRingbaGoogleConversion
);

router.get(
  "/ringba/google-conversion",
  googleConversionController.handleRedTrackGoogleConversion
);

module.exports = router;

