/**
 * Ringba API config for Accounting / revenue reporting.
 * Used to fetch revenue data from Ringba to display on the frontend.
 * Set RINGBA_API_BASE_URL and RINGBA_API_KEY in env when Ringba reporting API is available.
 */
module.exports = {
  BASE_URL: (process.env.RINGBA_API_BASE_URL || "").trim(),
  API_KEY: (process.env.RINGBA_API_KEY || "").trim(),
};
