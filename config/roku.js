/**
 * Roku Conversions API (CAPI) configuration
 * API key from Roku Ads Manager → Settings → Events → Generate new API key
 */
module.exports = {
  CAPI_API_KEY: (process.env.ROKU_CAPI_API_KEY || "").trim(),
  CAPI_EVENTS_URL: "https://events.ads.rokuapi.net/v1/events",
};
