/**
 * CallGrid ring-tree — ingest, RPC batches, tier discovery, dry-run moves.
 */
const fs = require("fs");
const path = require("path");
const CFG = require("../config/callgridRingTreeTarget");
const slackService = require("./slackService");

const targetLocks = new Map();
let stateMutex = Promise.resolve();

function withStateMutex(fn) {
  const run = stateMutex.then(fn, fn);
  stateMutex = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function emptyState() {
  return { version: 2, profiles: {} };
}

function ensureProfileState(state, profileKey) {
  if (!state.profiles[profileKey]) {
    state.profiles[profileKey] = { destinations: {}, lastMoveAt: {} };
  }
  return state.profiles[profileKey];
}

async function loadState() {
  try {
    const raw = await fs.promises.readFile(CFG.STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyState();
    if (!parsed.profiles) {
      return {
        version: 2,
        profiles: parsed.destinations
          ? { medicare: { destinations: parsed.destinations, lastMoveAt: parsed.lastMoveAt || {} } }
          : {},
      };
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") return emptyState();
    throw err;
  }
}

async function saveState(state) {
  await fs.promises.mkdir(path.dirname(CFG.STATE_FILE), { recursive: true });
  const tmp = `${CFG.STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.promises.rename(tmp, CFG.STATE_FILE);
}

async function appendEvent(entry = {}) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
  await fs.promises.mkdir(path.dirname(CFG.EVENTS_FILE), { recursive: true });
  await fs.promises.appendFile(CFG.EVENTS_FILE, line, "utf8");
}

function parseRevenue(value) {
  if (value == null || value === "") return 0;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function isBlankOrPlaceholder(value) {
  const s = String(value ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (["-no value-", "no value", "null", "undefined", "none", "n/a", "na"].includes(lower)) {
    return true;
  }
  // Unresolved CallGrid tokens: [[tag:X]], [[destinationId]], {{x}}, [x]
  if (/^\[\[[^\]]+\]\]$/.test(s)) return true;
  if (/^\[[^\]]+\]$/.test(s) || /^\{\{[^}]+\}\}$/.test(s)) return true;
  return false;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function pick(src, ...keys) {
  for (const k of keys) {
    const parts = String(k).split(".");
    let cur = src;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = cur[p];
    }
    if (cur != null && String(cur).trim() !== "") return String(cur).trim();
  }
  return "";
}

function parseIngestParams(query = {}, body = {}) {
  const src = { ...query, ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}) };
  const nestedCall = src.call && typeof src.call === "object" ? src.call : {};
  const nestedTags = src.tags && typeof src.tags === "object" ? src.tags : {};
  const merged = { ...nestedTags, ...nestedCall, ...src };
  return {
    event: pick(merged, "event", "type", "callStatus", "CallStatus"),
    callId: pick(merged, "callId", "call_id", "CallId", "id"),
    destinationId: pick(merged, "destinationId", "destination_id", "DestinationId", "destination.id"),
    destinationName: pick(merged, "destinationName", "destination_name", "DestinationName", "destination.name"),
    callerPhone: pick(merged, "callerPhone", "caller_phone", "CallerId", "callerId", "ani", "phone", "InboundNumber", "from"),
    revenue: pick(merged, "revenue", "CallRevenue", "callRevenue", "payout", "CallPayout", "conversionAmount"),
    campaignId: pick(merged, "campaignId", "campaign_id", "CampaignId", "campaign.id"),
    campaignName: pick(merged, "campaignName", "campaign_name", "CampaignName"),
    routingGroupName: pick(merged, "routingGroupName", "RoutingGroupName"),
    profileKey: pick(merged, "profile", "vertical", "profileKey"),
    callStatus: pick(merged, "callStatus", "CallStatus", "status"),
  };
}

/**
 * CallGrid webhooks often leave DestinationId / CallRevenue / RoutingGroupName blank
 * even when GET /api/call/:id has them. Backfill from the Call API when needed.
 * Call records are often not indexed yet at webhook fire time → retry briefly.
 */
async function enrichParamsFromCallApi(params) {
  const callId = params.callId;
  if (!callId) return { params, enriched: false, reason: "no_call_id" };

  const needsDestination = isBlankOrPlaceholder(params.destinationId);
  const needsRevenue = isBlankOrPlaceholder(params.revenue);
  const needsRouting = isBlankOrPlaceholder(params.routingGroupName);
  const needsDestName = isBlankOrPlaceholder(params.destinationName);
  const needsCaller = isBlankOrPlaceholder(params.callerPhone);
  const needsCampaign = isBlankOrPlaceholder(params.campaignId);

  if (!needsDestination && !needsRevenue && !needsRouting && !needsDestName && !needsCaller && !needsCampaign) {
    return { params, enriched: false, reason: "already_complete" };
  }

  const delaysMs = [0, 1500, 3000, 5000];
  let lastError = null;

  for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
    if (delaysMs[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
    try {
      const call = await callgridGet(`/api/call/${encodeURIComponent(callId)}`);
      const tags = call?.tags && typeof call.tags === "object" ? call.tags : {};
      // Docs: destinationId/campaignId/from/callStatus are top-level; tags mirror many of them.
      const fromApi = {
        destinationId: pick(call, "destinationId") || pick(tags, "DestinationId", "destinationId"),
        destinationName: pick(tags, "DestinationName", "destinationName"),
        callerPhone:
          pick(call, "from") || pick(tags, "CallerId", "InboundNumber", "callerPhone"),
        revenue: pick(tags, "CallRevenue", "CallPayout", "revenue", "payout") || pick(call, "revenue", "payout"),
        campaignId: pick(call, "campaignId") || pick(tags, "CampaignId", "campaignId"),
        campaignName: pick(tags, "CampaignName", "campaignName"),
        routingGroupName: pick(tags, "RoutingGroupName", "routingGroupName"),
        callStatus: pick(call, "callStatus") || pick(tags, "CallStatus", "callStatus"),
      };

      const next = { ...params };
      if (needsDestination && fromApi.destinationId) next.destinationId = fromApi.destinationId;
      if (needsDestName && fromApi.destinationName) next.destinationName = fromApi.destinationName;
      if (needsCaller && fromApi.callerPhone) next.callerPhone = fromApi.callerPhone;
      if (needsRevenue && !isBlankOrPlaceholder(fromApi.revenue)) next.revenue = fromApi.revenue;
      if (needsCampaign && fromApi.campaignId) next.campaignId = fromApi.campaignId;
      if (isBlankOrPlaceholder(next.campaignName) && fromApi.campaignName) {
        next.campaignName = fromApi.campaignName;
      }
      if (needsRouting && fromApi.routingGroupName) next.routingGroupName = fromApi.routingGroupName;

      const gotDestination = !isBlankOrPlaceholder(next.destinationId);
      if (!gotDestination && needsDestination) {
        // Call exists but destination not set yet — keep retrying.
        lastError = new Error("destination_not_ready");
        continue;
      }

      return {
        params: next,
        enriched: true,
        reason: "call_api",
        attempt: attempt + 1,
        callStatus: fromApi.callStatus || null,
        fromApi,
      };
    } catch (err) {
      lastError = err;
      const notFound =
        err.status === 404 || /not found/i.test(String(err.message || ""));
      if (!notFound) {
        console.warn("[callgrid-ring-tree] call API enrich failed:", callId, err.message);
        return { params, enriched: false, reason: "api_error", error: err.message };
      }
      // retry on Call not found
    }
  }

  console.warn(
    "[callgrid-ring-tree] call API enrich failed:",
    callId,
    lastError?.message || "exhausted_retries"
  );
  return {
    params,
    enriched: false,
    reason: "api_error",
    error: lastError?.message || "exhausted_retries",
  };
}

function asArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

async function callgridGet(apiPath) {
  const apiKey = CFG.getApiKey();
  if (!apiKey) {
    const err = new Error("CALLGRID_API_KEY is not configured on the server.");
    err.code = "missing_api_key";
    throw err;
  }
  const url = `${CFG.API_BASE_URL}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(json?.message || `CallGrid HTTP ${response.status} for ${apiPath}`);
    err.status = response.status;
    err.details = json;
    throw err;
  }
  return json;
}

async function callgridPatch(apiPath, body) {
  const apiKey = CFG.getApiKey();
  if (!apiKey) {
    const err = new Error("CALLGRID_API_KEY is not configured on the server.");
    err.code = "missing_api_key";
    throw err;
  }
  const url = `${CFG.API_BASE_URL}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(
      json?.message || json?.error || `CallGrid HTTP ${response.status} PATCH ${apiPath}`
    );
    err.status = response.status;
    err.details = json;
    throw err;
  }
  return json;
}

async function verifyAuth() {
  const apiKey = CFG.getApiKey();
  if (!apiKey) {
    return { ok: false, error: "missing_api_key", message: "Set CALLGRID_API_KEY in .env (publisher org key)." };
  }
  try {
    const [orgPayload, campaignPayload] = await Promise.all([
      callgridGet("/api/organization"),
      callgridGet("/api/campaign"),
    ]);
    const orgs = asArray(orgPayload);
    const campaigns = asArray(campaignPayload);
    return {
      ok: true,
      organizationId: orgs[0]?.id || orgs[0]?.organizationId || process.env.CALLGRID_ORGANIZATION_ID || null,
      campaignCount: campaigns.length,
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, paused: Boolean(c.paused), groupMode: Boolean(c.groupMode) })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err.code || "auth_failed",
      status: err.status || null,
      message: err.message,
      hint:
        err.status === 401
          ? "Invalid or revoked API key — regenerate in CallGrid → Organization Settings → API Keys."
          : undefined,
    };
  }
}

async function fetchDestinationNameMap() {
  // Omit page= — CallGrid truncates paginated /api/destination results.
  const byId = new Map();
  const payload = await callgridGet("/api/destination");
  for (const row of asArray(payload)) {
    if (row?.id) byId.set(row.id, row.name || row.id);
  }
  return byId;
}

async function fetchCampaignById(campaignId) {
  return callgridGet(`/api/campaign/${encodeURIComponent(campaignId)}`);
}

function findPlan(campaign, profile) {
  const plans = campaign?.routingGroups?.plans || [];
  if (profile?.planId) {
    const match = plans.find((p) => p.id === profile.planId);
    if (match) return match;
  }
  return plans[0] || null;
}

/**
 * Groups the ring-tree may move destinations between.
 * When profile.tierGroupNames is set (FE: T1/T2/T3), Sales Pulse and any other
 * groups are excluded from tierOrder and automation.
 */
function getManagedGroups(plan, profile) {
  const groups = plan?.groups || [];
  const names = profile?.tierGroupNames;
  if (Array.isArray(names) && names.length) {
    const want = new Set(names);
    return groups.filter((g) => want.has(g.name));
  }
  return groups;
}

function buildTierSnapshot(campaign, profile, destNameById) {
  const plan = findPlan(campaign, profile);
  const managed = getManagedGroups(plan, profile);
  const groups = managed.map((g) => {
    const destIds = (g.destinations || [])
      .map((d) => (typeof d === "string" ? d : d?.id))
      .filter(Boolean);
    const weights = Array.isArray(g.weights) ? g.weights : [];
    return {
      id: g.id,
      name: g.name,
      mode: g.mode,
      destinationCount: destIds.length,
      destinations: destIds.map((id) => {
        const w = weights.find((row) => row.destinationId === id);
        return {
          id,
          name: destNameById.get(id) || null,
          weight: w?.weight ?? null,
          priority: w?.priority ?? null,
        };
      }),
    };
  });
  return {
    profileKey: profile.key,
    label: profile.label,
    campaignId: campaign.id,
    campaignName: campaign.name,
    paused: Boolean(campaign.paused),
    groupMode: Boolean(campaign.groupMode),
    routing: campaign.routing || null,
    plan: plan ? { id: plan.id, name: plan.name, groupCount: groups.length } : null,
    tierGroupNames: Array.isArray(profile.tierGroupNames) ? profile.tierGroupNames : null,
    tiers: groups,
    totalDestinations: groups.reduce((sum, g) => sum + g.destinationCount, 0),
  };
}

function logTierSnapshot(snapshot) {
  console.log("\n========== CallGrid Ring Tree Discovery ==========");
  console.log(`Profile: ${snapshot.label} (${snapshot.profileKey})`);
  console.log(`Campaign: ${snapshot.campaignName} (${snapshot.campaignId})`);
  console.log(`Group mode: ${snapshot.groupMode} | Routing: ${snapshot.routing}`);
  if (snapshot.plan) {
    console.log(`Plan: ${snapshot.plan.name} (${snapshot.plan.id}) — ${snapshot.plan.groupCount} tier(s)`);
  }
  for (const tier of snapshot.tiers) {
    console.log(`\n--- ${tier.name} (${tier.id}) mode=${tier.mode} targets=${tier.destinationCount} ---`);
    for (const dest of tier.destinations) {
      console.log(
        `  • ${dest.name || "(unnamed)"} | id=${dest.id} | weight=${dest.weight ?? "-"} | priority=${dest.priority ?? "-"}`
      );
    }
  }
  console.log(`\nTotal destinations in tiers: ${snapshot.totalDestinations}`);
  console.log("==================================================\n");
}

async function discoverProfile(profile, destNameById) {
  const campaign = await fetchCampaignById(profile.campaignId);
  const snapshot = buildTierSnapshot(campaign, profile, destNameById);
  logTierSnapshot(snapshot);
  return snapshot;
}

async function discoverAllCampaigns(options = {}) {
  const logToConsole = options.logToConsole !== false;
  const auth = await verifyAuth();
  if (!auth.ok) {
    if (logToConsole) console.error("[callgrid-ring-tree] auth failed:", auth.message);
    return { ok: false, auth, profiles: [], enabledProfiles: [] };
  }

  if (logToConsole) {
    console.log("\n[callgrid-ring-tree] CallGrid auth OK");
    console.log("[callgrid-ring-tree] organizationId:", auth.organizationId);
    console.log("[callgrid-ring-tree] campaigns in account:", auth.campaignCount);
    for (const c of auth.campaigns) {
      const enabledProfile = CFG.resolveProfileKeyFromCampaign(c.id, c.name);
      console.log(
        `  - ${c.name} (${c.id}) paused=${c.paused} groupMode=${c.groupMode}` +
          (enabledProfile ? ` → ENABLED profile: ${enabledProfile}` : "")
      );
    }
  }

  const destNameById = await fetchDestinationNameMap();
  const enabledProfiles = CFG.getEnabledProfiles();
  const snapshots = [];

  for (const profile of enabledProfiles) {
    try {
      const snapshot = await discoverProfile(profile, destNameById);
      snapshots.push(snapshot);
    } catch (err) {
      console.error(`[callgrid-ring-tree] discover failed for ${profile.key}:`, err.message);
      snapshots.push({
        profileKey: profile.key,
        label: profile.label,
        campaignId: profile.campaignId,
        error: err.message,
        tiers: [],
      });
    }
  }

  const payload = {
    ok: true,
    auth,
    dryRun: CFG.DRY_RUN,
    batchSize: CFG.BATCH_SIZE,
    enabledProfileKeys: enabledProfiles.map((p) => p.key),
    allCampaigns: auth.campaigns,
    profiles: snapshots,
  };

  if (logToConsole) {
    console.log("[callgrid-ring-tree] discovery complete — enabled profiles:", payload.enabledProfileKeys.join(", ") || "(none)");
  }

  return payload;
}

let startupDiscoverStarted = false;
function runStartupDiscover() {
  if (startupDiscoverStarted || !CFG.STARTUP_DISCOVER) return;
  if (!CFG.getApiKey()) {
    console.warn("[callgrid-ring-tree] startup discover skipped — CALLGRID_API_KEY not set");
    return;
  }
  startupDiscoverStarted = true;
  setImmediate(async () => {
    try {
      await discoverAllCampaigns({ logToConsole: true });
    } catch (err) {
      console.error("[callgrid-ring-tree] startup discover error:", err.message);
    }
  });
}

function computeRpc(batch) {
  const sum = (batch || []).reduce((acc, c) => acc + parseRevenue(c.revenue), 0);
  return Math.round((sum / CFG.BATCH_SIZE) * 10000) / 10000;
}

function shortTierLabel(name) {
  const m = /\bT(\d+)\b/i.exec(String(name || ""));
  return m ? `T${m[1]}` : String(name || "unknown");
}

function getRawTierFromRpc(rpc, profile) {
  const rules = CFG.getProfileRpcRules(profile);
  const tierNames = (profile.tierNames || []).length
    ? profile.tierNames
    : ["Tier 1", "Tier 2", "Tier 3"];
  const t1 = tierNames[0];
  const t2 = tierNames[1] || tierNames[0];
  const t3 = tierNames[2] || tierNames[1] || tierNames[0];

  if (rules.mode === "above") {
    if (rpc > rules.tier1Above) return t1;
    if (rpc >= rules.tier2Min) return t2;
    return t3;
  }
  if (rpc >= rules.tier1Min) return t1;
  if (rpc >= rules.tier2Min) return t2;
  return t3;
}

function getDesiredTierWithHysteresis(rpc, currentTier, profile, tierOrder) {
  const h = CFG.getProfileHysteresis(profile);
  const rules = CFG.getProfileRpcRules(profile);
  const order = tierOrder.length ? tierOrder : [currentTier];
  const t1 = order[0];
  const t2 = order[1] || order[0];
  const t3 = order[2] || order[1] || order[0];
  const t4 = order[3] || order[2] || order[1] || order[0];
  const tier2Floor = rules.mode === "above" ? rules.tier2Min : rules.tier2Min;

  if (currentTier === t1) {
    if (rpc < h.demoteFromTier1) return rpc >= tier2Floor ? t2 : t3;
    return t1;
  }
  if (currentTier === t2) {
    if (rpc >= h.promoteToTier1) return t1;
    if (rpc < h.demoteFromTier2) return t3;
    return t2;
  }
  if (currentTier === t3) {
    if (rpc >= h.promoteToTier1) return t1;
    if (rpc >= h.promoteToTier2) return t2;
    return t3;
  }
  if (currentTier === t4) {
    if (rpc >= h.promoteToTier1) return t1;
    if (rpc >= h.promoteToTier2) return t2;
    if (rpc >= tier2Floor) return t3;
    return t4;
  }
  return getRawTierFromRpc(rpc, profile);
}

function isDemotion(currentTier, desiredTier, tierOrder) {
  const a = tierOrder.indexOf(currentTier);
  const b = tierOrder.indexOf(desiredTier);
  if (a < 0 || b < 0) return false;
  return b > a;
}

function locateDestinationInPlan(plan, destinationId) {
  for (const group of plan?.groups || []) {
    const dests = Array.isArray(group.destinations) ? group.destinations : [];
    const weights = Array.isArray(group.weights) ? group.weights : [];
    const inDests = dests.some((d) => (typeof d === "string" ? d : d?.id) === destinationId);
    const weight = weights.find((w) => w?.destinationId === destinationId);
    if (inDests || weight) {
      return {
        groupId: group.id,
        groupName: group.name,
        mode: group.mode,
        weight: weight?.weight ?? 1,
        priority: weight?.priority ?? 1,
      };
    }
  }
  return null;
}

function buildDryRunMovePlan(plan, destinationId, fromGroupName, toGroupName, campaignId) {
  const from = (plan?.groups || []).find((g) => g.name === fromGroupName);
  const to = (plan?.groups || []).find((g) => g.name === toGroupName);
  if (!from || !to) {
    return { ok: false, reason: "missing_group", fromGroupName, toGroupName };
  }
  return {
    ok: true,
    writePath: `PATCH /api/campaign/${campaignId}`,
    writeImplemented: true,
    from: { id: from.id, name: from.name },
    to: { id: to.id, name: to.name },
    destinationId,
  };
}

function groupHasDestination(group, destinationId) {
  const dests = Array.isArray(group?.destinations) ? group.destinations : [];
  const weights = Array.isArray(group?.weights) ? group.weights : [];
  const inDests = dests.some((d) => (typeof d === "string" ? d : d?.id) === destinationId);
  const inWeights = weights.some((w) => w?.destinationId === destinationId);
  return inDests || inWeights;
}

function removeDestinationFromGroup(group, destinationId) {
  const dests = Array.isArray(group.destinations) ? group.destinations : [];
  group.destinations = dests.filter((d) => (typeof d === "string" ? d : d?.id) !== destinationId);
  const weights = Array.isArray(group.weights) ? group.weights : [];
  group.weights = weights.filter((w) => w?.destinationId !== destinationId);
}

function addDestinationToGroup(group, destinationId, weight = 1, priority = 1) {
  const dests = Array.isArray(group.destinations) ? [...group.destinations] : [];
  const already = dests.some((d) => (typeof d === "string" ? d : d?.id) === destinationId);
  if (!already) dests.push(destinationId);
  group.destinations = dests;

  const weights = Array.isArray(group.weights) ? [...group.weights] : [];
  const idx = weights.findIndex((w) => w?.destinationId === destinationId);
  if (idx >= 0) {
    weights[idx] = {
      ...weights[idx],
      weight: weights[idx].weight ?? weight,
      priority: weights[idx].priority ?? priority,
      destinationId,
    };
  } else {
    weights.push({ destinationId, weight, priority });
  }
  group.weights = weights;
}

/**
 * Move destination between tiers across every plan that has matching T1/T2/... groups.
 * Keeps A/B Medicare plans (Best + Test) in sync by tier number.
 */
function buildMovedRoutingGroups(campaign, destinationId, fromGroupName, toGroupName, weight, priority) {
  const fromTier = shortTierLabel(fromGroupName);
  const toTier = shortTierLabel(toGroupName);
  const routingGroups = JSON.parse(JSON.stringify(campaign.routingGroups || { plans: [] }));
  const planResults = [];

  for (const plan of routingGroups.plans || []) {
    const fromGroup = (plan.groups || []).find((g) => shortTierLabel(g.name) === fromTier);
    const toGroup = (plan.groups || []).find((g) => shortTierLabel(g.name) === toTier);
    if (!fromGroup || !toGroup) {
      planResults.push({ planId: plan.id, planName: plan.name, changed: false, reason: "tier_groups_missing" });
      continue;
    }

    const currentlyHere =
      groupHasDestination(fromGroup, destinationId) ||
      (plan.groups || []).some((g) => groupHasDestination(g, destinationId));

    if (!currentlyHere) {
      planResults.push({ planId: plan.id, planName: plan.name, changed: false, reason: "destination_not_in_plan" });
      continue;
    }

    for (const g of plan.groups || []) {
      removeDestinationFromGroup(g, destinationId);
    }
    addDestinationToGroup(toGroup, destinationId, weight, priority);
    planResults.push({
      planId: plan.id,
      planName: plan.name,
      changed: true,
      from: fromGroup.name,
      to: toGroup.name,
    });
  }

  return {
    routingGroups,
    planResults,
    changedPlans: planResults.filter((p) => p.changed).length,
  };
}

async function applyLiveDestinationMove({
  campaign,
  destinationId,
  fromGroupName,
  toGroupName,
  weight = 1,
  priority = 1,
}) {
  const built = buildMovedRoutingGroups(
    campaign,
    destinationId,
    fromGroupName,
    toGroupName,
    weight,
    priority
  );
  if (!built.changedPlans) {
    const err = new Error("destination not found in any plan tier groups for this move");
    err.code = "move_noop";
    err.details = built.planResults;
    throw err;
  }

  const patched = await callgridPatch(`/api/campaign/${encodeURIComponent(campaign.id)}`, {
    routingGroups: built.routingGroups,
    updatedAt: campaign.updatedAt,
  });

  return {
    ok: true,
    writePath: `PATCH /api/campaign/${campaign.id}`,
    changedPlans: built.changedPlans,
    planResults: built.planResults,
    updatedAt: patched?.updatedAt || null,
  };
}

async function lookupDestinationName(destinationId) {
  try {
    const json = await callgridGet(`/api/destination/${encodeURIComponent(destinationId)}`);
    return json?.name || json?.data?.name || null;
  } catch {
    return null;
  }
}

function formatMoveSlackMessage({ destinationName, currentTier, desiredTier, rpc, dryRun, profileKey }) {
  const prefix = dryRun ? "[DRY-RUN] " : "";
  return `${prefix}[CallGrid ${profileKey}] ${destinationName} move from ${shortTierLabel(currentTier)} to ${shortTierLabel(desiredTier)}. RPC = ${rpc}`;
}

function ingestCall(state, params, profileKey) {
  const profile = CFG.getProfile(profileKey);
  if (!profile) {
    return {
      state,
      result: { ok: false, status: "unknown_profile", message: `Profile "${profileKey}" not enabled or configured` },
    };
  }

  const pState = ensureProfileState(state, profileKey);
  const { callId, destinationId, destinationName, callerPhone, revenue } = params;

  if (isBlankOrPlaceholder(destinationId)) {
    return {
      state,
      result: {
        ok: true,
        status: "ignored_no_destination",
        profileKey,
        message: "Completed call with no destination — skipped",
        dryRun: CFG.isProfileDryRun(profile),
      },
    };
  }
  if (!callId || !callerPhone) {
    return {
      state,
      result: {
        ok: false,
        status: "invalid_payload",
        message: "destinationId, callId, and callerPhone are required",
      },
    };
  }

  if (!pState.destinations[destinationId]) {
    pState.destinations[destinationId] = { batch: [], seenCallIds: [], destinationName: destinationName || null };
  }
  const destState = pState.destinations[destinationId];
  if (destinationName) destState.destinationName = destinationName;

  if (destState.seenCallIds.includes(callId)) {
    return {
      state,
      result: {
        ok: true,
        status: "duplicate_call_id",
        profileKey,
        destinationId,
        destinationName: destState.destinationName,
        batchSize: destState.batch.length,
        dryRun: CFG.isProfileDryRun(profile),
      },
    };
  }

  const phoneNorm = normalizePhone(callerPhone);
  if (destState.batch.some((c) => normalizePhone(c.callerPhone) === phoneNorm)) {
    return {
      state,
      result: {
        ok: true,
        status: "duplicate_caller_in_batch",
        profileKey,
        destinationId,
        destinationName: destState.destinationName,
        batchSize: destState.batch.length,
        dryRun: CFG.isProfileDryRun(profile),
      },
    };
  }

  destState.seenCallIds.push(callId);
  destState.batch.push({
    callId,
    callerPhone,
    revenue: parseRevenue(revenue),
    receivedAt: new Date().toISOString(),
  });

  if (destState.batch.length < CFG.BATCH_SIZE) {
    return {
      state,
      result: {
        ok: true,
        status: "accumulating",
        profileKey,
        destinationId,
        destinationName: destState.destinationName,
        batchSize: destState.batch.length,
        batchNeeded: CFG.BATCH_SIZE,
        rpc: null,
        dryRun: CFG.isProfileDryRun(profile),
      },
    };
  }

  const batchCopy = [...destState.batch];
  destState.batch = [];
  destState.seenCallIds = [];
  const rpc = computeRpc(batchCopy);
  return {
    state,
    result: {
      ok: true,
      status: "batch_complete",
      profileKey,
      destinationId,
      destinationName: destState.destinationName,
      batchSize: CFG.BATCH_SIZE,
      rpc,
      dryRun: CFG.isProfileDryRun(profile),
    },
    shouldEval: true,
    evalPayload: { profileKey, destinationId, destinationName: destState.destinationName, batch: batchCopy, rpc },
  };
}

function isMoveCooldownActive(profileState, destinationId) {
  const last = profileState.lastMoveAt?.[destinationId];
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < CFG.MOVE_COOLDOWN_MS;
}

function batchRevenueAllZero(batch) {
  if (!Array.isArray(batch) || batch.length === 0) return true;
  return batch.every((c) => parseRevenue(c?.revenue) === 0);
}

async function evaluateBatchMove({ profileKey, destinationId, destinationName, batch, rpc, state }) {
  const profile = CFG.getProfile(profileKey);
  if (!profile) {
    return { action: "skipped", reason: "unknown_profile" };
  }

  let campaign;
  try {
    campaign = await fetchCampaignById(profile.campaignId);
  } catch (err) {
    await appendEvent({ type: "eval_skipped", reason: "campaign_fetch_failed", profileKey, destinationId, error: err.message });
    return { action: "skipped", reason: "campaign_fetch_failed", error: err.message };
  }

  const plan = findPlan(campaign, profile);
  if (!plan) {
    return { action: "skipped", reason: "routing_plan_missing" };
  }

  const managedGroups = getManagedGroups(plan, profile);
  const tierOrder = managedGroups.map((g) => g.name);
  profile.tierNames = tierOrder;

  const located = locateDestinationInPlan(plan, destinationId);
  if (!located) {
    await appendEvent({
      type: "eval_skipped",
      reason: "destination_not_in_profile_tiers",
      profileKey,
      destinationId,
      destinationName,
      rpc,
    });
    return { action: "skipped", reason: "destination_not_in_profile_tiers", rpc };
  }

  if (!tierOrder.includes(located.groupName)) {
    await appendEvent({
      type: "eval_skipped",
      reason: "destination_outside_managed_tiers",
      profileKey,
      destinationId,
      destinationName,
      currentTier: located.groupName,
      managedTiers: tierOrder,
      rpc,
    });
    console.log("[callgrid-ring-tree] skip — outside managed tiers", {
      profileKey,
      destinationId,
      currentTier: located.groupName,
      managedTiers: tierOrder,
    });
    return {
      action: "skipped",
      reason: "destination_outside_managed_tiers",
      currentTier: located.groupName,
      managedTiers: tierOrder,
      rpc,
    };
  }

  const resolvedName = destinationName || (await lookupDestinationName(destinationId)) || destinationId;
  const currentTier = located.groupName;
  const rawTier = getRawTierFromRpc(rpc, profile);
  const desiredTier = getDesiredTierWithHysteresis(rpc, currentTier, profile, tierOrder);
  const blockedByHysteresis = rawTier !== currentTier && desiredTier === currentTier;
  const demotion = isDemotion(currentTier, desiredTier, tierOrder);
  const pState = ensureProfileState(state, profileKey);
  const dryRun = CFG.isProfileDryRun(profile);

  const summary = {
    profileKey,
    campaignId: profile.campaignId,
    destinationId,
    destinationName: resolvedName,
    rpc,
    currentTier,
    rawTier,
    desiredTier,
    batchSize: batch?.length || CFG.BATCH_SIZE,
    dryRun,
  };

  // Ringba parity: do not demote on an all-zero revenue batch (often lagging payouts).
  if (
    demotion &&
    CFG.SKIP_DEMOTION_ON_UNCONFIRMED_ZERO_RPC &&
    rpc === 0 &&
    batchRevenueAllZero(batch)
  ) {
    await appendEvent({
      type: "eval_skipped",
      reason: "insufficient_revenue_data",
      ...summary,
    });
    console.log("[callgrid-ring-tree] skip demotion — unconfirmed zero RPC", summary);
    return { action: "skipped", reason: "insufficient_revenue_data", ...summary };
  }

  if (desiredTier === currentTier) {
    await appendEvent({ type: "eval_no_move", ...summary, blockedByHysteresis });
    console.log("[callgrid-ring-tree] no move", summary);
    return { action: "no_move", ...summary, blockedByHysteresis };
  }

  if (isMoveCooldownActive(pState, destinationId)) {
    await appendEvent({ type: "eval_skipped", reason: "move_cooldown", ...summary });
    console.log("[callgrid-ring-tree] cooldown — skip move", summary);
    return { action: "skipped", reason: "move_cooldown", ...summary };
  }

  const movePlan = buildDryRunMovePlan(plan, destinationId, currentTier, desiredTier, profile.campaignId);
  const slackMessage = formatMoveSlackMessage({
    destinationName: resolvedName,
    currentTier,
    desiredTier,
    rpc,
    dryRun,
    profileKey,
  });

  if (!pState.lastMoveAt) pState.lastMoveAt = {};
  pState.lastMoveAt[destinationId] = new Date().toISOString();

  if (dryRun) {
    await appendEvent({ type: "dry_run_move", ...summary, movePlan });
    console.log("[callgrid-ring-tree]", slackMessage);
    console.log("[callgrid-ring-tree] intended write", JSON.stringify(movePlan));
    await slackService.sendCallGridRingTreeSlackMessage(slackMessage);
    return {
      action: "dry_run_move",
      message: slackMessage,
      ...summary,
      demotion,
      movePlan,
    };
  }

  let writeResult = null;
  try {
    writeResult = await applyLiveDestinationMove({
      campaign,
      destinationId,
      fromGroupName: currentTier,
      toGroupName: desiredTier,
      weight: located.weight ?? 1,
      priority: located.priority ?? 1,
    });
  } catch (err) {
    await appendEvent({
      type: "move_failed",
      ...summary,
      movePlan,
      error: err.message,
      details: err.details || null,
    });
    console.error("[callgrid-ring-tree] live move failed", err.message, err.details || "");
    await slackService.sendCallGridRingTreeSlackMessage(
      `[FAILED] ${slackMessage} — ${err.message}`
    );
    return {
      action: "move_failed",
      message: slackMessage,
      error: err.message,
      ...summary,
      demotion,
      movePlan,
    };
  }

  await appendEvent({ type: "live_move", ...summary, movePlan, writeResult });
  console.log("[callgrid-ring-tree]", slackMessage);
  console.log("[callgrid-ring-tree] live write", JSON.stringify(writeResult));
  await slackService.sendCallGridRingTreeSlackMessage(slackMessage);

  return {
    action: "live_move",
    message: slackMessage,
    ...summary,
    demotion,
    movePlan,
    writeResult,
  };
}

async function withTargetLock(lockKey, fn) {
  while (targetLocks.get(lockKey)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  targetLocks.set(lockKey, true);
  try {
    return await fn();
  } finally {
    targetLocks.delete(lockKey);
  }
}

function webhookSecretOk(query, body, headers) {
  if (!CFG.WEBHOOK_SECRET) return true;
  const provided =
    headers?.["x-callgrid-secret"] ||
    headers?.["x-webhook-secret"] ||
    query?.secret ||
    query?.token ||
    body?.secret ||
    body?.token ||
    "";
  return String(provided).trim() === CFG.WEBHOOK_SECRET;
}

function summarizeIncomingPayload(query, body) {
  const q = query && typeof query === "object" ? query : {};
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return {
    queryKeys: Object.keys(q),
    bodyKeys: Object.keys(b),
    body: b,
    query: q,
  };
}

async function handleWebhookIngest(query, body, headers = {}) {
  if (!webhookSecretOk(query, body, headers)) {
    return { ok: false, status: "unauthorized", message: "Invalid webhook secret" };
  }

  const raw = summarizeIncomingPayload(query, body);
  // Temporary: log full inbound payload so we can fix CallGrid tag mapping.
  console.log("[callgrid-ring-tree] raw webhook payload", JSON.stringify(raw));

  let params = parseIngestParams(query, body);
  const enrich = await enrichParamsFromCallApi(params);
  params = enrich.params;
  if (enrich.enriched) {
    console.log(
      "[callgrid-ring-tree] enriched from call API",
      JSON.stringify({
        callId: params.callId,
        destinationId: params.destinationId,
        destinationName: params.destinationName,
        revenue: params.revenue,
        routingGroupName: params.routingGroupName,
        callStatus: enrich.callStatus,
      })
    );
  }
  const profileKey =
    params.profileKey ||
    CFG.resolveProfileKeyFromCampaign(params.campaignId, params.campaignName) ||
    "medicare";

  const profile = CFG.getProfile(profileKey);
  if (!profile) {
    return {
      ok: true,
      status: "ignored_profile",
      message: `Profile "${profileKey}" is not enabled`,
      campaignId: params.campaignId || null,
    };
  }

  if (params.campaignId && profile.campaignId && params.campaignId !== profile.campaignId) {
    return {
      ok: true,
      status: "ignored_other_campaign",
      message: `Campaign ${params.campaignId} does not match profile ${profileKey}`,
      campaignId: params.campaignId,
    };
  }

  let ingested;
  await withStateMutex(async () => {
    const state = await loadState();
    ingested = ingestCall(state, params, profileKey);
    await saveState(ingested.state);
  });

  await appendEvent({
    type: "pixel_ingest",
    status: ingested.result.status,
    profileKey,
    destinationId: params.destinationId || null,
    destinationName: params.destinationName || ingested.result.destinationName || null,
    callId: params.callId || null,
    revenue: parseRevenue(params.revenue),
    batchSize: ingested.result.batchSize || null,
    rpc: ingested.result.rpc ?? null,
    // Keep a copy of what CallGrid actually sent (for tag debugging).
    rawBodyKeys: raw.bodyKeys,
    rawBody: raw.body,
    enrichedFromApi: Boolean(enrich.enriched),
    enrichReason: enrich.reason || null,
    parsed: {
      destinationId: params.destinationId || null,
      destinationName: params.destinationName || null,
      callerPhone: params.callerPhone || null,
      revenue: params.revenue || null,
      campaignId: params.campaignId || null,
      campaignName: params.campaignName || null,
      routingGroupName: params.routingGroupName || null,
    },
  });

  if (ingested.shouldEval && ingested.evalPayload) {
    const lockKey = `${profileKey}:${params.destinationId}`;
    setImmediate(() => {
      withTargetLock(lockKey, async () => {
        try {
          await withStateMutex(async () => {
            const freshState = await loadState();
            await evaluateBatchMove({ ...ingested.evalPayload, state: freshState });
            await saveState(freshState);
          });
        } catch (err) {
          console.error("[callgrid-ring-tree] eval error:", err.message);
          await appendEvent({
            type: "eval_skipped",
            reason: "eval_exception",
            profileKey,
            destinationId: params.destinationId,
            error: err.message,
          });
          await slackService.sendCallGridRingTreeSlackMessage(
            `[CallGrid ${profileKey}] eval error for ${params.destinationId}: ${err.message}`
          );
        }
      });
    });
  }

  return ingested.result;
}

async function listMedicareGroups() {
  const profile = CFG.getProfile("medicare");
  if (!profile) return { ok: false, error: "medicare profile not configured" };
  const destNameById = await fetchDestinationNameMap();
  const campaign = await fetchCampaignById(profile.campaignId);
  const snapshot = buildTierSnapshot(campaign, profile, destNameById);
  return {
    ok: true,
    dryRun: CFG.isProfileDryRun(profile),
    ...snapshot,
    rpcRules: CFG.getProfileRpcRules(profile),
    hysteresis: CFG.getProfileHysteresis(profile),
    batchSize: CFG.BATCH_SIZE,
    groups: snapshot.tiers,
  };
}

async function listProfileGroups(profileKey) {
  const profile = CFG.getProfile(profileKey);
  if (!profile) return { ok: false, error: `Profile "${profileKey}" not enabled or configured` };
  const destNameById = await fetchDestinationNameMap();
  const campaign = await fetchCampaignById(profile.campaignId);
  const snapshot = buildTierSnapshot(campaign, profile, destNameById);
  return { ok: true, ...snapshot, groups: snapshot.tiers };
}

async function getStatus(profileKeyFilter) {
  const state = await loadState();
  const profiles = profileKeyFilter
    ? { [profileKeyFilter]: state.profiles[profileKeyFilter] }
    : state.profiles;

  const destinations = [];
  for (const [pKey, pState] of Object.entries(profiles || {})) {
    if (!pState) continue;
    for (const [destinationId, tState] of Object.entries(pState.destinations || {})) {
      destinations.push({
        profileKey: pKey,
        destinationId,
        destinationName: tState.destinationName || null,
        batchSize: tState.batch?.length || 0,
        seenCallIds: tState.seenCallIds?.length || 0,
        batch: tState.batch || [],
      });
    }
  }

  return {
    ok: true,
    dryRun: CFG.DRY_RUN,
    writeImplemented: true,
    batchSize: CFG.BATCH_SIZE,
    enabledProfiles: CFG.getEnabledProfiles().map((p) => ({
      key: p.key,
      label: p.label,
      campaignId: p.campaignId,
      planId: p.planId || null,
      dryRun: CFG.isProfileDryRun(p),
    })),
    destinationCount: destinations.length,
    destinations,
  };
}

function getHealthPayload() {
  return {
    ok: true,
    dryRun: CFG.DRY_RUN,
    writeImplemented: true,
    batchSize: CFG.BATCH_SIZE,
    skipDemotionOnUnconfirmedZeroRpc: CFG.SKIP_DEMOTION_ON_UNCONFIRMED_ZERO_RPC,
    dailyBatchResetEnabled: CFG.DAILY_BATCH_RESET_ENABLED,
    dailyBatchResetHour: CFG.DAILY_BATCH_RESET_HOUR,
    dailyBatchResetTimezone: CFG.DAILY_BATCH_RESET_TIMEZONE,
    hasApiKey: Boolean(CFG.getApiKey()),
    hasSlackWebhook: Boolean(CFG.SLACK_WEBHOOK_URL),
    startupDiscover: CFG.STARTUP_DISCOVER,
    enabledProfiles: CFG.getEnabledProfiles().map((p) => ({
      key: p.key,
      dryRun: CFG.isProfileDryRun(p),
    })),
  };
}

function listProfilesConfig() {
  return Object.values(CFG.getProfiles()).map((p) => ({
    key: p.key,
    label: p.label,
    enabled: p.enabled,
    configured: CFG.isProfileConfigured(p),
    campaignId: p.campaignId || null,
    planId: p.planId || null,
    campaignName: p.campaignName || null,
    tierGroupNames: Array.isArray(p.tierGroupNames) ? p.tierGroupNames : null,
    dryRun: CFG.isProfileDryRun(p),
  }));
}

async function simulateSingle(options = {}) {
  const profileKey = options.profileKey || options.profile || "medicare";
  const profile = CFG.getProfile(profileKey);
  if (!profile) return { ok: false, error: `Profile "${profileKey}" not configured` };
  return handleWebhookIngest(
    {
      campaignId: profile.campaignId,
      profile: profileKey,
      callId: options.callId || `cg-test-single-${Date.now()}`,
      destinationId: options.destinationId,
      destinationName: options.destinationName || "",
      callerPhone: options.callerPhone || "+15551234567",
      revenue: options.revenue ?? "12",
    },
    {},
    {}
  );
}

async function simulateBatch(options = {}) {
  const profileKey = options.profileKey || options.profile || "medicare";
  const profile = CFG.getProfile(profileKey);
  if (!profile) return { ok: false, error: `Profile "${profileKey}" not configured` };
  const destinationId = String(options.destinationId || "").trim();
  if (!destinationId) {
    return { ok: false, error: "destinationId is required (CallGrid destination id)" };
  }
  const count = Math.min(50, Math.max(1, parseInt(options.count, 10) || CFG.BATCH_SIZE));
  const baseRevenue = parseRevenue(options.revenuePerCall ?? options.revenue ?? 12);
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const result = await handleWebhookIngest(
      {
        campaignId: profile.campaignId,
        profile: profileKey,
        callId: `cg-test-${Date.now()}-${i}`,
        destinationId,
        destinationName: options.destinationName || "",
        callerPhone: `+1555100${String(i).padStart(4, "0")}`,
        revenue: String(baseRevenue),
      },
      {},
      {}
    );
    results.push(result);
  }
  return {
    ok: true,
    profileKey,
    destinationId,
    hits: count,
    last: results[results.length - 1],
    results,
    note: "If last.status is batch_complete, eval runs async — check logs / Slack shortly after.",
  };
}

async function resetState(profileKey) {
  await withStateMutex(async () => {
    const state = await loadState();
    if (profileKey) {
      delete state.profiles[profileKey];
    } else {
      state.profiles = {};
    }
    await saveState(state);
  });
  return { ok: true, reset: true, profileKey: profileKey || "all" };
}

/**
 * Clear in-progress batches (batch + seenCallIds) for all destinations.
 * Preserves profile lastMoveAt cooldowns. Runs daily at 1am ET by default.
 * Parity with dynamicRingTreeTargetService.clearAllOpenBatches.
 */
async function clearAllOpenBatches(options = {}) {
  return withStateMutex(async () => {
    const state = await loadState();
    let destinationsCleared = 0;
    let callsCleared = 0;
    const clearedByProfile = {};

    for (const [pKey, pState] of Object.entries(state.profiles || {})) {
      if (!pState?.destinations) continue;
      let profileDestinations = 0;
      let profileCalls = 0;

      for (const [destinationId, dState] of Object.entries(pState.destinations)) {
        const batchLen = dState.batch?.length || 0;
        const seenLen = dState.seenCallIds?.length || 0;
        if (batchLen === 0 && seenLen === 0) continue;

        profileCalls += batchLen;
        profileDestinations += 1;
        delete pState.destinations[destinationId];
      }

      if (profileDestinations > 0) {
        clearedByProfile[pKey] = {
          destinationsCleared: profileDestinations,
          callsCleared: profileCalls,
        };
        destinationsCleared += profileDestinations;
        callsCleared += profileCalls;
      }
    }

    await saveState(state);

    const summary = {
      ok: true,
      destinationsCleared,
      callsCleared,
      clearedByProfile,
      trigger: options.trigger || "manual",
    };

    if (destinationsCleared > 0 || options.trigger) {
      await appendEvent({
        type: "batch_daily_reset",
        ...summary,
      });
    }

    return summary;
  });
}

module.exports = {
  verifyAuth,
  discoverAllCampaigns,
  runStartupDiscover,
  handleWebhookIngest,
  listMedicareGroups,
  listProfileGroups,
  listProfilesConfig,
  getStatus,
  getHealthPayload,
  simulateSingle,
  simulateBatch,
  resetState,
  clearAllOpenBatches,
  parseIngestParams,
};
