/**
 * Dynamic Ring Tree Target — multi-vertical tier profiles.
 * Each vertical (FE, Medicare, Debt, ACA) has fixed ping tree IDs per tier.
 * Enable additional verticals when IDs are confirmed in Ringba.
 */
const RINGBA_CONFIG = require("./ringbaApi");

function parseProfilesJson(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tier(name, pingTreeId) {
  return { name, pingTreeId: (pingTreeId || "").trim() };
}

const FE_RPC_RULES = { mode: "min", tier1Min: 20, tier2Min: 15 };
const FE_HYSTERESIS = {
  promoteToTier1: 21,
  demoteFromTier1: 19,
  promoteToTier2: 16,
  demoteFromTier2: 14,
};

const MEDICARE_RPC_RULES = { mode: "above", tier1Above: 11, tier2Min: 8 };
const MEDICARE_HYSTERESIS = {
  promoteToTier1: 11.5,
  demoteFromTier1: 10.5,
  promoteToTier2: 8.5,
  demoteFromTier2: 7.5,
};

/** Default profiles — FE live; others disabled until ping tree IDs are set. */
const DEFAULT_PROFILES = {
  fe: {
    key: "fe",
    label: "Final Expense",
    enabled: true,
    targetNamePrefix: "FE -",
    rpcRules: FE_RPC_RULES,
    hysteresis: FE_HYSTERESIS,
    tiers: [
      tier("FE - Tier 1", process.env.DYNAMIC_RING_TREE_FE_TIER1_ID || "PI943e1abfb7c84cbdbdf12b5fed5db525"),
      tier("FE - Tier 2", process.env.DYNAMIC_RING_TREE_FE_TIER2_ID || "PIfd7e2f930c1943dda25f3cfc290c1d9c"),
      tier("FE - Tier 3", process.env.DYNAMIC_RING_TREE_FE_TIER3_ID || "PId770038dc60d4aef9d2a735a629b1fca"),
    ],
  },
  medicare: {
    key: "medicare",
    label: "Medicare",
    enabled: process.env.DYNAMIC_RING_TREE_MEDICARE_ENABLED === "true",
    campaignName: "Paragon - Medicare",
    dryRun: process.env.DYNAMIC_RING_TREE_MEDICARE_DRY_RUN !== "false",
    targetNamePrefix: "Medi -",
    rpcRules: MEDICARE_RPC_RULES,
    hysteresis: MEDICARE_HYSTERESIS,
    tiers: [
      tier(
        "Medicare - Tier 1",
        process.env.DYNAMIC_RING_TREE_MEDICARE_TIER1_ID || "PI27c8553f1e9e495c90b1065063374ea7"
      ),
      tier(
        "Medicare  - Tier 2",
        process.env.DYNAMIC_RING_TREE_MEDICARE_TIER2_ID || "PI3a999008ead2425e82dbf9fc9fbddb32"
      ),
      tier(
        "Medicare  - Tier 3",
        process.env.DYNAMIC_RING_TREE_MEDICARE_TIER3_ID || "PI91698bc56b9a41c3bc8e1a5a1775ea44"
      ),
    ],
  },
  debt: {
    key: "debt",
    label: "Debt",
    enabled: process.env.DYNAMIC_RING_TREE_DEBT_ENABLED === "true",
    targetNamePrefix: "DEBT -",
    tiers: [
      tier("DEBT - Tier 1", process.env.DYNAMIC_RING_TREE_DEBT_TIER1_ID || ""),
      tier("DEBT - Tier 2", process.env.DYNAMIC_RING_TREE_DEBT_TIER2_ID || ""),
      tier("DEBT - Tier 3", process.env.DYNAMIC_RING_TREE_DEBT_TIER3_ID || ""),
    ],
  },
  aca: {
    key: "aca",
    label: "ACA",
    enabled: process.env.DYNAMIC_RING_TREE_ACA_ENABLED === "true",
    targetNamePrefix: "ACA -",
    tiers: [
      tier("ACA - Tier 1", process.env.DYNAMIC_RING_TREE_ACA_TIER1_ID || ""),
      tier("ACA - Tier 2", process.env.DYNAMIC_RING_TREE_ACA_TIER2_ID || ""),
      tier("ACA - Tier 3", process.env.DYNAMIC_RING_TREE_ACA_TIER3_ID || ""),
    ],
  },
};

const envOverrides = parseProfilesJson(process.env.DYNAMIC_RING_TREE_PROFILES_JSON);

function mergeProfile(base, override) {
  if (!override || typeof override !== "object") return base;
  const merged = { ...base, ...override };
  if (Array.isArray(override.tiers)) {
    merged.tiers = override.tiers.map((t, i) => ({
      ...(base.tiers[i] || {}),
      ...t,
    }));
  }
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
  return (
    Array.isArray(profile.tiers) &&
    profile.tiers.length === 3 &&
    profile.tiers.every((t) => t.name && t.pingTreeId)
  );
}

function getEnabledProfiles() {
  return Object.values(getProfiles()).filter(isProfileConfigured);
}

function getProfile(profileKey) {
  const key = String(profileKey || "fe").trim().toLowerCase();
  const profile = getProfiles()[key];
  if (!profile) return null;
  return isProfileConfigured(profile) ? profile : profile.enabled === false ? profile : null;
}

function resolveProfileKeyFromTargetName(targetName, explicitKey) {
  if (explicitKey) {
    const k = String(explicitKey).trim().toLowerCase();
    if (getProfiles()[k]) return k;
  }
  const name = String(targetName || "").trim();
  for (const profile of Object.values(getProfiles())) {
    if (!profile.enabled) continue;
    const prefix = profile.targetNamePrefix || "";
    if (prefix && name.startsWith(prefix)) return profile.key;
    for (const t of profile.tiers || []) {
      if (name.startsWith(t.name)) return profile.key;
    }
  }
  return null;
}

function resolveProfileKeyFromCampaignName(campaignName, explicitKey) {
  if (explicitKey) {
    const k = String(explicitKey).trim().toLowerCase();
    if (getProfiles()[k]) return k;
  }
  const name = String(campaignName || "").trim();
  if (!name) return null;
  for (const profile of Object.values(getProfiles())) {
    if (!profile.enabled) continue;
    if (profile.campaignName && profile.campaignName === name) return profile.key;
  }
  return null;
}

function getProfileRpcRules(profile) {
  if (profile?.rpcRules) return profile.rpcRules;
  return FE_RPC_RULES;
}

function getProfileHysteresis(profile) {
  if (profile?.hysteresis) return profile.hysteresis;
  return FE_HYSTERESIS;
}

/** Per-profile dry-run when set; otherwise global DYNAMIC_RING_TREE_DRY_RUN (FE on prod). */
function isProfileDryRun(profile) {
  if (profile && typeof profile.dryRun === "boolean") return profile.dryRun;
  return String(process.env.DYNAMIC_RING_TREE_DRY_RUN ?? "true").trim().toLowerCase() !== "false";
}

module.exports = {
  BATCH_SIZE: Math.max(1, parseInt(process.env.DYNAMIC_RING_TREE_BATCH_SIZE || "15", 10) || 15),
  RPC_TIER1_MIN: FE_RPC_RULES.tier1Min,
  RPC_TIER2_MIN: FE_RPC_RULES.tier2Min,
  HYSTERESIS: FE_HYSTERESIS,
  MOVE_COOLDOWN_MS: Math.max(
    0,
    parseInt(process.env.DYNAMIC_RING_TREE_MOVE_COOLDOWN_MS || "1800000", 10) || 1800000
  ),
  DRY_RUN: String(process.env.DYNAMIC_RING_TREE_DRY_RUN ?? "true").trim().toLowerCase() !== "false",
  /** When pixel revenue is all $0 at Completed, refetch conversion from Ringba calllogs before tier eval. */
  REVENUE_BACKFILL_ENABLED:
    String(process.env.DYNAMIC_RING_TREE_REVENUE_BACKFILL ?? "true").trim().toLowerCase() !== "false",
  REVENUE_BACKFILL_DELAY_MS: Math.max(
    0,
    parseInt(process.env.DYNAMIC_RING_TREE_REVENUE_BACKFILL_DELAY_MS || "0", 10) || 0
  ),
  /** Skip tier-down when RPC is still 0 after backfill (RTB postbacks often lag Completed). */
  SKIP_DEMOTION_ON_UNCONFIRMED_ZERO_RPC:
    String(process.env.DYNAMIC_RING_TREE_SKIP_DEMOTION_ON_ZERO_RPC ?? "true").trim().toLowerCase() !==
    "false",
  /** When false (default), always replace pixel revenue with Ringba Insights on batch eval. */
  REVENUE_BACKFILL_ONLY_ZERO_PIXEL:
    String(process.env.DYNAMIC_RING_TREE_REVENUE_BACKFILL_ONLY_ZERO_PIXEL ?? "false").trim().toLowerCase() ===
    "true",
  /** Clear open RPC batches daily so partial counts do not carry overnight. */
  DAILY_BATCH_RESET_ENABLED:
    String(process.env.DYNAMIC_RING_TREE_DAILY_BATCH_RESET ?? "true").trim().toLowerCase() !== "false",
  DAILY_BATCH_RESET_TIMEZONE: (
    process.env.DYNAMIC_RING_TREE_DAILY_BATCH_RESET_TIMEZONE || "America/New_York"
  ).trim(),
  DAILY_BATCH_RESET_HOUR: Math.min(
    23,
    Math.max(0, parseInt(process.env.DYNAMIC_RING_TREE_DAILY_BATCH_RESET_HOUR || "1", 10) || 1)
  ),
  STATE_FILE: require("path").join(__dirname, "..", "logs", "dynamic-ring-tree-state.json"),
  EVENTS_FILE: require("path").join(__dirname, "..", "logs", "dynamic-ring-tree-events.jsonl"),
  RINGBA_ACCOUNT_ID: RINGBA_CONFIG.ACCOUNT_ID,
  RINGBA_API_TOKEN: RINGBA_CONFIG.API_KEY,
  RINGBA_BASE_URL: (RINGBA_CONFIG.BASE_URL || "https://api.ringba.com").replace(/\/$/, ""),
  getProfiles,
  getProfile,
  getEnabledProfiles,
  isProfileConfigured,
  resolveProfileKeyFromTargetName,
  resolveProfileKeyFromCampaignName,
  getProfileRpcRules,
  getProfileHysteresis,
  isProfileDryRun,
};
