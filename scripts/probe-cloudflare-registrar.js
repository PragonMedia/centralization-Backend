require("dotenv").config();
const axios = require("axios");

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

(async () => {
  console.log("CLOUDFLARE_ACCOUNT_ID set:", Boolean(accountId));
  console.log("CLOUDFLARE_API_TOKEN set:", Boolean(token));

  if (!token || !accountId) {
    process.exit(1);
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    const r = await axios.get(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/registrations`,
      { headers, params: { per_page: 5 } }
    );
    const items = r.data?.result || [];
    console.log("GET registrar/registrations:", r.status, "items:", items.length);
    for (const item of items.slice(0, 3)) {
      console.log(" -", item.domain_name, "auto_renew:", item.auto_renew);
    }
  } catch (e) {
    console.log(
      "GET registrar/registrations FAILED:",
      e.response?.status,
      e.response?.data?.errors?.[0]?.message || e.message
    );
  }
})();
