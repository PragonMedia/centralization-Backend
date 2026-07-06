/**
 * One-shot: set exact FB subs template on every FB traffic channel.
 *
 *   node scripts/sync-fb-traffic-channel-subs.js           # dry-run (default)
 *   node scripts/sync-fb-traffic-channel-subs.js --apply     # write to RedTrack
 */
require("dotenv").config();
const { FB_TRAFFIC_CHANNEL_SUBS } = require("../config/redtrackFbSubsTemplate");
const redtrackService = require("../services/redtrackService");

const APPLY = process.argv.includes("--apply");
const DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstSubsDiff(current, template) {
  for (let i = 0; i < template.length; i++) {
    if (!redtrackService.subMatchesTemplate(current[i], template[i])) {
      return {
        index: i,
        expected: template[i],
        actual: redtrackService.normalizeSubAgainstTemplate(
          current[i],
          template[i]
        ),
      };
    }
  }
  return null;
}

(async () => {
  if (!process.env.REDTRACK_API_KEY) {
    console.error("REDTRACK_API_KEY is not set in .env");
    process.exit(1);
  }

  console.log(APPLY ? "APPLY mode — will update RedTrack\n" : "DRY-RUN — no writes\n");

  const sources = await redtrackService.getAllTrafficSources();
  const fbChannels = sources.filter(
    (s) => redtrackService.getTrafficChannelPlatform(s.title) === "facebook"
  );

  console.log(`Found ${fbChannels.length} FB traffic channel(s)\n`);

  const summary = { total: fbChannels.length, skipped: 0, updated: 0, failed: 0 };
  const templateSubs = redtrackService.cloneSubsTemplate(FB_TRAFFIC_CHANNEL_SUBS);

  for (const channel of fbChannels) {
    const label = `${channel.id} | ${channel.title}`;

    if (redtrackService.subsMatchTemplate(channel.subs, templateSubs)) {
      console.log(`SKIP (already exact): ${label}`);
      summary.skipped += 1;
      continue;
    }

    const diff = firstSubsDiff(channel.subs || [], templateSubs);
    if (diff) {
      console.log(`NEEDS UPDATE: ${label}`);
      console.log(`  first diff at subs[${diff.index}]:`);
      console.log(`    expected: ${JSON.stringify(diff.expected)}`);
      console.log(`    actual:   ${JSON.stringify(diff.actual)}`);
    } else {
      console.log(`NEEDS UPDATE: ${label}`);
    }

    if (!APPLY) {
      summary.updated += 1;
      continue;
    }

    try {
      const full = await redtrackService.getTrafficSourceById(channel.id);
      await redtrackService.updateTrafficSource(channel.id, {
        ...full,
        subs: redtrackService.cloneSubsTemplate(templateSubs),
      });
      console.log(`  UPDATED: ${label}`);
      summary.updated += 1;
      await sleep(DELAY_MS);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message;
      console.error(`  FAILED: ${label} — ${msg}`);
      summary.failed += 1;
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (!APPLY && summary.updated > 0) {
    console.log("\nRun with --apply to write changes:");
    console.log("  node scripts/sync-fb-traffic-channel-subs.js --apply");
  }

  if (summary.failed > 0) {
    process.exit(1);
  }
})();
