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
const RokuLog = require("../models/rokuLogModel");

/** Trigger Audience Acuity identity lookup when Ringba sends a valid (non-empty) ip. */
function hasValidIp(conversion) {
  const ip = conversion.ip ?? conversion.IP ?? "";
  return typeof ip === "string" && ip.trim().length > 0;
}

// Audience Acuity (Realink 2.0) identity lookup config.
// Uses AA_KEY_ID + timestamp + md5(timestamp + AA_SECRET) auth.
const AA_ORIGIN = (process.env.AA_ORIGIN || "https://api.audienceacuity.com").trim();
const AA_KEY_ID = (process.env.AA_KEY_ID || "").trim();
const AA_SECRET = (process.env.AA_SECRET || "").trim();
const AA_TEMPLATE = process.env.AA_TEMPLATE ? Number(process.env.AA_TEMPLATE) : 6323591;
// Optional: point to your local Audience Acuity / Realink 2.0 proxy:
// e.g. http://localhost:3000 where proxy exposes POST /identities/byPhone?clean=1
const AA_PROXY_ORIGIN = (process.env.AA_PROXY_ORIGIN || "").trim();

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
 * Normalize raw phone for Audience Acuity:
 * - take the last 10 digits always
 */
function normalizePhoneForAudienceAcuity(rawPhone) {
  if (rawPhone == null || typeof rawPhone !== "string") return "";
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function normalizeGenderForRoku(rawGender) {
  if (rawGender == null || typeof rawGender !== "string") return null;
  const s = rawGender.trim().toLowerCase();
  if (!s) return null;
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
  return "unknown";
}

function normalizeDateOfBirthForRoku(rawDob) {
  if (rawDob == null || typeof rawDob !== "string") return null;
  const s = rawDob.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * Audience Acuity (Realink 2.0) identity lookup - get caller data by phone.
 * Triggered only when Ringba provides a valid non-empty ip.
 *
 * On API error or no match, returns null (we then send to Roku with phone only).
 * @param {Object} conversion - Ringba conversion (phone/caller_phone etc.)
 * @returns {Promise<{
 *   email: string|null,
 *   firstName: string|null,
 *   lastName: string|null,
 *   gender: string|null,
 *   dateOfBirth: string|null,
 *   city: string|null,
 *   state: string|null,
 *   zip: string|null,
 *   ipAddress: string|null,
 *   aGA: string|null,
 *   aID: string|null,
 *   aGI: string|null,
 * }|null>}
 */
async function getCallerDataFromAudienceAcuity(conversion, audit = {}) {
  const rawPhone = getRawPhoneForLookup(conversion);
  if (!rawPhone) {
    console.warn("📋 AudienceAcuity: no phone on conversion, skipping lookup");
    return null;
  }

  const phoneForAA = normalizePhoneForAudienceAcuity(rawPhone);
  if (!phoneForAA) {
    console.warn("📋 AudienceAcuity: phone is not at least 10 digits, skipping lookup", { phone: rawPhone });
    return null;
  }

  audit.source = "audienceacuity_direct";

  if (!AA_ORIGIN || !AA_KEY_ID || !AA_SECRET) {
    audit.reason = "missing_env_AA_KEY_ID_AA_SECRET";
    console.warn("📋 AudienceAcuity: missing AA_KEY_ID/AA_SECRET (skipping lookup)");
    return null;
  }

  try {
    const requestBody = { inputs: [phoneForAA], template: AA_TEMPLATE };

    const now = Date.now().toString(36);
    const hash = crypto.createHash("md5").update(`${now}${AA_SECRET}`, "utf8").digest("hex");
    const authHeader = `Bearer ${AA_KEY_ID}${now}${hash}`;

    const url = `${AA_ORIGIN}/v2/identities/byPhone`;
    const response = await axios.post(url, requestBody, {
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      timeout: 10000,
    });

    audit.requestedAt = new Date().toISOString();
    audit.httpStatus = response?.status;

    const data = response.data;
    const results = data?.results ?? data?.[0]?.results ?? null;
    const identity = Array.isArray(results?.[0]?.identities) ? results[0].identities[0] : null;
    if (!identity) {
      audit.reason = "no_identity_match";
      console.warn("📋 AudienceAcuity: no identity match", { phone: phoneForAA });
      return null;
    }

    // Handle both raw AA identity shapes and the "cleaned" identity shape you tested.
    // Email selection rules (per your request):
    // 1) prefer emails with optIn: true
    // 2) within that set, choose the one with highest rankOrder
    // 3) if none have optIn, choose highest rankOrder from the full list
    // 4) ties: choose the first one in the array
    const selectBestEmail = () => {
      const emails = identity?.emails;
      if (!Array.isArray(emails) || emails.length === 0) return null;

      // Keep original order by using a single pass that only updates on "strictly better".
      const hasOptInTrue = emails.some((e) => typeof e === "object" && e != null && e.optIn === true);
      let bestRank = -Infinity;
      let bestEmail = null;

      for (const entry of emails) {
        // AA sometimes returns emails as strings; we can't infer optIn/rankOrder then.
        if (typeof entry === "string") {
          if (hasOptInTrue) continue; // only consider explicit opt-in emails when available
          // If we only have plain strings, pick the first one (preserve order).
          if (bestEmail == null) bestEmail = entry;
          continue;
        }

        if (!entry || typeof entry !== "object") continue;
        const emailStr = typeof entry.email === "string" ? entry.email : null;
        if (!emailStr) continue;

        if (hasOptInTrue && entry.optIn !== true) continue;

        const rank = Number(entry.rankOrder);
        const safeRank = Number.isFinite(rank) ? rank : -Infinity;

        if (safeRank > bestRank) {
          bestRank = safeRank;
          bestEmail = emailStr;
        }
        // If safeRank === bestRank, we intentionally keep the first one (no update).
      }

      return bestEmail;
    };

    const email = selectBestEmail() ?? (typeof identity?.email === "string" ? identity.email : null);

    let firstName = identity?.firstName ?? null;
    let lastName = identity?.lastName ?? null;

    // If AA didn't provide split names, derive from identity.name
    if ((!firstName || !lastName) && typeof identity?.name === "string" && identity.name.trim()) {
      const parts = identity.name.trim().split(/\s+/).filter(Boolean);
      if (parts.length > 0) {
        firstName = parts[0] || null;
        const rest = parts.slice(1).join(" ").trim();
        lastName = rest || null;
      }
    }

    // Prefer top-level identity fields, then fall back to nested identity.data fields
    // to match the external clean proxy behavior.
    const rawGender = identity?.gender ?? identity?.data?.gender ?? null;
    const rawDob = identity?.dateOfBirth ?? identity?.birthDate ?? identity?.data?.birthDate ?? null;
    const gender = normalizeGenderForRoku(rawGender);
    const dateOfBirth = normalizeDateOfBirthForRoku(rawDob);

    let city = identity?.city ?? null;
    let state = identity?.state ?? null;
    let zip = identity?.zip ?? null;

    // If AA provided a full address but not split geo fields, parse from address string:
    // Example: "1532 Brown St, Middletown OH 45044"
    if ((!city || !state || !zip) && typeof identity?.address === "string" && identity.address.trim()) {
      const addr = identity.address.trim();
      // Grab: ", <city> <STATE> <zip>"
      const m = addr.match(/,\s*([^,]+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?/);
      if (m) {
        city = m[1];
        state = m[2].toUpperCase();
        zip = m[3];
      }
    }

    // IP selection rules (per your request):
    // - identity.ips is an array of { ip, intensity }
    // - choose the highest intensity
    // - ties: choose the first one
    const selectBestIp = () => {
      const ips = identity?.ips;
      if (!Array.isArray(ips) || ips.length === 0) return null;

      let bestIntensity = -Infinity;
      let bestIp = null;

      for (const entry of ips) {
        const ipStr = entry && typeof entry === "object" ? entry.ip : null;
        if (typeof ipStr !== "string" || !ipStr.trim()) continue;

        const intensity = entry && typeof entry === "object" ? Number(entry.intensity) : NaN;
        const safeIntensity = Number.isFinite(intensity) ? intensity : -Infinity;

        if (safeIntensity > bestIntensity) {
          bestIntensity = safeIntensity;
          bestIp = ipStr;
        }
        // If safeIntensity === bestIntensity, keep first (no update).
      }

      return bestIp;
    };

    const ipAddress = selectBestIp() ?? identity?.ipAddress ?? null;

    let aGA = null;
    let aID = null;
    let aGI = null;
    const devices =
      (Array.isArray(identity?.devices) ? identity.devices : null) ??
      (Array.isArray(identity?.data?.devices) ? identity.data.devices : null) ??
      [];
    if (devices.length > 0) {
      for (const d of devices) {
        const idType = String(d?.idType ?? "").trim().toUpperCase();
        const deviceId = typeof d?.deviceId === "string" ? d.deviceId.trim() : "";
        if (!deviceId) continue;

        if (idType === "GAID" || idType === "ADID" || idType === "AAID") aGA = deviceId;
        else if (idType === "IDFA") aID = deviceId;
        else if (idType === "IDFV") aGI = deviceId;
        if (aGA && aID && aGI) break;
      }
    } else if (identity?.mobileId) {
      // If AA response does not include device idType, we don't know whether this is Apple vs Android.
      // Send the same mobileId to all Roku mobile-id fields to avoid losing enrichment.
      aGA = identity.mobileId;
      aID = identity.mobileId;
      aGI = identity.mobileId;
    }

    const toStr = (v) => (v != null && typeof v === "string" && v.trim() ? v.trim() : null);

    const cleaned = {
      email: toStr(email),
      firstName: toStr(firstName),
      lastName: toStr(lastName),
      gender,
      dateOfBirth,
      city: toStr(city),
      state: toStr(state),
      zip: toStr(zip),
      ipAddress: toStr(ipAddress),
      aGA,
      aID,
      aGI,
    };

    // If AA returns the identity object but all fields are null, treat as no enrichment.
    const hasAny =
      cleaned.email ||
      cleaned.firstName ||
      cleaned.lastName ||
      cleaned.gender ||
      cleaned.dateOfBirth ||
      cleaned.city ||
      cleaned.state ||
      cleaned.zip ||
      cleaned.ipAddress ||
      cleaned.aGA ||
      cleaned.aID ||
      cleaned.aGI;
    audit.reason = hasAny ? "enriched" : "identity_fields_all_null";

    return cleaned;
  } catch (error) {
    const errStatus = error.response?.status;
    const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    audit.reason = "api_error";
    audit.httpStatus = errStatus;
    audit.errorMessage = typeof msg === "string" ? msg.slice(0, 500) : String(msg);
    console.warn("📋 AudienceAcuity API error (continuing to Roku with phone only):", {
      status: errStatus,
      message: msg,
    });
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
 * user_data:
 *  - ph (hashed) always
 *  - em, fn, ln (hashed) when available from Audience Acuity
 *  - ge, db (hashed) when available from Audience Acuity
 *  - ct, st, zp from Audience Acuity or Ringba (conversion.ct/st/zp)
 *  - client_ip_address when available from Audience Acuity
 *  - aGA/aID/aGI when available from Audience Acuity
 *  - country (not hashed) always set to "US"
 *
 * @returns {{ payload: {event_group_id: string, events: Array}, plainUserData: Object }}
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

  // Hashed user_data sent to Roku
  const userData = {
    is_hashed: true,
    ph: hashedPhone,
  };

  // Un-hashed user_data values we derived from AA/Ringba (for debugging)
  const plainUserData = {
    is_hashed: false,
    ph: normalizedPhone,
  };

  if (options.callerEmail && typeof options.callerEmail === "string" && options.callerEmail.trim()) {
    const normalizedEm = normalizeEmail(options.callerEmail.trim());
    if (normalizedEm) {
      userData.em = sha256Hash(normalizedEm);
      plainUserData.em = normalizedEm;
    }
  }
  if (options.callerFirstName && typeof options.callerFirstName === "string" && options.callerFirstName.trim()) {
    const n = normalizeName(options.callerFirstName.trim());
    if (n) {
      userData.fn = sha256Hash(n);
      plainUserData.fn = n;
    }
  }
  if (options.callerLastName && typeof options.callerLastName === "string" && options.callerLastName.trim()) {
    const n = normalizeName(options.callerLastName.trim());
    if (n) {
      userData.ln = sha256Hash(n);
      plainUserData.ln = n;
    }
  }

  if (options.callerGender && typeof options.callerGender === "string" && options.callerGender.trim()) {
    const g = options.callerGender.trim().toLowerCase();
    userData.ge = sha256Hash(g);
    plainUserData.ge = g;
  }
  if (options.callerDob && typeof options.callerDob === "string" && options.callerDob.trim()) {
    const dobPlain = options.callerDob.trim();
    userData.db = sha256Hash(dobPlain);
    plainUserData.db = dobPlain;
  }

  if (options.callerIpAddress && typeof options.callerIpAddress === "string" && options.callerIpAddress.trim()) {
    const ip = options.callerIpAddress.trim();
    userData.client_ip_address = ip;
    plainUserData.client_ip_address = ip;
  }
  if (options.callerAga && typeof options.callerAga === "string" && options.callerAga.trim()) {
    const v = options.callerAga.trim();
    userData.aGA = v;
    plainUserData.aGA = v;
  }
  if (options.callerAid && typeof options.callerAid === "string" && options.callerAid.trim()) {
    const v = options.callerAid.trim();
    userData.aID = v;
    plainUserData.aID = v;
  }
  if (options.callerAgi && typeof options.callerAgi === "string" && options.callerAgi.trim()) {
    const v = options.callerAgi.trim();
    userData.aGI = v;
    plainUserData.aGI = v;
  }

  // City, state, zip: Audience Acuity first, then Ringba (ct, st, zp)
  const city =
    options.callerCity && typeof options.callerCity === "string" && options.callerCity.trim()
      ? options.callerCity.trim()
      : (conversion.ct ?? conversion.city ?? "").trim();
  if (city) {
    userData.ct = city;
    plainUserData.ct = city;
  }

  const state =
    options.callerState && typeof options.callerState === "string" && options.callerState.trim()
      ? options.callerState.trim()
      : (conversion.st ?? conversion.state ?? "").trim();
  if (state) {
    userData.st = state;
    plainUserData.st = state;
  }

  const zip =
    options.callerZip != null && String(options.callerZip).trim()
      ? String(options.callerZip).trim()
      : (conversion.zp ?? conversion.zip ?? "").trim();
  if (zip) {
    userData.zp = zip;
    plainUserData.zp = zip;
  }

  userData.country = "US";
  plainUserData.country = "US";

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

  const payload = {
    event_group_id: eventGroupId,
    events: [eventPayload],
  };

  return { payload, plainUserData };
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
        audienceAcuity: { called: false, reason: "skipped (missing roku_api_key)" },
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
        audienceAcuity: { called: false, reason: "skipped (duplicate within 1h, did not call AudienceAcuity)" },
        sentToRoku: null,
        result: { success: false, reason: "duplicate within 1 hour" },
      });
      continue;
    }

    // Desired behavior:
    // - If Ringba provides an IP, do NOT call AA (send Roku directly, using Ringba IP).
    // - If Ringba does NOT provide an IP, call AA to enrich (and use AA IP if available).
    const useAudienceAcuity = !hasValidIp(conversion);

    let callerData = null;
    const audienceAudit = {};
    if (useAudienceAcuity) {
      callerData = await getCallerDataFromAudienceAcuity(conversion, audienceAudit);
    }

    const aaSuccess = !!(
      callerData &&
      (callerData.email ||
        callerData.firstName ||
        callerData.lastName ||
        callerData.gender ||
        callerData.dateOfBirth ||
        callerData.city ||
        callerData.state ||
        callerData.zip ||
        callerData.ipAddress ||
        callerData.aGA ||
        callerData.aID ||
        callerData.aGI)
    );

    const ringbaLog = {
      phone: getRawPhoneForLookup(conversion) || null,
      ip: typeof conversion?.ip === "string" ? conversion.ip.trim() : typeof conversion?.IP === "string" ? conversion.IP.trim() : null,
      city: (conversion.ct ?? conversion.city ?? "").trim() || null,
      state: (conversion.st ?? conversion.state ?? "").trim() || null,
      zip: (conversion.zp ?? conversion.zip ?? "").trim() || null,
      event_group_id: (conversion.event_group_id ?? conversion.eventGroupId ?? conversion.event ?? conversion.Event ?? "").trim() || null,
      event_id: (conversion.event_id ?? conversion.eventId ?? "").trim() || null,
    };

    let payload;
    let plainUserData;
    try {
      const built = buildRokuEvent(conversion, {
        defaultEventGroupId: options.defaultEventGroupId,
        // Prefer AA-enriched IP; otherwise use Ringba IP directly.
        callerIpAddress: callerData?.ipAddress ?? ringbaLog.ip,
        ...(callerData && {
          callerEmail: callerData.email,
          callerFirstName: callerData.firstName,
          callerLastName: callerData.lastName,
          callerGender: callerData.gender,
          callerDob: callerData.dateOfBirth,
          callerCity: callerData.city,
          callerState: callerData.state,
          callerZip: callerData.zip,
          callerAga: callerData.aGA,
          callerAid: callerData.aID,
          callerAgi: callerData.aGI,
        }),
      });
      payload = built.payload;
      plainUserData = built.plainUserData;
      const response = await axios.post(url, payload, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
      });

      try {
        await RokuLog.create({
          aaCalled: useAudienceAcuity,
          aaSuccess,
          ringba: ringbaLog,
          plainUserData: plainUserData ?? {},
          rokuRequest: payload ?? {},
          rokuResponse: response?.data ?? null,
          rokuError: null,
        });
      } catch (logErr) {
        console.warn("⚠️ RokuLogs write failed:", logErr?.message || logErr);
      }

      results.push({ conversion, sentToRoku: payload, response: response.data });
      console.log("✅ Roku CAPI success:", {
        event_group_id: payload.event_group_id,
        code: response.data?.code,
      });
      appendRokuAudit({
        timestamp: new Date().toISOString(),
        receivedFromRingba: conversion,
        audienceAcuity: { called: useAudienceAcuity, ...audienceAudit, data: callerData },
        sentToRoku: payload,
        result: { success: true, response: response.data },
      });
    } catch (error) {
      const errMsg = error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message;
      console.error("❌ Roku CAPI error:", errMsg);

      try {
        await RokuLog.create({
          aaCalled: useAudienceAcuity,
          aaSuccess,
          ringba: ringbaLog,
          plainUserData: plainUserData ?? {},
          rokuRequest: payload ?? {},
          rokuResponse: null,
          rokuError: errMsg,
        });
      } catch (logErr) {
        console.warn("⚠️ RokuLogs write failed:", logErr?.message || logErr);
      }

      results.push({
        conversion,
        ...(payload !== undefined && { sentToRoku: payload }),
        error: errMsg,
      });
      appendRokuAudit({
        timestamp: new Date().toISOString(),
        receivedFromRingba: conversion,
        audienceAcuity: { called: useAudienceAcuity, ...audienceAudit, data: callerData },
        sentToRoku: payload !== undefined ? payload : null,
        result: { success: false, reason: errMsg },
      });
    }
  }

  return results;
}

/** @deprecated Kept for backward compatibility; now uses Audience Acuity. */
async function getCallerEmailFromExternalApi(conversion) {
  const data = await getCallerDataFromAudienceAcuity(conversion);
  return data?.email ?? null;
}

module.exports = {
  sendConversionsToRoku,
  buildRokuEvent,
  normalizePhone,
  normalizeEmail,
  normalizeName,
  getCallerDataFromAudienceAcuity,
  getCallerEmailFromExternalApi,
  timestampMicrosToEpochSeconds,
};
