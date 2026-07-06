require("dotenv").config();
const axios = require("axios");

(async () => {
  const r = await axios.get("https://api.redtrack.io/domains", {
    params: { api_key: process.env.REDTRACK_API_KEY, per: 500 },
  });
  const items = r.data.items || (Array.isArray(r.data) ? r.data : []);
  const q = (process.argv[2] || "").toLowerCase();
  const hits = q
    ? items.filter((d) =>
        `${d.url || ""} ${d.rootDomain || ""}`.toLowerCase().includes(q)
      )
    : items.slice(0, 5);
  console.log(JSON.stringify(hits.map((d) => ({ id: d.id, url: d.url })), null, 2));
  console.log("total:", items.length);
})();
