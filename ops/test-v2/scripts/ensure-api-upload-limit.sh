#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="/etc/nginx/sites-available/carepoint-v2-test"
LIMIT="12m"

for required in TEST_API_DOMAIN TEST_ADMIN_DOMAIN; do
  if [[ -z "${!required:-}" ]]; then
    echo "ERROR: $required is required" >&2
    exit 2
  fi
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo while preserving TEST_API_DOMAIN and TEST_ADMIN_DOMAIN: sudo -E bash $0" >&2
  exit 2
fi

command -v nginx >/dev/null || { echo "ERROR: nginx is not installed" >&2; exit 2; }
[[ -f "$TARGET" ]] || { echo "ERROR: $TARGET does not exist" >&2; exit 2; }

backup="$TARGET.before-upload-limit.$(date +%Y%m%d%H%M%S)"
cp -a "$TARGET" "$backup"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

ensure_domain_limit() {
  local domain="$1"
  if grep -A4 -F "server_name $domain;" "$TARGET" | grep -qE "client_max_body_size[[:space:]]+$LIMIT;"; then
    echo "Nginx upload limit already configured at $LIMIT for $domain."
    return
  fi
  if grep -A4 -F "server_name $domain;" "$TARGET" | grep -qE 'client_max_body_size[[:space:]]+'; then
    echo "ERROR: $domain already has a different client_max_body_size." >&2
    grep -A4 -F "server_name $domain;" "$TARGET" >&2
    exit 2
  fi

  awk -v domain="$domain" -v limit="$LIMIT" '
    {
      print
      line=$0
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line == "server_name " domain ";") {
        print "  client_max_body_size " limit ";"
        inserted++
      }
    }
    END { if (inserted < 1) exit 42 }
  ' "$TARGET" > "$tmp" || {
    status=$?
    echo "ERROR: server_name $domain was not found in $TARGET" >&2
    exit "$status"
  }
  cat "$tmp" > "$TARGET"
}

ensure_domain_limit "$TEST_API_DOMAIN"
ensure_domain_limit "$TEST_ADMIN_DOMAIN"

if ! nginx -t; then
  echo "ERROR: nginx validation failed; restoring $backup" >&2
  cp -a "$backup" "$TARGET"
  nginx -t || true
  exit 1
fi

systemctl reload nginx

echo "Nginx API and Admin upload limits configured at $LIMIT."
echo "Backup: $backup"
