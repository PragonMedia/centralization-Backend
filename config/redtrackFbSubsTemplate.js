/**
 * Canonical subs array for all FB (Facebook) RedTrack traffic channels.
 * Order and field values must match exactly — do not reorder.
 */
const FB_TRAFFIC_CHANNEL_SUBS = [
  { value: "{{ad.id}}", alias: "ad_id", hint: "ad_id" },
  { value: "{{adset.id}}", alias: "ad_group_id", hint: "adset_id" },
  { value: "{{campaign.id}}", alias: "campaign_id", hint: "campaign_id" },
  { value: "{{ad.name}}", alias: "ad_name", hint: "ad_name" },
  { value: "{{adset.name}}", alias: "ad_group_name", hint: "adset_name" },
  { value: "{{campaign.name}}", alias: "campaign_name", hint: "campaign_name" },
  { value: "{{placement}}", alias: "placement", hint: "Placement" },
  { value: "{{site_source_name}}", alias: "site_source_name", hint: "Site source name" },
  {
    value: "facebook",
    alias: "utm_source",
    hint: "UTM source",
    role: "rt_source",
  },
  {
    value: "paid",
    alias: "utm_medium",
    hint: "UTM medium",
    role: "rt_medium",
  },
  { value: "", alias: "fbclid", hint: "Facebook click ID" },
  { value: "" },
  { value: "" },
  { value: "" },
  { value: "" },
  { value: "" },
  { value: "{TRAFFIC CHANNEL}", alias: "channel" },
  { value: "{YOUR INITIALS}", alias: "mb" },
  { value: "{AD ACCOUNT NAME}", alias: "account" },
  { value: "" },
];

module.exports = { FB_TRAFFIC_CHANNEL_SUBS };
