/**
 * Fetch RedTrack traffic channels (API: /sources) and group by naming prefix.
 *   GG - ... → Google
 *   FB - ... → Facebook
 *
 * Usage: node scripts/list-redtrack-traffic-channels.js
 */
require("dotenv").config();
const redtrackService = require("../services/redtrackService");

function summarizeChannel(source) {
  return {
    id: source.id,
    title: source.title,
    alias: source.alias,
    platform: redtrackService.getTrafficChannelPlatform(source.title),
    campaignCount: source.campaign_count,
    paramCount: Array.isArray(source.subs) ? source.subs.length : 0,
  };
}

(async () => {
  console.log("Fetching RedTrack traffic channels...\n");

  if (!process.env.REDTRACK_API_KEY) {
    console.error("REDTRACK_API_KEY is not set in .env");
    process.exit(1);
  }

  try {
    const grouped = await redtrackService.getGroupedTrafficChannels();

    console.log("=== Counts ===");
    console.log(JSON.stringify(grouped.counts, null, 2));
    console.log();

    const printGroup = (label, channels) => {
      console.log(`=== ${label} (${channels.length}) ===`);
      const summary = channels.map(summarizeChannel);
      console.log(JSON.stringify(summary, null, 2));
      console.log();
    };

    printGroup("Google (GG -)", grouped.google);
    printGroup("Facebook (FB -)", grouped.facebook);

    if (grouped.other.length) {
      printGroup("Other (no GG/FB prefix)", grouped.other);
    }

    console.log("Done.");
  } catch (err) {
    console.error("Failed to fetch traffic channels:", err.message);
    if (err.response?.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
})();
