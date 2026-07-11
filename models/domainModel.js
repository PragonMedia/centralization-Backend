const mongoose = require("mongoose");
const { DOMAIN_VERTICALS } = require("../config/domainVerticals");

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
  rtkID: { type: String },
  phoneNumber: { type: String },
  createdBy: { type: String },
  platform: {
    type: String,
    required: true,
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
    },
    vertical: {
      type: String,
      enum: DOMAIN_VERTICALS,
      required: false,
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
    previousRedtrackDomainId: {
      type: String,
      required: false,
    },

    // Lifecycle: active domains are live; archived domains keep all data but are offline
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    archivedAt: { type: Date, required: false },
    archivedBy: { type: String, required: false },
    purgeAt: { type: Date, required: false },
    restoredAt: { type: Date, required: false },
    restoredBy: { type: String, required: false },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Domain", domainSchema);
