const cm360Service = require("../services/cm360Service");
const slackService = require("../services/slackService");

/**
 * Validate incoming Ringba conversion payload
 * @param {Object} body - Request body from Ringba
 * @returns {Object} { isValid: boolean, error?: string }
 */
function validateRingbaPayload(body) {
  // Check if body exists
  if (!body || typeof body !== "object") {
    return {
      isValid: false,
      error: "Invalid request body: body must be a valid JSON object",
    };
  }

  // Check if conversions array exists
  if (!body.conversions || !Array.isArray(body.conversions)) {
    return {
      isValid: false,
      error: "Missing or invalid 'conversions' array",
    };
  }

  if (body.conversions.length === 0) {
    return {
      isValid: false,
      error: "Conversions array cannot be empty",
    };
  }

  // Validate each conversion object
  for (let i = 0; i < body.conversions.length; i++) {
    const conversion = body.conversions[i];
    const errors = [];

    // Required fields validation
    if (
      !conversion.floodlightConfigurationId ||
      typeof conversion.floodlightConfigurationId !== "string" ||
      conversion.floodlightConfigurationId.trim() === ""
    ) {
      errors.push(
        "floodlightConfigurationId is required and must be a non-empty string"
      );
    }

    if (
      !conversion.floodlightActivityId ||
      typeof conversion.floodlightActivityId !== "string" ||
      conversion.floodlightActivityId.trim() === ""
    ) {
      errors.push(
        "floodlightActivityId is required and must be a non-empty string"
      );
    }

    if (
      !conversion.ordinal ||
      typeof conversion.ordinal !== "string" ||
      conversion.ordinal.trim() === ""
    ) {
      errors.push("ordinal is required and must be a non-empty string");
    }

    if (
      !conversion.timestampMicros ||
      typeof conversion.timestampMicros !== "string" ||
      conversion.timestampMicros.trim() === ""
    ) {
      errors.push("timestampMicros is required and must be a non-empty string");
    } else {
      // Validate timestampMicros is numeric (microseconds)
      // Allow negative/zero; cm360Service will normalize to current time if invalid
      const timestampStr = conversion.timestampMicros.trim();
      const timestampNum = Number(timestampStr);
      if (isNaN(timestampNum)) {
        errors.push(
          "timestampMicros must be a numeric string (microseconds)"
        );
      }
    }

    // dclid required: if missing or empty we do not call CM360 and do not send Slack
    if (
      conversion.dclid == null ||
      typeof conversion.dclid !== "string" ||
      conversion.dclid.trim() === ""
    ) {
      errors.push("dclid is required and must be a non-empty string");
    }

    if (errors.length > 0) {
      return {
        isValid: false,
        error: `Validation failed for conversion at index ${i}: ${errors.join(
          ", "
        )}`,
      };
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

    // Validate payload (Ringba sends full body: floodlight IDs, dclid, ordinal, etc. — no env fallbacks)
    const validation = validateRingbaPayload(req.body);
    if (!validation.isValid) {
      console.error("❌ Validation failed:", validation.error);
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // Log what we're sending to CM360
    console.log("📤 Sending to CM360:", JSON.stringify(req.body.conversions, null, 2));

    // Send conversions to CM360
    const cm360Response = await cm360Service.sendConversionsToCM360(
      req.body.conversions
    );

    // Check for errors in CM360 response and send Slack notifications
    if (cm360Response.hasFailures && cm360Response.status) {
      for (const statusItem of cm360Response.status) {
        if (statusItem.errors && statusItem.errors.length > 0) {
          const conversion = statusItem.conversion;
          const ordinal = conversion?.ordinal || "UNKNOWN";

          // Combine all error messages
          const errorMessages = statusItem.errors
            .map((err) => err.message)
            .join("; ");

          // Send Slack notification
          const slackMessage = `${ordinal} failed. Err message : ${errorMessages}`;
          await slackService.sendSlackMessage(slackMessage);

          console.error("❌ CM360 conversion error:", {
            ordinal: ordinal,
            errors: errorMessages,
          });
        }
      }
    }

    // Return success response
    return res.status(200).json({
      success: true,
      cm360Response: cm360Response,
    });
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
    } else if (error.message.includes("Validation failed")) {
      statusCode = 400;
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
