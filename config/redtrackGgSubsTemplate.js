/**
 * Canonical subs array for all GG (Google) RedTrack traffic channels.
 * Order and field values must match exactly — do not reorder.
 */
const GG_TRAFFIC_CHANNEL_SUBS = [
  { value: "{CAMPAIGNNAME}", alias: "campaign_name", hint: "Сampaign name" },
  { value: "{keyword}", alias: "keyword", hint: "Bidded keyword" },
  { value: "{matchtype}", alias: "match_type", hint: "Keyword match type" },
  { value: "{adgroupid}", alias: "ad_group_id", hint: "Ad group ID" },
  { value: "{creative}", alias: "ad_id", hint: "Creative ID" },
  { value: "{campaignid}", alias: "campaign_id", hint: "Campaign ID" },
  { value: "{device}", alias: "device_type", hint: "Device type" },
  { value: "{adposition}", alias: "ad_position", hint: "Ad position" },
  { value: "{network}", alias: "network", hint: "Network type" },
  { value: "{placement}", alias: "placement", hint: "Website placement" },
  {
    value: "Google",
    alias: "utm_source",
    hint: "Source",
    role: "rt_source",
  },
  { value: "{wbraid}", alias: "wbraid" },
  { value: "{gbraid}", alias: "gbraid" },
  { value: "" },
  { value: "" },
  { value: "" },
  { value: "{TRAFFICCHANNEL}", alias: "channel" },
  { value: "{YOURINITIALS}", alias: "mb" },
  { value: "{AD ACCOUNT NAME}", alias: "account" },
  { value: "" },
];

module.exports = { GG_TRAFFIC_CHANNEL_SUBS };
