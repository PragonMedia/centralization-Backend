const mongoose = require("mongoose");

const rokuAdSpendCacheSchema = new mongoose.Schema(
  {
    cacheKey: {
      type: String,
      required: true,
      unique: true,
      default: "latest",
      trim: true,
    },
    windowStart: {
      type: Date,
      required: true,
    },
    windowEnd: {
      type: Date,
      required: true,
    },
    timezone: {
      type: String,
      required: true,
      default: "America/New_York",
      trim: true,
    },
    trigger: {
      type: String,
      required: true,
      default: "manual",
      trim: true,
    },
    refreshedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true, collection: "rokuAdSpend" }
);

module.exports = mongoose.model("RokuAdSpendCache", rokuAdSpendCacheSchema);
