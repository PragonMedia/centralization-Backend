/**
 * CallGrid CLI — mirrors GET /api/v1/accounting/callgrid/test-data
 *
 * Loads buyers from MongoDB (platform=callgrid). Add companies via POST /api/v1/accounting/companies first.
 *
 *   node test-callgrid-buyers.js --rangeStart 2026-05-04 --rangeEnd 2026-05-08
 *   node test-callgrid-buyers.js --full
 *   node test-callgrid-buyers.js --accountID <callgrid-organizationId>
 *   node test-callgrid-buyers.js --calls
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const Company = require("./models/companyModel");
const { fetchBuyersByDayReport, parseBuyersReportCliArgs } = require("./services/callgridReportService");
const { fetchDashboardBuyersStatsReport, normalizeBuyers } = require("./services/callgridStatsReportService");

function parseAccountIdArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--accountID") return (argv[i + 1] || "").trim();
  }
  return "";
}

async function loadBuyersFromDb(accountIDFilter) {
  const query = { platform: "callgrid" };
  if (accountIDFilter) query.accountID = accountIDFilter;
  const companies = await Company.find(query).lean();
  return normalizeBuyers(
    companies.map((c) => ({
      buyer: c.companyName,
      organizationId: c.accountID,
      apiKey: c.apiToken,
    }))
  );
}

(async () => {
  const useCalls = process.argv.includes("--calls");
  const fullStats = process.argv.includes("--full");
  const accountIDFilter = parseAccountIdArg(process.argv);

  let opts;
  try {
    opts = parseBuyersReportCliArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const buyers = await loadBuyersFromDb(accountIDFilter || undefined);
  await mongoose.disconnect();

  if (!buyers.length) {
    console.error(
      accountIDFilter
        ? `No CallGrid company for accountID ${accountIDFilter}.`
        : "No CallGrid companies in DB. POST /api/v1/accounting/companies with platform callgrid."
    );
    process.exit(1);
  }

  const payload = useCalls
    ? await fetchBuyersByDayReport({
        buyers,
        rangeStart: opts.rangeStart,
        rangeEnd: opts.rangeEnd,
        maxItems: opts.maxItems,
        maxPages: opts.maxPages,
        pageSleepMs: opts.pageSleepMs,
        firstPageOnly: opts.firstPageOnly,
        verbose: opts.verbose,
        template: opts.template,
      })
    : await fetchDashboardBuyersStatsReport({
        buyers,
        rangeStart: opts.rangeStart,
        rangeEnd: opts.rangeEnd,
        requestDelayMs: opts.pageSleepMs,
        minimal: !fullStats,
      });

  if (!payload.success) {
    console.error(payload.error || "CallGrid report failed");
    process.exit(1);
  }

  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
