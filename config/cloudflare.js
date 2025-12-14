const CLOUDFLARE_CONFIG = {
  API_TOKEN: (process.env.CLOUDFLARE_API_TOKEN || "").trim(),
  ACCOUNT_ID: (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
  BASE_URL: "https://api.cloudflare.com/client/v4",
  SERVER_IP: process.env.SERVER_IP || "",
  INTERNAL_SERVER_URL:
    process.env.INTERNAL_SERVER_URL || "http://localhost:3000",
  INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN || "",
  SSL_MODE: process.env.CLOUDFLARE_SSL_MODE || "full", // full, flexible, strict
  // DNS Validation Configuration
  DNS_TIMEOUT: parseInt(process.env.CLOUDFLARE_DNS_TIMEOUT) || 120000, // 2 minutes default
  DNS_POLL_INTERVAL: parseInt(process.env.CLOUDFLARE_POLL_INTERVAL) || 10000, // 10 seconds default
  // SSH Configuration for remote server access
  SSH_HOST: process.env.SSH_HOST || process.env.SERVER_IP || "",
  SSH_USER: process.env.SSH_USER || "root",
  SSH_KEY_PATH: process.env.SSH_KEY_PATH || "", // Path to SSH private key (optional, can use password)
  SSH_PASSWORD: process.env.SSH_PASSWORD || "", // SSH password (if not using key)
  SSH_PORT: parseInt(process.env.SSH_PORT) || 22,
};

module.exports = CLOUDFLARE_CONFIG;
