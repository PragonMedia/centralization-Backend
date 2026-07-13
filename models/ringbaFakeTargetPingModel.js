/**
 * Captured pings from the fake Ring Tree Target (data sink — never routes calls).
 * Collection: ringbaFakeTargetPings
 */
const mongoose = require("mongoose");

const ringbaFakeTargetPingSchema = new mongoose.Schema(
  {
    callId: { type: String, index: true },
    callerId: { type: String, index: true },
    zipCode: { type: String },
    state: { type: String },
    targetId: { type: String },
    targetName: { type: String },
    rawQuery: { type: Object, default: {} },
    rawBody: { type: Object, default: {} },
  },
  { timestamps: true }
);

ringbaFakeTargetPingSchema.index(
  { callId: 1, createdAt: -1 },
  { sparse: true }
);

module.exports = mongoose.model(
  "RingbaFakeTargetPing",
  ringbaFakeTargetPingSchema,
  "ringbaFakeTargetPings"
);
