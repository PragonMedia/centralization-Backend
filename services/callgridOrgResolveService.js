/**
 * Resolve CallGrid organizationId for a per-org API key.
 * List endpoints (/api/organization*) often require session auth; API keys work on /api/call.
 */
const axios = require("axios");

const DEFAULT_BASE_URL = (
  process.env.CALLGRID_API_BASE_URL || "https://api.callgrid.com"
).replace(/\/$/, "");

const DEFAULT_TIMEZONE =
  (process.env.CALLGRID_REPORT_TIME_ZONE || "US/Eastern").trim() || "US/Eastern";

function pickString(...values) {
  for (const v of values) {
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function normalizeOrgEntry(row) {
  if (!row || typeof row !== "object") return null;
  const organizationId = pickString(
    row.organizationId,
    row.organization_id,
    row.id,
    row.organizationID,
    row.OrganizationId
  );
  if (!organizationId) return null;
  const label = pickString(
    row.name,
    row.organizationName,
    row.displayName,
    row.companyName,
    row.label,
    row.VendorName,
    row.vendorName
  );
  return { organizationId, label: label || organizationId };
}

function uniqueOrgs(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!e?.organizationId) continue;
    if (!map.has(e.organizationId)) map.set(e.organizationId, e);
  }
  return [...map.values()];
}

function extractOrgsFromListPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const candidates = [];
  if (Array.isArray(payload)) candidates.push(...payload);
  if (Array.isArray(payload.data)) candidates.push(...payload.data);
  if (Array.isArray(payload.items)) candidates.push(...payload.items);
  if (Array.isArray(payload.organizations)) candidates.push(...payload.organizations);
  return uniqueOrgs(candidates.map(normalizeOrgEntry).filter(Boolean));
}

async function tryListOrganizationEndpoints(baseUrl, headers) {
  const paths = [
    "/api/organizations?page=1&limit=100",
    "/api/organization?page=1&limit=100",
  ];
  for (const path of paths) {
    try {
      const response = await axios.get(`${baseUrl}${path}`, {
        headers,
        timeout: 20000,
        validateStatus: () => true,
      });
      if (response.status === 200) {
        const orgs = extractOrgsFromListPayload(response.data);
        if (orgs.length) {
          return { orgs, method: `GET ${path.split("?")[0]}` };
        }
      }
    } catch {
      // try next path
    }
  }
  return null;
}

async function resolveFromCallSample(baseUrl, headers, reportTimeZone) {
  const end = new Date();
  const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);
  const response = await axios.get(`${baseUrl}/api/call`, {
    headers,
    timeout: 30000,
    validateStatus: () => true,
    params: {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      maxItems: "25",
      useCursor: "true",
      reportTimeZone,
    },
  });

  if (response.status === 401) {
    return {
      success: false,
      error: "Invalid CallGrid API key (401 on /api/call).",
      organizations: [],
      method: "GET /api/call",
    };
  }
  if (response.status !== 200) {
    return {
      success: false,
      error: `CallGrid /api/call returned HTTP ${response.status}.`,
      organizations: [],
      method: "GET /api/call",
    };
  }

  const rows = Array.isArray(response.data?.data)
    ? response.data.data
    : Array.isArray(response.data?.data?.items)
      ? response.data.data.items
      : [];

  const orgs = uniqueOrgs(
    rows
      .map((row) =>
        normalizeOrgEntry({
          organizationId: row.organizationId || row.OrganizationId,
          label: row.VendorName || row.CampaignName || row.SourceName,
        })
      )
      .filter(Boolean)
  );

  if (!orgs.length) {
    return {
      success: false,
      error:
        "API key is valid but no calls were found in the last 48 hours, so organizationId could not be inferred. Enter organizationId manually or retry after traffic exists.",
      organizations: [],
      method: "GET /api/call",
    };
  }

  return {
    success: true,
    organizations: orgs,
    method: "GET /api/call",
  };
}

/**
 * @param {Object} options
 * @param {string} options.apiToken - CallGrid API key (Bearer)
 * @param {string} [options.baseUrl]
 * @param {string} [options.reportTimeZone]
 * @returns {Promise<{ success: boolean, organizations: Array<{organizationId:string,label:string}>, method?: string, error?: string }>}
 */
async function resolveCallgridOrganization(options = {}) {
  const apiToken = pickString(options.apiToken, options.apiKey);
  if (!apiToken) {
    return {
      success: false,
      organizations: [],
      error: "apiToken is required.",
    };
  }

  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const reportTimeZone =
    pickString(options.reportTimeZone) || DEFAULT_TIMEZONE;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
  };

  const listed = await tryListOrganizationEndpoints(baseUrl, headers);
  if (listed?.orgs?.length) {
    return {
      success: true,
      organizations: listed.orgs,
      method: listed.method,
    };
  }

  return resolveFromCallSample(baseUrl, headers, reportTimeZone);
}

module.exports = {
  resolveCallgridOrganization,
  DEFAULT_BASE_URL,
};
