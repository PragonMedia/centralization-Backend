const fs = require("fs");
const path = require("path");
const cm360Service = require("../services/cm360Service");
const rokuConversionService = require("../services/rokuConversionService");
const slackService = require("../services/slackService");

const CATCH_ROKU_DIR = path.join(__dirname, "..", "logs");
const CATCH_ROKU_PREFIX = "catchRoku";

function hasDclid(conversion) {
  return (
    conversion.dclid != null &&
    typeof conversion.dclid === "string" &&
    conversion.dclid.trim() !== ""
  );
}

function hasRokuApiKey(conversion) {
  const key = conversion.roku_api_key ?? conversion.rokuApiKey ?? "";
  return typeof key === "string" && key.trim() !== "";
}

function getRawPhone(conversion) {
  const raw =
    conversion.phone ??
    conversion.caller_phone ??
    conversion.callerPhone ??
    conversion.callerPhoneNumber ??
    "";
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Validate incoming Ringba conversion payload
 * dclid + roku_api_key → Roku only. dclid only → CM360 only. roku_api_key only (no dclid) → Roku only.
 * CM360 path (dclid, no roku_api_key): floodlightConfigurationId, floodlightActivityId, ordinal, timestampMicros
 * Roku path (has roku_api_key, with or without dclid): event_group_id (per conversion or body), phone
 */
function validateRingbaPayload(body) {
  if (!body || typeof body !== "object") {
    return { isValid: false, error: "Invalid request body: body must be a valid JSON object" };
  }
  if (!body.conversions || !Array.isArray(body.conversions)) {
    return { isValid: false, error: "Missing or invalid 'conversions' array" };
  }
  if (body.conversions.length === 0) {
    return { isValid: false, error: "Conversions array cannot be empty" };
  }

  for (let i = 0; i < body.conversions.length; i++) {
    const c = body.conversions[i];
    const errors = [];

    if (hasRokuApiKey(c)) {
      const eventGroupId =
        c.event_group_id ?? c.eventGroupId ?? body.event_group_id ?? body.eventGroupId ?? "";
      if (typeof eventGroupId !== "string" || eventGroupId.trim() === "")
        errors.push("event_group_id is required for Roku (from Ringba, per conversion or body)");
      const phone = getRawPhone(c);
      if (!phone) errors.push("phone (or caller_phone/callerPhone) is required for Roku");
    } else if (hasDclid(c)) {
      if (!c.timestampMicros || typeof c.timestampMicros !== "string" || c.timestampMicros.trim() === "") {
        errors.push("timestampMicros is required and must be a non-empty string");
      } else {
        const num = Number(c.timestampMicros.trim());
        if (isNaN(num)) errors.push("timestampMicros must be a numeric string");
      }
      if (!c.floodlightConfigurationId || typeof c.floodlightConfigurationId !== "string" || c.floodlightConfigurationId.trim() === "")
        errors.push("floodlightConfigurationId is required for CM360");
      if (!c.floodlightActivityId || typeof c.floodlightActivityId !== "string" || c.floodlightActivityId.trim() === "")
        errors.push("floodlightActivityId is required for CM360");
      if (!c.ordinal || typeof c.ordinal !== "string" || c.ordinal.trim() === "")
        errors.push("ordinal is required for CM360");
    } else {
      errors.push("conversion must have dclid (for CM360) or roku_api_key (for Roku)");
    }

    if (errors.length > 0) {
      return { isValid: false, error: `Validation failed for conversion at index ${i}: ${errors.join(", ")}` };
    }
  }

  return { isValid: true };
}

/**
 * Handle Ringba webhook conversion request
 * POST /ringba/conversion
 * Ringba sends full body (floodlightConfigurationId, floodlightActivityId, dclid, ordinal, etc.). No hardcoding.
 */
async function handleRingbaConversion(req, res) {
  try {
    // Debug: Log request details and full body (so we can see what Ringba sent / what we validate)
    console.log("📥 Ringba webhook received:", {
      timestamp: new Date().toISOString(),
      method: req.method,
      contentType: req.headers["content-type"],
      hasBody: !!req.body,
      bodyType: typeof req.body,
      conversionsCount: req.body?.conversions?.length || 0,
    });
    if (req.body && req.body.conversions) {
      console.log("📥 Ringba body (conversions):", JSON.stringify(req.body.conversions, null, 2));
    }

    // Check if body exists
    if (!req.body) {
      console.error("❌ Request body is undefined or empty");
      return res.status(400).json({
        success: false,
        error:
          "Request body is missing or could not be parsed. Ensure Content-Type is application/json",
      });
    }

    const validation = validateRingbaPayload(req.body);
    if (!validation.isValid) {
      console.error("❌ Validation failed:", validation.error);
      return res.status(400).json({ success: false, error: validation.error });
    }

    const conversions = req.body.conversions;
    const cm360Conversions = conversions.filter((c) => hasDclid(c) && !hasRokuApiKey(c));
    const rokuConversions = conversions.filter(hasRokuApiKey);

    let cm360Response = null;
    let rokuResults = null;

    if (cm360Conversions.length > 0) {
      try {
        console.log("📤 Sending to CM360:", cm360Conversions.length, "conversion(s)");
        cm360Response = await cm360Service.sendConversionsToCM360(cm360Conversions);
        if (cm360Response.hasFailures && cm360Response.status) {
          for (const statusItem of cm360Response.status) {
            if (statusItem.errors && statusItem.errors.length > 0) {
              const ordinal = statusItem.conversion?.ordinal || "UNKNOWN";
              const errorMessages = statusItem.errors.map((e) => e.message).join("; ");
              await slackService.sendSlackMessage(`${ordinal} failed. Err message : ${errorMessages}`);
              console.error("❌ CM360 conversion error:", { ordinal, errors: errorMessages });
            }
          }
        }
      } catch (cm360Err) {
        console.error("❌ CM360 request failed (Roku will still run if applicable):", cm360Err.message);
        cm360Response = { error: cm360Err.message, hasFailures: true };
      }
    }

    if (rokuConversions.length > 0) {
      console.log("📤 Sending to Roku CAPI:", rokuConversions.length, "conversion(s)");
      rokuResults = await rokuConversionService.sendConversionsToRoku(rokuConversions, {
        defaultEventGroupId: req.body.event_group_id ?? req.body.eventGroupId,
      });
      // Debug: write one JSON file per Roku conversion (received from Ringba + sent to Roku)
      try {
        if (!fs.existsSync(CATCH_ROKU_DIR)) {
          fs.mkdirSync(CATCH_ROKU_DIR, { recursive: true });
        }
        const ts = Date.now();
        console.log("📁 catchRoku: writing to", CATCH_ROKU_DIR, "count:", rokuResults.length);
        rokuResults.forEach((result, i) => {
          const filename = `${CATCH_ROKU_PREFIX}-${ts}-${i}.json`;
          const filepath = path.join(CATCH_ROKU_DIR, filename);
          const payload = {
            receivedFromRingba: result.conversion,
            sentToRoku: result.sentToRoku ?? null,
            rokuResponse: result.response ?? null,
            rokuError: result.error ?? null,
          };
          fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf8");
          console.log("📁 catchRoku: wrote", filename);
        });
      } catch (writeErr) {
        console.error("⚠️ catchRoku write failed:", writeErr.message, "path:", CATCH_ROKU_DIR, "code:", writeErr.code);
      }
    }

    // Build response with plain objects only (avoid 500 if Ringba sends non-JSON-serializable data)
    const responsePayload = { success: true };
    if (cm360Response !== null) responsePayload.cm360Response = cm360Response;
    if (rokuResults !== null) {
      responsePayload.rokuResults = rokuResults.map((r) => ({
        conversion: r.conversion && typeof r.conversion === "object" ? { ...r.conversion } : r.conversion,
        sentToRoku: r.sentToRoku ?? null,
        response: r.response ?? null,
        error: typeof r.error === "string" ? r.error : (r.error ?? null),
      }));
    }
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("❌ Ringba conversion handler error:", {
      error: error.message,
      stack: error.stack,
    });

    // Determine error status code
    let statusCode = 500;
    if (error.message.includes("authentication failed")) {
      statusCode = 500;
    } else if (error.message.includes("CM360 API error")) {
      statusCode = 502; // Bad Gateway
    } else     if (error.message.includes("Validation failed")) {
      statusCode = 400;
    } else if (error.message.includes("ROKU_CAPI_API_KEY") || error.message.includes("Roku CAPI")) {
      statusCode = 500;
    }

    return res.status(statusCode).json({
      success: false,
      error: error.message,
    });
  }
}

module.exports = {
  handleRingbaConversion,
};
