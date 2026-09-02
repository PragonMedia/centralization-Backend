/**
 * CallGrid tag-audit pixel — alert Slack when required call tags are missing.
 * POST /webhooks/callgrid/tag-audit
 *
 * Gates (ignore entirely):
 *   - phoneNumber or mb missing
 *   - gtg === "1"
 *   - clickid missing
 *
 * Required tags by channel:
 *   - PN          → angle, channel, key  (no adaccount)
 *   - contains TV → angle
 *   - FE          → channel, key
 *   - default     → angle, channel, adaccount, key
 */
const { sendSlackMessage } = require("./slackService");

const DEFAULT_REQUIRED_FIELDS = ["angle", "channel", "adaccount", "key"];
const PN_REQUIRED_FIELDS = ["angle", "channel", "key"];
const TV_REQUIRED_FIELDS = ["angle"];
const FE_REQUIRED_FIELDS = ["channel", "key"];

const FIELD_ALIASES = {
  angle: ["angle"],
  channel: ["channel"],
  adaccount: ["adaccount", "adAccount", "ad_account", "account"],
  key: ["key"],
  clickid: ["clickid", "clickId", "click_id"],
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

function isPnChannel(channel) {
  return normalizeChannel(channel) === "pn";
}

function isTvChannel(channel) {
  return normalizeChannel(channel).includes("tv");
}

function isFeChannel(channel) {
  return normalizeChannel(channel) === "fe";
}

function isGtgSkip(value) {
  if (value == null) return false;
  return String(value).trim() === "1";
}

function getRequiredFields(payload) {
  if (isPnChannel(payload?.channel)) return [...PN_REQUIRED_FIELDS];
  if (isTvChannel(payload?.channel)) return [...TV_REQUIRED_FIELDS];
  if (isFeChannel(payload?.channel)) return [...FE_REQUIRED_FIELDS];
  return [...DEFAULT_REQUIRED_FIELDS];
}

function formatMissingList(fields) {
  if (fields.length === 1) return fields[0];
  if (fields.length === 2) return `${fields[0]} and ${fields[1]}`;
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

function buildSlackMessage({ phoneNumber, mb, missing }) {
  return `Call ${phoneNumber} from ${mb} does not contain ${formatMissingList(missing)}`;
}

function extractPayload(query = {}, body = {}) {
  const merged =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...(query || {}), ...body }
      : { ...(query || {}) };

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
  const pnChannel = isPnChannel(payload.channel);
  const tvChannel = isTvChannel(payload.channel);
  const feChannel = isFeChannel(payload.channel);
  const gtgSkip = isGtgSkip(payload.gtg);
  const clickidMissing = isMissing(payload.clickid);
  const phoneMissing = isMissing(payload.phoneNumber);
  const mbMissing = isMissing(payload.mb);

  const baseMeta = {
    pnChannel,
    tvChannel,
    feChannel,
    gtg: payload.gtg ?? null,
    campaign: payload.campaign ?? null,
    phoneNumber: payload.phoneNumber ?? null,
    mb: payload.mb ?? null,
    clickid: payload.clickid ?? null,
  };

  if (phoneMissing || mbMissing) {
    console.log("[callgrid-tag-audit] skip Slack (phone/mb missing)", {
      phoneMissing,
      mbMissing,
    });
    return {
      ok: true,
      status: "ignored_missing_identity",
      missing: [],
      message: null,
      notified: false,
      gtgSkip,
      requiredFields: [],
      ...baseMeta,
    };
  }

  if (gtgSkip) {
    console.log("[callgrid-tag-audit] skip Slack (gtg=1)", {
      phoneNumber: payload.phoneNumber,
      mb: payload.mb,
    });
    return {
      ok: true,
      status: "ignored_gtg",
      missing: [],
      message: null,
      notified: false,
      gtgSkip: true,
      requiredFields: [],
      ...baseMeta,
    };
  }

  if (clickidMissing) {
    console.log("[callgrid-tag-audit] skip Slack (clickid missing)", {
      phoneNumber: payload.phoneNumber,
      mb: payload.mb,
    });
    return {
      ok: true,
      status: "ignored_missing_clickid",
      missing: [],
      message: null,
      notified: false,
      gtgSkip: false,
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
      gtgSkip: false,
      ...baseMeta,
    };
  }

  const phoneNumber = String(payload.phoneNumber).trim();
  const mb = String(payload.mb).trim();
  const message = buildSlackMessage({ phoneNumber, mb, missing });

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
  DEFAULT_REQUIRED_FIELDS,
  PN_REQUIRED_FIELDS,
  TV_REQUIRED_FIELDS,
  FE_REQUIRED_FIELDS,
  handleTagAudit,
  extractPayload,
  isMissing,
  isPnChannel,
  isTvChannel,
  isFeChannel,
  getRequiredFields,
  formatMissingList,
  buildSlackMessage,
};
