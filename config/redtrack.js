const REDTRACK_CONFIG = {
  API_KEY: (process.env.REDTRACK_API_KEY || "").trim(),
  API_URL: process.env.REDTRACK_API_URL || "https://api.redtrack.io",
  DEDICATED_DOMAIN: (process.env.REDTRACK_DEDICATED_DOMAIN || "").trim(),
};

module.exports = REDTRACK_CONFIG;
