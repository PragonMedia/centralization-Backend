const express = require("express");
const googleConversionController = require("../controllers/googleConversionController");

const router = express.Router();

router.post(
  "/ringba/google-conversion",
  googleConversionController.handleRingbaGoogleConversion
);

module.exports = router;

