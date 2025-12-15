const mongoose = require("mongoose");

const routeSchema = new mongoose.Schema({
  route: { type: String, required: true },
  template: { type: String, required: true },
  organization: {
    type: String,
    required: true,
    enum: ["paragon media", "elite", "fluent"],
    default: "paragon media",
  },
  ringbaID: { type: String },
  phoneNumber: { type: String },
  createdBy: { type: String },
  platform: {
    type: String,
    required: true,
    enum: ["Facebook", "Google", "Liftoff", "Bigo", "Media Math"],
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const domainSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true, unique: true },
    assignedTo: { type: String, required: true },
    organization: {
      type: String,
      required: true,
      enum: ["Elite", "Paragon", "Fluent"],
      default: "Paragon",
    },
    id: { type: String, required: true },
    platform: {
      type: String,
      required: true,
      enum: ["Facebook", "Google", "Liftoff", "Bigo", "Media Math"],
    },
    rtkID: { type: String, required: false },
    certificationTags: [{ type: String }],
    routes: [routeSchema],

    // Cloudflare fields
    cloudflareZoneId: {
      type: String,
      required: false,
    },
    aRecordIP: {
      type: String,
      required: false,
    },
    sslStatus: {
      type: String,
      enum: ["pending", "active", "failed", "cf-universal"],
      default: "pending",
    },
    proxyStatus: {
      type: String,
      enum: ["enabled", "disabled"],
      default: "disabled",
    },
    sslActivatedAt: {
      type: Date,
      required: false,
    },
    sslError: {
      type: String,
      required: false,
    },
    cloudflareMetadata: {
      type: Object,
      default: {},
    },

    // RedTrack fields
    redtrackDomainId: {
      type: String,
      required: false,
    },
    redtrackTrackingDomain: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Domain", domainSchema);
