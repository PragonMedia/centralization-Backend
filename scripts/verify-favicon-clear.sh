#!/bin/bash
echo "=== page ==="
curl -sS -D - -o /tmp/body.html -H "Host: relief-assistance.com" http://127.0.0.1/ | head -20
echo
echo "=== favicon ==="
curl -sS -D - -o /dev/null -H "Host: relief-assistance.com" http://127.0.0.1/favicon.ico | head -15
echo
grep -i "icon\|title" /tmp/body.html || true
