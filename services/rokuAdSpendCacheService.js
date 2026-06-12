/**
 * Roku ad spend cache — rolling 2-month window, per-day per-account spend in Mongo.
 * Nightly refresh chunks weekly reports to stay within ~1h Roku async report budget.
 */
const RokuAdSpendCache = require("../models/rokuAdSpendCacheModel");
const ROKU_ADS = require("../config/rokuAdsApi");
const rokuAdsReportService = require("./rokuAdsReportService");

function toIsoNoMs(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getRollingTwoMonthWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 2);
  return {
    startDate: toIsoNoMs(start).slice(0, 10),
    endDate: toIsoNoMs(now).slice(0, 10),
    endDateTimeIso: toIsoNoMs(now),
  };
}

function parseUTCDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function formatDayLabel(utcDate) {
  const m = utcDate.getUTCMonth() + 1;
  const d = utcDate.getUTCDate();
  const y = utcDate.getUTCFullYear();
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

function toYmdUtc(utcDate) {
  return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, "0")}-${String(
    utcDate.getUTCDate()
  ).padStart(2, "0")}`;
}

function addDaysYmd(ymd, days) {
  const dt = parseUTCDate(ymd);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return toYmdUtc(dt);
}

function compareYmd(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function getDaysInRangeUTC(startYmd, endYmd) {
  const start = parseUTCDate(startYmd);
  const end = parseUTCDate(endYmd);
  if (!start || !end || end < start) return [];

  const now = new Date();
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );

  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dateIso = toYmdUtc(cur);
    out.push({
      dateIso,
      day: formatDayLabel(cur),
      isToday: cur.getTime() === todayUTC.getTime(),
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function splitDateRangeIntoChunks(startYmd, endYmd, chunkDays = ROKU_ADS.CACHE_CHUNK_DAYS) {
  const chunks = [];
  let cur = startYmd;
  while (compareYmd(cur, endYmd) <= 0) {
    const tentativeEnd = addDaysYmd(cur, chunkDays - 1);
    const chunkEnd = compareYmd(tentativeEnd, endYmd) <= 0 ? tentativeEnd : endYmd;
    chunks.push({ startDate: cur, endDate: chunkEnd });
    cur = addDaysYmd(chunkEnd, 1);
  }
  return chunks;
}

function normalizeCsvDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const m = parseInt(slash[1], 10);
    const d = parseInt(slash[2], 10);
    const y = parseInt(slash[3], 10);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function buildAccountLookup(accounts = []) {
  const byName = new Map();
  const byUid = new Map();
  for (const a of accounts) {
    if (a.uid) byUid.set(String(a.uid), a);
    if (a.name) byName.set(String(a.name).trim().toLowerCase(), a);
  }
  return { byName, byUid };
}

function resolveAccountMeta(row, lookup) {
  const id = String(row.accountId || "").trim();
  if (id && lookup.byUid.has(id)) {
    const a = lookup.byUid.get(id);
    return { accountUid: a.uid, accountName: a.name };
  }
  const nameKey = String(row.accountName || "").trim().toLowerCase();
  if (nameKey && lookup.byName.has(nameKey)) {
    const a = lookup.byName.get(nameKey);
    return { accountUid: a.uid, accountName: a.name };
  }
  return {
    accountUid: id || null,
    accountName: row.accountName || null,
  };
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function buildPayloadFromRows(rows, accounts, startYmd, endYmd, summary = {}) {
  const lookup = buildAccountLookup(accounts);
  const dayAccountMap = new Map();

  for (const row of rows) {
    const dateIso = normalizeCsvDate(row.date);
    if (!dateIso) continue;
    const meta = resolveAccountMeta(row, lookup);
    const key = meta.accountUid || meta.accountName || "unknown";
    if (!dayAccountMap.has(dateIso)) dayAccountMap.set(dateIso, new Map());
    const accMap = dayAccountMap.get(dateIso);
    const prev = accMap.get(key) || { ...meta, spend: 0 };
    prev.spend += Number.isFinite(row.spend) ? row.spend : 0;
    accMap.set(key, prev);
  }

  const byAccountMap = new Map();
  for (const row of rows) {
    const meta = resolveAccountMeta(row, lookup);
    const key = meta.accountUid || meta.accountName || "unknown";
    const prev = byAccountMap.get(key) || { ...meta, spend: 0 };
    prev.spend += Number.isFinite(row.spend) ? row.spend : 0;
    byAccountMap.set(key, prev);
  }

  const days = getDaysInRangeUTC(startYmd, endYmd).map(({ dateIso, day, isToday }) => {
    const accMap = dayAccountMap.get(dateIso) || new Map();
    const accountsForDay = [...accMap.values()].map((a) => ({
      accountUid: a.accountUid,
      accountName: a.accountName,
      spend: roundMoney(a.spend),
    }));
    const totalSpend = accountsForDay.reduce((sum, a) => sum + a.spend, 0);
    return {
      day,
      dateIso,
      isToday,
      totalSpend: roundMoney(totalSpend),
      accounts: accountsForDay,
    };
  });

  const byAccount = [...byAccountMap.values()].map((a) => ({
    accountUid: a.accountUid,
    accountName: a.accountName,
    spend: roundMoney(a.spend),
  }));

  const totalSpend = byAccount.reduce((sum, a) => sum + a.spend, 0);

  return {
    success: summary.failedChunks?.length ? false : true,
    range: { startDate: startYmd, endDate: endYmd },
    timezone: "America/New_York",
    accounts: accounts.map((a) => ({
      uid: a.uid,
      name: a.name,
      organizationUid: a.organizationUid || null,
      currency: a.currency || null,
      timezone: a.timezone || null,
    })),
    totals: { spend: roundMoney(totalSpend) },
    byAccount,
    days,
    summary,
  };
}

async function getLatestRokuAdSpendCache() {
  return RokuAdSpendCache.findOne({ cacheKey: "latest" }).lean();
}

async function fetchChunkSpend(chunk, options = {}) {
  return rokuAdsReportService.fetchSpendForRange({
    startDate: chunk.startDate,
    endDate: chunk.endDate,
    verbose: options.verbose === true,
    checkPermissions: options.checkPermissions !== false,
    requestTimeoutMs: options.requestTimeoutMs ?? ROKU_ADS.REQUEST_TIMEOUT_MS,
    poll: {
      intervalMs: ROKU_ADS.REPORT_POLL_INTERVAL_MS,
      maxAttempts: options.chunkPollMaxAttempts ?? ROKU_ADS.CACHE_CHUNK_POLL_MAX_ATTEMPTS,
      requestTimeoutMs: options.requestTimeoutMs ?? ROKU_ADS.REQUEST_TIMEOUT_MS,
      verbose: options.verbose === true,
    },
  });
}

/**
 * Fetch Roku spend in weekly chunks, merge rows, overwrite `rokuAdSpend` collection.
 */
async function refreshRokuAdSpendCache(options = {}) {
  const trigger = (options.trigger || "manual").trim() || "manual";
  const startedAt = Date.now();
  const windowData = getRollingTwoMonthWindow();
  const { startDate, endDate, endDateTimeIso } = windowData;
  const chunks = splitDateRangeIntoChunks(startDate, endDate);

  const accountsResult = await rokuAdsReportService.listAdAccounts({ limit: 100 });
  const accounts = accountsResult.accounts || [];

  const allRows = [];
  const succeededChunks = [];
  const failedChunks = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    console.log(
      `RokuAdSpend refresh chunk ${i + 1}/${chunks.length}: ${chunk.startDate} → ${chunk.endDate}`
    );

    try {
      const result = await fetchChunkSpend(chunk, options);
      if (!result.success) {
        failedChunks.push({
          ...chunk,
          error: result.error || "chunk fetch failed",
          status: result.status || null,
        });
        continue;
      }
      allRows.push(...(result.rows || []));
      succeededChunks.push({
        ...chunk,
        reportUid: result.reportUid,
        rowCount: result.rows?.length || 0,
        pollAttempts: result.pollAttempts,
      });
    } catch (err) {
      failedChunks.push({
        ...chunk,
        error: err.message || String(err),
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const summary = {
    chunkCount: chunks.length,
    succeededChunks,
    failedChunks,
    elapsedMs,
    elapsedMinutes: Math.round((elapsedMs / 60000) * 10) / 10,
  };

  const payload = buildPayloadFromRows(allRows, accounts, startDate, endDate, summary);

  await RokuAdSpendCache.deleteMany({});
  const cache = await RokuAdSpendCache.create({
    cacheKey: "latest",
    windowStart: new Date(`${startDate}T00:00:00.000Z`),
    windowEnd: new Date(endDateTimeIso),
    timezone: "America/New_York",
    trigger,
    refreshedAt: new Date(),
    payload,
  });

  console.log("RokuAdSpend cache refresh summary:", {
    success: payload.success,
    days: payload.days?.length || 0,
    totalSpend: payload.totals?.spend,
    failedChunks: failedChunks.length,
    elapsedMinutes: summary.elapsedMinutes,
  });

  return {
    success: payload.success,
    payload,
    cache,
    trigger,
    windowStart: startDate,
    windowEnd: endDate,
    summary,
  };
}

module.exports = {
  getRollingTwoMonthWindow,
  getLatestRokuAdSpendCache,
  refreshRokuAdSpendCache,
  buildPayloadFromRows,
  splitDateRangeIntoChunks,
};
