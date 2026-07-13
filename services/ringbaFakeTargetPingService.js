const RingbaFakeTargetPing = require("../models/ringbaFakeTargetPingModel");
const CFG = require("../config/ringbaFakeTargetPing");

function isBlankOrPlaceholder(value) {
  const s = String(value ?? "").trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (
    ["-no value-", "no value", "null", "undefined", "none", "n/a", "na"].includes(
      lower
    )
  ) {
    return true;
  }
  if (/^\[[^\]]+\]$/.test(s)) return true;
  return false;
}

function normalizeField(value) {
  if (isBlankOrPlaceholder(value)) return null;
  return String(value).trim();
}

function pickField(src, keys) {
  for (const key of keys) {
    const v = src[key];
    if (!isBlankOrPlaceholder(v)) return normalizeField(v);
  }
  return null;
}

function parsePingParams(query = {}, body = {}) {
  const src =
    body && typeof body === "object" && !Array.isArray(body)
      ? { ...query, ...body }
      : { ...query };

  return {
    callId: pickField(src, ["callId", "call_id", "inboundCallId", "InboundCallId"]),
    callerId: pickField(src, [
      "callerId",
      "caller_id",
      "callerPhone",
      "caller_phone",
      "phone",
      "ani",
      "CID",
      "cid",
    ]),
    zipCode: pickField(src, ["zipCode", "zip_code", "zip", "ZipCode"]),
    state: pickField(src, ["state", "State"]),
    targetId: pickField(src, ["targetId", "target_id", "pingTreeTargetId", "rttId"]),
    targetName: pickField(src, ["targetName", "target_name", "name"]),
  };
}

function isAuthorized(query = {}, headers = {}) {
  const expected = CFG.RINGBA_FAKE_TARGET_PING_TOKEN;
  if (!expected) return true;

  const provided =
    query.token ||
    query.secret ||
    headers["x-fake-target-token"] ||
    headers["x-api-key"];

  return String(provided || "") === expected;
}

async function savePing(params, rawQuery, rawBody) {
  const doc = {
    callId: params.callId,
    callerId: params.callerId,
    zipCode: params.zipCode,
    state: params.state,
    targetId: params.targetId,
    targetName: params.targetName,
    rawQuery: rawQuery || {},
    rawBody: rawBody && typeof rawBody === "object" ? rawBody : {},
  };

  if (params.callId) {
    const existing = await RingbaFakeTargetPing.findOne({ callId: params.callId })
      .select("_id")
      .lean();
    if (existing) {
      return { saved: false, duplicate: true, id: existing._id };
    }
  }

  const created = await RingbaFakeTargetPing.create(doc);
  return { saved: true, duplicate: false, id: created._id };
}

async function handleFakeTargetPing(query = {}, body = {}, headers = {}) {
  if (!isAuthorized(query, headers)) {
    return {
      httpStatus: 401,
      body: { ok: false, error: "unauthorized" },
    };
  }

  const params = parsePingParams(query, body);
  const hasData =
    params.callId || params.callerId || params.zipCode || params.state;

  if (!hasData) {
    return {
      httpStatus: 400,
      body: {
        ok: false,
        error: "invalid_payload",
        message: "At least one of callId, callerId, zipCode, or state is required",
        ...CFG.REJECT_RESPONSE,
      },
    };
  }

  let persistResult = { saved: false, duplicate: false, id: null };
  try {
    persistResult = await savePing(params, query, body);
  } catch (err) {
    console.error("[fake-target-ping] Mongo save error:", err.message);
    // Still reject the bid even if persistence fails — routing safety first.
  }

  return {
    httpStatus: 200,
    body: {
      ...CFG.REJECT_RESPONSE,
      ok: true,
      persisted: persistResult.saved,
      duplicate: persistResult.duplicate,
    },
  };
}

function getRejectResponse() {
  return { ...CFG.REJECT_RESPONSE };
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildListQuery(filters = {}) {
  const query = {};

  if (filters.callId) {
    query.callId = String(filters.callId).trim();
  }
  if (filters.callerId) {
    query.callerId = {
      $regex: String(filters.callerId).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }
  if (filters.state) {
    query.state = String(filters.state).trim().toUpperCase();
  }
  if (filters.zipCode) {
    query.zipCode = String(filters.zipCode).trim();
  }
  if (filters.targetId) {
    query.targetId = String(filters.targetId).trim();
  }

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      const start = new Date(filters.startDate);
      if (!Number.isNaN(start.getTime())) query.createdAt.$gte = start;
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }
    if (Object.keys(query.createdAt).length === 0) delete query.createdAt;
  }

  return query;
}

async function listPings(filters = {}) {
  const limit = Math.min(Math.max(parsePositiveInt(filters.limit, 100), 1), 500);
  const page = Math.max(parsePositiveInt(filters.page, 1), 1);
  const skip = (page - 1) * limit;
  const query = buildListQuery(filters);

  const [pings, total] = await Promise.all([
    RingbaFakeTargetPing.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RingbaFakeTargetPing.countDocuments(query),
  ]);

  return {
    pings,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    },
  };
}

async function getPingById(id) {
  return RingbaFakeTargetPing.findById(id).lean();
}

module.exports = {
  parsePingParams,
  isAuthorized,
  handleFakeTargetPing,
  getRejectResponse,
  isBlankOrPlaceholder,
  listPings,
  getPingById,
};
