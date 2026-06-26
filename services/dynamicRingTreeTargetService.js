/**
 * Dynamic Ring Tree Target — pixel ingest, RPC batches, tier moves via Ringba API.
 * Merged into ParagonMedia-BE; multi-vertical (FE now, Medicare/Debt/ACA later).
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const CFG = require("../config/dynamicRingTreeTarget");
const slackService = require("./slackService");

const targetLocks = new Map();

function emptyState() {
  return { profiles: {}, version: 1 };
}

function ensureProfileState(state, profileKey) {
  if (!state.profiles[profileKey]) {
    state.profiles[profileKey] = { targets: {}, lastMoveAt: {} };
  }
  return state.profiles[profileKey];
}

async function loadState() {
  try {
    const raw = await fs.promises.readFile(CFG.STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyState();
    if (!parsed.profiles) {
      return { version: 1, profiles: { fe: { targets: parsed.targets || {}, lastMoveAt: parsed.lastMoveAt || {} } } };
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") return emptyState();
    throw err;
  }
}

async function saveState(state) {
  await fs.promises.mkdir(path.dirname(CFG.STATE_FILE), { recursive: true });
  await fs.promises.writeFile(CFG.STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function appendEvent(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  await fs.promises.mkdir(path.dirname(CFG.EVENTS_FILE), { recursive: true });
  await fs.promises.appendFile(CFG.EVENTS_FILE, line, "utf8");
}

function parseRevenue(value) {
  if (value == null || value === "") return 0;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Ringba empty / unreplaced token values for target id on no-answer completed calls. */
function isBlankOrPlaceholder(value) {
  const s = String(value ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (["-no value-", "no value", "null", "undefined", "none", "n/a", "na"].includes(lower)) {
    return true;
  }
  // Unreplaced Ringba macro e.g. [tag:Target:Id]
  if (/^\[[^\]]+\]$/.test(s)) return true;
  return false;
}

/**
 * Completed calls where no target accepted — ignore entirely (no batch, no RPC).
 * Revenue alone does not skip; $0 with a valid targetId still counts toward RPC.
 */
function getIgnoreReason(params = {}) {
  if (isBlankOrPlaceholder(params.targetId)) return "no_target";
  return null;
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/** e.g. "FE - Tier 2" → "tier 2" for Slack alerts */
function shortTierLabel(tierName) {
  const m = /tier\s*(\d+)/i.exec(String(tierName || ""));
  return m ? `tier ${m[1]}` : String(tierName || "unknown").trim();
}

function formatRingTreeMoveSlackMessage({ targetName, currentTier, desiredTier, rpc, dryRun = false }) {
  const prefix = dryRun ? "[DRY-RUN] " : "";
  const rpcValue = Number.isFinite(rpc) ? rpc : parseRevenue(rpc);
  return `${prefix}${targetName} move from ${shortTierLabel(currentTier)} to ${shortTierLabel(desiredTier)}. RPC = ${rpcValue}`;
}

function getRawTierFromRpc(rpc, profile) {
  const t1 = profile?.tiers?.[0]?.name || "FE - Tier 1";
  const t2 = profile?.tiers?.[1]?.name || "FE - Tier 2";
  const t3 = profile?.tiers?.[2]?.name || "FE - Tier 3";
  if (rpc >= CFG.RPC_TIER1_MIN) return t1;
  if (rpc >= CFG.RPC_TIER2_MIN) return t2;
  return t3;
}

function getDesiredTierWithHysteresis(rpc, currentTier, profile) {
  const t1 = profile.tiers[0].name;
  const t2 = profile.tiers[1].name;
  const t3 = profile.tiers[2].name;
  const h = CFG.HYSTERESIS;

  if (currentTier === t1) {
    if (rpc < h.demoteFromTier1) return rpc >= CFG.RPC_TIER2_MIN ? t2 : t3;
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
  return getRawTierFromRpc(rpc, profile);
}

function computeRpcFromBatch(batch) {
  const sum = (batch || []).reduce((acc, c) => acc + parseRevenue(c.revenue), 0);
  return Math.round((sum / CFG.BATCH_SIZE) * 10000) / 10000;
}

function batchPixelRevenueAllZero(batch) {
  return (batch || []).every((c) => parseRevenue(c.revenue) === 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBatchReportWindow(batch) {
  const times = (batch || [])
    .map((c) => new Date(c.receivedAt).getTime())
    .filter((t) => Number.isFinite(t));
  const end = new Date();
  const start = new Date(
    times.length ? Math.min(...times) - 60 * 60 * 1000 : end.getTime() - 7 * 24 * 60 * 60 * 1000
  );
  return {
    reportStart: start.toISOString().replace(/\.\d{3}Z/, "Z"),
    reportEnd: end.toISOString().replace(/\.\d{3}Z/, "Z"),
  };
}

function buildInboundCallIdInsightsBody(callId, reportStart, reportEnd) {
  return {
    reportStart,
    reportEnd,
    groupByColumns: [{ column: "targetName", displayName: "Target" }],
    valueColumns: [
      { column: "conversionAmount", aggregateFunction: null },
      { column: "callCount", aggregateFunction: null },
    ],
    filters: [
      {
        anyConditionToMatch: [
          {
            column: "inboundCallId",
            value: callId,
            isNegativeMatch: false,
            comparisonType: "EQUALS",
          },
        ],
      },
    ],
    maxResultsPerGroup: 10,
    generateRollups: false,
    formatTimeZone: "America/New_York",
  };
}

function parseInsightsCallRevenue(reportData) {
  const records = reportData?.report?.records || [];
  const dataRows = records.filter(
    (r) => r?.targetName && String(r.targetName).trim().toLowerCase() !== "-no value-"
  );
  const rows = dataRows.length > 0 ? dataRows : records;
  let totalConversion = 0;
  let totalCalls = 0;
  for (const row of rows) {
    const count = parseInt(row.callCount, 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    totalConversion += parseRevenue(row.conversionAmount);
    totalCalls += count;
  }
  if (totalCalls <= 0) return 0;
  if (totalCalls === 1) return Math.round(totalConversion * 10000) / 10000;
  return Math.round((totalConversion / totalCalls) * 10000) / 10000;
}

/**
 * Ringba calllogs/details is deprecated (404). Use Insights filtered by inboundCallId.
 */
async function fetchSingleCallRevenueFromInsights(callId, reportStart, reportEnd) {
  const response = await ringbaRequest("POST", "/insights", {
    data: buildInboundCallIdInsightsBody(callId, reportStart, reportEnd),
    validateStatus: (s) => s >= 200 && s < 500,
    timeout: 30000,
  });
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, revenue: 0, error: `insights HTTP ${response.status}` };
  }
  return { ok: true, revenue: parseInsightsCallRevenue(response.data) };
}

async function fetchCallRevenuesByInboundCallIds(callIds, options = {}) {
  const unique = [...new Set((callIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (unique.length === 0) return { byId: new Map(), ok: true, fetched: 0 };

  const window =
    options.reportStart && options.reportEnd
      ? { reportStart: options.reportStart, reportEnd: options.reportEnd }
      : getBatchReportWindow(options.batch || []);

  const byId = new Map();
  const errors = [];
  const chunkSize = 4;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const result = await fetchSingleCallRevenueFromInsights(
            id,
            window.reportStart,
            window.reportEnd
          );
          if (!result.ok) errors.push(`${id}: ${result.error}`);
          return [id, result.revenue];
        } catch (err) {
          errors.push(`${id}: ${err.message}`);
          return [id, 0];
        }
      })
    );
    for (const [id, revenue] of results) byId.set(id, revenue);
    if (i + chunkSize < unique.length) await sleep(300);
  }

  return {
    byId,
    ok: errors.length < unique.length,
    fetched: byId.size,
    error: errors.length ? errors.slice(0, 3).join("; ") : null,
    reportStart: window.reportStart,
    reportEnd: window.reportEnd,
  };
}

async function enrichBatchRevenueFromCallLogs(batch, options = {}) {
  const pixelRpc = computeRpcFromBatch(batch);
  const pixelAllZero = batchPixelRevenueAllZero(batch);

  if (!CFG.REVENUE_BACKFILL_ENABLED) {
    return {
      batch,
      rpc: pixelRpc,
      pixelRpc,
      revenueSource: "pixel",
      backfilled: false,
      backfillOk: false,
      backfillSkipped: true,
      hadAnyBackfillRevenue: false,
    };
  }

  if (CFG.REVENUE_BACKFILL_ONLY_ZERO_PIXEL && !pixelAllZero) {
    return {
      batch,
      rpc: pixelRpc,
      pixelRpc,
      revenueSource: "pixel",
      backfilled: false,
      backfillOk: true,
      hadAnyBackfillRevenue: false,
    };
  }

  const delayMs = options.delayMs ?? CFG.REVENUE_BACKFILL_DELAY_MS;
  if (delayMs > 0) await sleep(delayMs);

  const callIds = (batch || []).map((c) => c.callId);
  const { byId, ok, error, fetched, reportStart, reportEnd } =
    await fetchCallRevenuesByInboundCallIds(callIds, { batch });
  const enrichedBatch = (batch || []).map((call) => {
    if (!byId.has(call.callId)) return call;
    return {
      ...call,
      pixelRevenue: parseRevenue(call.revenue),
      revenue: byId.get(call.callId),
      revenueSource: "insights",
    };
  });
  const rpc = computeRpcFromBatch(enrichedBatch);
  const hadAnyBackfillRevenue = enrichedBatch.some((c) => parseRevenue(c.revenue) > 0);

  return {
    batch: enrichedBatch,
    rpc,
    pixelRpc,
    revenueSource: hadAnyBackfillRevenue || fetched > 0 ? "insights" : "pixel",
    backfilled: true,
    backfillOk: ok,
    backfillError: error || null,
    backfillFetched: fetched,
    backfillReportStart: reportStart,
    backfillReportEnd: reportEnd,
    hadAnyBackfillRevenue,
  };
}

function isDemotion(currentTier, desiredTier, profile) {
  const tiers = (profile?.tiers || []).map((t) => t.name);
  const currentIdx = tiers.indexOf(currentTier);
  const desiredIdx = tiers.indexOf(desiredTier);
  if (currentIdx < 0 || desiredIdx < 0) return false;
  return desiredIdx > currentIdx;
}

function ringbaV2Url(relativePath) {
  const p = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${CFG.RINGBA_BASE_URL}/v2/${CFG.RINGBA_ACCOUNT_ID}${p}`;
}

async function ringbaRequest(method, relativePath, options = {}) {
  if (!CFG.RINGBA_ACCOUNT_ID || !CFG.RINGBA_API_TOKEN) {
    throw new Error("Missing RINGBA_ACCOUNT_ID or RINGBA_API_KEY in .env");
  }
  return axios({
    method,
    url: ringbaV2Url(relativePath),
    headers: {
      Authorization: `Token ${CFG.RINGBA_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    params: options.params,
    data: options.data,
    timeout: options.timeout ?? 30000,
    validateStatus: options.validateStatus,
  });
}

function extractProfileTierRingTrees(pingTrees, profile) {
  const tierNames = new Set((profile.tiers || []).map((t) => t.name));
  const tierIdByName = new Map((profile.tiers || []).map((t) => [t.name, t.pingTreeId]));
  const list = Array.isArray(pingTrees) ? pingTrees : [];
  return list.filter((tree) => {
    const name = tree?.name || tree?.attributes?.name || "";
    if (!tierNames.has(name)) return false;
    const id = tree?.id || tree?.uid || tree?.pingTreeId || "";
    const expected = tierIdByName.get(name);
    return !expected || id === expected;
  });
}

function buildFeTargetMap(feTiers) {
  const byId = new Map();
  const byName = new Map();
  for (const tree of feTiers || []) {
    const currentTier = tree?.name || tree?.attributes?.name;
    const currentPingTreeId = tree?.id || tree?.uid || tree?.pingTreeId;
    const targets = tree?.targets || tree?.attributes?.targets || [];
    for (const target of targets) {
      if (target?.enabled === false) continue;
      const name = target?.name || target?.attributes?.name;
      const id = target?.id || target?.uid;
      if (!id) continue;
      const info = { id, name: name || null, currentTier, currentPingTreeId };
      byId.set(id, info);
      if (name) byName.set(name, info);
    }
  }
  return { byId, byName };
}

function buildTierIdMap(profile) {
  const map = new Map();
  for (const t of profile.tiers || []) {
    map.set(t.name, t.pingTreeId);
  }
  return map;
}

async function fetchPingTrees() {
  const response = await ringbaRequest("GET", "/pingtrees", {
    params: { includeStats: true },
  });
  const data = response.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.pingTrees)) return data.pingTrees;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizePingTreeTarget(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id || raw.uid || raw.targetId || null;
  const name = raw.name || raw.attributes?.name || null;
  if (!id) return null;
  const enabled = raw.enabled !== false && raw.attributes?.enabled !== false;
  return {
    id: String(id),
    name: name ? String(name) : null,
    enabled,
  };
}

function normalizePingTreeRow(raw, profileTier) {
  if (!raw) {
    return {
      name: profileTier?.name || null,
      pingTreeId: profileTier?.pingTreeId || null,
      configuredPingTreeId: profileTier?.pingTreeId || null,
      foundInRingba: false,
      targetCount: 0,
      enabledTargetCount: 0,
      targets: [],
    };
  }
  const name = raw?.name || raw?.attributes?.name || profileTier?.name || null;
  const pingTreeId = raw?.id || raw?.uid || raw?.pingTreeId || profileTier?.pingTreeId || null;
  const rawTargets = raw?.targets || raw?.attributes?.targets || [];
  const targets = rawTargets.map(normalizePingTreeTarget).filter(Boolean);
  return {
    name,
    pingTreeId,
    configuredPingTreeId: profileTier?.pingTreeId || null,
    foundInRingba: true,
    targetCount: targets.length,
    enabledTargetCount: targets.filter((t) => t.enabled).length,
    targets,
  };
}

/**
 * Live list of FE Tier 1/2/3 ring trees and targets from Ringba pingtrees API.
 */
async function listFeRingTreesWithTargets(options = {}) {
  const profileKey = (options.profileKey || "fe").trim().toLowerCase();
  const profile = CFG.getProfile(profileKey);
  if (!profile) {
    return {
      ok: false,
      error: `Profile "${profileKey}" is not configured`,
      profile: profileKey,
      ringTrees: [],
    };
  }

  const enabledOnly = options.enabledOnly === true;
  let pingTrees;
  try {
    pingTrees = await fetchPingTrees();
  } catch (err) {
    return {
      ok: false,
      error: err.message || "Failed to fetch pingtrees from Ringba",
      profile: profileKey,
      ringTrees: [],
    };
  }

  const feTreesFromApi = extractProfileTierRingTrees(pingTrees, profile);
  const apiByName = new Map(
    feTreesFromApi.map((tree) => [tree?.name || tree?.attributes?.name, tree])
  );

  const ringTrees = (profile.tiers || []).map((tier) => {
    const row = normalizePingTreeRow(apiByName.get(tier.name), tier);
    if (!enabledOnly) return row;
    const enabledTargets = row.targets.filter((t) => t.enabled);
    return {
      ...row,
      targets: enabledTargets,
      targetCount: enabledTargets.length,
      enabledTargetCount: enabledTargets.length,
    };
  });

  const totalTargets = ringTrees.reduce((sum, t) => sum + t.targetCount, 0);
  const enabledTargets = ringTrees.reduce((sum, t) => sum + t.enabledTargetCount, 0);

  return {
    ok: true,
    profile: profileKey,
    label: profile.label,
    fetchedAt: new Date().toISOString(),
    ringTrees,
    summary: {
      ringTreeCount: ringTrees.length,
      foundInRingba: ringTrees.filter((t) => t.foundInRingba).length,
      totalTargets,
      enabledTargets,
    },
  };
}

function parsePixelParams(query = {}, body = {}) {
  const src = { ...query, ...body };
  const pick = (...keys) => {
    for (const k of keys) {
      const v = src[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return "";
  };
  return {
    callId: pick("callId", "call_id", "inboundCallId"),
    targetId: pick("targetId", "target_id", "pingTreeTargetId", "rttId"),
    targetName: pick("targetName", "target_name", "name"),
    callerPhone: pick("callerPhone", "caller_phone", "phone", "ani"),
    revenue: pick("revenue", "conversionAmount", "conversion_amount", "conversionPayout", "payout", "payoutAmount"),
    profileKey: pick("vertical", "profile", "campaignVertical"),
  };
}

function ingestPixelCall(state, payload, profileKey) {
  const profile = CFG.getProfile(profileKey);
  if (!profile) {
    return {
      state,
      result: {
        ok: false,
        status: "unknown_profile",
        message: `Profile "${profileKey}" not found or not configured`,
      },
    };
  }

  const { callId, targetId, targetName, callerPhone, revenue } = payload;

  const ignoreReason = getIgnoreReason(payload);
  if (ignoreReason) {
    return {
      state,
      result: {
        ok: true,
        status: "ignored_no_target",
        reason: ignoreReason,
        message: "Completed call with no accepting target — skipped",
        profileKey,
        dryRun: CFG.DRY_RUN,
      },
    };
  }

  if (!callId || !targetId || !callerPhone) {
    return {
      state,
      result: {
        ok: false,
        status: "invalid_payload",
        message: "targetId, callId, callerPhone required",
      },
    };
  }

  const pState = ensureProfileState(state, profileKey);
  if (!pState.targets[targetId]) {
    pState.targets[targetId] = { batch: [], seenCallIds: [], targetName: targetName || null };
  }
  const targetState = pState.targets[targetId];
  if (targetName) targetState.targetName = targetName;

  if (targetState.seenCallIds.includes(callId)) {
    return {
      state,
      result: {
        ok: true,
        status: "duplicate_call_id",
        profileKey,
        targetId,
        targetName: targetState.targetName,
        batchSize: targetState.batch.length,
        dryRun: CFG.DRY_RUN,
      },
    };
  }

  const phoneNorm = normalizePhone(callerPhone);
  if (targetState.batch.some((c) => normalizePhone(c.callerPhone) === phoneNorm)) {
    return {
      state,
      result: {
        ok: true,
        status: "duplicate_caller_in_batch",
        profileKey,
        targetId,
        targetName: targetState.targetName,
        batchSize: targetState.batch.length,
        dryRun: CFG.DRY_RUN,
      },
    };
  }

  targetState.seenCallIds.push(callId);
  targetState.batch.push({
    callId,
    callerPhone,
    revenue: parseRevenue(revenue),
    receivedAt: new Date().toISOString(),
  });

  if (targetState.batch.length < CFG.BATCH_SIZE) {
    return {
      state,
      result: {
        ok: true,
        status: "accumulating",
        profileKey,
        targetId,
        targetName: targetState.targetName,
        batchSize: targetState.batch.length,
        rpc: null,
        dryRun: CFG.DRY_RUN,
      },
    };
  }

  const batchCopy = [...targetState.batch];
  targetState.batch = [];
  targetState.seenCallIds = [];
  const rpc = computeRpcFromBatch(batchCopy);

  return {
    state,
    result: {
      ok: true,
      status: "batch_complete",
      profileKey,
      targetId,
      targetName: targetState.targetName,
      batchSize: CFG.BATCH_SIZE,
      batch: batchCopy,
      rpc,
      dryRun: CFG.DRY_RUN,
    },
    shouldEval: true,
    evalPayload: { profileKey, targetId, targetName: targetState.targetName, batch: batchCopy, rpc },
  };
}

function isMoveCooldownActive(profileState, targetId) {
  const last = profileState.lastMoveAt?.[targetId];
  if (!last) return false;
  const elapsed = Date.now() - new Date(last).getTime();
  return elapsed < CFG.MOVE_COOLDOWN_MS;
}

async function removeTargetFromPingTree(pingTreeId, targetId) {
  return ringbaRequest(
    "DELETE",
    `/pingtrees/${encodeURIComponent(pingTreeId)}/Targets/${encodeURIComponent(targetId)}`
  );
}

async function getPingTreeTargetConfig(targetId) {
  const response = await ringbaRequest("GET", `/pingtreetargets/${encodeURIComponent(targetId)}`);
  return response.data?.target || response.data?.data || response.data;
}

async function addTargetToPingTree(sourceTargetId, destPingTreeId) {
  const patchBodies = [
    { targetIds: [sourceTargetId] },
    { targets: [{ id: sourceTargetId }] },
    { ids: [sourceTargetId] },
  ];

  for (const body of patchBodies) {
    try {
      const res = await ringbaRequest("PATCH", `/pingtrees/${encodeURIComponent(destPingTreeId)}/Targets`, {
        data: body,
        validateStatus: (s) => s >= 200 && s < 500,
      });
      if (res.status >= 200 && res.status < 300) {
        return { method: "PATCH", body, status: res.status, data: res.data };
      }
    } catch {
      /* try next */
    }
  }

  const config = await getPingTreeTargetConfig(sourceTargetId);
  const clone = { ...(config || {}) };
  delete clone.id;
  delete clone.version;
  delete clone.accountId;
  clone.pingTreeId = destPingTreeId;

  const postRes = await ringbaRequest("POST", "/pingtreetargets", { data: clone });
  return { method: "POST", status: postRes.status, data: postRes.data };
}

async function evaluateBatchMove({ profileKey, targetId, targetName, batch, rpc: initialRpc, state }) {
  const profile = CFG.getProfile(profileKey);
  if (!profile) {
    await appendEvent({
      type: "eval_skipped",
      reason: "unknown_profile",
      profileKey,
      targetId,
      targetName,
      rpc: initialRpc,
    });
    return { action: "skipped", reason: "unknown_profile" };
  }

  let batchForEval = batch;
  let rpc = initialRpc;
  let revenueMeta = {
    revenueSource: "pixel",
    pixelRpc: initialRpc,
    backfilled: false,
  };

  if (batch && batch.length > 0) {
    const enriched = await enrichBatchRevenueFromCallLogs(batch);
    batchForEval = enriched.batch;
    rpc = enriched.rpc;
    revenueMeta = {
      revenueSource: enriched.revenueSource,
      pixelRpc: enriched.pixelRpc,
      backfilled: enriched.backfilled,
      backfillOk: enriched.backfillOk,
      backfillError: enriched.backfillError,
      backfillFetched: enriched.backfillFetched,
      hadAnyBackfillRevenue: enriched.hadAnyBackfillRevenue,
    };
    if (enriched.backfilled) {
      await appendEvent({
        type: "revenue_backfill",
        profileKey,
        targetId,
        targetName,
        pixelRpc: enriched.pixelRpc,
        rpc: enriched.rpc,
        backfillOk: enriched.backfillOk,
        backfillError: enriched.backfillError || null,
        backfillFetched: enriched.backfillFetched || 0,
        hadAnyBackfillRevenue: enriched.hadAnyBackfillRevenue,
        revenueSource: enriched.revenueSource,
        backfillReportStart: enriched.backfillReportStart || null,
        backfillReportEnd: enriched.backfillReportEnd || null,
      });
    }
  }

  let pingTrees;
  try {
    pingTrees = await fetchPingTrees();
  } catch (err) {
    await appendEvent({
      type: "eval_skipped",
      reason: "pingtrees_fetch_failed",
      profileKey,
      targetId,
      targetName,
      rpc,
      error: err.message,
    });
    return { action: "skipped", reason: "pingtrees_fetch_failed", error: err.message };
  }

  const feTiers = extractProfileTierRingTrees(pingTrees, profile);
  const { byId: targetMapById } = buildFeTargetMap(feTiers);
  const tierIdMap = buildTierIdMap(profile);
  const targetInfo = targetMapById.get(targetId);

  if (!targetInfo) {
    await appendEvent({
      type: "eval_skipped",
      reason: "target_not_in_profile_tiers",
      profileKey,
      targetId,
      targetName,
      rpc,
    });
    return { action: "skipped", reason: "target_not_in_profile_tiers" };
  }

  const { id: resolvedTargetId, name: resolvedTargetName, currentTier, currentPingTreeId } = targetInfo;
  const displayName = resolvedTargetName || targetName || targetId;
  const rawTier = getRawTierFromRpc(rpc, profile);
  const desiredTier = getDesiredTierWithHysteresis(rpc, currentTier, profile);
  const desiredPingTreeId = tierIdMap.get(desiredTier);
  const blockedByHysteresis = rawTier !== currentTier && desiredTier === currentTier;
  const demotion = isDemotion(currentTier, desiredTier, profile);
  const pixelAllZero = batchPixelRevenueAllZero(batch);
  const revenueConfirmedByCallLogs =
    revenueMeta.hadAnyBackfillRevenue ||
    (revenueMeta.backfilled && revenueMeta.backfillOk && (revenueMeta.backfillFetched || 0) > 0);

  if (
    demotion &&
    CFG.SKIP_DEMOTION_ON_UNCONFIRMED_ZERO_RPC &&
    rpc === 0 &&
    pixelAllZero &&
    !revenueConfirmedByCallLogs
  ) {
    await appendEvent({
      type: "eval_skipped",
      reason: "insufficient_revenue_data",
      profileKey,
      targetId: resolvedTargetId,
      targetName: displayName,
      rpc,
      pixelRpc: revenueMeta.pixelRpc,
      currentTier,
      desiredTier,
      revenueSource: revenueMeta.revenueSource,
      backfillOk: revenueMeta.backfillOk,
      backfillError: revenueMeta.backfillError || null,
    });
    return {
      action: "skipped",
      reason: "insufficient_revenue_data",
      currentTier,
      desiredTier,
      rpc,
      pixelRpc: revenueMeta.pixelRpc,
    };
  }

  const pState = ensureProfileState(state, profileKey);

  if (desiredTier === currentTier) {
    await appendEvent({
      type: "eval_no_move",
      profileKey,
      targetName: displayName,
      targetId: resolvedTargetId,
      rpc,
      currentTier,
      rawTier,
      desiredTier,
      blockedByHysteresis,
    });
    return { action: "no_move", currentTier, desiredTier, rpc, blockedByHysteresis };
  }

  if (!desiredPingTreeId) {
    await appendEvent({
      type: "eval_skipped",
      reason: "missing_dest_ping_tree_id",
      profileKey,
      targetId: resolvedTargetId,
      targetName: displayName,
      desiredTier,
      rpc,
    });
    return { action: "skipped", reason: "missing_dest_ping_tree_id" };
  }

  if (isMoveCooldownActive(pState, resolvedTargetId)) {
    await appendEvent({
      type: "eval_skipped",
      reason: "move_cooldown",
      profileKey,
      targetId: resolvedTargetId,
      targetName: displayName,
      rpc,
      currentTier,
      desiredTier,
    });
    return { action: "skipped", reason: "move_cooldown" };
  }

  const moveSummary = {
    profileKey,
    targetName: displayName,
    targetId: resolvedTargetId,
    rpc,
    pixelRpc: revenueMeta.pixelRpc,
    revenueSource: revenueMeta.revenueSource,
    currentTier,
    desiredTier,
    currentPingTreeId,
    desiredPingTreeId,
    batchSize: batchForEval?.length || CFG.BATCH_SIZE,
  };

  if (CFG.DRY_RUN) {
    await appendEvent({ type: "dry_run_move", ...moveSummary, action: "dry_run_move" });
    await slackService.sendSlackMessage(
      formatRingTreeMoveSlackMessage({
        targetName: displayName,
        currentTier,
        desiredTier,
        rpc,
        dryRun: true,
      })
    );
    console.log("[ring-tree-target][dry-run]", moveSummary);
    return { action: "dry_run_move", ...moveSummary };
  }

  try {
    await removeTargetFromPingTree(currentPingTreeId, resolvedTargetId);
    const addResult = await addTargetToPingTree(resolvedTargetId, desiredPingTreeId);
    pState.lastMoveAt[resolvedTargetId] = new Date().toISOString();
    // After tier move Ringba assigns a new RTT id — next pixel uses new targetId and starts a fresh batch.
    delete pState.targets[resolvedTargetId];
    await appendEvent({
      type: "move_completed",
      ...moveSummary,
      addMethod: addResult.method,
    });
    await slackService.sendSlackMessage(
      formatRingTreeMoveSlackMessage({
        targetName: displayName,
        currentTier,
        desiredTier,
        rpc,
        dryRun: false,
      })
    );
    console.log("[ring-tree-target][move_completed]", moveSummary);
    return { action: "move_completed", ...moveSummary, addResult };
  } catch (err) {
    await appendEvent({
      type: "move_failed",
      ...moveSummary,
      error: err.message,
    });
    await slackService.sendSlackMessage(
      `Ring Tree move FAILED (${profile.label})\nTarget: ${displayName} (${resolvedTargetId})\nError: ${err.message}`
    );
    console.error("[ring-tree-target][move_failed]", err.message);
    return { action: "move_failed", ...moveSummary, error: err.message };
  }
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

async function handlePixelIngest(query, body) {
  const params = parsePixelParams(query, body);

  const ignoreReason = getIgnoreReason(params);
  if (ignoreReason) {
    await appendEvent({
      type: "pixel_ingest",
      status: "ignored_no_target",
      reason: ignoreReason,
      profileKey: params.profileKey || "fe",
      callId: params.callId || null,
      targetId: params.targetId || null,
      revenue: parseRevenue(params.revenue),
    });
    return {
      ok: true,
      status: "ignored_no_target",
      reason: ignoreReason,
      message: "Completed call with no accepting target — skipped",
      dryRun: CFG.DRY_RUN,
    };
  }

  const profileKey =
    CFG.resolveProfileKeyFromTargetName(params.targetName, params.profileKey) ||
    (params.profileKey ? String(params.profileKey).trim().toLowerCase() : "") ||
    "fe";

  if (!CFG.getProfile(profileKey) && !CFG.getProfiles()[profileKey]) {
    return {
      ok: false,
      status: "unknown_profile",
      message: `Unknown vertical/profile: ${profileKey}`,
    };
  }

  const profile = CFG.getProfiles()[profileKey];
  if (!CFG.isProfileConfigured(profile)) {
    return {
      ok: false,
      status: "profile_not_configured",
      message: `Profile "${profileKey}" is not enabled or missing tier ping tree IDs`,
    };
  }

  let state = await loadState();
  const ingested = ingestPixelCall(state, params, profileKey);
  state = ingested.state;
  await saveState(state);

  await appendEvent({
    type: "pixel_ingest",
    status: ingested.result.status,
    profileKey,
    targetId: params.targetId,
    targetName: params.targetName || ingested.result.targetName || null,
    batchSize: ingested.result.batchSize,
    callId: params.callId,
    revenue: parseRevenue(params.revenue),
  });

  if (ingested.shouldEval && ingested.evalPayload) {
    const lockKey = `${profileKey}:${params.targetId}`;
    setImmediate(() => {
      withTargetLock(lockKey, async () => {
        try {
          const freshState = await loadState();
          const evalResult = await evaluateBatchMove({
            ...ingested.evalPayload,
            state: freshState,
          });
          await saveState(freshState);
          return evalResult;
        } catch (err) {
          console.error("[ring-tree-target] eval error:", err.message);
          await appendEvent({
            type: "eval_skipped",
            reason: "eval_exception",
            profileKey,
            targetId: params.targetId,
            targetName: params.targetName,
            error: err.message,
          });
        }
      });
    });
  }

  return ingested.result;
}

async function getStatus(profileKeyFilter) {
  const state = await loadState();
  const profiles = profileKeyFilter
    ? { [profileKeyFilter]: state.profiles[profileKeyFilter] }
    : state.profiles;

  const targets = [];
  for (const [pKey, pState] of Object.entries(profiles || {})) {
    if (!pState) continue;
    for (const [targetId, tState] of Object.entries(pState.targets || {})) {
      targets.push({
        profileKey: pKey,
        targetId,
        targetName: tState.targetName || null,
        batchSize: tState.batch?.length || 0,
        seenCallIds: tState.seenCallIds?.length || 0,
        batch: tState.batch || [],
      });
    }
  }

  return {
    dryRun: CFG.DRY_RUN,
    batchSize: CFG.BATCH_SIZE,
    enabledProfiles: CFG.getEnabledProfiles().map((p) => ({
      key: p.key,
      label: p.label,
      tiers: p.tiers.map((t) => ({ name: t.name, pingTreeId: t.pingTreeId })),
    })),
    targetCount: targets.length,
    targets,
    lastMoveAt: Object.fromEntries(
      Object.entries(profiles || {}).flatMap(([pKey, pState]) =>
        Object.entries(pState?.lastMoveAt || {}).map(([id, at]) => [`${pKey}:${id}`, at])
      )
    ),
  };
}

async function simulateTestBatch(options = {}) {
  const profileKey = (options.profileKey || "fe").trim().toLowerCase();
  const targetId = String(options.targetId || "").trim();
  const targetName = String(options.targetName || "").trim();
  const count = Math.min(100, Math.max(1, parseInt(options.count, 10) || CFG.BATCH_SIZE));
  const baseRevenue = parseRevenue(options.revenuePerCall ?? options.revenue ?? 25);

  if (!targetId) {
    return {
      ok: false,
      error: "targetId is required (Ringba ping tree target id, e.g. PI1e2efa7...)",
    };
  }

  const results = [];
  for (let i = 0; i < count; i += 1) {
    const result = await handlePixelIngest(
      {
        vertical: profileKey,
        callId: `test-${Date.now()}-${i}`,
        targetId,
        ...(targetName ? { targetName } : {}),
        callerPhone: `+1555000${String(i).padStart(4, "0")}`,
        revenue: String(baseRevenue + i),
      },
      {}
    );
    results.push(result);
  }

  const last = results[results.length - 1];
  return {
    ok: true,
    profileKey,
    targetId,
    targetName: targetName || last?.targetName || null,
    hits: count,
    lastStatus: last?.status,
    lastRpc: last?.rpc ?? null,
    results: results.map((r) => ({
      status: r.status,
      batchSize: r.batchSize,
      rpc: r.rpc,
    })),
  };
}

async function resetProfileState(profileKey) {
  const state = await loadState();
  if (profileKey) {
    delete state.profiles[profileKey];
  } else {
    state.profiles = {};
  }
  await saveState(state);
  return { ok: true, profileKey: profileKey || "all" };
}

/**
 * Clear in-progress batches (batch + seenCallIds) for all targets.
 * Preserves lastMoveAt cooldowns. Runs daily at 1am ET by default.
 */
async function clearAllOpenBatches(options = {}) {
  const state = await loadState();
  let targetsCleared = 0;
  let callsCleared = 0;
  const clearedByProfile = {};

  for (const [profileKey, pState] of Object.entries(state.profiles || {})) {
    if (!pState?.targets) continue;
    let profileTargets = 0;
    let profileCalls = 0;

    for (const [targetId, tState] of Object.entries(pState.targets)) {
      const batchLen = tState.batch?.length || 0;
      const seenLen = tState.seenCallIds?.length || 0;
      if (batchLen === 0 && seenLen === 0) continue;

      profileCalls += batchLen;
      profileTargets += 1;
      delete pState.targets[targetId];
    }

    if (profileTargets > 0) {
      clearedByProfile[profileKey] = { targetsCleared: profileTargets, callsCleared: profileCalls };
      targetsCleared += profileTargets;
      callsCleared += profileCalls;
    }
  }

  await saveState(state);

  const summary = {
    ok: true,
    targetsCleared,
    callsCleared,
    clearedByProfile,
    trigger: options.trigger || "manual",
  };

  if (targetsCleared > 0 || options.trigger) {
    await appendEvent({
      type: "batch_daily_reset",
      ...summary,
    });
  }

  return summary;
}

function getHealthPayload() {
  return {
    ok: true,
    service: "dynamic-ring-tree-target",
    dryRun: CFG.DRY_RUN,
    batchSize: CFG.BATCH_SIZE,
    revenueBackfillEnabled: CFG.REVENUE_BACKFILL_ENABLED,
    revenueBackfillDelayMs: CFG.REVENUE_BACKFILL_DELAY_MS,
    revenueBackfillOnlyZeroPixel: CFG.REVENUE_BACKFILL_ONLY_ZERO_PIXEL,
    skipDemotionOnUnconfirmedZeroRpc: CFG.SKIP_DEMOTION_ON_UNCONFIRMED_ZERO_RPC,
    dailyBatchResetEnabled: CFG.DAILY_BATCH_RESET_ENABLED,
    dailyBatchResetHour: CFG.DAILY_BATCH_RESET_HOUR,
    dailyBatchResetTimezone: CFG.DAILY_BATCH_RESET_TIMEZONE,
    enabledProfiles: CFG.getEnabledProfiles().map((p) => p.key),
  };
}

module.exports = {
  loadState,
  saveState,
  parseRevenue,
  normalizePhone,
  getRawTierFromRpc,
  getDesiredTierWithHysteresis,
  computeRpcFromBatch,
  batchPixelRevenueAllZero,
  enrichBatchRevenueFromCallLogs,
  fetchCallRevenuesByInboundCallIds,
  extractProfileTierRingTrees,
  buildFeTargetMap,
  buildTierIdMap,
  fetchPingTrees,
  listFeRingTreesWithTargets,
  normalizePingTreeTarget,
  ingestPixelCall,
  evaluateBatchMove,
  handlePixelIngest,
  parsePixelParams,
  getIgnoreReason,
  isBlankOrPlaceholder,
  formatRingTreeMoveSlackMessage,
  shortTierLabel,
  getStatus,
  simulateTestBatch,
  resetProfileState,
  clearAllOpenBatches,
  getHealthPayload,
};
