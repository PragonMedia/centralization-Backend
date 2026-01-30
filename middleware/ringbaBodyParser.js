/**
 * Ringba conversion webhook body parser with malformed JSON repair.
 * Ringba sometimes sends "conversions": "," instead of "conversions": [{...}].
 * This middleware parses raw body and attempts to repair that pattern before parsing.
 */

function repairMalformedRingbaJson(str) {
  // Ringba sends "conversions": ",\n    "ordinal" instead of "conversions": [{"ordinal"
  // Repair: "conversions": ",\n    " -> "conversions": [{"
  let repaired = str.replace(
    /"conversions":\s*",\s*\n\s*"/g,
    '"conversions": [{"'
  );
  // Also handle "conversions": "," (no newline)
  repaired = repaired.replace(
    /"conversions":\s*",\s*"/g,
    '"conversions": [{"'
  );
  return repaired;
}

/**
 * Middleware: expects req.body to be a Buffer (from express.raw()).
 * Parses JSON; on failure, tries repair and parse again. Sets req.body to parsed object.
 */
function ringbaBodyParser(req, res, next) {
  let body = req.body;
  if (!body || !(body.length > 0)) {
    req.body = {};
    return next();
  }
  const str =
    typeof body === "string" ? body : body.toString ? body.toString("utf8") : "";
  if (!str.trim()) {
    req.body = {};
    return next();
  }
  try {
    req.body = JSON.parse(str);
    return next();
  } catch (e) {
    if (str.includes('"conversions"') && e instanceof SyntaxError) {
      try {
        const repaired = repairMalformedRingbaJson(str);
        req.body = JSON.parse(repaired);
        console.log(
          "🔧 Ringba: Repaired malformed JSON (conversions string -> array) and parsed successfully"
        );
        return next();
      } catch (e2) {
        return next(e);
      }
    }
    return next(e);
  }
}

module.exports = { ringbaBodyParser, repairMalformedRingbaJson };
