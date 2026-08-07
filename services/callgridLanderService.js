/**
 * CallGrid lander helpers — list campaigns and media buyers (sources + phones).
 * Uses publisher org API key from CALLGRID_API_KEY (never expose to browser).
 */
const BASE_URL = (
  process.env.CALLGRID_API_BASE_URL || "https://api.callgrid.com"
).replace(/\/$/, "");

function getApiKey() {
  return (
    process.env.CALLGRID_API_KEY ||
    process.env.CALLGRID_API_TOKEN ||
    ""
  ).trim();
}

async function callgridGet(path) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error(
      "CALLGRID_API_KEY is not configured on the server.",
    );
    err.status = 500;
    throw err;
  }

  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(
      json?.message ||
        json?.error ||
        `CallGrid HTTP ${response.status} for ${path}`,
    );
    err.status = response.status;
    err.details = json;
    throw err;
  }

  return json;
}

function asArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function resolveOrganizationId(orgPayload) {
  const orgs = asArray(orgPayload);
  return (
    orgs[0]?.organizationId ||
    orgs[0]?.organization?.id ||
    orgs[0]?.id ||
    process.env.CALLGRID_ORGANIZATION_ID ||
    "cmqzp5upm023q06jr1r2nas6f"
  );
}

/**
 * List CallGrid campaigns (omit page query — page=1 returns empty for this API).
 */
async function listCampaigns() {
  const [payload, orgPayload] = await Promise.all([
    callgridGet("/api/campaign"),
    callgridGet("/api/organization"),
  ]);
  const rows = asArray(payload);
  return {
    organizationId: resolveOrganizationId(orgPayload),
    campaigns: rows.map((c) => ({
      id: c.id,
      name: c.name || c.id,
      paused: Boolean(c.paused),
      biddingEnabled: Boolean(c.biddingEnabled),
      phoneNumberIds: Array.isArray(c.phoneNumbers)
        ? c.phoneNumbers.map((p) => p.id || p).filter(Boolean)
        : [],
    })),
  };
}

/**
 * Media buyers for a campaign = CallGrid campaignSource rows for that campaign.
 *
 * SDK assign requires campaignSource.id (NOT Source.id).
 * GET /api/campaignSource?campaignId=… returns:
 *   id            → real SDK campaignSourceId
 *   sourceId      → Source.id (display/join only)
 *   source.name   → media buyer name
 *   phoneNumber   → assigned number
 */
async function listMediaBuyersForCampaign(campaignId) {
  if (!campaignId) {
    const err = new Error("campaignId is required");
    err.status = 400;
    throw err;
  }

  const [campaignSourcesPayload, orgPayload] = await Promise.all([
    callgridGet(
      `/api/campaignSource?campaignId=${encodeURIComponent(campaignId)}`,
    ),
    callgridGet("/api/organization"),
  ]);

  const campaignSources = asArray(campaignSourcesPayload);
  const organizationId = resolveOrganizationId(orgPayload);

  const mediaBuyers = [];
  const skipped = [];

  for (const row of campaignSources) {
    const campaignSourceId =
      typeof row?.id === "string" ? row.id.trim() : "";
    const sourceId =
      typeof row?.sourceId === "string"
        ? row.sourceId.trim()
        : typeof row?.source?.id === "string"
          ? row.source.id.trim()
          : "";

    // Never substitute Source.id — SDK assign 404s on that value.
    if (!campaignSourceId) {
      skipped.push({
        reason: "missing_campaign_source_id",
        sourceId: sourceId || null,
        name: row?.source?.name || null,
      });
      continue;
    }
    if (sourceId && campaignSourceId === sourceId) {
      skipped.push({
        reason: "campaign_source_id_equals_source_id",
        sourceId,
        name: row?.source?.name || null,
      });
      continue;
    }

    const phoneNumber =
      row?.phoneNumber?.phoneNumber ||
      (Array.isArray(row?.phoneNumbers) && row.phoneNumbers[0]?.phoneNumber) ||
      null;
    const phoneNumberId =
      row?.phoneNumberId ||
      row?.phoneNumber?.id ||
      (Array.isArray(row?.phoneNumbers) && row.phoneNumbers[0]?.id) ||
      null;

    mediaBuyers.push({
      id: campaignSourceId,
      name: row?.source?.name || sourceId || campaignSourceId,
      sourceId: sourceId || null,
      campaignSourceId,
      phoneNumber,
      phoneNumberId,
      active: row?.source?.paused !== true && row?.paused !== true,
      vendorId: row?.source?.vendorId || null,
      numberPoolId: row?.numberPoolId || row?.numberPool?.id || null,
      capped: Boolean(row?.capped),
    });
  }

  mediaBuyers.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, {
      sensitivity: "base",
    }),
  );

  return {
    organizationId,
    campaignId,
    mediaBuyers,
    skippedCount: skipped.length,
    skipped: skipped.length ? skipped : undefined,
  };
}

module.exports = {
  listCampaigns,
  listMediaBuyersForCampaign,
  getApiKey,
};
