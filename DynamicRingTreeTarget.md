# Dynamic Ring Tree Target — Full System Documentation

> **Purpose:** Automatically move Ringba Ring Tree Targets (RTTs) between FE Tier 1 / Tier 2 / Tier 3 based on RPC (Revenue Per Call), computed from completed-call pixel data.
>
> **Main file:** `dynamicRingTreeTarget.js`
>
> **Last updated:** June 2026
>
> **Status:** Pixel ingest server built. **Dry-run ON by default.** Live tier moves (`DELETE` + `PATCH`/`POST`) implemented but need production validation (Phase C).

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Project History & Design Decisions](#project-history--design-decisions)
3. [Ringba Concepts](#ringba-concepts)
4. [Account & Ring Tree IDs](#account--ring-tree-ids)
5. [Business Rules](#business-rules)
6. [Architecture](#architecture)
7. [End-to-End Flow](#end-to-end-flow)
8. [Ringba Pixel Setup (Manual)](#ringba-pixel-setup-manual)
9. [HTTP Server API](#http-server-api)
10. [State & Persistence](#state--persistence)
11. [Dedup Logic](#dedup-logic)
12. [RPC Calculation](#rpc-calculation)
13. [Tier Assignment & Hysteresis](#tier-assignment--hysteresis)
14. [Tier Move Logic (Ringba API)](#tier-move-logic-ringba-api)
15. [Environment Variables](#environment-variables)
16. [Running the Server](#running-the-server)
17. [Testing Guide](#testing-guide)
18. [Deployment Notes](#deployment-notes)
19. [Exported Functions (for unit tests)](#exported-functions-for-unit-tests)
20. [Code Structure & Key Functions](#code-structure--key-functions)
21. [Known Limitations & Open Items](#known-limitations--open-items)
22. [Troubleshooting](#troubleshooting)
23. [Related Repo Files](#related-repo-files)

---

## Executive Summary

This system replaces the original **calllogs polling** approach (`POST /calllogs` bulk fetch every run) with a **real-time pixel ingest** model:

1. Ringba fires a **tracking pixel** on **Call Completed** for every completed call.
2. Our Node.js HTTP server receives `targetName`, `callId`, `callerPhone`, and `revenue`.
3. We accumulate **15 unique callers** per target (non-overlapping batches).
4. On the 15th unique caller, we:
   - Compute RPC = `sum(revenue) / 15` (zeros count)
   - `GET /pingtrees` to find where the target currently lives (`id`, tier, pingTreeId)
   - Decide desired tier from RPC + hysteresis
   - If move needed: `DELETE` from source ring tree, `PATCH`/`POST` add to destination
5. **Clear the batch** — next call starts a fresh batch of 15.

**No authentication** on the pixel endpoint (explicit user decision).

**Dry-run is default** — moves are logged + Slack alert, but Ringba write APIs are not called unless `DYNAMIC_RING_TREE_DRY_RUN=false`.

---

## Project History & Design Decisions

### Phase 1 (replaced): Calllogs polling

Original `dynamicRingTreeTarget.js` used:

- `GET /pingtrees?includeStats=true` — list ring trees + targets
- `POST /calllogs` — bulk fetch last 15 calls per target (10-day window)
- RPC = sum of `conversionAmount` ÷ 15
- Dry-run tier plan output to `dynamic-ring-tree-dry-run.json`

**Problems at scale:**

- Calllogs rate limits: ~5/min, ~20/hour
- ~10 calllogs pages per full run (~2+ minutes)
- Running every 10 minutes would hit rate limits hard with 400+ targets

### Phase 2 (current): Pixel ingest

User chose webhook/pixel approach:

| Decision        | Choice                                                |
| --------------- | ----------------------------------------------------- |
| Data source     | Ringba tracking pixel on **Completed** calls          |
| RPC sample      | **15 unique callers** per batch (not rolling window)  |
| Revenue         | Whatever pixel sends at Completed; **0 is valid**     |
| Batch storage   | **Clear after eval** — do not keep finished batches   |
| Dedup           | By `callId` (retries) + by `callerPhone` within batch |
| Pingtrees pull  | **Every time a target hits 15** (fresh `id` + tier)   |
| Auth on pixel   | **None** (no secret token)                            |
| Move timing     | On batch complete (15th unique caller)                |
| Hysteresis      | Yes — prevent thrashing at 20/30 boundaries           |
| Move cooldown   | 30 min default between moves per target               |
| Dry-run default | `true`                                                |

### Explicitly NOT doing

- Hourly calllogs reconciliation (user chose pixel revenue as final)
- Long-term call history database
- Rolling 15-call window (using reset batches instead)
- Secret/token on pixel URL

---

## Ringba Concepts

### Ring Tree (Ping Tree)

A **Ring Tree** is a routing tier container. We only care about three:

| Name        | Role                |
| ----------- | ------------------- |
| FE - Tier 1 | Highest RPC targets |
| FE - Tier 2 | Mid RPC targets     |
| FE - Tier 3 | Lowest RPC targets  |

### Ring Tree Target (RTT)

Each **target inside a ring tree** is a separate RTT instance with its own `id`, even if the logical buyer name is the same.

**Critical:** Moving between tiers is NOT a single "move" API. It requires:

1. **Remove** from source tree: `DELETE /{accountId}/pingtrees/{ringTreeId}/Targets/{targetId}`
2. **Add** to destination tree: `PATCH /{accountId}/pingtrees/{destRingTreeId}/Targets` (or `POST /pingtreetargets` fallback)

Ringba may **duplicate** the RTT when adding to another tree — new `id` in the new tier.

### Tracking Pixel vs Webhook

| Feature                | Direction               | Use                 |
| ---------------------- | ----------------------- | ------------------- |
| **Tracking Pixel**     | Ringba → your server    | ✅ What we use      |
| **Conversion Webhook** | External buyer → Ringba | ❌ Not this project |

Pixels are configured under **Integrations → Pixels** and attached per **Campaign → Tracking Pixels**.

### Pixel trigger: Completed

**Completed** = call finished after connecting to a target.

**Not used:** Incoming, Connected, Converted, Payout.

**Known tradeoff:** Webhook/RTB targets often report `revenue=0` at Completed because buyer postback arrives later. User accepted this — no reconciliation.

---

## Account & Ring Tree IDs

| Item            | Value                                     |
| --------------- | ----------------------------------------- |
| **Account ID**  | `RA417e311c6e8b47538624556e6e84298a`      |
| **API base**    | `https://api.ringba.com/v2`               |
| **Auth header** | `Authorization: Token {RINGBA_API_TOKEN}` |

### FE Ring Tree IDs (from `sample.json` — verify live via pingtrees)

| Ring Tree Name | Ping Tree ID                         |
| -------------- | ------------------------------------ |
| FE - Tier 1    | `PI943e1abfb7c84cbdbdf12b5fed5db525` |
| FE - Tier 2    | `PIfd7e2f930c1943dda25f3cfc290c1d9c` |
| FE - Tier 3    | `PId770038dc60d4aef9d2a735a629b1fca` |

### Scale reference (from prior calllogs runs)

- ~76–77 **enabled** targets across FE Tier 1–3
- ~400+ targets total account (only FE tiers are managed)
- ~8,000–10,000 calls/day account-wide

---

## Business Rules

### Tier assignment (raw, no hysteresis)

| RPC               | Destination Tier |
| ----------------- | ---------------- |
| **≥ 30**          | FE - Tier 1      |
| **≥ 20 and < 30** | FE - Tier 2      |
| **< 20**          | FE - Tier 3      |

Boundary examples:

- RPC `30.00` → Tier 1
- RPC `20.00` → Tier 2
- RPC `0` → Tier 3 (valid — includes calls with no revenue)

### Batch model

- **Non-overlapping batches** of 15 unique callers
- Batch 1: callers 1–15 → eval → **clear**
- Batch 2: callers 16–30 (as new unique callers arrive) → eval → **clear**
- NOT a rolling/FIFO window

### When to move

Move only if ALL true:

1. `desiredTier !== currentTier` (after hysteresis)
2. Target found in FE Tier 1/2/3 via pingtrees
3. Not in move cooldown (`lastMoveAt` + `MOVE_COOLDOWN_MS`)
4. Destination ping tree ID exists
5. Not dry-run (or dry-run logs only)

### Scope

- Only targets whose `targetName` appears in **FE - Tier 1**, **FE - Tier 2**, or **FE - Tier 3**
- Only **enabled** targets (filtered from pingtrees response)
- Pixel hits for unknown target names → eval skipped (`target_not_in_fe_tiers`)

---

## Architecture

```mermaid
flowchart TB
  subgraph ringba [Ringba]
    CALL[Completed Call]
    PIXEL[Tracking Pixel GET]
    PT[GET /pingtrees]
    DEL[DELETE target from tree]
    ADD[PATCH/POST target to tree]
  end

  subgraph server [dynamicRingTreeTarget.js]
    INGEST[/ringba/tier-rpc]
    STATE[(dynamic-ring-tree-state.json)]
    EVENTS[(dynamic-ring-tree-events.jsonl)]
    EVAL[evaluateBatchMove]
    QUEUE[evalQueue + targetLocks]
  end

  subgraph notify [Optional]
    SLACK[Slack webhook]
  end

  CALL --> PIXEL --> INGEST
  INGEST --> STATE
  INGEST --> EVENTS
  INGEST -->|15 unique callers| QUEUE --> EVAL
  EVAL --> PT
  EVAL --> DEL
  EVAL --> ADD
  EVAL --> SLACK
  EVAL --> EVENTS
```

### Concurrency

- **Per-target lock** (`targetLocks` Map) — prevents race if two calls complete simultaneously for same target
- **Eval queue** — batch complete triggers async eval; HTTP response returns 200 immediately
- **State file** — read/write on each pixel hit + after eval

---

## End-to-End Flow

```
1. Call completes on FE-tier campaign
2. Ringba fires GET pixel:
   /ringba/tier-rpc?callId=...&targetName=...&callerPhone=...&revenue=...

3. Server: parse params
4. Server: load state from dynamic-ring-tree-state.json

5. Dedup checks:
   - callId already in seenCallIds for this target? → skip (duplicate_call_id)
   - callerPhone already in current batch? → skip (duplicate_caller_in_batch)

6. Append call to batch:
   { callId, callerPhone, revenue, receivedAt }

7. If batch.length < 15:
   - Save state
   - Return { status: "accumulating", batchSize: N }
   - DONE

8. If batch.length === 15:
   - Copy batch for eval
   - Clear batch + seenCallIds (fresh start for call 16+)
   - Save state
   - Compute RPC = sum(revenue) / 15
   - Queue async evaluateBatchMove job
   - Return { status: "batch_complete", rpc: X }
   - DONE (HTTP returns before eval finishes)

9. evaluateBatchMove (background):
   a. GET /pingtrees?includeStats=true
   b. Extract FE Tier 1/2/3 targets → map targetName → { id, currentTier, currentPingTreeId }
   c. Lookup target by targetName from pixel
   d. rawTier = getRawTierFromRpc(rpc)
   e. desiredTier = getDesiredTierWithHysteresis(rpc, currentTier)
   f. If desiredTier === currentTier → log eval_no_move, DONE
   g. If move cooldown active → log eval_skipped (move_cooldown), DONE
   h. If DRY_RUN → log dry_run_move + Slack, DONE
   i. Live move:
      - GET /pingtreetargets/{id} (config snapshot)
      - DELETE /pingtrees/{currentPingTreeId}/Targets/{targetId}
      - PATCH /pingtrees/{desiredPingTreeId}/Targets (try 3 body formats)
      - If PATCH fails → POST /pingtreetargets (clone config with new pingTreeId)
      - Update lastMoveAt[targetName]
      - Slack alert
      - Log move_completed or move_failed
```

---

## Ringba Pixel Setup (Manual)

### Step 1: Create reusable pixel

**Path:** `Integrations → Pixels → Create Pixel`

| Setting             | Value                            |
| ------------------- | -------------------------------- |
| **Name**            | `FE Tier RPC Tracker` (any name) |
| **Trigger / Event** | **Completed**                    |
| **HTTP method**     | **GET**                          |
| **POST pixel**      | Off                              |

### Step 2: Pixel URL

Replace `YOUR-PUBLIC-HOST` with your deployed server (ngrok, VPS, etc.):

```
https://YOUR-PUBLIC-HOST/ringba/tier-rpc?callId=[Call:InboundCallId]&targetName=[tag:Target:Name]&callerPhone=[tag:InboundNumber:Number]&revenue=[Call:ConversionAmount]
```

**Use Ringba Token button** to insert macros — do not guess token syntax.

| Query Param   | Ringba Token                 | Required |
| ------------- | ---------------------------- | -------- |
| `callId`      | `[Call:InboundCallId]`       | Yes      |
| `targetName`  | `[tag:Target:Name]`          | Yes      |
| `callerPhone` | `[tag:InboundNumber:Number]` | Yes      |
| `revenue`     | `[Call:ConversionAmount]`    | Yes      |

Optional debug params (not required):

```
&targetId=[tag:Target:Id]&campaignName=[tag:Campaign:Name]
```

**No `token=` param** — auth intentionally omitted.

### Step 3: Attach pixel to campaigns

For **each campaign** that routes through FE Tier 1, 2, or 3:

**Path:** `Campaigns → [campaign] → Tracking Pixels → Add Pixel → Select Existing → FE Tier RPC Tracker`

Skip campaigns that do not use these ring trees.

### Step 4: Verify pixel fires

After a test call, Ringba pixel log should show **HTTP 200** from your server.

---

## HTTP Server API

**Default port:** `3456`  
**Bind:** `0.0.0.0` (all interfaces)

### `GET /health`

Health check.

**Response 200:**

```json
{
  "ok": true,
  "service": "dynamic-ring-tree-target",
  "dryRun": true,
  "batchSize": 15,
  "feTiers": ["FE - Tier 1", "FE - Tier 2", "FE - Tier 3"]
}
```

---

### `GET /status`

Debug: current open batches and move cooldowns.

**Response 200:**

```json
{
  "dryRun": true,
  "targetCount": 1,
  "targets": [
    {
      "targetName": "FE - Some Target",
      "batchSize": 3,
      "seenCallIds": 3,
      "batch": [
        {
          "callId": "RGB...",
          "callerPhone": "15551234567",
          "revenue": 25,
          "receivedAt": "2026-06-21T19:22:00.564Z"
        }
      ]
    }
  ],
  "lastMoveAt": {
    "FE - Some Target": "2026-06-21T20:00:00.000Z"
  }
}
```

---

### `GET /ringba/tier-rpc` (primary pixel endpoint)

Also accepts: `GET /`, `POST /ringba/tier-rpc`, `POST /`

**Query parameters** (aliases supported):

| Primary       | Aliases                                           |
| ------------- | ------------------------------------------------- |
| `callId`      | `call_id`, `inboundCallId`                        |
| `targetName`  | `target_name`, `name`                             |
| `callerPhone` | `caller_phone`, `phone`, `ani`                    |
| `revenue`     | `conversionAmount`, `conversion_amount`, `payout` |

**Response — accumulating (calls 1–14):**

```json
{
  "ok": true,
  "status": "accumulating",
  "targetName": "FE - Naked Media - CTV",
  "batchSize": 7,
  "rpc": null,
  "dryRun": true
}
```

**Response — batch complete (15th unique caller):**

```json
{
  "ok": true,
  "status": "batch_complete",
  "targetName": "FE - Naked Media - CTV",
  "batchSize": 15,
  "batch": ["...15 call objects..."],
  "rpc": 37.2293,
  "dryRun": true
}
```

**Response — duplicate callId:**

```json
{
  "ok": true,
  "status": "duplicate_call_id",
  "targetName": "FE - Naked Media - CTV",
  "batchSize": 5
}
```

**Response — duplicate caller in batch:**

```json
{
  "ok": true,
  "status": "duplicate_caller_in_batch",
  "targetName": "FE - Naked Media - CTV",
  "batchSize": 5
}
```

**Response — invalid payload (400):**

```json
{
  "ok": false,
  "status": "invalid_payload",
  "message": "targetName, callId, callerPhone required"
}
```

**Note:** `batch` array is included in HTTP response on `batch_complete`. Eval runs asynchronously after response is sent.

---

### `404` — anything else

```json
{ "ok": false, "error": "not_found" }
```

---

## State & Persistence

### `dynamic-ring-tree-state.json`

Location: same directory as `dynamicRingTreeTarget.js`

**Schema:**

```json
{
  "targets": {
    "FE - Target Name Here": {
      "batch": [
        {
          "callId": "RGB123...",
          "callerPhone": "15551234567",
          "revenue": 25.5,
          "receivedAt": "2026-06-21T19:22:00.564Z"
        }
      ],
      "seenCallIds": ["RGB123..."]
    }
  },
  "lastMoveAt": {
    "FE - Target Name Here": "2026-06-21T20:00:00.000Z"
  }
}
```

| Field                       | Purpose                                                 |
| --------------------------- | ------------------------------------------------------- |
| `targets[name].batch`       | Current open batch (max 14 between evals, 0 after eval) |
| `targets[name].seenCallIds` | All callIds seen in current batch (for retry dedup)     |
| `lastMoveAt[name]`          | ISO timestamp — move cooldown tracking                  |

**After batch complete:** `batch` and `seenCallIds` reset to `[]`.

**Storage size:** ~400 targets × 14 calls × ~100 bytes ≈ under 1 MB. No finished batch history kept.

---

### `dynamic-ring-tree-events.jsonl`

Append-only audit log. One JSON object per line.

**Event types:**

| type             | When                                                |
| ---------------- | --------------------------------------------------- |
| `pixel_ingest`   | Every accepted pixel hit                            |
| `eval_no_move`   | Batch eval — stay in current tier                   |
| `eval_skipped`   | Target not in FE tiers, cooldown, missing dest tree |
| `dry_run_move`   | Would move (dry-run ON)                             |
| `move_completed` | Live move succeeded                                 |
| `move_failed`    | Live move threw error                               |

**Example lines:**

```jsonl
{"at":"2026-06-21T19:22:00.565Z","type":"pixel_ingest","status":"accumulating","targetName":"FE - Test","batchSize":1,"callId":"test-1","revenue":25}
{"at":"2026-06-21T20:00:00.000Z","type":"dry_run_move","targetName":"FE - Naked Media - CTV","targetId":"PI1e2efa7...","rpc":37.2293,"currentTier":"FE - Tier 2","desiredTier":"FE - Tier 1","action":"dry_run_move"}
```

---

### Legacy file (from old calllogs dry-run — not used by pixel server)

`dynamic-ring-tree-dry-run.json` — output from previous Phase B calllogs script. Safe to ignore or delete.

---

## Dedup Logic

Two independent dedup layers:

### Layer 1: Call ID dedup (pixel retries)

- **Key:** `callId` (Ringba `[Call:InboundCallId]`)
- **Scope:** Current batch's `seenCallIds` array
- **Behavior:** If callId already seen → return `duplicate_call_id`, do NOT increment batch
- **Why:** Ringba may retry failed pixel fires

### Layer 2: Caller phone dedup (within batch)

- **Key:** Normalized phone (digits only via `normalizePhone()`)
- **Scope:** Current batch only
- **Behavior:** If same phone already in batch → return `duplicate_caller_in_batch`
- **Cross-batch:** Same caller CAN appear in next batch (after eval clears)

### What counts toward 15

**15 unique callers** = 15 unique normalized phone numbers in the current batch (each with unique callId).

Example:

| Event             | Result                              |
| ----------------- | ----------------------------------- |
| Caller A, call-1  | Added → 1/15                        |
| Caller A, call-2  | Skipped (duplicate_caller_in_batch) |
| Callers B–O       | Added → 15/15 → batch_complete      |
| Batch cleared     |                                     |
| Caller A, call-16 | Added → 1/15 (new batch, allowed)   |

---

## RPC Calculation

```javascript
RPC = sum(revenue for each call in batch) / 15
```

- Always divide by **15**, even if some revenues are 0
- `parseRevenue()` treats null/empty/non-numeric as **0**
- Strips commas from revenue strings
- Result rounded to 4 decimal places

**Example batch:**

| Call    | Revenue               |
| ------- | --------------------- |
| 1–14    | various               |
| 15      | 10                    |
| **Sum** | 101                   |
| **RPC** | 101 / 15 = **6.7333** |

Revenue comes **only** from pixel at Completed — no calllogs backfill.

---

## Tier Assignment & Hysteresis

### Raw tier (`getRawTierFromRpc`)

```javascript
if (rpc >= 30) return "FE - Tier 1";
if (rpc >= 20) return "FE - Tier 2";
return "FE - Tier 3";
```

Constants: `RPC_TIER1_MIN = 30`, `RPC_TIER2_MIN = 20`

### Hysteresis (`getDesiredTierWithHysteresis`)

Prevents bouncing when RPC hovers near boundaries:

| Constant          | Value | Meaning                                        |
| ----------------- | ----- | ---------------------------------------------- |
| `promoteToTier1`  | 31    | Must reach 31 to promote TO Tier 1             |
| `demoteFromTier1` | 29    | Below 29 to demote FROM Tier 1                 |
| `promoteToTier2`  | 21    | Must reach 21 to promote TO Tier 2 from Tier 3 |
| `demoteFromTier2` | 19    | Below 19 to demote FROM Tier 2 to Tier 3       |

### Hysteresis examples

| RPC  | Current Tier | Raw Tier | Desired Tier | Moves?                                    |
| ---- | ------------ | -------- | ------------ | ----------------------------------------- |
| 38   | FE - Tier 3  | Tier 1   | Tier 1       | Yes ↑                                     |
| 30   | FE - Tier 2  | Tier 1   | Tier 2       | No (need 31 to promote)                   |
| 31   | FE - Tier 2  | Tier 1   | Tier 1       | Yes ↑                                     |
| 22   | FE - Tier 1  | Tier 2   | Tier 2       | Yes ↓ (22 < 29)                           |
| 29   | FE - Tier 1  | Tier 2   | Tier 1       | No (29 ≥ 29 demote threshold... stays T1) |
| 28.9 | FE - Tier 1  | Tier 2   | Tier 2       | Yes ↓                                     |
| 5    | FE - Tier 2  | Tier 3   | Tier 3       | Yes ↓                                     |
| 22   | FE - Tier 3  | Tier 2   | Tier 2       | Yes ↑ (22 ≥ 21)                           |
| 20   | FE - Tier 3  | Tier 2   | Tier 3       | No (need 21 to promote to T2)             |

`blockedByHysteresis` flag in eval = raw tier differs from current tier but hysteresis keeps target in place.

---

## Tier Move Logic (Ringba API)

### Step 1: Fetch current location

```
GET https://api.ringba.com/v2/{RINGBA_ACCOUNT_ID}/pingtrees?includeStats=true
```

Filter to `FE - Tier 1`, `FE - Tier 2`, `FE - Tier 3`. Build map:

```
targetName → { id, name, currentTier, currentPingTreeId }
```

**Important:** Lookup is by `targetName` string. If duplicate names exist across tiers (rare), last one in iteration wins — watch for this.

### Step 2: Remove from source tree

```
DELETE https://api.ringba.com/v2/{RINGBA_ACCOUNT_ID}/pingtrees/{currentPingTreeId}/Targets/{targetId}
```

Headers: `Authorization: Token {API_TOKEN}`

### Step 3: Add to destination tree

**Try PATCH first** (3 body format attempts):

```
PATCH https://api.ringba.com/v2/{RINGBA_ACCOUNT_ID}/pingtrees/{desiredPingTreeId}/Targets
```

Attempt bodies (in order):

```json
{ "targetIds": ["PI...sourceTargetId"] }
{ "targets": [{ "id": "PI...sourceTargetId" }] }
{ "ids": ["PI...sourceTargetId"] }
```

**Fallback if all PATCH fail:**

1. `GET /pingtreetargets/{sourceTargetId}` — full RTT config
2. Clone config, set `pingTreeId` to destination, strip `id`/`version`/`accountId`
3. `POST /pingtreetargets` — create new RTT in destination tree

### Move cooldown

Default: **30 minutes** (`MOVE_COOLDOWN_MS = 1800000`)

After a successful live move, `lastMoveAt[targetName]` is set. Eval skips move if within cooldown even if RPC says move.

---

## Environment Variables

Add to `.env` in project root:

| Variable                             | Required        | Default            | Description                                |
| ------------------------------------ | --------------- | ------------------ | ------------------------------------------ |
| `RINGBA_ACCOUNT_ID`                  | Yes (for moves) | —                  | e.g. `RA417e311c6e8b47538624556e6e84298a`  |
| `RINGBA_API_TOKEN`                   | Yes (for moves) | —                  | Ringba API token                           |
| `SLACK_WEBHOOK_URL`                  | No              | —                  | Slack alerts on move/dry-run move          |
| `DYNAMIC_RING_TREE_PORT`             | No              | `3456`             | HTTP server port                           |
| `PORT`                               | No              | —                  | Fallback if `DYNAMIC_RING_TREE_PORT` unset |
| `DYNAMIC_RING_TREE_DRY_RUN`          | No              | `true`             | Set to `false` for live moves              |
| `DYNAMIC_RING_TREE_MOVE_COOLDOWN_MS` | No              | `1800000` (30 min) | Min ms between moves per target            |

**Dry-run logic:**

```javascript
DRY_RUN = process.env.DYNAMIC_RING_TREE_DRY_RUN ?? "true" !== "false";
// Anything other than literal "false" → dry-run ON
```

---

## Running the Server

### Install dependencies

```bash
npm install
```

Dependencies used: `axios`, `dotenv` (see `package.json`). No Express — uses Node built-in `http`.

### Start

```bash
npm run dynamicRingTreeTarget
# or
node dynamicRingTreeTarget.js
```

### Console output on start

```
dynamicRingTreeTarget — pixel ingest server
  listening on http://0.0.0.0:3456
  pixel URL path: /ringba/tier-rpc
  health: /health
  batch status: /status
  dry-run moves: ON (set DYNAMIC_RING_TREE_DRY_RUN=false for live)
  batch size: 15 unique callers
  state file: .../dynamic-ring-tree-state.json
  events log: .../dynamic-ring-tree-events.jsonl
```

### Enable live moves

```bash
DYNAMIC_RING_TREE_DRY_RUN=false node dynamicRingTreeTarget.js
```

**Recommended:** Run dry-run in production first. Validate `dynamic-ring-tree-events.jsonl` shows expected `dry_run_move` entries before going live.

### Expose locally for Ringba testing

Ringba must reach your server over HTTPS. Options:

- **ngrok:** `ngrok http 3456`
- **Cloudflare Tunnel**
- Deploy to VPS with public IP + reverse proxy (nginx/caddy)

Pixel URL example with ngrok:

```
https://abc123.ngrok.io/ringba/tier-rpc?callId=[Call:InboundCallId]&targetName=[tag:Target:Name]&callerPhone=[tag:InboundNumber:Number]&revenue=[Call:ConversionAmount]
```

---

## Testing Guide

### 1. Health check

```bash
curl http://127.0.0.1:3456/health
```

Or with Node 18+:

```bash
node -e "fetch('http://127.0.0.1:3456/health').then(r=>r.json()).then(console.log)"
```

### 2. Single pixel hit

```bash
curl "http://127.0.0.1:3456/ringba/tier-rpc?callId=test-1&targetName=FE%20-%20Test&callerPhone=%2B15551110001&revenue=25"
```

Expected: `{ "status": "accumulating", "batchSize": 1 }`

### 3. Check batch status

```bash
curl http://127.0.0.1:3456/status
```

### 4. Simulate 15-call batch (use real FE target name for eval test)

Replace `FE - YOUR REAL TARGET NAME` with an actual target from pingtrees:

```bash
node --input-type=module -e "
const target = encodeURIComponent('FE - YOUR REAL TARGET NAME');
for (let i = 0; i < 15; i++) {
  const url = 'http://127.0.0.1:3456/ringba/tier-rpc?callId=sim-' + i + '&targetName=' + target + '&callerPhone=%2B1555000' + String(i).padStart(4,'0') + '&revenue=' + (i * 2);
  const r = await fetch(url);
  const j = await r.json();
  console.log(i+1, j.status, j.batchSize ?? '', j.rpc ?? '');
}
"
```

On 15th hit expect `batch_complete` with RPC value. Check console for `[eval]` log and `dynamic-ring-tree-events.jsonl`.

### 5. Test dedup

```bash
# Same callId twice → duplicate_call_id
curl "http://127.0.0.1:3456/ringba/tier-rpc?callId=test-1&targetName=FE%20-%20Test&callerPhone=%2B15551110001&revenue=25"
curl "http://127.0.0.1:3456/ringba/tier-rpc?callId=test-1&targetName=FE%20-%20Test&callerPhone=%2B15559999999&revenue=99"

# Same phone different callId → duplicate_caller_in_batch
curl "http://127.0.0.1:3456/ringba/tier-rpc?callId=test-2&targetName=FE%20-%20Test&callerPhone=%2B15551110001&revenue=10"
```

### 6. Unit test exported functions (no server)

```bash
node --input-type=module -e "
import { ingestPixelCall, getDesiredTierWithHysteresis } from './dynamicRingTreeTarget.js';
let state = { targets: {}, lastMoveAt: {} };
// ... test ingestPixelCall, hysteresis, etc.
"
```

---

## Deployment Notes

### Process manager

Run under **pm2**, **systemd**, or similar — server must stay up 24/7 to receive pixels.

Example pm2:

```bash
pm2 start dynamicRingTreeTarget.js --name ring-tree-rpc
pm2 save
```

### Firewall

Open port `3456` (or your chosen port) to Ringba's outbound IPs if restricting. Ringba pixel fires from their infrastructure — usually allow all inbound HTTPS on your reverse proxy.

### HTTPS

Ringba pixels work best with **HTTPS** public URLs. Use nginx/caddy terminating TLS in front of Node.

### Not in scheduler

This is **NOT** in `schedules.config.js` — it's a long-running HTTP server, not a cron script.

### Restart behavior

- Open batches in `dynamic-ring-tree-state.json` **persist** across restarts
- In-progress eval jobs are lost on crash (acceptable — next batch will re-eval)
- `lastMoveAt` cooldowns persist

---

## Exported Functions (for unit tests)

These are `export`ed from `dynamicRingTreeTarget.js`:

| Function                                               | Purpose                       |
| ------------------------------------------------------ | ----------------------------- |
| `loadState()`                                          | Read state file               |
| `saveState(state)`                                     | Write state file              |
| `parseRevenue(value)`                                  | Parse revenue string → number |
| `normalizePhone(phone)`                                | Strip to digits for dedup     |
| `getRawTierFromRpc(rpc)`                               | Raw tier from RPC             |
| `getDesiredTierWithHysteresis(rpc, currentTier)`       | Tier with hysteresis          |
| `computeRpcFromBatch(batch)`                           | RPC from 15-call batch        |
| `extractFeTierRingTrees(pingTrees)`                    | Filter to FE tiers            |
| `buildFeTargetMap(feTiers)`                            | Map targetName → target info  |
| `buildTierIdMap(feTiers)`                              | Map tier name → pingTreeId    |
| `fetchPingTrees()`                                     | Live Ringba API call          |
| `ingestPixelCall(state, payload)`                      | Core batch ingest logic       |
| `evaluateBatchMove({ targetName, batch, rpc, state })` | Full eval + move              |

---

## Code Structure & Key Functions

### Constants (top of file)

```javascript
FE_RING_TREES = ["FE - Tier 1", "FE - Tier 2", "FE - Tier 3"];
BATCH_SIZE = 15;
RPC_TIER1_MIN = 30;
RPC_TIER2_MIN = 20;
HYSTERESIS = {
  promoteToTier1: 31,
  demoteFromTier1: 29,
  promoteToTier2: 21,
  demoteFromTier2: 19,
};
```

### In-memory (not persisted)

```javascript
targetLocks = new Map(); // per-target async lock
evalQueue = []; // pending eval jobs
```

### Entry point

```javascript
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
```

Importing as module does NOT start server — only running file directly does.

### Ringba API auth

```javascript
headers: {
  Authorization: `Token ${API_TOKEN}`,
  "Content-Type": "application/json",
}
```

Same pattern as other scripts in this repo (`targetNoAnswer.js`, `webHook.js`, etc.).

---

## Known Limitations & Open Items

### Phase C — Live move API not production-validated

`addTargetToPingTree()` tries 3 PATCH body formats then falls back to POST clone. **Exact Ringba PATCH body is unknown** — needs one controlled live test on a low-risk target.

**Risk:** DELETE succeeds but ADD fails → target removed from tree entirely.

**Mitigation:** Keep `DYNAMIC_RING_TREE_DRY_RUN=true` until one manual spike confirms add works.

### Revenue at Completed

Webhook/RTB targets often send `revenue=0` at Completed. User accepted — will cause lower RPC and Tier 3 placement.

### targetName lookup

Eval matches by **name string**, not RTT id from pixel. Duplicate names across tiers could cause wrong mapping.

### No pixel authentication

Anyone who discovers the URL can send fake data. User explicitly declined secret token.

### Single-process state file

Not safe for multiple server instances writing same state file. Run **one instance** only, or migrate to Redis/DB for multi-instance.

### POST body not parsed

Pixel handler reads **query string only**. If Ringba POST pixel with JSON body is enabled, params won't be read — keep GET pixel.

### After move — new target ID

Ringba duplicates RTT on add. Next batch uses same `targetName` — pingtrees refresh picks up new `id`. No special handling needed beyond per-eval pingtrees pull.

---

## Troubleshooting

| Symptom                                     | Likely cause                               | Fix                                                       |
| ------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Pixel returns 400                           | Missing callId/targetName/callerPhone      | Check Ringba token substitution                           |
| Pixel returns 200 but batch never completes | Duplicate callers skipped                  | Need 15 **unique** phones                                 |
| `target_not_in_fe_tiers` in events          | targetName doesn't match pingtrees exactly | Verify exact name spelling/casing                         |
| Eval never runs                             | Server not running / wrong URL             | Check `/health`, ngrok tunnel                             |
| Move always dry-run                         | `DYNAMIC_RING_TREE_DRY_RUN=true`           | Set to `false`                                            |
| Move skipped cooldown                       | Moved within 30 min                        | Wait or reduce `MOVE_COOLDOWN_MS`                         |
| Ringba API error on eval                    | Missing `.env` credentials                 | Set `RINGBA_ACCOUNT_ID` + `RINGBA_API_TOKEN`              |
| Target disappeared after live move          | DELETE ok, ADD failed                      | **Urgent** — re-add manually in Ringba UI; fix PATCH body |
| Slack not firing                            | `SLACK_WEBHOOK_URL` unset                  | Add to `.env`                                             |

---

## Related Repo Files

| File                             | Relationship                                                        |
| -------------------------------- | ------------------------------------------------------------------- |
| `dynamicRingTreeTarget.js`       | **Main server** — this documentation                                |
| `dynamic-ring-tree-state.json`   | Runtime state (auto-created)                                        |
| `dynamic-ring-tree-events.jsonl` | Audit log (auto-created)                                            |
| `dynamic-ring-tree-dry-run.json` | Legacy output from old calllogs script                              |
| `sample.json`                    | Snapshot of `GET /pingtrees` response (~98k lines)                  |
| `.env`                           | Credentials (not in git)                                            |
| `.env.example`                   | Env var template                                                    |
| `package.json`                   | `"dynamicRingTreeTarget": "node dynamicRingTreeTarget.js"`          |
| `schedules.config.js`            | Other cron scripts — **does NOT include this server**               |
| `webHook.js`                     | Different project — monitors webhook conversion issues via calllogs |
| `RINGBA-API-RESEARCH.md`         | General Ringba API notes                                            |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  DYNAMIC RING TREE TARGET — QUICK REFERENCE                 │
├─────────────────────────────────────────────────────────────┤
│  Start:     npm run dynamicRingTreeTarget                   │
│  Port:      3456                                            │
│  Pixel:     GET /ringba/tier-rpc                            │
│  Health:    GET /health                                     │
│  Status:    GET /status                                     │
│  Dry-run:   ON by default (DYNAMIC_RING_TREE_DRY_RUN=false) │
│  Batch:     15 unique callers → eval → clear                │
│  RPC:       sum(revenue) / 15                               │
│  Tiers:     ≥30 → T1 | ≥20 → T2 | <20 → T3                 │
│  Trigger:   Ringba pixel on Completed                       │
│  Move:      DELETE from source tree + PATCH/POST to dest    │
└─────────────────────────────────────────────────────────────┘
```

---

## Handoff Checklist for New Cursor Session

- [ ] Read this file completely
- [ ] Read `dynamicRingTreeTarget.js` (590 lines)
- [ ] Confirm `.env` has `RINGBA_ACCOUNT_ID` + `RINGBA_API_TOKEN`
- [ ] Start server: `npm run dynamicRingTreeTarget`
- [ ] Verify `/health` returns 200
- [ ] Configure Ringba pixel (Completed, GET, 4 params)
- [ ] Attach pixel to all FE-tier campaigns
- [ ] Expose server via HTTPS (ngrok or deploy)
- [ ] Send test call → check `/status` and events log
- [ ] Simulate 15 unique callers on one real target name
- [ ] Confirm `dry_run_move` in events log looks correct
- [ ] Phase C: test ONE live move with `DYNAMIC_RING_TREE_DRY_RUN=false`
- [ ] Confirm PATCH add body works or document which fallback succeeded
- [ ] Enable live moves only after Phase C passes
