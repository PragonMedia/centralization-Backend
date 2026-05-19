/**
 * Browser helper: resolve CallGrid organizationId via Paragon BE (no direct CallGrid calls).
 * POST /api/v1/accounting/callgrid/resolve-org — server calls CallGrid; avoids CORS.
 *
 * @example
 * const result = await resolveCallgridOrganization(apiToken, {
 *   accountingApiBaseUrl: import.meta.env.VITE_API_BASE_URL,
 * });
 * if (result.success && result.organizations.length === 1) {
 *   setField("accountID", result.organizations[0].organizationId);
 * }
 */

const DEFAULT_CALLGRID_BASE = "https://api.callgrid.com";
const DEFAULT_TIMEZONE = "US/Eastern";

function trim(value) {
  return value != null ? String(value).trim() : "";
}

function normalizeOrg(row) {
  if (!row || typeof row !== "object") return null;
  const organizationId = trim(
    row.organizationId || row.OrganizationId || row.id
  );
  if (!organizationId) return null;
  const label = trim(
    row.label || row.name || row.VendorName || row.CampaignName
  );
  return { organizationId, label: label || organizationId };
}

function uniqueOrgs(list) {
  const map = new Map();
  for (const item of list) {
    if (!item?.organizationId) continue;
    if (!map.has(item.organizationId)) map.set(item.organizationId, item);
  }
  return [...map.values()];
}

function isLikelyCorsError(err) {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  return (
    err.name === "TypeError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("cors")
  );
}

async function resolveViaCallgridDirect(apiToken, options = {}) {
  const baseUrl = trim(options.callgridBaseUrl || DEFAULT_CALLGRID_BASE).replace(
    /\/$/,
    ""
  );
  const reportTimeZone = trim(options.reportTimeZone) || DEFAULT_TIMEZONE;
  const end = new Date();
  const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    maxItems: "25",
    useCursor: "true",
    reportTimeZone,
  });

  const response = await fetch(`${baseUrl}/api/call?${params}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });

  if (response.status === 401) {
    return {
      success: false,
      organizations: [],
      method: "GET /api/call (direct)",
      error: "Invalid CallGrid API key (401).",
      via: "direct",
    };
  }

  if (!response.ok) {
    return {
      success: false,
      organizations: [],
      method: "GET /api/call (direct)",
      error: `CallGrid returned HTTP ${response.status}.`,
      via: "direct",
    };
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.data?.items)
      ? payload.data.items
      : [];

  const organizations = uniqueOrgs(
    rows.map((row) =>
      normalizeOrg({
        organizationId: row.organizationId || row.OrganizationId,
        label: row.VendorName || row.CampaignName || row.SourceName,
      })
    )
  );

  if (!organizations.length) {
    return {
      success: false,
      organizations: [],
      method: "GET /api/call (direct)",
      error:
        "No calls in the last 48 hours; cannot infer organizationId. Enter it manually.",
      via: "direct",
    };
  }

  return {
    success: true,
    organizations,
    method: "GET /api/call (direct)",
    via: "direct",
  };
}

async function resolveViaBackendProxy(apiToken, options = {}) {
  const base = trim(
    options.accountingApiBaseUrl ||
      (typeof window !== "undefined" ? window.location.origin : "")
  ).replace(/\/$/, "");

  if (!base) {
    return {
      success: false,
      organizations: [],
      error: "accountingApiBaseUrl is required for backend proxy resolution.",
      via: "proxy",
    };
  }

  const response = await fetch(`${base}/api/v1/accounting/callgrid/resolve-org`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apiToken }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      success: false,
      organizations: [],
      error: payload.error || `Backend resolve-org HTTP ${response.status}.`,
      via: "proxy",
    };
  }

  return {
    ...payload,
    organizations: Array.isArray(payload.organizations) ? payload.organizations : [],
    via: "proxy",
  };
}

/**
 * @param {string} apiToken
 * @param {Object} [options]
 * @param {string} [options.callgridBaseUrl]
 * @param {string} [options.accountingApiBaseUrl] - Paragon BE origin for proxy fallback
 * @param {string} [options.reportTimeZone]
 * @param {boolean} [options.proxyOnly=true] - use backend proxy (default; required for CORS)
 * @param {boolean} [options.preferDirect=false] - if true, try CallGrid from browser first
 * @param {boolean} [options.directOnly=false] - skip proxy (dev only; usually blocked by CORS)
 */
async function resolveCallgridOrganization(apiToken, options = {}) {
  const token = trim(apiToken);
  if (!token) {
    return { success: false, organizations: [], error: "apiToken is required." };
  }

  const directOnly = options.directOnly === true;
  const preferDirect = options.preferDirect === true;

  // Default: backend proxy only (CORS-safe). Opt in to direct with preferDirect/directOnly.
  if (!preferDirect && !directOnly) {
    return resolveViaBackendProxy(token, options);
  }

  try {
    const direct = await resolveViaCallgridDirect(token, options);
    if (direct.success || directOnly) return direct;
    if (direct.error && direct.error.includes("401")) return direct;
  } catch (err) {
    if (directOnly) {
      return {
        success: false,
        organizations: [],
        error: err.message || String(err),
        via: "direct",
      };
    }
    if (!isLikelyCorsError(err)) {
      return {
        success: false,
        organizations: [],
        error: err.message || String(err),
        via: "direct",
      };
    }
  }

  return resolveViaBackendProxy(token, options);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    resolveCallgridOrganization,
    resolveViaCallgridDirect,
    resolveViaBackendProxy,
    isLikelyCorsError,
  };
}

if (typeof window !== "undefined") {
  window.resolveCallgridOrganization = resolveCallgridOrganization;
}
