const Domain = require("../models/domainModel");
const TRASH_BIN_CONFIG = require("../config/trashBin");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getRetentionDays() {
  const days = TRASH_BIN_CONFIG.RETENTION_DAYS;
  return Number.isFinite(days) && days > 0 ? days : 30;
}

/**
 * @param {Date|string} archivedAt
 * @returns {Date}
 */
function computePurgeAt(archivedAt) {
  const base = archivedAt ? new Date(archivedAt) : new Date();
  return new Date(base.getTime() + getRetentionDays() * MS_PER_DAY);
}

/**
 * @param {object} domainDoc - Mongoose doc or plain object
 * @returns {object}
 */
function getTrashMetadata(domainDoc) {
  const archivedAt = domainDoc.archivedAt
    ? new Date(domainDoc.archivedAt)
    : null;
  const purgeAt = domainDoc.purgeAt
    ? new Date(domainDoc.purgeAt)
    : archivedAt
      ? computePurgeAt(archivedAt)
      : null;

  let daysUntilPurge = null;
  if (purgeAt) {
    daysUntilPurge = Math.max(
      0,
      Math.ceil((purgeAt.getTime() - Date.now()) / MS_PER_DAY)
    );
  }

  return {
    status: domainDoc.status || "active",
    archivedAt,
    archivedBy: domainDoc.archivedBy || null,
    purgeAt,
    daysUntilPurge,
    retentionDays: getRetentionDays(),
    routeCount: Array.isArray(domainDoc.routes) ? domainDoc.routes.length : 0,
  };
}

/**
 * @param {object} domainDoc
 * @returns {object}
 */
function formatArchivedDomainResponse(domainDoc) {
  const plain =
    typeof domainDoc.toObject === "function"
      ? domainDoc.toObject()
      : { ...domainDoc };

  return {
    ...plain,
    trash: getTrashMetadata(plain),
  };
}

/**
 * Hard-delete archived domains whose purge date has passed.
 * External cleanup (RedTrack, nginx, auto-renew) already ran at archive time.
 * @returns {Promise<{ purged: string[], failed: Array<{domain: string, error: string}> }>}
 */
async function purgeExpiredArchivedDomains() {
  const now = new Date();
  const retentionDays = getRetentionDays();
  const fallbackCutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);

  const candidates = await Domain.find({
    status: "archived",
    $or: [{ purgeAt: { $lte: now } }, { purgeAt: null, archivedAt: { $lte: fallbackCutoff } }],
  });

  const purged = [];
  const failed = [];

  for (const domainDoc of candidates) {
    try {
      const deleted = await Domain.findOneAndDelete({
        _id: domainDoc._id,
        status: "archived",
      });

      if (deleted) {
        purged.push(deleted.domain);
        console.log(`🗑️  Permanently purged archived domain: ${deleted.domain}`);
      }
    } catch (error) {
      failed.push({ domain: domainDoc.domain, error: error.message });
      console.error(
        `⚠️  Failed to purge archived domain ${domainDoc.domain}:`,
        error.message
      );
    }
  }

  return { purged, failed, checked: candidates.length };
}

module.exports = {
  getRetentionDays,
  computePurgeAt,
  getTrashMetadata,
  formatArchivedDomainResponse,
  purgeExpiredArchivedDomains,
};
