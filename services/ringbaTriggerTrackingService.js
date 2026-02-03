/**
 * Temporary tracking: count Ringba API triggers per domain (frontend pings).
 * Data stored in logs/ringba-trigger-counts.json. File is deleted/reset if older than 3 days.
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const COUNTS_FILE = path.join(LOG_DIR, "ringba-trigger-counts.json");
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function isFileTooOld(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs > MAX_AGE_MS;
  } catch {
    return false;
  }
}

function readCounts() {
  ensureLogDir();
  if (!fs.existsSync(COUNTS_FILE)) {
    return {};
  }
  if (isFileTooOld(COUNTS_FILE)) {
    try {
      fs.unlinkSync(COUNTS_FILE);
    } catch (err) {
      console.error("ringbaTriggerTracking: failed to delete old file", err.message);
    }
    return {};
  }
  try {
    const raw = fs.readFileSync(COUNTS_FILE, "utf8");
    const data = JSON.parse(raw);
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

function writeCounts(counts) {
  ensureLogDir();
  fs.writeFileSync(COUNTS_FILE, JSON.stringify(counts, null, 2), "utf8");
}

/**
 * Increment trigger count for a domain. Returns updated count for that domain.
 * @param {string} domain - e.g. "sample.com"
 * @returns {number} - count after increment
 */
function incrementCount(domain) {
  const counts = readCounts();
  const key = String(domain || "").trim().toLowerCase();
  if (!key) return 0;
  counts[key] = (counts[key] || 0) + 1;
  writeCounts(counts);
  return counts[key];
}

/**
 * Get current counts (domain -> number). Used for GET endpoint.
 * @returns {{ [domain: string]: number }}
 */
function getCounts() {
  return readCounts();
}

module.exports = {
  incrementCount,
  getCounts,
  COUNTS_FILE,
};
