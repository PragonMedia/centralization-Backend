/**
 * CallGrid Dynamic Ring Tree — multi-campaign profiles.
 * Ringba ping trees ≈ campaign.routingGroups.plans[].groups[] (tiers).
 * Ringba targets ≈ destinations (destinationId).
 */
const path = require("path");

function envTrim(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  return String(raw).trim();
}

function parseProfilesJson(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const MEDICARE_RPC_RULES = { mode: "above", tier1Above: 11, tier2Min: 8 };
const MEDICARE_HYSTERESIS = {
  promoteToTier1: 11.5,
  demoteFromTier1: 10.5,
  promoteToTier2: 8.5,
  demoteFromTier2: 7.5,
};

const FE_RPC_RULES = { mode: "min", tier1Min: 20, tier2Min: 15 };
const FE_HYSTERESIS = {
  promoteToTier1: 21,
  demoteFromTier1: 19,
  promoteToTier2: 16,
  demoteFromTier2: 14,
};

/** Default profiles — Medicare live; FE/ACA disabled until campaign IDs are set. */
const DEFAULT_PROFILES = {
  medicare: {
    key: "medicare",
    label: "Medicare",
    enabled: envTrim("CALLGRID_RING_TREE_MEDICARE_ENABLED", "true").toLowerCase() !== "false",
    campaignId: envTrim("CALLGRID_RING_TREE_MEDICARE_CAMPAIGN_ID", "cmrwhonxu04ak07jzvllrcf4d"),
    planId: envTrim("CALLGRID_RING_TREE_MEDICARE_PLAN_ID", "plan-1784829558366"),
    campaignName: "Medicare",
    targetNamePrefix: "Medi -",
    rpcRules: MEDICARE_RPC_RULES,
    hysteresis: MEDICARE_HYSTERESIS,
  },
  fe: {
    key: "fe",
    label: "Final Expense",
    enabled: envTrim("CALLGRID_RING_TREE_FE_ENABLED", "false").toLowerCase() === "true",
    campaignId: envTrim("CALLGRID_RING_TREE_FE_CAMPAIGN_ID", ""),
    planId: envTrim("CALLGRID_RING_TREE_FE_PLAN_ID", ""),
    campaignName: "Final Expense",
    targetNamePrefix: "FE -",
    rpcRules: FE_RPC_RULES,
    hysteresis: FE_HYSTERESIS,
  },
  aca: {
    key: "aca",
    label: "ACA",
    enabled: envTrim("CALLGRID_RING_TREE_ACA_ENABLED", "false").toLowerCase() === "true",
    campaignId: envTrim("CALLGRID_RING_TREE_ACA_CAMPAIGN_ID", ""),
    planId: envTrim("CALLGRID_RING_TREE_ACA_PLAN_ID", ""),
    campaignName: "ACA",
    targetNamePrefix: "ACA -",
    rpcRules: FE_RPC_RULES,
    hysteresis: FE_HYSTERESIS,
  },
};

const envOverrides = parseProfilesJson(process.env.CALLGRID_RING_TREE_PROFILES_JSON);

function mergeProfile(base, override) {
  if (!override || typeof override !== "object") return base;
  const merged = { ...base, ...override };
  if (override.rpcRules && typeof override.rpcRules === "object") {
    merged.rpcRules = { ...(base.rpcRules || {}), ...override.rpcRules };
  }
  if (override.hysteresis && typeof override.hysteresis === "object") {
    merged.hysteresis = { ...(base.hysteresis || {}), ...override.hysteresis };
  }
  return merged;
}

function getProfiles() {
  const out = {};
  for (const [key, base] of Object.entries(DEFAULT_PROFILES)) {
    out[key] = mergeProfile(base, envOverrides?.[key]);
  }
  return out;
}

function isProfileConfigured(profile) {
  if (!profile || !profile.enabled) return false;
  return Boolean(profile.campaignId);
}

function getEnabledProfiles() {
  return Object.values(getProfiles()).filter(isProfileConfigured);
}

function getProfile(profileKey) {
  const key = String(profileKey || "medicare").trim().toLowerCase();
  const profile = getProfiles()[key];
  if (!profile || !isProfileConfigured(profile)) return null;
  return profile;
}

function resolveProfileKeyFromCampaign(campaignId, campaignName) {
  const id = String(campaignId || "").trim();
  const name = String(campaignName || "").trim();
  for (const profile of Object.values(getProfiles())) {
    if (!profile.enabled) continue;
    if (profile.campaignId && id && profile.campaignId === id) return profile.key;
    if (profile.campaignName && name && profile.campaignName === name) return profile.key;
  }
  return null;
}

function getProfileRpcRules(profile) {
  return profile?.rpcRules || MEDICARE_RPC_RULES;
}

function getProfileHysteresis(profile) {
  return profile?.hysteresis || MEDICARE_HYSTERESIS;
}

module.exports = {
  BATCH_SIZE: Math.max(1, parseInt(envTrim("CALLGRID_RING_TREE_BATCH_SIZE", "5"), 10) || 5),
  MOVE_COOLDOWN_MS: Math.max(
    0,
    parseInt(envTrim("CALLGRID_RING_TREE_MOVE_COOLDOWN_MS", "1800000"), 10) || 1800000
  ),
  DRY_RUN: envTrim("CALLGRID_RING_TREE_DRY_RUN", "true").toLowerCase() !== "false",
  STARTUP_DISCOVER:
    envTrim("CALLGRID_RING_TREE_STARTUP_DISCOVER", "true").toLowerCase() !== "false",
  WEBHOOK_SECRET: envTrim("CALLGRID_RING_TREE_WEBHOOK_SECRET"),
  SLACK_WEBHOOK_URL:
    envTrim("CALLGRID_RING_TREE_SLACK_WEBHOOK_URL") ||
    envTrim("DYNAMIC_RING_TREE_SLACK_WEBHOOK_URL") ||
    envTrim("SLACK_WEBHOOK_URL"),
  STATE_FILE: path.join(__dirname, "..", "logs", "callgrid-ring-tree-state.json"),
  EVENTS_FILE: path.join(__dirname, "..", "logs", "callgrid-ring-tree-events.jsonl"),
  API_BASE_URL: envTrim("CALLGRID_API_BASE_URL", "https://api.callgrid.com").replace(/\/$/, ""),
  getApiKey() {
    return envTrim("CALLGRID_API_KEY") || envTrim("CALLGRID_API_TOKEN");
  },
  getProfiles,
  getProfile,
  getEnabledProfiles,
  isProfileConfigured,
  resolveProfileKeyFromCampaign,
  getProfileRpcRules,
  getProfileHysteresis,
  // Legacy exports for medicare-only callers
  PROFILE_KEY: "medicare",
  CAMPAIGN_ID: DEFAULT_PROFILES.medicare.campaignId,
  PLAN_ID: DEFAULT_PROFILES.medicare.planId,
  RPC_RULES: MEDICARE_RPC_RULES,
  HYSTERESIS: MEDICARE_HYSTERESIS,
};
