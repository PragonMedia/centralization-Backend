/**
 * Domain vertical is a free-form string chosen by the frontend.
 * Backend only requires a non-empty string when provided (no enum allowlist).
 */
function isValidDomainVertical(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  isValidDomainVertical,
};
