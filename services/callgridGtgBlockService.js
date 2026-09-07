/**
 * CallGrid GTG number-block pixel.
 * POST/GET /webhooks/callgrid/gtg-block
 *
 * Payload (body or query): phoneNumber (or CallerId / phone / InboundNumber), gtg
 *
 * Behavior:
 *   - gtg === 1 / "1" → POST CallGrid /api/blocked (org-wide / universal)
 *   - gtg null / missing / any other value → ignore (no API call)
 *
 * Always returns 200 so CallGrid does not retry the pixel.
 *
 * Env:
 *   CALLGRID_API_KEY (required to block)
 *   CALLGRID_ORGANIZATION_ID (optional; falls back to /api/organization)
 *   CALLGRID_API_BASE_URL (optional)
 *   CALLGRID_GTG_BLOCK_DRY_RUN=true to skip POST /api/blocked
 */
const BASE_URL = (
  process.env.CALLGRID_API_BASE_URL || "https://api.callgrid.com"
).replace(/\/$/, "");

const PHONE_KEYS = [
  "phoneNumber",
  "phone_number",
  "phone",
  "CallerId",
  "callerId",
  "callerPhone",
  "InboundNumber",
  "inboundNumber",
  "from",
];

const GTG_KEYS = ["gtg", "GTG"];

function envTrim(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  return String(raw).trim();
}

function getApiKey() {
  return (
    process.env.CALLGRID_API_KEY ||
    process.env.CALLGRID_API_TOKEN ||
    ""
  ).trim();
}

function isDryRun() {
  const v = String(process.env.CALLGRID_GTG_BLOCK_DRY_RUN || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function pickFirst(source, keys) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(source, key) &&
      source[key] !== undefined
    ) {
      return source[key];
    }
  }
  const lowerMap = Object.create(null);
  for (const [k, v] of Object.entries(source)) {
    lowerMap[String(k).toLowerCase()] = v;
  }
  for (const key of keys) {
    const hit = lowerMap[String(key).toLowerCase()];
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function mergePayload(query = {}, body = {}) {
  const q =
    query && typeof query === "object" && !Array.isArray(query) ? query : {};
  const b =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return { ...q, ...b };
}

function normalizePhone(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (
    lower === "null" ||
    lower === "undefined" ||
    lower === "n/a" ||
    lower === "na"
  ) {
    return null;
  }
  if (/^\{\{?[a-zA-Z0-9_.]+\}\}?$/.test(trimmed)) return null;
  if (/^\[\[tag:[^\]]+\]\]$/i.test(trimmed)) return null;
  return trimmed;
}

/** Only exact gtg=1 (number or string) triggers a block. */
function isGtgBlock(value) {
  if (value === 1 || value === true) return true;
  if (typeof value === "string" && value.trim() === "1") return true;
  return false;
}

function asArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

async function callgridRequest(method, path, { query, body } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error("CALLGRID_API_KEY is not configured on the server.");
    err.code = "missing_api_key";
    throw err;
  }

  const url = new URL(
    `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  );
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), init);
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
        `CallGrid HTTP ${response.status} for ${path}`
    );
    err.status = response.status;
    err.details = json;
    throw err;
  }

  return json;
}

async function resolveOrganizationId(payload = {}) {
  const rawOrg = pickFirst(payload, [
    "organizationId",
    "organization_id",
    "callgridOrganizationId",
  ]);
  if (rawOrg != null && String(rawOrg).trim()) {
    return String(rawOrg).trim();
  }

  const envOrg = envTrim("CALLGRID_ORGANIZATION_ID");
  if (envOrg) return envOrg;

  const orgPayload = await callgridRequest("GET", "/api/organization");
  const orgs = asArray(orgPayload);
  const id =
    orgs[0]?.organizationId ||
    orgs[0]?.organization?.id ||
    orgs[0]?.id ||
    null;
  if (!id) {
    const err = new Error(
      "Could not resolve organizationId. Set CALLGRID_ORGANIZATION_ID in .env"
    );
    err.code = "missing_organization_id";
    throw err;
  }
  return String(id);
}

async function isAlreadyBlocked(phoneNumber) {
  try {
    const data = await callgridRequest("GET", "/api/blocked", {
      query: { phoneNumber },
    });
    return Boolean(data?.isBlocked);
  } catch (err) {
    console.warn(
      `[callgrid-gtg-block] block-status check failed for ${phoneNumber}:`,
      err.message
    );
    return false;
  }
}

function isAlreadyBlockedError(err) {
  if (err?.status === 409) return true;
  const message = String(
    err?.details?.message || err?.message || ""
  ).toLowerCase();
  return (
    message.includes("already") ||
    message.includes("exists") ||
    message.includes("blocked")
  );
}

async function blockPhoneNumber(organizationId, phoneNumber) {
  return callgridRequest("POST", "/api/blocked", {
    body: { phoneNumber, organizationId },
  });
}

/**
 * @param {object} query
 * @param {object} body
 */
async function handleGtgBlock(query = {}, body = {}) {
  const payload = mergePayload(query, body);
  const phoneNumber = normalizePhone(pickFirst(payload, PHONE_KEYS));
  const gtgRaw = pickFirst(payload, GTG_KEYS);
  const shouldBlock = isGtgBlock(gtgRaw);

  if (!shouldBlock) {
    return {
      ok: true,
      status: "ignored",
      reason: "gtg_not_1",
      gtg: gtgRaw == null ? null : String(gtgRaw),
      phoneNumber: phoneNumber || null,
      blocked: false,
    };
  }

  if (!phoneNumber) {
    return {
      ok: true,
      status: "skipped",
      reason: "missing_phone",
      gtg: "1",
      phoneNumber: null,
      blocked: false,
    };
  }

  const dryRun = isDryRun();
  const organizationId = await resolveOrganizationId(payload);

  if (await isAlreadyBlocked(phoneNumber)) {
    return {
      ok: true,
      status: "already_blocked",
      reason: "gtg",
      gtg: "1",
      phoneNumber,
      organizationId,
      blocked: false,
      dryRun,
    };
  }

  if (dryRun) {
    console.log(
      `[callgrid-gtg-block] DRY-RUN would block ${phoneNumber} org=${organizationId}`
    );
    return {
      ok: true,
      status: "dry_run",
      reason: "gtg",
      gtg: "1",
      phoneNumber,
      organizationId,
      blocked: false,
      dryRun: true,
    };
  }

  try {
    const result = await blockPhoneNumber(organizationId, phoneNumber);
    console.log(
      `[callgrid-gtg-block] blocked ${phoneNumber} org=${organizationId}`
    );
    return {
      ok: true,
      status: "blocked",
      reason: "gtg",
      gtg: "1",
      phoneNumber,
      organizationId,
      blocked: true,
      dryRun: false,
      result: result || undefined,
    };
  } catch (err) {
    if (isAlreadyBlockedError(err)) {
      return {
        ok: true,
        status: "already_blocked",
        reason: "gtg",
        gtg: "1",
        phoneNumber,
        organizationId,
        blocked: false,
        dryRun: false,
      };
    }
    console.error(
      `[callgrid-gtg-block] block failed for ${phoneNumber}:`,
      err.message,
      err.details || ""
    );
    return {
      ok: true,
      status: "error",
      reason: "block_failed",
      gtg: "1",
      phoneNumber,
      organizationId,
      blocked: false,
      message: err.message,
      details: err.details || undefined,
    };
  }
}

module.exports = {
  handleGtgBlock,
  isGtgBlock,
  normalizePhone,
};
