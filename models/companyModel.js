/**
 * Ringba company/account credentials for Accounting (revenue) API.
 * Stored in MongoDB collection "companies" (same DB as domains, users).
 */
const mongoose = require("mongoose");

const companySchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    accountID: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    apiToken: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Company", companySchema);
