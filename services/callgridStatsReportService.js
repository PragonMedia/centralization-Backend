/**
 * CallGrid POST /api/reports/stats — dashboard-aligned totals (footerTotals.total_payout).
 * One request per buyer per calendar day; each buyer supplies apiKey (from Company.apiToken).
 */
const axios = require("axios");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function roundMoney2(n) {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
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

function formatCivilDayLabel(y, mo, d) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)));
}

function isoToUsDayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return String(iso);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function readFiniteNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickFooterTotals(data) {
  if (!data || typeof data !== "object") return null;
  const ft = data.footerTotals ?? data.report?.footerTotals ?? data.data?.footerTotals;
  return ft && typeof ft === "object" ? ft : null;
}

function emptyDayRevenue(dayList, error) {
  return dayList.map(({ y, mo, d, iso }) => ({
    date: formatCivilDayLabel(y, mo, d),
    dateIso: iso,
    totalPayout: null,
    totalCalls: null,
    error,
  }));
}

function normalizeBuyers(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((row) => ({
    buyer: String(row.buyer || row.companyName || "").trim(),
    organizationId: String(row.organizationId || row.accountID || "").trim(),
    apiKey: String(row.apiKey || row.apiToken || "").trim(),
  }));
}

/**
 * @param {Object} options
 * @param {Array<{buyer:string,organizationId:string,apiKey:string}>} options.buyers - required
 * @param {boolean} [options.minimal] - default true
 */
async function fetchDashboardBuyersStatsReport(options = {}) {
  const minimal = options.minimal !== false;
  const buyers = normalizeBuyers(options.buyers);

  if (!buyers.length) {
    return {
      success: false,
      source: "callgrid_stats",
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

  const requestDelayMs = Math.max(0, options.requestDelayMs ?? 200);
  const pivot = (options.pivot || "CampaignName").trim() || "CampaignName";
  const maxItemsDefault = Math.max(1, parseInt(String(process.env.CALLGRID_STATS_MAX_ITEMS || "2000"), 10) || 2000);
  const maxItems = Math.max(1, options.maxItems ?? maxItemsDefault);

  let dayList;
  try {
    dayList = enumerateInclusiveYmd(rangeStart, rangeEnd);
  } catch (e) {
    return { success: false, source: "callgrid_stats", error: e.message || String(e) };
  }

  const outBuyers = [];
  let requestsOk = 0;
  let requestsFailed = 0;
  let requestIndex = 0;

  for (const row of buyers) {
    const organizationId = row.organizationId;
    const buyer = row.buyer || organizationId;
    const apiKey = row.apiKey;

    if (!organizationId) {
      outBuyers.push({
        buyer,
        organizationId: null,
        apiKeyConfigured: false,
        revenue: emptyDayRevenue(dayList, "Missing organizationId (store CallGrid organizationId in company accountID)."),
        weekTotals: { totalPayout: 0, totalCalls: 0 },
      });
      requestsFailed += dayList.length;
      continue;
    }

    if (!apiKey) {
      outBuyers.push({
        buyer,
        organizationId,
        apiKeyConfigured: false,
        revenue: emptyDayRevenue(
          dayList,
          `Missing apiToken for "${buyer}". Add CallGrid API key on the company record.`
        ),
        weekTotals: { totalPayout: 0, totalCalls: 0 },
      });
      requestsFailed += dayList.length;
      continue;
    }

    const revenue = [];
    let weekTotalPayout = 0;
    let weekTotalCalls = 0;

    for (const { y: yy, mo, d, iso } of dayList) {
      if (requestIndex > 0 && requestDelayMs > 0) await sleep(requestDelayMs);
      requestIndex += 1;

      const url = `${baseUrl}/api/reports/stats?organizationId=${encodeURIComponent(organizationId)}`;
      const body = {
        startDate: iso,
        endDate: iso,
        pivot,
        pivot2: "",
        filters: { items: [] },
        page: 0,
        maxItems,
        reportTimeZone: reportTz,
      };

      let dayPayload = {
        date: formatCivilDayLabel(yy, mo, d),
        dateIso: iso,
        totalPayout: null,
        totalCalls: null,
        error: null,
      };

      try {
        const response = await axios.post(url, body, {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 120000,
          validateStatus: () => true,
        });

        if (response.status === 401) {
          const bodyHint =
            response.data && typeof response.data === "object"
              ? response.data.message || response.data.error || ""
              : typeof response.data === "string"
                ? response.data.slice(0, 200)
                : "";
          const tail = bodyHint ? ` ${String(bodyHint).slice(0, 280)}` : "";
          dayPayload.error =
            `CallGrid 401 for "${buyer}" (${organizationId}): API key invalid for this organization.${tail}`;
          requestsFailed += 1;
        } else if (response.status < 200 || response.status >= 300) {
          const snippet =
            typeof response.data === "string"
              ? response.data.slice(0, 500)
              : JSON.stringify(response.data || {}).slice(0, 500);
          dayPayload.error = `HTTP ${response.status}: ${snippet}`;
          requestsFailed += 1;
        } else {
          const data = response.data;
          const ft = pickFooterTotals(data);
          const tp = readFiniteNumber(ft?.total_payout);
          const tc = readFiniteNumber(ft?.totalCalls);

          if (!ft && data && typeof data === "object") {
            const msg =
              data.message ||
              data.error ||
              (data.isSuccessful === false ? data.message || "CallGrid isSuccessful=false" : null);
            if (msg) {
              dayPayload.error = String(msg);
              requestsFailed += 1;
            } else if (tp != null || tc != null) {
              dayPayload.totalPayout = tp;
              dayPayload.totalCalls = tc;
              if (tp != null) weekTotalPayout += tp;
              if (tc != null) weekTotalCalls += tc;
              requestsOk += 1;
            } else {
              dayPayload.error = "missing footerTotals in CallGrid response";
              requestsFailed += 1;
            }
          } else {
            dayPayload.totalPayout = tp;
            dayPayload.totalCalls = tc;
            if (tp != null) weekTotalPayout += tp;
            if (tc != null) weekTotalCalls += tc;
            requestsOk += 1;
          }
        }
      } catch (e) {
        dayPayload.error = e.message || String(e);
        requestsFailed += 1;
      }

      revenue.push(dayPayload);
    }

    outBuyers.push({
      buyer,
      organizationId,
      apiKeyConfigured: true,
      revenue,
      weekTotals: {
        totalPayout: weekTotalPayout,
        totalCalls: weekTotalCalls,
      },
    });
  }

  if (minimal) {
    return {
      success: true,
      buyers: outBuyers.map((b) => ({
        buyer: b.buyer,
        apiKeyConfigured: b.apiKeyConfigured,
        payout: b.revenue.map((d) => {
          const row = {
            day: isoToUsDayLabel(d.dateIso),
            payout: d.error ? null : d.totalPayout != null ? roundMoney2(d.totalPayout) : 0,
          };
          if (d.error) row.error = d.error;
          return row;
        }),
      })),
    };
  }

  return {
    success: true,
    source: "callgrid_stats",
    range: {
      reportTimeZone: reportTz,
      days: dayList.map((x) => x.iso),
      rangeStart,
      rangeEnd,
      pivot,
    },
    meta: {
      buyerCount: outBuyers.length,
      buyersWithApiKey: outBuyers.filter((b) => b.apiKeyConfigured).length,
      buyersMissingApiKey: outBuyers.filter((b) => !b.apiKeyConfigured).map((b) => b.buyer),
      dayCount: dayList.length,
      statsRequestsOk: requestsOk,
      statsRequestsFailed: requestsFailed,
      note: "Credentials from Company records (platform=callgrid): accountID=organizationId, apiToken=API key.",
    },
    buyers: outBuyers.map((b) => ({
      buyer: b.buyer,
      organizationId: b.organizationId,
      apiKeyConfigured: b.apiKeyConfigured,
      revenue: b.revenue.map((d) => ({
        date: d.date,
        dateIso: d.dateIso,
        payout: d.totalPayout != null ? roundMoney2(d.totalPayout) : null,
        calls: d.totalCalls,
        error: d.error,
      })),
      weekTotals: {
        payout: roundMoney2(b.weekTotals.totalPayout),
        calls: b.weekTotals.totalCalls,
      },
    })),
  };
}

module.exports = {
  fetchDashboardBuyersStatsReport,
  normalizeBuyers,
};
