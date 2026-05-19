/**
 * Smoke test for CallGrid REST API (GET /api/call) — same idea as exercising Retriever before wiring accounting.
 *
 * Env:
 *   CALLGRID_API_KEY or CALLGRID_API_TOKEN (required)
 *   CALLGRID_API_BASE_URL (optional, default https://api.callgrid.com)
 *   CALLGRID_REPORT_TIME_ZONE (optional, default US/Eastern)
 *
 * Usage:
 *   node test-callgrid-api.js
 *   node test-callgrid-api.js --hours 6
 *   node test-callgrid-api.js --start 2026-05-01T00:00:00.000Z --end 2026-05-02T00:00:00.000Z
 *   node test-callgrid-api.js --first-page-only
 *   node test-callgrid-api.js --filters '{"items":[{"operator":"AND","rules":[{"tagName":"CampaignId","values":["YOUR_ID"],"condition":"equals"}]}]}'
 *
 * Docs: https://callgrid.com/api
 */
require("dotenv").config();
const axios = require("axios");

const BASE_URL = (process.env.CALLGRID_API_BASE_URL || "https://api.callgrid.com").replace(
  /\/$/,
  ""
);
const API_KEY = (process.env.CALLGRID_API_KEY || process.env.CALLGRID_API_TOKEN || "").trim();
const DEFAULT_TIMEZONE =
  (process.env.CALLGRID_REPORT_TIME_ZONE || "US/Eastern").trim() || "US/Eastern";

function parseArgs(argv) {
  const out = {
    hours: 24,
    maxItems: 100,
    maxPages: 200,
    pageSleepMs: 500,
    firstPageOnly: false,
    start: null,
    end: null,
    timezone: DEFAULT_TIMEZONE,
    filters: null,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hours") out.hours = Math.max(1, parseInt(argv[++i], 10) || 24);
    else if (a === "--start") out.start = argv[++i];
    else if (a === "--end") out.end = argv[++i];
    else if (a === "--timezone") out.timezone = argv[++i] || out.timezone;
    else if (a === "--max-items") out.maxItems = Math.max(1, parseInt(argv[++i], 10) || 100);
    else if (a === "--max-pages") out.maxPages = Math.max(1, parseInt(argv[++i], 10) || 200);
    else if (a === "--sleep-ms") out.pageSleepMs = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === "--first-page-only") out.firstPageOnly = true;
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--filters") {
      const raw = argv[++i];
      if (!raw) throw new Error("--filters requires JSON string next arg");
      out.filters = JSON.parse(raw);
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractRows(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function summarizeKeys(rows, maxKeys = 40) {
  const keys = new Set();
  for (const row of rows.slice(0, 50)) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) keys.add(k);
    }
  }
  return [...keys].sort().slice(0, maxKeys);
}

async function fetchAllCalls({ startDate, endDate, timezone, maxItems, maxPages, pageSleepMs, firstPageOnly, filters }) {
  const url = `${BASE_URL}/api/call`;
  const all = [];
  let searchAfter = null;
  let page = 0;
  let lastHeaders = {};

  while (page < maxPages) {
    page += 1;
    const params = new URLSearchParams({
      startDate,
      endDate,
      maxItems: String(maxItems),
      useCursor: "true",
      reportTimeZone: timezone,
    });
    if (searchAfter != null) {
      params.set("searchAfter", JSON.stringify(searchAfter));
    }
    if (filters != null) {
      params.set("filters", JSON.stringify(filters));
    }

    const response = await axios.get(`${url}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      timeout: 120000,
      validateStatus: () => true,
    });

    lastHeaders = response.headers || {};

    if (response.status === 401) {
      throw new Error("CallGrid returned 401 — check CALLGRID_API_KEY / CALLGRID_API_TOKEN.");
    }
    if (response.status === 429) {
      const reset = response.headers?.["ratelimit-reset"];
      const waitSec = reset ? parseInt(reset, 10) : 60;
      console.warn(`Rate limited (429). Waiting ${waitSec}s then retrying page ${page}...`);
      await sleep(Math.min(Math.max(waitSec, 1), 120) * 1000);
      page -= 1;
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      const body =
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data).slice(0, 2000);
      throw new Error(`CallGrid HTTP ${response.status}: ${body}`);
    }

    const payload = response.data;
    const rows = extractRows(payload);
    all.push(...rows);

    const hasMore = Boolean(payload?.hasMore);
    const nextCursor = payload?.nextCursor ?? null;

    console.log(
      `Page ${page}: +${rows.length} rows (running total ${all.length}), hasMore=${hasMore}`
    );

    if (firstPageOnly || !hasMore || nextCursor == null) break;
    searchAfter = nextCursor;
    if (pageSleepMs > 0) await sleep(pageSleepMs);
  }

  return { rows: all, lastHeaders };
}

(async () => {
  console.log("CallGrid API test — GET /api/call\n");

  if (!API_KEY) {
    console.error(
      "Missing CALLGRID_API_KEY (or CALLGRID_API_TOKEN) in environment / .env"
    );
    process.exit(1);
  }

  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const now = new Date();
  let startDate;
  let endDate;
  if (opts.start && opts.end) {
    startDate = opts.start;
    endDate = opts.end;
  } else {
    const start = new Date(now.getTime() - opts.hours * 60 * 60 * 1000);
    startDate = start.toISOString();
    endDate = now.toISOString();
  }

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Window:   ${startDate}  →  ${endDate}`);
  console.log(`Timezone: ${opts.timezone}`);
  console.log(`Cursor:   maxItems=${opts.maxItems}, maxPages=${opts.maxPages}, sleep=${opts.pageSleepMs}ms`);
  if (opts.filters) console.log(`Filters:  ${JSON.stringify(opts.filters)}`);
  if (opts.firstPageOnly) console.log("Mode:     first page only\n");
  else console.log("");

  try {
    const { rows, lastHeaders } = await fetchAllCalls({
      startDate,
      endDate,
      timezone: opts.timezone,
      maxItems: opts.maxItems,
      maxPages: opts.maxPages,
      pageSleepMs: opts.pageSleepMs,
      firstPageOnly: opts.firstPageOnly,
      filters: opts.filters,
    });

    console.log("\n--- Result ---");
    console.log(`Total rows fetched: ${rows.length}`);
    if (lastHeaders["ratelimit-remaining"] != null) {
      console.log(
        `Rate limit headers (last response): remaining=${lastHeaders["ratelimit-remaining"]} limit=${lastHeaders["ratelimit-limit"]} reset=${lastHeaders["ratelimit-reset"]}`
      );
    }

    if (rows.length === 0) {
      console.log("\nNo calls in window — widen --hours or adjust --start/--end / filters.");
      process.exit(0);
    }

    const keys = summarizeKeys(rows);
    console.log(`\nSample field keys (from first up to 50 rows, max 40 names):`);
    console.log(keys.join(", "));

    if (opts.verbose) {
      console.log("\nFirst row (verbose — redact before sharing externally):");
      console.log(JSON.stringify(rows[0], null, 2));
    } else {
      console.log(
        "\nRe-run with --verbose to print the first raw call object (for field mapping)."
      );
    }

    console.log("\nOK — CallGrid /api/call reachable.");
    process.exit(0);
  } catch (err) {
    console.error("\nCallGrid test failed:", err.response?.data || err.message || err);
    process.exit(1);
  }
})();
