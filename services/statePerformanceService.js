/**
 * State Performance service – Ringba Insights by US state, total + per-channel.
 * Filters: qualified=yes, Paragon - Medicare. Channel filter optional per request.
 */
const axios = require("axios");
const RINGBA_CONFIG = require("../config/ringbaApi");

const DEFAULT_BASE_URL = (RINGBA_CONFIG.BASE_URL || "https://api.ringba.com").replace(/\/$/, "");
const STATE_WEEKS_COUNT = 8;
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
 * Build Insights body grouped by state. channel=null → total (all channels).
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

function formatWeekLabelDate(d) {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const y = d.getUTCFullYear();
  return `${m}/${day}/${y}`;
}

function getWeekStartMonday(utcDate) {
  const d = new Date(
    Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate())
  );
  const dayOfWeek = d.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  d.setUTCHours(4, 0, 0, 0);
  return d;
}

function buildWeekWindow(weekStartMonday) {
  const reportStart = weekStartMonday.toISOString().replace(/\.\d{3}Z$/, "Z");
  const weekEnd = new Date(weekStartMonday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  weekEnd.setUTCHours(3, 59, 59, 0);
  const reportEnd = weekEnd.toISOString().replace(/\.\d{3}Z$/, "Z");

  const labelStart = new Date(weekStartMonday);
  labelStart.setUTCHours(0, 0, 0, 0);
  const labelEnd = new Date(labelStart);
  labelEnd.setUTCDate(labelEnd.getUTCDate() + 6);

  return {
    reportStart,
    reportEnd,
    weekLabel: `${formatWeekLabelDate(labelStart)} - ${formatWeekLabelDate(labelEnd)}`,
  };
}

function getStatePerformanceWeekWindows(count = STATE_WEEKS_COUNT) {
  const now = new Date();
  const currentWeekStart = getWeekStartMonday(now);
  const mostRecentCompletedWeekStart = new Date(currentWeekStart);
  mostRecentCompletedWeekStart.setUTCDate(mostRecentCompletedWeekStart.getUTCDate() - 7);

  const weeks = [];
  for (let i = count - 1; i >= 0; i--) {
    const weekStart = new Date(mostRecentCompletedWeekStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - i * 7);
    weeks.push(buildWeekWindow(weekStart));
  }
  return weeks;
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
      timeout: 20000,
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
      data: data != null ? (typeof data === "string" ? data : JSON.stringify(data).slice(0, 500)) : undefined,
    });
    return {
      success: false,
      message: error.message || "Ringba request failed",
      records: [],
    };
  }
}

/**
 * Discover channels over the full refresh window (all 8 weeks).
 */
async function listChannelsFromRingba(options = {}) {
  const { accountID, apiToken, baseUrl, weekCount = STATE_WEEKS_COUNT } = options;
  const windows = getStatePerformanceWeekWindows(weekCount);
  if (windows.length === 0) {
    return { success: false, message: "No week windows.", channels: [] };
  }

  const reportStart = windows[0].reportStart;
  const reportEnd = windows[windows.length - 1].reportEnd;
  const body = buildChannelDiscoveryInsightsBody(reportStart, reportEnd);

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
    reportStart,
    reportEnd,
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

  const states = cleanStatePerformanceRecords(result.records);

  return {
    success: true,
    reportStart,
    reportEnd,
    channel,
    rawRecordCount: result.records.length,
    states,
  };
}

/**
 * Discover channels, then fetch total + per-channel state data for each week.
 */
async function fetchAllWeeksStatePerformance(options = {}) {
  const { accountID, apiToken, baseUrl, weekCount = STATE_WEEKS_COUNT } = options;
  const windows = getStatePerformanceWeekWindows(weekCount);

  const channelResult = await listChannelsFromRingba({
    accountID,
    apiToken,
    baseUrl,
    weekCount,
  });

  if (!channelResult.success) {
    return {
      success: false,
      channels: [],
      weeks: [],
      summary: {
        weeksFetched: 0,
        channelsDiscovered: 0,
        failedWeeks: [],
        failedChannelWeeks: [],
        message: channelResult.message,
      },
    };
  }

  const channels = channelResult.channels;
  const weeks = [];
  const failedWeeks = [];
  const failedChannelWeeks = [];

  for (const window of windows) {
    const totalResult = await fetchStatePerformanceFromRingba({
      accountID,
      apiToken,
      baseUrl,
      reportStart: window.reportStart,
      reportEnd: window.reportEnd,
      channel: null,
    });

    const channelWeekData = [];
    for (const channel of channels) {
      const channelResult = await fetchStatePerformanceFromRingba({
        accountID,
        apiToken,
        baseUrl,
        reportStart: window.reportStart,
        reportEnd: window.reportEnd,
        channel,
      });

      channelWeekData.push({
        channel,
        success: channelResult.success,
        states: channelResult.states || [],
        message: channelResult.message,
      });

      if (!channelResult.success) {
        failedChannelWeeks.push({
          weekLabel: window.weekLabel,
          channel,
          message: channelResult.message,
        });
      }
    }

    const weekSuccess = totalResult.success && channelWeekData.every((c) => c.success);
    if (!totalResult.success) {
      failedWeeks.push(window.weekLabel);
    }

    const weekData = {
      weekStart: window.reportStart,
      weekEnd: window.reportEnd,
      weekLabel: window.weekLabel,
      success: weekSuccess,
      total: {
        success: totalResult.success,
        states: totalResult.states || [],
        message: totalResult.message,
      },
      channels: channelWeekData,
    };

    console.log("StatePerformance week:", {
      weekLabel: weekData.weekLabel,
      totalStates: weekData.total.states.length,
      channels: channelWeekData.map((c) => ({ channel: c.channel, stateCount: c.states.length })),
    });

    weeks.push(weekData);
  }

  const payload = {
    success: weeks.every((w) => w.success),
    channels,
    weeks,
    summary: {
      weeksFetched: weeks.length,
      channelsDiscovered: channels.length,
      totalStateRows: weeks.reduce((sum, w) => sum + w.total.states.length, 0),
      failedWeeks,
      failedChannelWeeks,
    },
  };

  console.log("StatePerformance fetch complete:", payload.summary);

  return payload;
}

module.exports = {
  STATE_WEEKS_COUNT,
  CAMPAIGN_NAME,
  buildStatePerformanceInsightsBody,
  buildChannelDiscoveryInsightsBody,
  getStatePerformanceWeekWindows,
  cleanStatePerformanceRecords,
  cleanChannelDiscoveryRecords,
  listChannelsFromRingba,
  fetchStatePerformanceFromRingba,
  fetchAllWeeksStatePerformance,
};
