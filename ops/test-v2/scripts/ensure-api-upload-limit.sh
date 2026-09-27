#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="/etc/nginx/sites-available/carepoint-v2-test"
LIMIT="12m"

if [[ -z "${TEST_API_DOMAIN:-}" ]]; then
  echo "ERROR: TEST_API_DOMAIN is required" >&2
  exit 2
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo while preserving TEST_API_DOMAIN: sudo -E bash $0" >&2
  exit 2
fi

command -v nginx >/dev/null || { echo "ERROR: nginx is not installed" >&2; exit 2; }
[[ -f "$TARGET" ]] || { echo "ERROR: $TARGET does not exist" >&2; exit 2; }

if grep -qE '^[[:space:]]*client_max_body_size[[:space:]]+12m;' "$TARGET"; then
  echo "Nginx API upload limit is already configured at 12m."
  nginx -t
  exit 0
fi

if grep -qE '^[[:space:]]*client_max_body_size[[:space:]]+' "$TARGET"; then
  echo "ERROR: an existing client_max_body_size directive uses a different value. Review $TARGET manually." >&2
  grep -nE 'server_name|client_max_body_size' "$TARGET" >&2
  exit 2
fi

backup="$TARGET.before-upload-limit.$(date +%Y%m%d%H%M%S)"
cp -a "$TARGET" "$backup"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

awk -v domain="$TEST_API_DOMAIN" -v limit="$LIMIT" '
  {
    print
    line=$0
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
    if (line == "server_name " domain ";") {
      print "  client_max_body_size " limit ";"
      inserted++
    }
  }
  END {
    if (inserted < 1) exit 42
  }
' "$TARGET" > "$tmp" || {
  status=$?
  echo "ERROR: API server_name $TEST_API_DOMAIN was not found in $TARGET" >&2
  exit "$status"
}

cat "$tmp" > "$TARGET"

if ! nginx -t; then
  echo "ERROR: nginx validation failed; restoring $backup" >&2
  cp -a "$backup" "$TARGET"
  nginx -t || true
  exit 1
fi

systemctl reload nginx

echo "Nginx API upload limit configured at $LIMIT."
echo "Backup: $backup"
