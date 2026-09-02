/**
 * CallGrid accounting — Paragon Media only (no Elite).
 * Uses publisher org API key from CALLGRID_API_KEY.
 */

function envTrim(name, fallback = "") {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return fallback;
  return String(v).trim();
}

/** Paragon Media CallGrid organization (publisher). */
const PARAGON_ORGANIZATION_ID =
  envTrim("CALLGRID_ORGANIZATION_ID") || "cmqzp5upm023q06jr1r2nas6f";

const PARAGON_ORGANIZATION_NAME = "Paragon Media";

module.exports = {
  PARAGON_ORGANIZATION_ID,
  PARAGON_ORGANIZATION_NAME,
};
