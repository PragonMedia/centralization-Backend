/**
 * CallGrid tag-audit pixel — alert Slack when required call tags are missing.
 * POST /webhooks/callgrid/tag-audit
 */
const { sendSlackMessage } = require("./slackService");

const REQUIRED_FIELDS = ["angle", "channel", "qualified", "adaccount", "key"];
/** CTV / Containers TV: only require channel + angle (case-insensitive match). */
const CTV_CHANNEL_VALUES = new Set(["containers tv", "tv"]);
const CTV_REQUIRED_FIELDS = ["channel", "angle"];
/** Final Expense campaign: only require channel. */
const FE_REQUIRED_FIELDS = ["channel"];

const FIELD_ALIASES = {
  angle: ["angle"],
  channel: ["channel"],
  qualified: ["qualified"],
  adaccount: ["adaccount", "adAccount", "ad_account", "account"],
  key: ["key"],
  phoneNumber: [
    "phoneNumber",
    "phone_number",
    "phone",
    "callerPhone",
    "callerNumber",
    "CallerId",
    "from",
  ],
  mb: ["mb", "mediaBuyer", "media_buyer", "mediaBuyerName", "VendorName"],
  gtg: ["gtg"],
  campaign: ["campaign", "campaignName", "CampaignName"],
};

function envTrim(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  return String(raw).trim();
}

function pickFirst(source, keys) {
  if (!source || typeof source !== "object") return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      return source[key];
    }
  }
  // case-insensitive fallback
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

function isMissing(value) {
  if (value == null) return true;
  const s = String(value).trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower === "null" || lower === "undefined" || lower === "n/a" || lower === "na") {
    return true;
  }
  // Unresolved placeholders: {angle}, {{channel}}, [[tag:key]], etc.
  if (/^\{\{?[a-zA-Z0-9_.]+\}\}?$/.test(s)) return true;
  if (/^\[\[tag:[^\]]+\]\]$/i.test(s)) return true;
  return false;
}

function normalizeChannel(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function isCtvChannel(channel) {
  return CTV_CHANNEL_VALUES.has(normalizeChannel(channel));
}

function isPnChannel(channel) {
  return normalizeChannel(channel) === "pn";
}

function isFinalExpenseCampaign(campaign) {
  if (campaign == null) return false;
  return String(campaign).trim().toLowerCase().includes("final expense");
}

function getRequiredFields(payload) {
  // FE campaign: only channel (takes precedence over CTV relaxed rules).
  if (isFinalExpenseCampaign(payload?.campaign)) {
    return [...FE_REQUIRED_FIELDS];
  }
  if (isCtvChannel(payload?.channel)) {
    return [...CTV_REQUIRED_FIELDS];
  }
  return [...REQUIRED_FIELDS];
}

function isGtgSkip(value) {
  if (value == null) return false;
  const s = String(value).trim();
  return s === "1";
}

function formatMissingList(fields) {
  if (fields.length === 1) return fields[0];
  if (fields.length === 2) return `${fields[0]} and ${fields[1]}`;
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

function buildSlackMessage({ phoneNumber, mb, missing }) {
  const phone = phoneNumber || "unknown";
  const buyer = mb || "unknown";
  return `Call ${phone} from ${buyer} does not contain ${formatMissingList(missing)}`;
}

function extractPayload(query = {}, body = {}) {
  const merged =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...(query || {}), ...body }
      : { ...(query || {}) };

  // Nested tags object (CallGrid sometimes nests custom tags)
  const tags =
    (merged.tags && typeof merged.tags === "object" ? merged.tags : null) ||
    (merged.Tags && typeof merged.Tags === "object" ? merged.Tags : null) ||
    {};

  const source = { ...tags, ...merged };

  const out = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    out[field] = pickFirst(source, aliases);
  }
  return out;
}

function getSlackWebhookUrl() {
  return (
    envTrim("CALLGRID_TAG_AUDIT_SLACK_WEBHOOK_URL") ||
    envTrim("SLACK_WEBHOOK_URL")
  );
}

/**
 * @returns {{ ok: true, status: string, missing: string[], message: string|null, notified: boolean }}
 */
async function handleTagAudit(query = {}, body = {}) {
  const payload = extractPayload(query, body);
  const feRelaxed = isFinalExpenseCampaign(payload.campaign);
  const pnChannel = isPnChannel(payload.channel);
  const ctvRelaxed = !feRelaxed && isCtvChannel(payload.channel);
  const gtgSkip = isGtgSkip(payload.gtg);

  const baseMeta = {
    feRelaxed,
    pnChannel,
    ctvRelaxed,
    gtg: payload.gtg ?? null,
    campaign: payload.campaign ?? null,
    phoneNumber: payload.phoneNumber ?? null,
    mb: payload.mb ?? null,
  };

  // channel === PN: ignore entirely — no tag checks, no Slack.
  if (pnChannel) {
    console.log("[callgrid-tag-audit] skip Slack (channel=PN)", {
      phoneNumber: payload.phoneNumber ?? null,
      mb: payload.mb ?? null,
    });
    return {
      ok: true,
      status: "ignored_pn_channel",
      missing: [],
      message: null,
      notified: false,
      gtgSkip,
      requiredFields: [],
      ...baseMeta,
    };
  }

  const requiredFields = getRequiredFields(payload);
  const missing = requiredFields.filter((field) => isMissing(payload[field]));
  baseMeta.requiredFields = requiredFields;

  if (missing.length === 0) {
    return {
      ok: true,
      status: "ok",
      missing: [],
      message: null,
      notified: false,
      gtgSkip,
      ...baseMeta,
    };
  }

  const message = buildSlackMessage({
    phoneNumber: isMissing(payload.phoneNumber) ? "unknown" : String(payload.phoneNumber).trim(),
    mb: isMissing(payload.mb) ? "unknown" : String(payload.mb).trim(),
    missing,
  });

  if (gtgSkip) {
    console.log("[callgrid-tag-audit] skip Slack (gtg=1)", message);
    return {
      ok: true,
      status: "missing_tags_skipped_gtg",
      missing,
      message,
      notified: false,
      gtgSkip: true,
      ...baseMeta,
    };
  }

  let notified = false;
  try {
    await sendSlackMessage(message, { webhookUrl: getSlackWebhookUrl() || undefined });
    notified = Boolean(getSlackWebhookUrl());
  } catch (err) {
    console.error("[callgrid-tag-audit] Slack error:", err.message || err);
  }

  console.warn("[callgrid-tag-audit]", message);

  return {
    ok: true,
    status: "missing_tags",
    missing,
    message,
    notified,
    gtgSkip: false,
    ...baseMeta,
  };
}

module.exports = {
  REQUIRED_FIELDS,
  CTV_REQUIRED_FIELDS,
  FE_REQUIRED_FIELDS,
  CTV_CHANNEL_VALUES,
  handleTagAudit,
  extractPayload,
  isMissing,
  isCtvChannel,
  isPnChannel,
  isFinalExpenseCampaign,
  getRequiredFields,
  formatMissingList,
  buildSlackMessage,
};
