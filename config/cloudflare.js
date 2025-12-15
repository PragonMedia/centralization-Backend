const CLOUDFLARE_CONFIG = {
  API_TOKEN: (process.env.CLOUDFLARE_API_TOKEN || "").trim(),
  ACCOUNT_ID: (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
  BASE_URL: "https://api.cloudflare.com/client/v4",
  SERVER_IP: process.env.SERVER_IP || "",
  INTERNAL_SERVER_URL:
    process.env.INTERNAL_SERVER_URL || "http://localhost:3000",
  INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN || "",
  SSL_MODE: process.env.CLOUDFLARE_SSL_MODE || "full", // full, flexible, strict
};

module.exports = CLOUDFLARE_CONFIG;
