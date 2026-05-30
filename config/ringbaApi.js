/**
 * Ringba API config – shared by Accounting and State Performance.
 * Token: set RINGBA_API_KEY or RINGBA_API_TOKEN in .env.
 * Account: set RINGBA_ACCOUNT_ID in .env (PGNM Ringba account).
 */
module.exports = {
  BASE_URL: (process.env.RINGBA_API_BASE_URL || "https://api.ringba.com").trim(),
  API_KEY: (process.env.RINGBA_API_KEY || process.env.RINGBA_API_TOKEN || "").trim(),
  ACCOUNT_ID: (process.env.RINGBA_ACCOUNT_ID || "").trim(),
};
