#!/bin/bash
set -e
cd /var/www/paragon-fe

python3 <<'PY'
from pathlib import Path

api = Path("src/config/api.js")
text = api.read_text()
old = 'import.meta.env.VITE_API_BASE_URL || "http://138.68.231.226:3000/api/v1"'
new = 'import.meta.env.VITE_API_BASE_URL || "/api/v1"'
if old not in text:
    raise SystemExit("api.js pattern not found")
api.write_text(text.replace(old, new))

acc = Path("src/pages/Accounting.jsx")
text = acc.read_text()
old = """  const buyers = Object.keys(buyerMap)
    .filter((b) => buyerHasComparison.has(b))
    .sort();"""
new = """  const buyers = Object.keys(buyerMap)
    .filter((b) =>
      DAY_NAMES.some((d) => {
        const cell = buyerMap[b][d];
        return (
          cell.conversionAmount !== "" || cell.buyerConversionAmount !== ""
        );
      }),
    )
    .sort();"""
if old not in text:
    raise SystemExit("Accounting.jsx pattern not found")
acc.write_text(text.replace(old, new))
print("patched api.js and Accounting.jsx")
PY

export VITE_API_BASE_URL=/api/v1
npm run build

chown -R www-data:www-data /var/www/paragon-fe/dist
chmod -R 755 /var/www/paragon-fe/dist

echo BUILD_OK
grep "BASE_URL" src/config/api.js | head -2
grep -c "138.68.231.226:3000" dist/assets/*.js || true
