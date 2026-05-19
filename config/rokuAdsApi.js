/**
 * Roku Ads API (beta) — reporting & account reads.
 * Docs: https://developer.ads.roku.com/ads/reference/introduction
 * Not used for Conversions API (CAPI); see config/roku.js.
 */
module.exports = {
  BASE_URL: (process.env.ROKU_ADS_API_BASE_URL || "https://api.ads.roku.com/v1").replace(/\/$/, ""),
  CLIENT_ID: (process.env.ROKU_ADS_CLIENT_ID || "").trim(),
  CLIENT_SECRET: (process.env.ROKU_ADS_CLIENT_SECRET || "").trim(),
  REFRESH_TOKEN: (process.env.ROKU_ADS_REFRESH_TOKEN || "").trim(),
  ACCESS_TOKEN: (process.env.ROKU_ADS_ACCESS_TOKEN || "").trim(),
  REPORT_POLL_INTERVAL_MS: Math.max(500, parseInt(process.env.ROKU_ADS_REPORT_POLL_MS || "3000", 10) || 3000),
  REPORT_POLL_MAX_ATTEMPTS: Math.max(1, parseInt(process.env.ROKU_ADS_REPORT_POLL_MAX || "120", 10) || 120),
  REQUEST_TIMEOUT_MS: Math.max(5000, parseInt(process.env.ROKU_ADS_REQUEST_TIMEOUT_MS || "30000", 10) || 30000),
};
