# catchRoku – Roku debug logs

When the Ringba conversion API receives a request that includes Roku conversions, the app writes **one JSON file per conversion** so you can see exactly what we got from Ringba and what we sent to Roku.

**⚠️ Turn this off when you’re done debugging** – it creates a new file for every Roku conversion and will use server storage if left on. See [Disable the logging feature](#disable-the-logging-feature-avoid-filling-server-storage) below.

## Where the files are

| Where        | Path |
|-------------|------|
| **Local**   | `logs/` in the project root |
| **Server**  | `/var/www/paragon-be/logs/` |

**Filename pattern:** `catchRoku-<timestamp>-<index>.json`  
Example: `catchRoku-1739456789123-0.json`

**Contents (per file):**
- `receivedFromRingba` – conversion object from Ringba (event_group_id, roku_api_key, phone, event_id, etc.)
- `sentToRoku` – exact payload we POST to Roku
- `rokuResponse` – Roku’s response on success (e.g. code 200)
- `rokuError` – Roku’s error message on failure (if any)

---

## How to check the logs

### On the server (SSH)

**List all catchRoku files (newest last):**
```bash
ls -la /var/www/paragon-be/logs/catchRoku-*.json
```

**List with newest first:**
```bash
ls -lt /var/www/paragon-be/logs/catchRoku-*.json
```

**View the most recent file:**
```bash
cat $(ls -t /var/www/paragon-be/logs/catchRoku-*.json 2>/dev/null | head -1)
```

**Pretty-print with jq (if installed):**
```bash
jq . $(ls -t /var/www/paragon-be/logs/catchRoku-*.json 2>/dev/null | head -1)
```

**View the last 3 files:**
```bash
ls -t /var/www/paragon-be/logs/catchRoku-*.json 2>/dev/null | head -3 | xargs -I {} sh -c 'echo "=== {} ===" && cat {}'
```

### Locally

- Open the `logs/` folder and open any `catchRoku-*.json` file in your editor, or
- In a terminal: `cat logs/catchRoku-*.json` (or use the same `ls` / `cat` / `jq` style commands with path `logs/`).

---

## Cleanup (when you’re done debugging)

**1. Delete existing log files**

**On the server:**
```bash
rm /var/www/paragon-be/logs/catchRoku-*.json
```

**Locally:** Delete the `catchRoku-*.json` files in the `logs/` folder.

**2. Disable the feature** so new files stop being written and server storage isn’t used. See the section below.

---

## Disable the logging feature (avoid filling server storage)

**Important:** This feature writes a new file for every Roku conversion. Leave it on only while debugging, then turn it off so it doesn’t use server disk space.

**How to remove it:**

1. Open **`controllers/ringbaController.js`**.
2. Find the block that starts with:  
   `// Debug: write one JSON file per Roku conversion`
3. Delete that entire block (from `// Debug: write...` through the closing `}` and the `});` of the inner try/catch, and the closing `}` before `return res.status(200)`).

Or remove these parts only:
- The `fs` and `path` requires at the top (if nothing else uses them).
- The constants: `CATCH_ROKU_DIR`, `CATCH_ROKU_PREFIX`.
- The whole `// Debug: write one JSON file per Roku conversion` block (the `try { ... } catch (writeErr) { ... }` block).

After removing, redeploy/restart the app (e.g. `git pull` and `pm2 restart paragon-be` on the server).
