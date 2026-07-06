require("dotenv").config();
const axios = require("axios");

const token = process.env.CLOUDFLARE_API_TOKEN;

(async () => {
  try {
    const r = await axios.get("https://api.cloudflare.com/client/v4/zones", {
      headers: { Authorization: `Bearer ${token}` },
      params: { per_page: 1 },
    });
    console.log("GET zones:", r.status, "sample:", r.data?.result?.[0]?.name);
  } catch (e) {
    console.log(
      "GET zones FAILED:",
      e.response?.status,
      e.response?.data?.errors?.[0]?.message || e.message
    );
    process.exit(1);
  }
})();
