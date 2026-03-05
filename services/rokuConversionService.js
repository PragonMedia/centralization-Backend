/**
 * Roku Conversions API (CAPI) - server-to-server conversion events
 * POST https://events.ads.rokuapi.net/v1/events
 * Docs: https://help.ads.roku.com/en/articles/8880744-conversions-api
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ROKU_CONFIG = require("../config/roku");
const DATAZAPP_CONFIG = require("../config/datazapp");

/** Trigger DataZapp when Ringba sends a valid (non-empty) ip. No longer based on event_group_id. */
function hasValidIp(conversion) {
  const ip = conversion.ip ?? conversion.IP ?? "";
  return typeof ip === "string" && ip.trim().length > 0;
}

/** 1-hour dedupe: do not send the same caller to Roku more than once per hour. */
const RECENT_CALLERS_TTL_MS = 60 * 60 * 1000;
const RECENT_CALLERS_FILE = path.join(__dirname, "..", "logs", "roku-recent-callers.json");
let recentCallersLock = null;

/** Temporary audit log: one JSON object per line (JSONL) for every call hitting Roku endpoint. */
const ROKU_AUDIT_FILE = path.join(__dirname, "..", "logs", "roku-audit.jsonl");

function appendRokuAudit(entry) {
  try {
    const dir = path.dirname(ROKU_AUDIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(ROKU_AUDIT_FILE, line, "utf8");
  } catch (e) {
    console.warn("⚠️ Roku audit write failed:", e.message);
  }
}

/**
 * Run a function with exclusive lock so only one read-modify-write on recent callers runs at a time.
 */
async function withRecentCallersLock(fn) {
  const next = (recentCallersLock || Promise.resolve()).then(() => fn()).then(
    (r) => {
      recentCallersLock = null;
      return r;
    },
    (e) => {
      recentCallersLock = null;
      throw e;
    }
  );
  recentCallersLock = next;
  return next;
}

/**
 * Read recent-callers file, prune entries older than 1 hour, return list and set of normalized phones.
 */
async function getRecentCallers() {
  let list = [];
  try {
    const raw = await fs.promises.readFile(RECENT_CALLERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) list = parsed;
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("📋 Roku recent-callers read failed:", e.message);
  }
  const now = Date.now();
  const pruned = list.filter((entry) => entry && entry.ts && now - entry.ts < RECENT_CALLERS_TTL_MS);
  const set = new Set(pruned.map((e) => e.phone).filter(Boolean));
  return { list: pruned, set };
}

/**
 * Write recent-callers list to file (directory created if needed).
 */
async function writeRecentCallersFile(list) {
  const dir = path.dirname(RECENT_CALLERS_FILE);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(RECENT_CALLERS_FILE, JSON.stringify(list, null, 0), "utf8");
}

/**
 * If this conversion's phone is already in the recent-callers list (within 1 hour), return true (duplicate).
 * Otherwise add the phone to the list and return false (proceed to send to Roku).
 */
async function isDuplicateAndAdd(conversion) {
  const raw = getRawPhoneForLookup(conversion);
  const phone = normalizePhone(raw);
  if (!phone) return false;

  return withRecentCallersLock(async () => {
    const { list, set } = await getRecentCallers();
    if (set.has(phone)) {
      console.log("📋 Roku: skipping duplicate caller within 1h:", phone);
      return true;
    }
    list.push({ phone, ts: Date.now() });
    await writeRecentCallersFile(list);
    return false;
  });
}

/**
 * Normalize raw phone for Roku before hashing (per Roku docs)
 * Remove all special characters including '+' or '-', leading zeros, trim whitespace
 */
function normalizePhone(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim();
  s = s.replace(/[\s+\-().]/g, "");
  s = s.replace(/^0+/, "");
  return s;
}

/**
 * SHA-256 hash (hex string)
 */
function sha256Hash(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

/**
 * Normalize email for Roku before hashing (per Roku docs: lowercase, trim, remove after + and before @)
 */
function normalizeEmail(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim().toLowerCase();
  const plusIdx = s.indexOf("+");
  const atIdx = s.indexOf("@");
  if (plusIdx !== -1 && (atIdx === -1 || plusIdx < atIdx)) {
    s = s.substring(0, plusIdx) + (atIdx !== -1 ? s.substring(atIdx) : "");
  }
  return s;
}

/**
 * Get raw (unhashed) phone from conversion for external API lookup
 */
function getRawPhoneForLookup(conversion) {
  const raw =
    conversion.phone ??
    conversion.caller_phone ??
    conversion.callerPhone ??
    conversion.callerPhoneNumber ??
    "";
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Normalize first/last name for Roku before hashing (trim, lowercase for consistency)
 */
function normalizeName(raw) {
  if (raw == null || typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

/**
 * DataZapp Reverse Phone Append API - get caller data by phone (unhashed).
 * Returns firstName, lastName, email, city, state, zip, country for Roku user_data.
 * Missing or empty fields from DataZapp are returned as null; we still send to Roku with whatever we have.
 * On API error or no match, returns null (we then send to Roku with phone only, same as event_id 1).
 * @param {Object} conversion - Ringba conversion (phone/caller_phone etc.)
 * @returns {Promise<{ email?, firstName?, lastName?, city?, state?, zip?, country? }|null>}
 */
async function getCallerDataFromDataZapp(conversion) {
  const rawPhone = getRawPhoneForLookup(conversion);
  if (!rawPhone) {
    console.warn("📋 DataZapp: no phone on conversion, skipping lookup");
    return null;
  }

  const apiUrl = DATAZAPP_CONFIG.API_URL;
  const apiKey = DATAZAPP_CONFIG.API_KEY;
  if (!apiUrl || !apiKey) {
    console.warn("📋 DataZapp: API URL or key not set, skipping lookup");
    return null;
  }

  try {
    const requestBody = {
      ApiKey: apiKey,
      AppendModule: DATAZAPP_CONFIG.APPEND_MODULE,
      Data: [{ Phone: rawPhone }],
    };
    const response = await axios.post(apiUrl, requestBody, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });

    const dataArray = response.data?.ResponseDetail?.Data;
    const firstRecord = Array.isArray(dataArray) ? dataArray[0] : undefined;

    if (!firstRecord) {
      console.warn("📋 DataZapp: no record in response (empty Data or no match)", { phone: rawPhone });
      return null;
    }
    if (firstRecord.Matched === false) {
      console.warn("📋 DataZapp: phone not matched", { phone: rawPhone });
      return null;
    }

    const str = (v) => (v != null && typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      email: str(firstRecord.Email),
      firstName: str(firstRecord.FirstName),
      lastName: str(firstRecord.LastName),
      city: str(firstRecord.City),
      state: str(firstRecord.State),
      zip: str(firstRecord.Zip ?? firstRecord.ZipCode),
      country: str(firstRecord.Country),
    };
  } catch (error) {
    const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.warn("📋 DataZapp API error (continuing to Roku with phone only):", msg);
    return null;
  }
}

/**
 * Get event_time in UNIX epoch seconds from Ringba timestampMicros
 */
function timestampMicrosToEpochSeconds(timestampMicros) {
  if (timestampMicros == null || timestampMicros === "") return Math.floor(Date.now() / 1000);
  const str = String(timestampMicros).trim();
  const num = parseInt(str, 10);
  if (!Number.isFinite(num)) return Math.floor(Date.now() / 1000);
  // If small (seconds), use as-is; else assume microseconds -> seconds
  return num < 1e12 ? num : Math.floor(num / 1e6);
}

/**
 * Build one Roku event from Ringba conversion (no dclid path)
 * event_group_id from Ringba (conversion or defaultEventGroupId fallback).
 * event_id from Ringba (pass-through, not hashed) for Roku deduplication.
 * event_time = server time (Date.now() → epoch seconds).
 * user_data: ph (hashed) always; em, fn, ln (hashed) when from DataZapp; ct, st, zp from DataZapp or Ringba (conversion.ct/st/zp), country (not hashed) when present.
 */
function buildRokuEvent(conversion, options = {}) {
  const eventGroupId =
    conversion.event_group_id ??
    conversion.eventGroupId ??
    conversion.event ??
    conversion.Event ??
    options.defaultEventGroupId ??
    "";
  const eventIdRaw = conversion.event_id ?? conversion.eventId ?? "";
  const eventId = typeof eventIdRaw === "string" ? eventIdRaw.trim() : "";
  const rawPhone =
    conversion.phone ??
    conversion.caller_phone ??
    conversion.callerPhone ??
    conversion.callerPhoneNumber ??
    "";
  const normalizedPhone = normalizePhone(rawPhone);
  const hashedPhone = normalizedPhone ? sha256Hash(normalizedPhone) : "";

  const userData = {
    is_hashed: true,
    ph: hashedPhone,
  };

  if (options.callerEmail && typeof options.callerEmail === "string" && options.callerEmail.trim()) {
    const normalizedEm = normalizeEmail(options.callerEmail.trim());
    if (normalizedEm) userData.em = sha256Hash(normalizedEm);
  }
  if (options.callerFirstName && typeof options.callerFirstName === "string" && options.callerFirstName.trim()) {
    const n = normalizeName(options.callerFirstName.trim());
    if (n) userData.fn = sha256Hash(n);
  }
  if (options.callerLastName && typeof options.callerLastName === "string" && options.callerLastName.trim()) {
    const n = normalizeName(options.callerLastName.trim());
    if (n) userData.ln = sha256Hash(n);
  }
  // City, state, zip: DataZapp first, then Ringba (ct, st, zp)
  const city =
    options.callerCity && typeof options.callerCity === "string" && options.callerCity.trim()
      ? options.callerCity.trim()
      : (conversion.ct ?? conversion.city ?? "").trim();
  if (city) userData.ct = city;

  const state =
    options.callerState && typeof options.callerState === "string" && options.callerState.trim()
      ? options.callerState.trim()
      : (conversion.st ?? conversion.state ?? "").trim();
  if (state) userData.st = state;

  const zip =
    options.callerZip != null && String(options.callerZip).trim()
      ? String(options.callerZip).trim()
      : (conversion.zp ?? conversion.zip ?? "").trim();
  if (zip) userData.zp = zip;

  userData.country = "US";

  const eventTime = Math.floor(Date.now() / 1000);

  const eventPayload = {
    event_name: "LEAD",
    event_source: "phone_call",
    event_time: eventTime,
    event_type: "conversion",
    user_data: userData,
  };
  if (eventId) {
    eventPayload.event_id = eventId;
  }

  return {
    event_group_id: eventGroupId,
    events: [eventPayload],
  };
}

/**
 * Send one or more conversions to Roku CAPI (no-dclid conversions only)
 * API key comes from Ringba per conversion (roku_api_key / rokuApiKey) - each ad account has its own key.
 * event_group_id from Ringba (per conversion or body default).
 * @param {Array<Object>} conversions - Ringba conversion objects (without dclid)
 * @param {{ defaultEventGroupId?: string }} options - optional body-level event_group_id from Ringba
 * @returns {Promise<Array<{ conversion, sentToRoku, response?, error? }>>}
 */
async function sendConversionsToRoku(conversions, options = {}) {
  const url = ROKU_CONFIG.CAPI_EVENTS_URL;
  const results = [];

  for (const conversion of conversions) {
    const apiKey =
      conversion.roku_api_key ?? conversion.rokuApiKey ?? "";
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      console.error("❌ Roku CAPI: missing roku_api_key on conversion (from Ringba)");
      results.push({ conversion, error: "roku_api_key is required from Ringba" });
      appendRokuAudit({
        timestamp: new Date().toISOString(),
        receivedFromRingba: conversion,
        dataZapp: { called: false, reason: "skipped (missing roku_api_key)" },
        sentToRoku: null,
        result: { success: false, reason: "roku_api_key is required from Ringba" },
      });
      continue;
    }

    const isDuplicate = await isDuplicateAndAdd(conversion);
    if (isDuplicate) {
      results.push({ conversion, skipped: true });
      appendRokuAudit({
        timestamp: new Date().toISOString(),
        receivedFromRingba: conversion,
        dataZapp: { called: false, reason: "skipped (duplicate within 1h, did not call DataZapp)" },
        sentToRoku: null,
        result: { success: false, reason: "duplicate within 1 hour" },
      });
      continue;
    }

    const useDataZapp = hasValidIp(conversion);

    let callerData = null;
    if (useDataZapp) {
      callerData = await getCallerDataFromDataZapp(conversion);
    }

    let payload;
    try {
      payload = buildRokuEvent(conversion, {
        defaultEventGroupId: options.defaultEventGroupId,
        ...(callerData && {
          callerEmail: callerData.email,
          callerFirstName: callerData.firstName,
          callerLastName: callerData.lastName,
          callerCity: callerData.city,
          callerState: callerData.state,
          callerZip: callerData.zip,
          callerCountry: callerData.country,
        }),
      });
      const response = await axios.post(url, payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
      });
      results.push({ conversion, sentToRoku: payload, response: response.data });
      console.log("✅ Roku CAPI success:", {
        event_group_id: payload.event_group_id,
        code: response.data?.code,
      });
      appendRokuAudit({
        timestamp: new Date().toISOString(),
        receivedFromRingba: conversion,
        dataZapp: { called: useDataZapp, data: callerData },
        sentToRoku: payload,
        result: { success: true, response: response.data },
      });
    } catch (error) {
      const errMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      console.error("❌ Roku CAPI error:", errMsg);
      results.push({
        conversion,
        ...(payload !== undefined && { sentToRoku: payload }),
        error: errMsg,
      });
      appendRokuAudit({
        timestamp: new Date().toISOString(),
        receivedFromRingba: conversion,
        dataZapp: { called: useDataZapp, data: callerData },
        sentToRoku: payload !== undefined ? payload : null,
        result: { success: false, reason: errMsg },
      });
    }
  }

  return results;
}

/** @deprecated Use getCallerDataFromDataZapp; kept for backward compatibility */
async function getCallerEmailFromExternalApi(conversion) {
  const data = await getCallerDataFromDataZapp(conversion);
  return data?.email ?? null;
}

module.exports = {
  sendConversionsToRoku,
  buildRokuEvent,
  normalizePhone,
  normalizeEmail,
  normalizeName,
  getCallerDataFromDataZapp,
  getCallerEmailFromExternalApi,
  timestampMicrosToEpochSeconds,
};
