const mongoose = require("mongoose");

const routeSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true,
    },
    template: {
      type: String,
      required: true,
    },
    domain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Domain",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

routeSchema.index({ path: 1, domain: 1 }, { unique: true }); // Ensure unique route per domain

module.exports = mongoose.model("Route", routeSchema);
