# Google Conversion Live Endpoint Handoff

This document is for another Cursor instance to implement the same working Google conversion webhook flow in the live system.

## Objective

Implement a webhook endpoint that receives Ringba conversion data and uploads offline click conversions to Google Ads API.

We are intentionally using **manager-level conversion customer** IDs for now.

---

## Current Working Behavior (from local test)

- Upload flow works with:
  - `googleCustomerId = 4316986825` (hardcoded)
  - `loginCustomerId / MccCustomerID = 4316986825` (hardcoded)
  - `conversionActionId` provided by payload
  - click id from payload (`gclid` preferred, fallback `gbraid`, then `wbraid`)
- `conversionValue` and `currencyCode` are hardcoded server-side:
  - `conversion_value = 1`
  - `currency_code = "USD"`

---

## Endpoint Contract (Ringba -> API)

### HTTP

- Method: `POST`
- Content-Type: `application/json`

### Route

- `/webhooks/ringba/google-conversion`

### Payload accepted from Ringba

```json
{
  "conversionActionId": "7559018081",
  "conversionDateTime": "2026-04-28 11:30:00+00:00",
  "gclid": "....",
  "gbraid": "...",
  "wbraid": "..."
}
```

Notes:

- `conversionDateTime` is optional; if missing, backend should use current server time in Google format.
- Ringba may send all 3 click IDs; backend should use one in this priority:
  1. `gclid`
  2. `gbraid`
  3. `wbraid`

---

## Hardcoded Values (for now)

Use these in backend (do not require in payload):

- `googleCustomerId = "4316986825"`
- `loginCustomerId = "4316986825"`
- `conversion_value = 1`
- `currency_code = "USD"`

---

## Required Google Env Vars

- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_REFRESH_TOKEN`
- optional:
  - `GOOGLE_ADS_VALIDATE_ONLY` (`0` for live)
  - `GOOGLE_ADS_DRY_RUN` (`0` for live)

---

## Upload Logic

1. Parse payload JSON.
2. Resolve click identifier:
   - if none found, return `400`.
3. Resolve `conversionActionId` from payload:
   - if missing/invalid, return `400`.
4. Resolve `conversionDateTime`:
   - use payload value if present, else current time.
5. Build conversion action resource:
   - `customers/{googleCustomerId}/conversionActions/{conversionActionId}`
6. Upload via `ConversionUploadService.UploadClickConversions` with:
   - `customer_id = googleCustomerId`
   - `login_customer_id = loginCustomerId`
   - `partial_failure = true`
   - `validate_only` from env
7. Return:
   - success: `200 { ok: true, uploaded: true, ... }`
   - partial failure: `500 { ok: false, error: "google upload partial failure", details: ... }`

---

## Known Operational Notes

1. Account/action/click alignment still matters.
   - If Google returns `click ... associated with different account`, then click did not originate in expected account context.
2. If Google returns permission error:
   - OAuth refresh token user lacks access for chosen manager/customer context.
3. We observed manager-level conversion account behavior in this org.
   - That is why hardcoded base manager IDs worked consistently.

---

## Recommended Improvements (optional)

1. Decode Google partial-failure protobuf details into plain text for easier debugging.
2. Add explicit request logging (masked IDs) to trace:
   - conversionActionId
   - selected click id type
   - upload customer/login customer pair
3. Re-introduce explicit unique event ID support later if multi-fire per click is required.

---

## Quick Smoke Test Payload

```json
{
  "conversionActionId": "7559018081",
  "gclid": "REAL_CLICK_ID_HERE"
}
```

---

## Success Criteria

- Endpoint returns `200 ok` for valid payloads and uploads.
- Conversion appears in Google Ads conversion diagnostics/reporting with normal delay.
- No dependency on Ringba passing customer/manager IDs for phase 1.
