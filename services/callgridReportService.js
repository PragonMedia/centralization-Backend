/**
 * CallGrid: fetch /api/call and aggregate revenue by VendorId × calendar day (report timezone).
 * Used by GET /api/v1/accounting/callgrid/test-data and test-callgrid-buyers.js.
 */
const axios = require("axios");
const { normalizeBuyers } = require("./callgridStatsReportService");

/** CallGrid dashboard vendor picker labels (wire rows often use short VendorName, e.g. PM). */
const DEFAULT_UI_VENDOR_NAMES = [
  "Persistent Policies",
  "AR Media",
  "Naked Media",
  "PPC Media Services",
  "DigiPeak",
  "Insurco",
  "Health Quotes",
];

const PAYOUT_FIELD_KEYS = [
  "WinningBidAmount",
  "payout",
  "CallPayout",
  "payoutAmount",
  "revenue",
  "buyerPayout",
  "publisherPayout",
  "estimatedPayout",
  "conversionAmount",
  "mediaCost",
  "amount",
  "totalPayout",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ianaFromReportTz(tz) {
  const s = String(tz).trim();
  if (/^US\/Eastern$/i.test(s)) return "America/New_York";
  if (/^US\/Central$/i.test(s)) return "America/Chicago";
  if (/^US\/Mountain$/i.test(s)) return "America/Denver";
  if (/^US\/Pacific$/i.test(s)) return "America/Los_Angeles";
  return /\//.test(s) ? s : "America/New_York";
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`Invalid YYYY-MM-DD: ${s}`);
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

function addGregorianDays(y, mo, d, n) {
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function enumerateInclusiveYmd(startStr, endStr) {
  const a = parseYmd(startStr);
  const b = parseYmd(endStr);
  if (a.y * 1e4 + a.mo * 100 + a.d > b.y * 1e4 + b.mo * 100 + b.d) {
    throw new Error(`range-start ${startStr} is after range-end ${endStr}`);
  }
  const out = [];
  let { y, mo, d } = a;
  for (;;) {
    out.push({
      y,
      mo,
      d,
      iso: `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
    if (y === b.y && mo === b.mo && d === b.d) break;
    ({ y, mo, d } = addGregorianDays(y, mo, d, 1));
  }
  return out;
}

function localDateParts(ms, iana) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const o = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of dtf.formatToParts(new Date(ms))) {
    if (p.type in o) o[p.type] = parseInt(p.value, 10);
  }
  return o;
}

function ymdKeyFromParts(p) {
  return p.year * 1e4 + p.month * 100 + p.day;
}

/** Civil calendar (y, mo, d) as integer for comparisons. */
function ymdCalendarKey(y, mo, d) {
  return y * 1e4 + mo * 100 + d;
}

/**
 * UTC instant at the start of civil date (y, mo, d) in IANA zone (local midnight).
 * Binary search — avoids the old 1s scan missing exact midnight and returning `lo` (wrong day).
 */
function startOfLocalCalendarDayUtcMs(y, mo, d, iana) {
  const want = ymdCalendarKey(y, mo, d);
  let lo = Date.UTC(y, mo - 1, d) - 72 * 3600000;
  let hi = Date.UTC(y, mo - 1, d) + 72 * 3600000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const key = ymdKeyFromParts(localDateParts(mid, iana));
    if (key >= want) hi = mid;
    else lo = mid;
  }
  return hi;
}

function apiWindowIso(rangeStartYmd, rangeEndYmd, iana) {
  const { y: ys, mo: ms, d: ds } = parseYmd(rangeStartYmd);
  const { y: ye, mo: me, d: de } = parseYmd(rangeEndYmd);
  const startMs = startOfLocalCalendarDayUtcMs(ys, ms, ds, iana);
  const endNext = addGregorianDays(ye, me, de, 1);
  const endMs = startOfLocalCalendarDayUtcMs(endNext.y, endNext.mo, endNext.d, iana) - 1;
  return { startDate: new Date(startMs).toISOString(), endDate: new Date(endMs).toISOString() };
}

/** Label for the same civil day as `days[]` / `YYYY-MM-DD` (no local-midnight skew). */
function formatCivilDayLabel(y, mo, d) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)));
}

function extractRows(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function pickDirect(row, keys) {
  if (!row || typeof row !== "object") return "";
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
  }
  return "";
}

function parseMoney(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = parseFloat(String(v).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function guessPayoutShallow(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/payout|revenue|amount|conversion|cost|price|earn|media|fee|total|bid|publisher|buyer/i.test(k)) {
      const n = parseMoney(v);
      if (n != null) return n;
    }
  }
  return null;
}

function guessPayoutDeep(row, maxDepth) {
  const seen = new WeakSet();
  function walk(obj, depth) {
    if (!obj || depth < 0) return null;
    if (typeof obj !== "object") return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    const shallow = guessPayoutShallow(obj);
    if (shallow != null) return shallow;
    if (Array.isArray(obj)) {
      for (const el of obj) {
        const n = walk(el, depth - 1);
        if (n != null) return n;
      }
      return null;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") {
        const n = walk(v, depth - 1);
        if (n != null) return n;
      }
    }
    return null;
  }
  return walk(row, maxDepth);
}

function guessPayout(row) {
  if (!row || typeof row !== "object") return null;
  const bid = parseMoney(row.WinningBidAmount);
  const rev = parseMoney(row.revenue);
  const payoutField = parseMoney(row.payout);
  const callP = parseMoney(row.CallPayout);
  if (bid != null && bid > 0) return bid;
  if (rev != null && rev > 0) return rev;
  if (payoutField != null && payoutField > 0) return payoutField;
  if (callP != null && callP > 0) return callP;
  for (const k of PAYOUT_FIELD_KEYS) {
    const n = parseMoney(row[k]);
    if (n != null && n > 0) return n;
  }
  if (bid != null) return bid;
  if (rev != null) return rev;
  if (payoutField != null) return payoutField;
  if (callP != null) return callP;
  for (const nest of [row.call, row.data, row.callDetails, row.details, row.attributes, row.metadata]) {
    const n = guessPayoutShallow(nest || {});
    if (n != null) return n;
  }
  return guessPayoutDeep(row, 6);
}

function rowEventMs(row) {
  const raw =
    pickDirect(row, ["UTCISODate", "utcISODate", "createdAt", "updatedAt"]) ||
    (row.UTCUnixTimeMs != null ? String(row.UTCUnixTimeMs) : "") ||
    (row.UTCUnixTime != null ? String(Number(row.UTCUnixTime) * 1000) : "");
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function collectStringValues(obj, maxDepth, maxStrings, out) {
  if (out.length >= maxStrings || maxDepth < 0 || obj == null) return;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t) out.push(t);
    return;
  }
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      collectStringValues(el, maxDepth - 1, maxStrings, out);
      if (out.length >= maxStrings) return;
    }
    return;
  }
  for (const k of Object.keys(obj)) {
    collectStringValues(obj[k], maxDepth - 1, maxStrings, out);
    if (out.length >= maxStrings) return;
  }
}

function rowMatchesUiVendor(row, targetName) {
  const want = norm(targetName);
  if (want.length < 2) return false;
  const fields = [
    pickDirect(row, ["VendorName", "vendorName"]),
    pickDirect(row, ["CampaignName", "campaignName"]),
    pickDirect(row, ["SourceName", "sourceName"]),
  ].filter(Boolean);
  for (const f of fields) {
    const nf = norm(f);
    if (nf === want || (want.length >= 4 && nf.includes(want))) return true;
  }
  const buf = [];
  collectStringValues(row, 8, 400, buf);
  for (const s of buf) {
    const ns = norm(s);
    if (ns === want || (want.length >= 4 && ns.includes(want))) return true;
  }
  return false;
}

function firstMatchingUiVendor(row, uiNamesInOrder) {
  for (const name of uiNamesInOrder) {
    if (rowMatchesUiVendor(row, name)) return name;
  }
  return null;
}

function parseUiVendorNameList(options) {
  if (Array.isArray(options.uiVendorNames)) {
    return options.uiVendorNames.map((s) => String(s).trim()).filter(Boolean);
  }
  const raw = (options.uiVendors || process.env.CALLGRID_UI_VENDOR_NAMES || "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...DEFAULT_UI_VENDOR_NAMES];
}

async function fetchCallsPage({ baseUrl, apiKey, startDate, endDate, timezone, maxItems, searchAfter, filters }) {
  const url = `${baseUrl}/api/call`;
  const params = new URLSearchParams({
    startDate,
    endDate,
    maxItems: String(maxItems),
    useCursor: "true",
    reportTimeZone: timezone,
  });
  if (searchAfter != null) params.set("searchAfter", JSON.stringify(searchAfter));
  if (filters != null) params.set("filters", JSON.stringify(filters));

  const response = await axios.get(`${url}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 120000,
    validateStatus: () => true,
  });

  if (response.status === 401) {
    throw new Error("CallGrid 401 — check CALLGRID_API_KEY in .env");
  }
  if (response.status === 429) {
    const reset = parseInt(response.headers?.["ratelimit-reset"] || "45", 10);
    await sleep(Math.min(Math.max(reset, 1), 120) * 1000);
    return fetchCallsPage({ baseUrl, apiKey, startDate, endDate, timezone, maxItems, searchAfter, filters });
  }
  if (response.status < 200 || response.status >= 300) {
    const body =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data).slice(0, 1500);
    throw new Error(`CallGrid HTTP ${response.status}: ${body}`);
  }

  return response.data;
}

async function fetchAllCallsInWindow(opts) {
  const { baseUrl, apiKey, startDate, endDate, timezone, maxItems, maxPages, pageSleepMs, firstPageOnly, verbose } =
    opts;
  const all = [];
  let searchAfter = null;

  for (let page = 1; page <= maxPages; page++) {
    const payload = await fetchCallsPage({
      baseUrl,
      apiKey,
      startDate,
      endDate,
      timezone,
      maxItems,
      searchAfter,
      filters: null,
    });
    const rows = extractRows(payload);
    all.push(...rows);
    const hasMore = Boolean(payload?.hasMore);
    const nextCursor = payload?.nextCursor ?? null;
    if (verbose) {
      console.error(`  page ${page}: +${rows.length} (total ${all.length}), hasMore=${hasMore}`);
    }

    if (firstPageOnly || !hasMore || nextCursor == null) break;
    searchAfter = nextCursor;
    if (pageSleepMs > 0) await sleep(pageSleepMs);
  }
  return all;
}

function roundMoney(n) {
  return Math.round(n * 10000) / 10000;
}

function aggregateOrgPayoutByDay(rows, dayList, iana) {
  const byDay = new Map();
  for (const row of rows) {
    const tMs = rowEventMs(row);
    if (tMs == null) continue;
    const p = localDateParts(tMs, iana);
    const dayIso = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    if (!dayList.some((x) => x.iso === dayIso)) continue;
    const amt = guessPayout(row);
    const add = amt != null && Number.isFinite(amt) ? amt : 0;
    byDay.set(dayIso, roundMoney((byDay.get(dayIso) || 0) + add));
  }
  return byDay;
}

function aggregateUiBuyer(rows, dayList, iana, uiName) {
  const byDay = new Map();
  let callsMatched = 0;
  for (const row of rows) {
    const tMs = rowEventMs(row);
    if (tMs == null) continue;
    const p = localDateParts(tMs, iana);
    const dayIso = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    if (!dayList.some((x) => x.iso === dayIso)) continue;
    if (firstMatchingUiVendor(row, [uiName]) !== uiName) continue;
    const amt = guessPayout(row);
    const add = amt != null && Number.isFinite(amt) ? amt : 0;
    byDay.set(dayIso, roundMoney((byDay.get(dayIso) || 0) + add));
    callsMatched += 1;
  }
  return { byDay, callsMatched };
}

/**
 * @param {Object} options
 * @param {string} [options.rangeStart] - YYYY-MM-DD
 * @param {string} [options.rangeEnd] - YYYY-MM-DD inclusive
 * @param {string} [options.baseUrl] - defaults CALLGRID_API_BASE_URL or https://api.callgrid.com
 * @param {string} [options.reportTimeZone] - defaults CALLGRID_REPORT_TIME_ZONE or US/Eastern
 * @param {Array<{buyer:string,organizationId:string,apiKey:string}>} options.buyers - required
 * @returns {Promise<{ success: boolean, error?: string, range?: object, meta?: object, buyers?: array }>}
 */
async function fetchBuyersByDayReport(options = {}) {
  const dashboardBuyers = normalizeBuyers(options.buyers);
  if (!dashboardBuyers.length) {
    return {
      success: false,
      source: "callgrid_live",
      error: "No CallGrid buyers provided. Load companies with platform=callgrid from the database.",
    };
  }
  const baseUrl = (options.baseUrl || process.env.CALLGRID_API_BASE_URL || "https://api.callgrid.com").replace(
    /\/$/,
    ""
  );
  const reportTz = (options.reportTimeZone || process.env.CALLGRID_REPORT_TIME_ZONE || "US/Eastern").trim() || "US/Eastern";

  const y = new Date().getUTCFullYear();
  const reportYear = Math.max(2000, parseInt(process.env.CALLGRID_REPORT_YEAR || String(y), 10) || y);
  let rangeStart = (options.rangeStart || process.env.CALLGRID_REPORT_RANGE_START || "").trim();
  let rangeEnd = (options.rangeEnd || process.env.CALLGRID_REPORT_RANGE_END || "").trim();
  if (!rangeStart) rangeStart = `${reportYear}-05-04`;
  if (!rangeEnd) rangeEnd = `${reportYear}-05-08`;

  const maxItems = Math.max(1, options.maxItems ?? 100);
  const maxPages = Math.max(1, options.maxPages ?? 300);
  const pageSleepMs = Math.max(0, options.pageSleepMs ?? 500);
  const firstPageOnly = Boolean(options.firstPageOnly);
  const verbose = Boolean(options.verbose);
  const templateRaw = String(options.template || process.env.CALLGRID_REPORT_TEMPLATE || "wire")
    .trim()
    .toLowerCase();
  const useUiTemplate = templateRaw === "ui" || templateRaw === "dashboard";

  let dayList;
  try {
    dayList = enumerateInclusiveYmd(rangeStart, rangeEnd);
  } catch (e) {
    return { success: false, source: "callgrid_live", error: e.message || String(e) };
  }

  const iana = ianaFromReportTz(reportTz);
  const { startDate, endDate } = apiWindowIso(rangeStart, rangeEnd, iana);

  const buyersOut = [];
  let totalCallsFetched = 0;
  const vendorIdsSeenAll = new Set();

  for (const cfg of dashboardBuyers) {
    const buyerLabel = String(cfg.buyer || cfg.organizationId || "").trim();
    if (!cfg.apiKey) {
      buyersOut.push({
        buyer: buyerLabel,
        organizationId: cfg.organizationId || null,
        apiKeyConfigured: false,
        error: `Missing apiToken for "${buyerLabel}". Add CallGrid API key on the company record.`,
        revenue: dayList.map(({ y, mo, d, iso }) => ({
          date: formatCivilDayLabel(y, mo, d),
          amount: 0,
        })),
      });
      continue;
    }

    let rows;
    try {
      rows = await fetchAllCallsInWindow({
        baseUrl,
        apiKey: cfg.apiKey,
        startDate,
        endDate,
        timezone: reportTz,
        maxItems,
        maxPages,
        pageSleepMs,
        firstPageOnly,
        verbose,
      });
    } catch (e) {
      buyersOut.push({
        buyer: buyerLabel,
        organizationId: cfg.organizationId || null,
        apiKeyConfigured: true,
        error: e.message || String(e),
        revenue: dayList.map(({ y, mo, d, iso }) => ({
          date: formatCivilDayLabel(y, mo, d),
          amount: 0,
        })),
      });
      continue;
    }

    totalCallsFetched += rows.length;
    for (const r of rows) {
      const vid = pickDirect(r, ["VendorId", "vendorId"]);
      if (vid) vendorIdsSeenAll.add(vid);
    }

    if (useUiTemplate) {
      const { byDay, callsMatched } = aggregateUiBuyer(rows, dayList, iana, buyerLabel);
      buyersOut.push({
        buyer: buyerLabel,
        organizationId: cfg.organizationId || null,
        apiKeyConfigured: true,
        vendorId: null,
        callsMatched,
        revenue: dayList.map(({ y, mo, d, iso }) => ({
          date: formatCivilDayLabel(y, mo, d),
          amount: roundMoney(byDay.get(iso) || 0),
        })),
      });
    } else {
      const byDay = aggregateOrgPayoutByDay(rows, dayList, iana);
      buyersOut.push({
        buyer: buyerLabel,
        organizationId: cfg.organizationId || null,
        apiKeyConfigured: true,
        callsInWindow: rows.length,
        revenue: dayList.map(({ y, mo, d, iso }) => ({
          date: formatCivilDayLabel(y, mo, d),
          amount: roundMoney(byDay.get(iso) || 0),
        })),
      });
    }
  }

  return {
    success: true,
    source: "callgrid_live",
    template: useUiTemplate ? "ui" : "wire",
    range: {
      startDate,
      endDate,
      reportTimeZone: reportTz,
      reportTimeZoneResolved: iana,
      days: dayList.map((x) => x.iso),
    },
    meta: {
      callsFetched: totalCallsFetched,
      buyerCount: buyersOut.length,
      buyersWithApiKey: buyersOut.filter((b) => b.apiKeyConfigured).length,
      buyersMissingApiKey: buyersOut.filter((b) => !b.apiKeyConfigured).map((b) => b.buyer),
      vendorIdsSeen: [...vendorIdsSeenAll].sort(),
      distinctVendorIdCount: vendorIdsSeenAll.size,
      template: useUiTemplate ? "ui" : "wire",
      note: "One GET /api/call fetch per buyer; credentials from Company (platform=callgrid).",
    },
    buyers: buyersOut,
  };
}

function parseBuyersReportCliArgs(argv) {
  const y = new Date().getUTCFullYear();
  const out = {
    rangeStart: null,
    rangeEnd: null,
    reportYear: Math.max(2000, parseInt(process.env.CALLGRID_REPORT_YEAR || String(y), 10) || y),
    maxItems: 100,
    maxPages: 300,
    pageSleepMs: 500,
    firstPageOnly: false,
    verbose: false,
    dumpFirstRow: false,
    groupBy: (process.env.CALLGRID_REPORT_GROUP_BY || "").trim() || "vendor",
    template: (process.env.CALLGRID_REPORT_TEMPLATE || "wire").trim() || "wire",
  };

  const envStart = (process.env.CALLGRID_REPORT_RANGE_START || "").trim();
  const envEnd = (process.env.CALLGRID_REPORT_RANGE_END || "").trim();
  out.rangeStart = envStart || null;
  out.rangeEnd = envEnd || null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--range-start") out.rangeStart = argv[++i];
    else if (a === "--range-end") out.rangeEnd = argv[++i];
    else if (a === "--year") out.reportYear = Math.max(2000, parseInt(argv[++i], 10) || out.reportYear);
    else if (a === "--max-items") out.maxItems = Math.max(1, parseInt(argv[++i], 10) || 100);
    else if (a === "--max-pages") out.maxPages = Math.max(1, parseInt(argv[++i], 10) || 300);
    else if (a === "--sleep-ms") out.pageSleepMs = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === "--first-page-only") out.firstPageOnly = true;
    else if (a === "--verbose" || a === "-v") out.verbose = true;
    else if (a === "--dump-first-row") out.dumpFirstRow = true;
    else if (a === "--group-by") out.groupBy = (argv[++i] || "vendor").trim();
    else if (a === "--template") out.template = (argv[++i] || "wire").trim();
  }

  if (!out.rangeStart) out.rangeStart = `${out.reportYear}-05-04`;
  if (!out.rangeEnd) out.rangeEnd = `${out.reportYear}-05-08`;

  return out;
}

module.exports = {
  fetchBuyersByDayReport,
  parseBuyersReportCliArgs,
};
