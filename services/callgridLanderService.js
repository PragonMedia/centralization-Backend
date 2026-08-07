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
 * Media buyers for a campaign = sources that have a phoneNumber on that campaign.
 * campaignSourceId for the lander SDK = source.id (phone.campaignSourceId is null today).
 */
async function listMediaBuyersForCampaign(campaignId) {
  if (!campaignId) {
    const err = new Error("campaignId is required");
    err.status = 400;
    throw err;
  }

  const [sourcesPayload, phonesPayload, orgPayload] = await Promise.all([
    callgridGet("/api/source"),
    callgridGet("/api/phoneNumber"),
    callgridGet("/api/organization"),
  ]);

  const sources = asArray(sourcesPayload);
  const phones = asArray(phonesPayload);
  const organizationId = resolveOrganizationId(orgPayload);

  const phonesOnCampaign = phones.filter(
    (p) => p.campaignId === campaignId && p.sourceId,
  );

  const bySourceId = new Map();
  for (const phone of phonesOnCampaign) {
    if (!bySourceId.has(phone.sourceId)) {
      bySourceId.set(phone.sourceId, phone);
    }
  }

  const mediaBuyers = [];
  for (const [sourceId, phone] of bySourceId.entries()) {
    const source = sources.find((s) => s.id === sourceId);
    mediaBuyers.push({
      id: sourceId,
      name: source?.name || sourceId,
      sourceId,
      campaignSourceId: phone.campaignSourceId || sourceId,
      phoneNumber: phone.phoneNumber || null,
      phoneNumberId: phone.id || null,
      active: source?.active !== false,
      vendorId: source?.vendorId || null,
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
  };
}

module.exports = {
  listCampaigns,
  listMediaBuyersForCampaign,
  getApiKey,
};
