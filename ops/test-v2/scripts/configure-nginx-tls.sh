#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEMPLATE="$ROOT_DIR/ops/test-v2/nginx/carepoint-v2-http.conf.template"
SITE_NAME="${NGINX_SITE_NAME:-carepoint-v2-test}"
SITE_AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}"
SITE_ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}"

required_vars=(
  TEST_API_DOMAIN TEST_ADMIN_DOMAIN TEST_PATIENT_DOMAIN TEST_DOCTOR_DOMAIN TEST_PROVIDER_DOMAIN
)
for name in "${required_vars[@]}"; do
  value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "ERROR: required variable $name is not set." >&2
    exit 2
  fi
  if [[ ! "$value" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "ERROR: $name contains unsupported characters: $value" >&2
    exit 2
  fi
done

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: Nginx template not found: $TEMPLATE" >&2
  exit 2
fi
if ! command -v nginx >/dev/null 2>&1; then
  echo "ERROR: nginx is not installed. Run bootstrap-host.sh first." >&2
  exit 2
fi

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=()
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "ERROR: sudo is required when not running as root." >&2
    exit 2
  fi
  SUDO=(sudo)
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cp "$TEMPLATE" "$tmp"

replace_placeholder() {
  local placeholder="$1" value="$2"
  sed -i "s|${placeholder}|${value}|g" "$tmp"
}

replace_placeholder "__API_DOMAIN__" "$TEST_API_DOMAIN"
replace_placeholder "__ADMIN_DOMAIN__" "$TEST_ADMIN_DOMAIN"
replace_placeholder "__PATIENT_DOMAIN__" "$TEST_PATIENT_DOMAIN"
replace_placeholder "__DOCTOR_DOMAIN__" "$TEST_DOCTOR_DOMAIN"
replace_placeholder "__PROVIDER_DOMAIN__" "$TEST_PROVIDER_DOMAIN"

if grep -q '__[A-Z_]*__' "$tmp"; then
  echo "ERROR: unresolved placeholder remains in rendered Nginx config." >&2
  grep -n '__[A-Z_]*__' "$tmp" >&2 || true
  exit 1
fi

printf '==> Installing Nginx site %s\n' "$SITE_NAME"
"${SUDO[@]}" install -m 0644 "$tmp" "$SITE_AVAILABLE"
"${SUDO[@]}" ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"

if [[ "${DISABLE_NGINX_DEFAULT:-true}" == "true" ]]; then
  "${SUDO[@]}" rm -f /etc/nginx/sites-enabled/default
fi

printf '==> Validating and reloading Nginx\n'
"${SUDO[@]}" nginx -t
"${SUDO[@]}" systemctl reload nginx

if [[ "${ENABLE_CERTBOT:-false}" == "true" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "ERROR: certbot is not installed. Run bootstrap-host.sh first." >&2
    exit 2
  fi
  if [[ -z "${LETSENCRYPT_EMAIL:-}" ]]; then
    echo "ERROR: LETSENCRYPT_EMAIL is required when ENABLE_CERTBOT=true." >&2
    exit 2
  fi

  certbot_args=(
    certbot --nginx --non-interactive --agree-tos --redirect
    --email "$LETSENCRYPT_EMAIL"
    -d "$TEST_API_DOMAIN"
    -d "$TEST_ADMIN_DOMAIN"
    -d "$TEST_PATIENT_DOMAIN"
    -d "$TEST_DOCTOR_DOMAIN"
    -d "$TEST_PROVIDER_DOMAIN"
  )
  if [[ "${CERTBOT_STAGING:-false}" == "true" ]]; then
    certbot_args+=(--staging)
  fi

  printf '==> Requesting TLS certificates with Certbot\n'
  "${SUDO[@]}" "${certbot_args[@]}"
  "${SUDO[@]}" nginx -t
  "${SUDO[@]}" systemctl reload nginx
else
  cat <<'EOF'
Nginx HTTP routing is active.
TLS was not requested because ENABLE_CERTBOT is not true.
After DNS for all five hostnames points to this VPS, run again with:
  ENABLE_CERTBOT=true LETSENCRYPT_EMAIL=<address> ops/test-v2/scripts/configure-nginx-tls.sh
EOF
fi
