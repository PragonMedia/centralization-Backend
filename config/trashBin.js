const TRASH_BIN_CONFIG = {
  RETENTION_DAYS: parseInt(process.env.TRASH_RETENTION_DAYS || "30", 10),
};

module.exports = TRASH_BIN_CONFIG;
