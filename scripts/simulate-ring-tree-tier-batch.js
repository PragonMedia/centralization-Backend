/**
 * Simulate a 15-call RPC batch against the local API (test flow).
 *
 * Usage:
 *   node scripts/simulate-ring-tree-tier-batch.js --targetId PI1e2efa7...
 *   node scripts/simulate-ring-tree-tier-batch.js --targetId PI1e2efa7... --revenue 30 --profile fe
 *   node scripts/simulate-ring-tree-tier-batch.js --baseUrl http://localhost:3000
 */
require("dotenv").config({ quiet: true });

const axios = require("axios");

function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    profile: "fe",
    targetId: "",
    targetName: "",
    count: 15,
    revenue: 25,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--baseUrl") out.baseUrl = argv[++i] || out.baseUrl;
    else if (a === "--profile" || a === "--vertical") out.profile = argv[++i] || out.profile;
    else if (a === "--targetId" || a === "--target_id") out.targetId = argv[++i] || "";
    else if (a === "--targetName") out.targetName = argv[++i] || "";
    else if (a === "--count") out.count = parseInt(argv[++i], 10) || 15;
    else if (a === "--revenue") out.revenue = parseFloat(argv[++i]) || 25;
  }
  return out;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.targetId) {
    console.error(
      "Usage: node scripts/simulate-ring-tree-tier-batch.js --targetId PI... [--revenue 30] [--profile fe]"
    );
    process.exit(1);
  }

  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/v1/ring-tree-target/test/simulate-batch`;
  console.log(`POST ${url}`);
  console.log(
    `  profile=${opts.profile} targetId=${opts.targetId} count=${opts.count} revenue=${opts.revenue}`
  );

  const { data } = await axios.post(
    url,
    {
      profile: opts.profile,
      targetId: opts.targetId,
      ...(opts.targetName ? { targetName: opts.targetName } : {}),
      count: opts.count,
      revenuePerCall: opts.revenue,
    },
    { timeout: 120000 }
  );

  console.log(JSON.stringify(data, null, 2));
  if (data.lastStatus === "batch_complete") {
    console.log("\nCheck eval in server logs + logs/dynamic-ring-tree-events.jsonl");
    console.log(`Status: GET ${opts.baseUrl}/api/v1/ring-tree-target/status?profile=${opts.profile}`);
  }
})().catch((err) => {
  console.error(err.response?.data || err.message);
  process.exit(1);
});
