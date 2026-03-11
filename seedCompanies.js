/**
 * One-time seed: create "companies" collection and insert PGNM Ringba credentials.
 * Run: node seedCompanies.js
 * Uses same MONGO_URI as the app (from .env).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Company = require("./models/companyModel");

const PGNM_COMPANY = {
  companyName: "PGNM",
  accountID: "RA417e311c6e8b47538624556e6e84298a",
  apiToken:
    "09f0c9f0c033544593cea5409fad971c23237045bad4c7df5c0a6143571bc536a3c02566ee514421a7eaa335c3d3ce87a6b891ac64063ae5bc9aa9bd2bce8d40c843200d925d971d01002993adfaa76202e3726335c93bd6200ac084cc826e48dce6d965ed055392a67eb47d8588f5f9c73ac462",
};

async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set in .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    const existing = await Company.findOne({ accountID: PGNM_COMPANY.accountID });
    if (existing) {
      console.log("Company already exists for accountID:", PGNM_COMPANY.accountID);
      await Company.updateOne(
        { accountID: PGNM_COMPANY.accountID },
        { $set: { companyName: PGNM_COMPANY.companyName, apiToken: PGNM_COMPANY.apiToken } }
      );
      console.log("Updated company record.");
    } else {
      await Company.create(PGNM_COMPANY);
      console.log("Created company:", PGNM_COMPANY.companyName);
    }
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Done.");
  }
}

seed();
