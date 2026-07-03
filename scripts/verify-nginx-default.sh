#!/bin/bash
set -e
echo "=== deleted domain (relief-assistance.com) ==="
curl -sS -D /tmp/deleted.hdr -o /tmp/deleted.body -H "Host: relief-assistance.com" http://127.0.0.1/
grep -i "^HTTP/" /tmp/deleted.hdr | head -1
head -c 300 /tmp/deleted.body
echo
echo
echo "=== admin portal ==="
curl -sS -D /tmp/admin.hdr -o /tmp/admin.body -H "Host: admin.pgnmapprovedlander.com" http://127.0.0.1/
grep -i "^HTTP/" /tmp/admin.hdr | head -1
grep -o "<title>[^<]*</title>" /tmp/admin.body || true
echo
echo "=== active lander ==="
ACTIVE=$(ls /etc/nginx/dynamic/*.conf 2>/dev/null | head -1 | xargs -n1 basename | sed 's/\.conf$//')
echo "host=$ACTIVE"
curl -sS -D /tmp/active.hdr -o /tmp/active.body -H "Host: $ACTIVE" http://127.0.0.1/
grep -i "^HTTP/" /tmp/active.hdr | head -1
