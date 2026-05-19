# Roku Ads API reference (captured from OpenAPI)

Source: [developer.ads.roku.com](https://developer.ads.roku.com/ads/reference/get_campaign) embedded OpenAPI (beta v1.0).

**Base URL:** `https://api.ads.roku.com/v1`  
**Auth:** `Authorization: Bearer {access_token}` (JWT-style bearer from `/developer/token`)

This is separate from **Conversions API (CAPI)** at `https://events.ads.rokuapi.net/v1/events`.

## Authentication

`POST /developer/token`

| grant_type | Body fields |
|------------|-------------|
| `authorization_code` | `client_id`, `client_secret`, `code`, `redirect_uri` |
| `refresh_token` | `client_id`, `client_secret`, `refresh_token` |

Response includes `access_token`, `refresh_token`, `expires_in` (seconds).

## Organizations and ad accounts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/developer/organizations` | List organizations. Query `include=accounts` to embed ad accounts. |
| GET | `/developer/organizations/{uid}` | Get one organization. Optional `include=accounts`. |
| GET | `/developer/accounts` | List all ad accounts (`limit`, `offset`, `organization_uid`). |
| GET | `/developer/accounts/{uid}` | Get one ad account. |

Account resource (`type: account`): `uid`, `attributes.name`, `attributes.organization_uid`, `attributes.currency`, `attributes.timezone`, etc.

## Async reports (spend)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/developer/reports` | Create one or more async reports. |
| GET | `/developer/reports/{uid}` | Get report metadata. |
| GET | `/developer/reports/{uid}/status` | Poll status; when `done`, `attributes.download_url` points to CSV. |

### Create report body (JSON:API style)

```json
{
  "data": [
    {
      "type": "report",
      "attributes": {
        "name": "Paragon spend report",
        "metrics": ["spend", "impressions"],
        "dimensions": ["account_id", "account_name", "date"],
        "filters": [{ "metric": "account_uid", "value": "<optional-account-uid>" }],
        "start_at": "2026-05-04T00:00:00Z",
        "end_at": "2026-05-08T23:59:59Z"
      }
    }
  ]
}
```

### Metrics (enum)

`spend`, `impressions`, `cpm`, `cpcv`, `cpa`, `cpur`, `roas`, `actions`, `household_reach`, `household_frequency`, `vcr`, `order_value`, `total_unique_actions`, video completion metrics, etc.

### Dimensions (enum)

`account_id`, `account_name`, `campaign_id`, `campaign_name`, `date`, `week`, `month`, `year`, `hour`, and others.

### Report status

`attributes.status`: `pending` | `running` | `done` | `error`

## Sample responses (shapes)

**List accounts (200):**

```json
{
  "data": [
    {
      "type": "account",
      "uid": "abc123",
      "attributes": {
        "name": "My Ad Account",
        "organization_uid": "org456",
        "currency": "USD"
      }
    }
  ],
  "meta": { "count": 1, "total_count": 1 }
}
```

**Create report (201):**

```json
{
  "data": [
    {
      "type": "report",
      "uid": "report-uid-789",
      "attributes": { "name": "...", "status": "pending" }
    }
  ]
}
```

**Report status when done (200):**

```json
{
  "data": {
    "type": "report_status",
    "uid": "report-uid-789",
    "attributes": {
      "status": "done",
      "download_url": "https://..."
    }
  }
}
```

## Env vars (Paragon BE)

See `.env.example` — `ROKU_ADS_CLIENT_ID`, `ROKU_ADS_CLIENT_SECRET`, `ROKU_ADS_REFRESH_TOKEN` (or short-lived `ROKU_ADS_ACCESS_TOKEN`).

## Developer app roles (important)

`GET /developer/permissions` shows which roles your OAuth app has per ad account.

| Ad account role | Spend reports API |
|-----------------|-------------------|
| **Campaign manager** / **Account admin** | Recommended — can create async reports |
| **Viewer** | May create reports in UI; API jobs sometimes stay `running` forever |
| **Audience Manager** | **No** — custom audiences only; `GET /developer/accounts` is empty and `POST /developer/reports` returns `403 readAccessDenied` |

Do **not** assign **Audience Manager** if you need spend. After changing roles, **re-run OAuth** (new refresh token) so permissions match.

If every account is **Viewer** only, async reports often stay **`running`** forever. Grant **Campaign manager** or **Account admin** on the developer app per account, then re-authorize.

## UI validation

Compare `GET /api/v1/roku/spend?start=YYYY-MM-DD&end=YYYY-MM-DD` totals to Ads Manager → Reports for the same date range and accounts.
