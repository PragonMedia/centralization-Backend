/**
 * Quick RedTrack API key diagnostic (does not print the key).
 * Usage: node scripts/test-redtrack-key.js
 */
require("dotenv").config();
const axios = require("axios");

const key = (process.env.REDTRACK_API_KEY || "").trim();
const base = process.env.REDTRACK_API_URL || "https://api.redtrack.io";

async function probe(path, params = {}) {
  try {
    const res = await axios.get(`${base}${path}`, {
      params: { api_key: key, ...params },
      timeout: 15000,
    });
    const size = Array.isArray(res.data) ? res.data.length : "object";
    return { ok: true, status: res.status, size };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status,
      error: err.response?.data?.error || err.message,
    };
  }
}

(async () => {
  console.log("RedTrack API diagnostic");
  console.log("base:", base);
  console.log("key configured:", Boolean(key), "length:", key.length);

  if (!key) {
    console.error("\nREDTRACK_API_KEY is missing. Set it in .env (Tools → Integrations → General in RedTrack).");
    process.exit(1);
  }

  for (const path of ["/domains", "/sources", "/campaigns"]) {
    const result = await probe(path, path === "/campaigns" ? { per: 1 } : {});
    console.log(`${path}:`, result);
  }
})();
