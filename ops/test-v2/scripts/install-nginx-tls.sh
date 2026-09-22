#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$ROOT_DIR/ops/test-v2/nginx/carepoint-v2-http.conf.template"
TARGET="/etc/nginx/sites-available/carepoint-v2-test"
LINK="/etc/nginx/sites-enabled/carepoint-v2-test"

required=(TEST_API_DOMAIN TEST_ADMIN_DOMAIN TEST_PATIENT_DOMAIN TEST_DOCTOR_DOMAIN TEST_PROVIDER_DOMAIN)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required" >&2
    exit 2
  fi
done

for name in "${required[@]}"; do
  value="${!name}"
  if [[ ! "$value" =~ ^[A-Za-z0-9.-]+$ ]] || [[ "$value" == .* ]] || [[ "$value" == *..* ]]; then
    echo "ERROR: invalid hostname in $name" >&2
    exit 2
  fi
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo while preserving the five TEST_*_DOMAIN variables: sudo -E bash $0" >&2
  exit 2
fi

command -v nginx >/dev/null || { echo "ERROR: nginx is not installed" >&2; exit 2; }
command -v certbot >/dev/null || { echo "ERROR: certbot is not installed" >&2; exit 2; }

sed \
  -e "s/__API_DOMAIN__/${TEST_API_DOMAIN}/g" \
  -e "s/__ADMIN_DOMAIN__/${TEST_ADMIN_DOMAIN}/g" \
  -e "s/__PATIENT_DOMAIN__/${TEST_PATIENT_DOMAIN}/g" \
  -e "s/__DOCTOR_DOMAIN__/${TEST_DOCTOR_DOMAIN}/g" \
  -e "s/__PROVIDER_DOMAIN__/${TEST_PROVIDER_DOMAIN}/g" \
  "$TEMPLATE" >"$TARGET"

ln -sfn "$TARGET" "$LINK"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

cat <<EOF
Nginx HTTP routing installed. Confirm all five DNS records resolve to this VPS before requesting TLS:
  $TEST_API_DOMAIN
  $TEST_ADMIN_DOMAIN
  $TEST_PATIENT_DOMAIN
  $TEST_DOCTOR_DOMAIN
  $TEST_PROVIDER_DOMAIN
EOF

if [[ "${ISSUE_TLS:-false}" != "true" ]]; then
  echo "TLS not requested. After DNS propagation run with ISSUE_TLS=true and CERTBOT_EMAIL set."
  exit 0
fi

if [[ -z "${CERTBOT_EMAIL:-}" ]]; then
  echo "ERROR: CERTBOT_EMAIL is required when ISSUE_TLS=true" >&2
  exit 2
fi

certbot --nginx \
  --non-interactive --agree-tos --redirect \
  --email "$CERTBOT_EMAIL" \
  -d "$TEST_API_DOMAIN" \
  -d "$TEST_ADMIN_DOMAIN" \
  -d "$TEST_PATIENT_DOMAIN" \
  -d "$TEST_DOCTOR_DOMAIN" \
  -d "$TEST_PROVIDER_DOMAIN"

nginx -t
systemctl reload nginx
certbot renew --dry-run

echo "HTTPS enabled. Keep this environment synthetic-only and non-production."
