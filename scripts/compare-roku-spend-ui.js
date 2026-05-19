/**
 * Compare Roku Ads API spend totals vs Ads Manager UI (manual check).
 *
 * Usage:
 *   node scripts/compare-roku-spend-ui.js --start 2026-05-04 --end 2026-05-08
 *   node scripts/compare-roku-spend-ui.js --start 2026-05-04 --end 2026-05-08 --accountUid <uid>
 *   node scripts/compare-roku-spend-ui.js --start 2026-05-04 --end 2026-05-08 --verbose
 *   node scripts/compare-roku-spend-ui.js --start 2026-05-04 --end 2026-05-08 --skip-permission-check
 *
 * Requires .env: ROKU_ADS_CLIENT_ID, ROKU_ADS_CLIENT_SECRET, ROKU_ADS_REFRESH_TOKEN
 *   (or ROKU_ADS_ACCESS_TOKEN for a short-lived token).
 */
require("dotenv").config({ quiet: true });
const rokuAdsReportService = require("../services/rokuAdsReportService");

function parseArgs(argv) {
  const out = { start: "", end: "", accountUid: "", verbose: false, skipPermissionCheck: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--start") out.start = argv[++i] || "";
    else if (a === "--end") out.end = argv[++i] || "";
    else if (a === "--accountUid") out.accountUid = argv[++i] || "";
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--skip-permission-check") out.skipPermissionCheck = true;
  }
  return out;
}

(async () => {
  const { start, end, accountUid, verbose, skipPermissionCheck } = parseArgs(process.argv.slice(2));
  if (!start || !end) {
    console.error("Usage: node scripts/compare-roku-spend-ui.js --start YYYY-MM-DD --end YYYY-MM-DD [--accountUid uid]");
    process.exit(1);
  }

  console.log("Checking developer app permissions...");
  const perms = await rokuAdsReportService.getDeveloperPermissions();
  const roleSummary = perms.accounts.map((a) => `${a.accountName}: ${a.roles.join(", ") || "?"}`);
  console.log(roleSummary.join("\n"));
  if (perms.audienceManagerOnly) {
    console.error(
      "\n❌ All accounts are Audience Manager only. Switch to Viewer in Roku Ads Manager → Developer app, then re-run OAuth.\n"
    );
    if (!skipPermissionCheck) process.exit(1);
  } else if (perms.viewerOnly) {
    console.log("\n✓ Viewer on all accounts (correct role for spend reports on developer apps).\n");
  }

  console.log("\nFetching ad accounts...");
  const accountsResult = await rokuAdsReportService.listAdAccounts({ limit: 100 });
  console.log(JSON.stringify(accountsResult.accounts, null, 2));

  console.log(`\nCreating async spend report ${start} → ${end}...`);
  const spend = await rokuAdsReportService.fetchSpendForRange({
    startDate: start,
    endDate: end,
    accountUid: accountUid || undefined,
    verbose,
    checkPermissions: !skipPermissionCheck,
    poll: { verbose },
  });

  if (!spend.success) {
    console.error("Spend report failed:", spend.error || spend);
    process.exit(1);
  }

  console.log("\n=== API spend summary ===");
  console.log("Total spend:", spend.totals.spend);
  console.log("By account:");
  for (const row of spend.byAccount) {
    console.log(`  ${row.accountName || row.accountId || "unknown"}: ${row.spend}`);
  }

  console.log("\n=== Manual UI validation ===");
  console.log("1. Open https://ads.roku.com/ → Reports");
  console.log(`2. Set date range: ${start} through ${end}`);
  console.log("3. Dimension: Account (and Date if comparing daily)");
  console.log("4. Metric: Spend");
  if (accountUid) console.log(`5. Filter to account uid: ${accountUid}`);
  console.log("6. Compare UI total Spend to API total above (small rounding differences OK).");
  console.log(`\nReport uid: ${spend.reportUid}`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
