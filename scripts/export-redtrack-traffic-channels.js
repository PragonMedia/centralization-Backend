/**
 * Export all RedTrack traffic channels with full subs (Additional Parameters).
 * Output shape matches OG_RT_PARAMS.json.
 *
 * Usage:
 *   node scripts/export-redtrack-traffic-channels.js
 *   node scripts/export-redtrack-traffic-channels.js --out RT_PARAMS_LIVE.json
 *   node scripts/export-redtrack-traffic-channels.js --platform facebook
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const redtrackService = require("../services/redtrackService");

const outArg = process.argv.indexOf("--out");
const outFile =
  outArg !== -1 ? process.argv[outArg + 1] : null;
const platformFilter = process.argv.includes("--platform")
  ? process.argv[process.argv.indexOf("--platform") + 1]
  : null;

(async () => {
  if (!process.env.REDTRACK_API_KEY) {
    console.error("REDTRACK_API_KEY is not set in .env");
    process.exit(1);
  }

  const sources = await redtrackService.getAllTrafficSources();
  let channels = sources.map((source) => ({
    ...source,
    platform: redtrackService.getTrafficChannelPlatform(source.title),
  }));

  if (platformFilter) {
    channels = channels.filter((c) => c.platform === platformFilter.toLowerCase());
  }

  const payload = {
    ok: true,
    count: channels.length,
    channels,
  };

  const json = JSON.stringify(payload, null, 2);

  if (outFile) {
    const target = path.resolve(outFile);
    fs.writeFileSync(target, json, "utf8");
    console.error(`Wrote ${channels.length} channel(s) to ${target}`);
  }

  console.log(json);
})().catch((err) => {
  console.error("Export failed:", err.message);
  if (err.response?.data) {
    console.error(JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
