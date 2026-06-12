/**
 * Roku Ads API — list ad accounts and pull spend via async reports.
 * Separate from rokuConversionService.js (CAPI event uploads).
 */
const axios = require("axios");
const ROKU_ADS = require("../config/rokuAdsApi");
const { adsApiRequest } = require("./rokuAdsApiClient");

/** Roles that can create async spend reports via POST /developer/reports */
const REPORT_CAPABLE_ROLES = new Set([
  "viewer",
  "campaign manager",
  "account admin",
]);

function normalizeRoleName(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function accountHasReportCapableRole(roles) {
  return (Array.isArray(roles) ? roles : []).some((r) => REPORT_CAPABLE_ROLES.has(normalizeRoleName(r)));
}

function formatRokuErrors(data) {
  if (!Array.isArray(data?.errors) || !data.errors.length) return null;
  return data.errors
    .map((e) => e.detail || e.title || e.status || "")
    .filter(Boolean)
    .join(" ");
}

function ymdToUtcStart(isoDate) {
  return `${isoDate}T00:00:00Z`;
}

function ymdToUtcEnd(isoDate) {
  return `${isoDate}T23:59:59Z`;
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function normalizeAccount(row) {
  if (!row || row.type !== "account") return null;
  const a = row.attributes || {};
  return {
    uid: row.uid,
    name: a.name || null,
    organizationUid: a.organization_uid || null,
    currency: a.currency || null,
    timezone: a.timezone || null,
  };
}

/**
 * GET /developer/accounts
 */
async function listAdAccounts(options = {}) {
  const params = {
    limit: options.limit ?? 100,
    offset: options.offset ?? 0,
  };
  if (options.organizationUid) {
    params.organization_uid = options.organizationUid;
  }

  const response = await adsApiRequest("GET", "/developer/accounts", { params });
  const data = Array.isArray(response.data?.data) ? response.data.data : [];
  let accounts = data.map(normalizeAccount).filter(Boolean);
  let fromPermissions = false;

  if (accounts.length === 0) {
    const perms = await getDeveloperPermissions();
    accounts = perms.accounts
      .filter((a) => a.accountUid)
      .map((a) => ({
        uid: a.accountUid,
        name: a.accountName,
        organizationUid: null,
        currency: null,
        timezone: null,
        roles: a.roles,
      }));
    fromPermissions = accounts.length > 0;
  }

  return {
    success: true,
    accounts,
    meta: response.data?.meta ?? null,
    fromPermissions,
  };
}

/**
 * GET /developer/organizations?include=accounts
 */
async function listOrganizations(options = {}) {
  const params = {
    limit: options.limit ?? 100,
    offset: options.offset ?? 0,
  };
  if (options.includeAccounts !== false) {
    params.include = "accounts";
  }

  const response = await adsApiRequest("GET", "/developer/organizations", { params });
  const data = Array.isArray(response.data?.data) ? response.data.data : [];

  const organizations = data.map((org) => {
    const attrs = org.attributes || {};
    const accounts = Array.isArray(attrs.accounts)
      ? attrs.accounts.map((acc) => ({
          accountUid: acc.account_uid || acc.uid || null,
          accountName: acc.account_name || acc.name || null,
        }))
      : [];
    return {
      uid: org.uid,
      name: attrs.name || null,
      accounts,
    };
  });

  return {
    success: true,
    organizations,
    meta: response.data?.meta ?? null,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST /developer/reports — create async spend report.
 */
async function createSpendReport(options = {}) {
  const start = parseYmd(options.startDate);
  const end = parseYmd(options.endDate);
  if (!start || !end) {
    return { success: false, error: "startDate and endDate required as YYYY-MM-DD" };
  }

  const metrics = options.metrics || ["spend", "impressions"];
  const dimensions = options.dimensions || ["account_id", "account_name", "date"];

  const attributes = {
    name: options.name || `Paragon spend ${start} to ${end}`,
    description: options.description || "Spend report from Paragon BE",
    metrics,
    dimensions,
    start_at: options.startAt || ymdToUtcStart(start),
    end_at: options.endAt || ymdToUtcEnd(end),
  };

  if (options.accountUid) {
    attributes.filters = [{ metric: "account_uid", value: String(options.accountUid) }];
  }

  const response = await adsApiRequest("POST", "/developer/reports", {
    data: { data: [{ type: "report", attributes }] },
    validateStatus: () => true,
    timeout: options.requestTimeoutMs,
  });

  const apiErrors = formatRokuErrors(response.data);
  if (response.status >= 400 || apiErrors) {
    const hint =
      response.status === 403 || String(apiErrors || "").includes("readAccessDenied")
        ? " Audience Manager cannot create spend reports — use Campaign manager or Account admin (Viewer may work), then re-run OAuth."
        : "";
    return {
      success: false,
      error: (apiErrors || `HTTP ${response.status}`) + hint,
      status: response.status,
      raw: response.data,
    };
  }

  const created = Array.isArray(response.data?.data) ? response.data.data[0] : null;
  const reportUid = created?.uid;
  if (!reportUid) {
    return {
      success: false,
      error: formatRokuErrors(response.data) || "Report created but no uid returned",
      raw: response.data,
    };
  }

  return {
    success: true,
    reportUid,
    report: created,
  };
}

function normalizeReportStatus(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function extractReportPollPayload(statusResponse, reportResponse) {
  const fromStatus = statusResponse?.data?.data;
  const fromReport = reportResponse?.data?.data;
  const attrs = fromStatus?.attributes || fromReport?.attributes || {};
  const status = normalizeReportStatus(attrs.status);
  const downloadUrl =
    (typeof attrs.download_url === "string" && attrs.download_url.trim()) ||
    (typeof attrs.downloadUrl === "string" && attrs.downloadUrl.trim()) ||
    null;
  return { status, downloadUrl };
}

/**
 * GET /developer/permissions — roles granted to this developer app per account.
 */
async function getDeveloperPermissions() {
  const response = await adsApiRequest("GET", "/developer/permissions", {
    params: { limit: 100 },
  });
  const rows = Array.isArray(response.data?.data) ? response.data.data : [];
  const accounts = [];
  for (const row of rows) {
    const list = row?.attributes?.accounts;
    if (!Array.isArray(list)) continue;
    for (const acc of list) {
      accounts.push({
        accountUid: acc.account_uid || null,
        accountName: acc.account_name || null,
        roles: Array.isArray(acc.roles) ? acc.roles : [],
      });
    }
  }
  const viewerOnly =
    accounts.length > 0 &&
    accounts.every((a) => a.roles.length === 1 && normalizeRoleName(a.roles[0]) === "viewer");
  const audienceManagerOnly =
    accounts.length > 0 &&
    accounts.every(
      (a) => a.roles.length === 1 && normalizeRoleName(a.roles[0]) === "audience manager"
    );
  const reportCapable =
    accounts.length > 0 && accounts.some((a) => accountHasReportCapableRole(a.roles));
  return {
    success: true,
    accounts,
    viewerOnly,
    audienceManagerOnly,
    reportCapable,
    meta: response.data?.meta ?? null,
  };
}

/**
 * GET /developer/reports/{uid}/status — poll until done or error.
 */
async function pollReportStatus(reportUid, pollOptions = {}) {
  const intervalMs = pollOptions.intervalMs ?? ROKU_ADS.REPORT_POLL_INTERVAL_MS;
  const maxAttempts = pollOptions.maxAttempts ?? ROKU_ADS.REPORT_POLL_MAX_ATTEMPTS;
  const requestTimeoutMs = pollOptions.requestTimeoutMs ?? ROKU_ADS.REQUEST_TIMEOUT_MS;
  const verbose = pollOptions.verbose === true;
  let lastStatus = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const statusResponse = await adsApiRequest(
      "GET",
      `/developer/reports/${encodeURIComponent(reportUid)}/status`,
      { timeout: requestTimeoutMs }
    );
    let reportResponse = null;
    try {
      reportResponse = await adsApiRequest("GET", `/developer/reports/${encodeURIComponent(reportUid)}`, {
        timeout: requestTimeoutMs,
      });
    } catch {
      reportResponse = null;
    }

    const { status, downloadUrl } = extractReportPollPayload(statusResponse, reportResponse);
    lastStatus = status || lastStatus;

    if (verbose) {
      process.stdout.write(
        `  poll ${attempt + 1}/${maxAttempts}: status=${status || "?"}${downloadUrl ? " (download ready)" : ""}\n`
      );
    }

    if (downloadUrl) {
      return { success: true, status: status || "done", downloadUrl, attempts: attempt + 1 };
    }
    if (status === "done") {
      return {
        success: false,
        status,
        error: "Report status is done but download_url is empty",
        attempts: attempt + 1,
      };
    }
    if (status === "error" || status === "failed") {
      return { success: false, status, error: "Report job failed on Roku side", attempts: attempt + 1 };
    }

    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }

  const waitMinutes = Math.round((maxAttempts * intervalMs) / 60000);
  return {
    success: false,
    status: "timeout",
    lastStatus: lastStatus || "unknown",
    error:
      `Report still not done after ${maxAttempts} polls (~${waitMinutes} min). Last status: "${lastStatus}". ` +
      "Try a shorter date range, confirm reports work in Ads Manager UI, or contact Roku if the job never completes.",
    attempts: maxAttempts,
  };
}

async function downloadReportCsv(downloadUrl) {
  const response = await axios.get(downloadUrl, {
    timeout: ROKU_ADS.REQUEST_TIMEOUT_MS,
    responseType: "text",
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return response.data;
}

/**
 * Parse CSV text into rows; aggregate spend by account_id / account_name when present.
 */
function parseSpendFromCsv(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], totals: { spend: 0 }, byAccount: [] };
  }

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const spendIdx = headers.findIndex((h) => h.toLowerCase() === "spend");
  const accountIdIdx = headers.findIndex((h) => h.toLowerCase() === "account_id");
  const accountNameIdx = headers.findIndex((h) => h.toLowerCase() === "account_name");
  const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");

  const rows = [];
  let totalSpend = 0;
  const byAccountMap = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const spendRaw = spendIdx >= 0 ? cols[spendIdx] : "";
    const spend = parseFloat(String(spendRaw).replace(/[$,]/g, ""));
    const safeSpend = Number.isFinite(spend) ? spend : 0;

    const accountId = accountIdIdx >= 0 ? cols[accountIdIdx] : "";
    const accountName = accountNameIdx >= 0 ? cols[accountNameIdx] : "";
    const date = dateIdx >= 0 ? cols[dateIdx] : "";

    rows.push({ accountId, accountName, date, spend: safeSpend });
    totalSpend += safeSpend;

    const key = accountId || accountName || "unknown";
    const prev = byAccountMap.get(key) || {
      accountId: accountId || null,
      accountName: accountName || null,
      spend: 0,
    };
    prev.spend += safeSpend;
    byAccountMap.set(key, prev);
  }

  return {
    rows,
    totals: { spend: Math.round(totalSpend * 100) / 100 },
    byAccount: [...byAccountMap.values()].map((a) => ({
      ...a,
      spend: Math.round(a.spend * 100) / 100,
    })),
  };
}

/**
 * Full flow: create report → poll → download → parse spend.
 */
async function fetchSpendForRange(options = {}) {
  if (options.checkPermissions !== false) {
    try {
      const perms = await getDeveloperPermissions();
      if (perms.audienceManagerOnly) {
        return {
          success: false,
          error:
            "Developer app has Audience Manager only (custom audiences). Switch to Viewer on the developer app, then re-run OAuth.",
          permissions: perms,
        };
      }
      if (!perms.reportCapable && perms.accounts.length > 0) {
        return {
          success: false,
          error:
            "Developer app has no report-capable roles (need Viewer, Campaign manager, or Account admin). " +
            "Update roles in Roku Ads Manager and re-run OAuth.",
          permissions: perms,
        };
      }
    } catch (permErr) {
      if (options.verbose) {
        console.warn("Could not load developer permissions:", permErr.message);
      }
    }
  }

  const created = await createSpendReport(options);
  if (!created.success) return created;

  const polled = await pollReportStatus(created.reportUid, {
    ...(options.poll || {}),
    verbose: options.verbose,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  if (!polled.success) {
    return { ...polled, reportUid: created.reportUid };
  }

  if (!polled.downloadUrl) {
    return {
      success: false,
      error: "Report done but no download_url",
      reportUid: created.reportUid,
    };
  }

  const csv = await downloadReportCsv(polled.downloadUrl);
  const parsed = parseSpendFromCsv(csv);

  return {
    success: true,
    reportUid: created.reportUid,
    downloadUrl: polled.downloadUrl,
    range: {
      startDate: parseYmd(options.startDate),
      endDate: parseYmd(options.endDate),
    },
    pollAttempts: polled.attempts,
    ...parsed,
  };
}

module.exports = {
  listAdAccounts,
  listOrganizations,
  getDeveloperPermissions,
  createSpendReport,
  pollReportStatus,
  downloadReportCsv,
  parseSpendFromCsv,
  fetchSpendForRange,
  parseYmd,
  ymdToUtcStart,
  ymdToUtcEnd,
};
