/**
 * State Performance service – Ringba Insights by US state, total + per-channel.
 * Filters: qualified=yes, Paragon - Medicare. Channel filter optional per request.
 * Window: rolling 2 months of daily records (accounting-like behavior).
 */
const axios = require("axios");
const RINGBA_CONFIG = require("../config/ringbaApi");

const DEFAULT_BASE_URL = (RINGBA_CONFIG.BASE_URL || "https://api.ringba.com").replace(/\/$/, "");
const NO_VALUE = "-no value-";
const CAMPAIGN_NAME = "Paragon - Medicare";

const VALUE_COLUMNS = [
  { column: "callCount", aggregateFunction: null },
  { column: "liveCallCount", aggregateFunction: null },
  { column: "completedCalls", aggregateFunction: null },
  { column: "endedCalls", aggregateFunction: null },
  { column: "connectedCallCount", aggregateFunction: null },
  { column: "payoutCount", aggregateFunction: null },
  { column: "convertedCalls", aggregateFunction: null },
  { column: "nonConnectedCallCount", aggregateFunction: null },
  { column: "duplicateCalls", aggregateFunction: null },
  { column: "blockedCalls", aggregateFunction: null },
  { column: "incompleteCalls", aggregateFunction: null },
  { column: "earningsPerCallGross", aggregateFunction: null },
  { column: "conversionAmount", aggregateFunction: null },
  { column: "payoutAmount", aggregateFunction: null },
  { column: "profitGross", aggregateFunction: null },
  { column: "profitMarginGross", aggregateFunction: null },
  { column: "convertedPercent", aggregateFunction: null },
  { column: "callLengthInSeconds", aggregateFunction: null },
  { column: "avgHandleTime", aggregateFunction: null },
  { column: "totalCost", aggregateFunction: null },
];

function toIsoNoMs(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getRollingTwoMonthWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 2);
  return {
    startDate: toIsoNoMs(start).slice(0, 10),
    endDate: toIsoNoMs(now).slice(0, 10),
    endDateTimeIso: toIsoNoMs(now),
  };
}

function parseUTCDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function getDaysInRangeUTC(startYmd, endYmd) {
  const start = parseUTCDate(startYmd);
  const end = parseUTCDate(endYmd);
  if (!start || !end || end < start) return null;

  const now = new Date();
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );

  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const d = cur.getUTCDate();
    const dayLabel = `${String(m + 1).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
    out.push({
      date: new Date(cur),
      day: dayLabel,
      dateIso: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      isToday: cur.getTime() === todayUTC.getTime(),
    });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function getRingbaDayWindow(utcDate) {
  const y = utcDate.getUTCFullYear();
  const m = utcDate.getUTCMonth();
  const d = utcDate.getUTCDate();
  const reportStart = new Date(Date.UTC(y, m, d, 4, 0, 0, 0));
  const reportEnd = new Date(Date.UTC(y, m, d + 1, 3, 59, 59, 999));
  return {
    reportStart: reportStart.toISOString().replace(/\.\d{3}Z$/, "Z"),
    reportEnd: reportEnd.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function buildBaseFilters(channel) {
  const filters = [
    {
      anyConditionToMatch: [
        {
          column: "tag:User:qualified",
          value: "yes",
          isNegativeMatch: false,
          comparisonType: "EQUALS",
        },
      ],
    },
    {
      anyConditionToMatch: [
        {
          column: "campaignName",
          value: CAMPAIGN_NAME,
          isNegativeMatch: false,
          comparisonType: "EQUALS",
        },
      ],
    },
  ];

  if (channel) {
    filters.unshift({
      anyConditionToMatch: [
        {
          column: "tag:User:channel",
          value: channel,
          isNegativeMatch: false,
          comparisonType: "EQUALS",
        },
      ],
    });
  }

  return filters;
}

/**
 * Build Insights body grouped by state. channel=null -> total (all channels).
 */
function buildStatePerformanceInsightsBody(reportStart, reportEnd, channel = null) {
  return {
    reportStart,
    reportEnd,
    groupByColumns: [
      { column: "tag:InboundNumber:State", displayName: "InboundNumber:State" },
    ],
    valueColumns: VALUE_COLUMNS,
    orderByColumns: [{ column: "callCount", direction: "desc" }],
    formatTimespans: true,
    formatPercentages: true,
    generateRollups: true,
    maxResultsPerGroup: 1000,
    filters: buildBaseFilters(channel),
    formatTimeZone: "America/New_York",
  };
}

/**
 * Build Insights body grouped by channel (discovery).
 */
function buildChannelDiscoveryInsightsBody(reportStart, reportEnd) {
  return {
    reportStart,
    reportEnd,
    groupByColumns: [{ column: "tag:User:channel", displayName: "User:channel" }],
    valueColumns: VALUE_COLUMNS,
    orderByColumns: [{ column: "callCount", direction: "desc" }],
    formatTimespans: true,
    formatPercentages: true,
    generateRollups: true,
    maxResultsPerGroup: 1000,
    filters: buildBaseFilters(null),
    formatTimeZone: "America/New_York",
  };
}

function stripRollupRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  return records.length > 1 ? records.slice(0, -1) : records;
}

function cleanStatePerformanceRecords(records) {
  return stripRollupRecords(records)
    .map((r) => {
      const state =
        r["tag:InboundNumber:State"] != null ? String(r["tag:InboundNumber:State"]).trim() : "";
      return {
        state,
        earningsPerCallGross: Number(r.earningsPerCallGross) || 0,
        callCount: Number(r.callCount) || 0,
      };
    })
    .filter((r) => r.state && r.state !== NO_VALUE);
}

function cleanChannelDiscoveryRecords(records) {
  const unique = new Set();
  for (const r of stripRollupRecords(records)) {
    const channel = r["tag:User:channel"] != null ? String(r["tag:User:channel"]).trim() : "";
    if (channel && channel !== NO_VALUE) unique.add(channel);
  }
  return [...unique].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function postRingbaInsights(options = {}) {
  const { accountID, apiToken, baseUrl, body, label } = options;

  const tokenToUse = (apiToken && String(apiToken).trim()) || "";
  if (!accountID || !tokenToUse) {
    return { success: false, message: "Missing accountID or apiToken." };
  }

  const url = `${baseUrl || DEFAULT_BASE_URL}/v2/${accountID}/insights`;
  const authHeader =
    process.env.RINGBA_AUTH_SCHEME === "Bearer"
      ? `Bearer ${tokenToUse}`
      : `Token ${tokenToUse}`;

  try {
    const response = await axios.post(url, body, {
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      timeout: 30000,
    });

    const data = response.data;
    const first = Array.isArray(data) ? data[0] : data;
    const allRecords = first?.report?.records || [];

    return { success: true, records: allRecords };
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    console.error("StatePerformance: Ringba fetch failed", {
      label: label || "insights",
      status,
      message: error.message,
      data:
        data != null
          ? typeof data === "string"
            ? data
            : JSON.stringify(data).slice(0, 500)
          : undefined,
    });
    return {
      success: false,
      message: error.message || "Ringba request failed",
      records: [],
    };
  }
}

/**
 * Discover channels over full rolling 2-month window.
 */
async function listChannelsFromRingba(options = {}) {
  const { accountID, apiToken, baseUrl, startDate, endDateTimeIso } = options;
  const windowData =
    startDate && endDateTimeIso
      ? { startDate, endDateTimeIso }
      : getRollingTwoMonthWindow();

  const start = parseUTCDate(windowData.startDate);
  if (!start) {
    return { success: false, message: "Invalid startDate.", channels: [] };
  }

  const discoveryStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 4, 0, 0, 0)
  )
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const discoveryEnd =
    (typeof windowData.endDateTimeIso === "string" && windowData.endDateTimeIso.trim()) ||
    toIsoNoMs(new Date());

  const body = buildChannelDiscoveryInsightsBody(discoveryStart, discoveryEnd);

  const result = await postRingbaInsights({
    accountID,
    apiToken,
    baseUrl,
    body,
    label: "channel-discovery",
  });

  if (!result.success) {
    return { success: false, message: result.message, channels: [] };
  }

  const channels = cleanChannelDiscoveryRecords(result.records);
  console.log("StatePerformance channels discovered:", channels);

  return {
    success: true,
    channels,
    reportStart: discoveryStart,
    reportEnd: discoveryEnd,
  };
}

async function fetchStatePerformanceFromRingba(options = {}) {
  const { accountID, apiToken, reportStart, reportEnd, baseUrl, channel = null } = options;

  const body = buildStatePerformanceInsightsBody(reportStart, reportEnd, channel);
  const result = await postRingbaInsights({
    accountID,
    apiToken,
    baseUrl,
    body,
    label: channel ? `state-${channel}` : "state-total",
  });

  if (!result.success) {
    return {
      success: false,
      message: result.message,
      reportStart,
      reportEnd,
      channel,
      states: [],
    };
  }

  return {
    success: true,
    reportStart,
    reportEnd,
    channel,
    rawRecordCount: result.records.length,
    states: cleanStatePerformanceRecords(result.records),
  };
}

/**
 * Discover channels, then fetch total + per-channel state data for each day.
 */
async function fetchAllDaysStatePerformance(options = {}) {
  const { accountID, apiToken, baseUrl, startDate, endDate, endDateTimeIso } = options;
  const windowData =
    startDate && endDate && endDateTimeIso
      ? { startDate, endDate, endDateTimeIso }
      : getRollingTwoMonthWindow();

  const days = getDaysInRangeUTC(windowData.startDate, windowData.endDate);
  if (!days || days.length === 0) {
    return {
      success: false,
      channels: [],
      days: [],
      summary: {
        daysFetched: 0,
        channelsDiscovered: 0,
        failedDays: [],
        failedChannelDays: [],
        message: "Invalid or empty date range.",
      },
    };
  }

  const channelResult = await listChannelsFromRingba({
    accountID,
    apiToken,
    baseUrl,
    startDate: windowData.startDate,
    endDateTimeIso: windowData.endDateTimeIso,
  });

  if (!channelResult.success) {
    return {
      success: false,
      channels: [],
      days: [],
      summary: {
        daysFetched: 0,
        channelsDiscovered: 0,
        failedDays: [],
        failedChannelDays: [],
        message: channelResult.message,
      },
    };
  }

  const channels = channelResult.channels;
  const daysPayload = [];
  const failedDays = [];
  const failedChannelDays = [];

  for (const dayEntry of days) {
    const { reportStart, reportEnd } = dayEntry.isToday
      ? {
          reportStart: new Date(
            Date.UTC(
              dayEntry.date.getUTCFullYear(),
              dayEntry.date.getUTCMonth(),
              dayEntry.date.getUTCDate(),
              4,
              0,
              0,
              0
            )
          )
            .toISOString()
            .replace(/\.\d{3}Z$/, "Z"),
          reportEnd: windowData.endDateTimeIso,
        }
      : getRingbaDayWindow(dayEntry.date);

    const totalResult = await fetchStatePerformanceFromRingba({
      accountID,
      apiToken,
      baseUrl,
      reportStart,
      reportEnd,
      channel: null,
    });

    const channelDayData = [];
    for (const channel of channels) {
      const chResult = await fetchStatePerformanceFromRingba({
        accountID,
        apiToken,
        baseUrl,
        reportStart,
        reportEnd,
        channel,
      });

      channelDayData.push({
        channel,
        success: chResult.success,
        states: chResult.states || [],
        message: chResult.message,
      });

      if (!chResult.success) {
        failedChannelDays.push({
          day: dayEntry.day,
          channel,
          message: chResult.message,
        });
      }
    }

    const daySuccess = totalResult.success && channelDayData.every((c) => c.success);
    if (!totalResult.success) {
      failedDays.push(dayEntry.day);
    }

    const dayData = {
      day: dayEntry.day,
      dateIso: dayEntry.dateIso,
      reportStart,
      reportEnd,
      success: daySuccess,
      total: {
        success: totalResult.success,
        states: totalResult.states || [],
        message: totalResult.message,
      },
      channels: channelDayData,
    };

    console.log("StatePerformance day:", {
      day: dayData.day,
      totalStates: dayData.total.states.length,
      channels: channelDayData.map((c) => ({ channel: c.channel, stateCount: c.states.length })),
    });

    daysPayload.push(dayData);
  }

  const payload = {
    success: daysPayload.every((d) => d.success),
    channels,
    days: daysPayload,
    summary: {
      daysFetched: daysPayload.length,
      channelsDiscovered: channels.length,
      totalStateRows: daysPayload.reduce((sum, d) => sum + d.total.states.length, 0),
      failedDays,
      failedChannelDays,
    },
  };

  console.log("StatePerformance fetch complete:", payload.summary);

  return payload;
}

module.exports = {
  CAMPAIGN_NAME,
  getRollingTwoMonthWindow,
  getDaysInRangeUTC,
  getRingbaDayWindow,
  buildStatePerformanceInsightsBody,
  buildChannelDiscoveryInsightsBody,
  cleanStatePerformanceRecords,
  cleanChannelDiscoveryRecords,
  listChannelsFromRingba,
  fetchStatePerformanceFromRingba,
  fetchAllDaysStatePerformance,
};