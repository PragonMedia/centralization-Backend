/**
 * Ringba API config for Accounting / revenue reporting.
 * Used to fetch revenue data from Ringba to display on the frontend.
 * Set RINGBA_API_KEY in .env (your Ringba apiToken). Optionally set RINGBA_API_BASE_URL if different.
 */
module.exports = {
  BASE_URL: (process.env.RINGBA_API_BASE_URL || "https://api.ringba.com").trim(),
  API_KEY: (process.env.RINGBA_API_KEY || "").trim(),
};
