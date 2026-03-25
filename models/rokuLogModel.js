/**
 * Roku CAPI debug logs
 * Stored in MongoDB collection: `rokuLogs` (intended for the "test" database in Atlas).
 *
 * IMPORTANT: This schema intentionally stores un-hashed PII fields for debugging.
 */
const mongoose = require("mongoose");

const rokuLogSchema = new mongoose.Schema(
  {
    aaCalled: { type: Boolean, required: true },
    aaSuccess: { type: Boolean, required: true },

    ringba: {
      type: Object,
      default: {},
    },

    plainUserData: {
      type: Object,
      default: {},
    },

    rokuRequest: {
      type: Object,
      default: {},
    },

    rokuResponse: {
      type: Object,
      default: null,
    },

    rokuError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("RokuLog", rokuLogSchema, "rokuLogs");

