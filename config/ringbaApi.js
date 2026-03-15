/**
 * Ringba API config for Accounting / revenue reporting.
 * Token: set RINGBA_API_KEY or RINGBA_API_TOKEN in .env (same token your working script uses).
 */
module.exports = {
  BASE_URL: (process.env.RINGBA_API_BASE_URL || "https://api.ringba.com").trim(),
  API_KEY: (process.env.RINGBA_API_KEY || process.env.RINGBA_API_TOKEN || "").trim(),
};
