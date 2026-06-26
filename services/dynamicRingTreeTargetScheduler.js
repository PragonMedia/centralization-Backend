const dynamicRingTreeTargetService = require("./dynamicRingTreeTargetService");
const CFG = require("../config/dynamicRingTreeTarget");

let schedulerTimer = null;
let resetInProgress = false;
let lastRunDateKey = "";

function getEasternClock() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CFG.DAILY_BATCH_RESET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const out = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return {
    hour: out.hour,
    minute: out.minute,
    dateKey: `${out.year}-${out.month}-${out.day}`,
  };
}

function padHour(hour) {
  return String(hour).padStart(2, "0");
}

async function runScheduledBatchReset() {
  if (resetInProgress) return;
  resetInProgress = true;
  try {
    const result = await dynamicRingTreeTargetService.clearAllOpenBatches({
      trigger: "scheduler_1am_et",
    });
    console.log("RingTreeTarget scheduler: daily batch reset complete", result);
  } catch (error) {
    console.error("RingTreeTarget scheduler batch reset failed:", error.message);
  } finally {
    resetInProgress = false;
  }
}

function startDynamicRingTreeTargetScheduler() {
  if (!CFG.DAILY_BATCH_RESET_ENABLED) {
    console.log("RingTreeTarget daily batch reset scheduler disabled");
    return;
  }
  if (schedulerTimer) return;

  const hourLabel = padHour(CFG.DAILY_BATCH_RESET_HOUR);
  schedulerTimer = setInterval(async () => {
    const now = getEasternClock();
    const shouldRun = now.hour === hourLabel && now.minute === "00";
    if (!shouldRun) return;
    if (lastRunDateKey === now.dateKey) return;
    lastRunDateKey = now.dateKey;
    await runScheduledBatchReset();
  }, 60000);

  console.log(
    `RingTreeTarget scheduler started (daily ${hourLabel}:00 ${CFG.DAILY_BATCH_RESET_TIMEZONE} batch reset)`
  );
}

function stopDynamicRingTreeTargetScheduler() {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

module.exports = {
  startDynamicRingTreeTargetScheduler,
  stopDynamicRingTreeTargetScheduler,
  runScheduledBatchReset,
};
