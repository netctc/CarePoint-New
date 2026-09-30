#!/usr/bin/env bash
set -Eeuo pipefail

required_vars=(
  TEST_API_DOMAIN TEST_ADMIN_DOMAIN TEST_PATIENT_DOMAIN TEST_DOCTOR_DOMAIN TEST_PROVIDER_DOMAIN
)
for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required variable $name is not set." >&2
    echo "For nip.io hosts you may run: source ops/test-v2/scripts/use-nipio-domains.sh <VPS_PUBLIC_IP>" >&2
    exit 2
  fi
done

check_https() {
  local name="$1" url="$2"
  printf '%-24s %s ... ' "$name" "$url"
  if curl --fail --silent --show-error --location \
      --retry 3 --retry-delay 2 --connect-timeout 5 --max-time 20 \
      "$url" >/dev/null; then
    echo PASS
  else
    echo FAIL
    return 1
  fi
}

check_flutter_public() {
  local name="$1" domain="$2"
  check_https "$name root" "https://${domain}/" || return 1
  check_https "$name bootstrap" "https://${domain}/flutter_bootstrap.js" || return 1
  check_https "$name main" "https://${domain}/main.dart.js" || return 1
  check_https "$name health" "https://${domain}/healthz" || return 1
}

check_http_redirect() {
  local name="$1" domain="$2"
  local effective
  printf '%-24s http://%s -> HTTPS ... ' "$name" "$domain"
  effective="$(curl --silent --show-error --location --max-redirs 5 \
    --connect-timeout 5 --max-time 20 -o /dev/null -w '%{url_effective}' "http://${domain}/")" || {
      echo FAIL
      return 1
    }
  if [[ "$effective" == https://* ]]; then
    echo PASS
  else
    echo "FAIL (${effective})"
    return 1
  fi
}

failed=0
check_https "API" "https://${TEST_API_DOMAIN}/api/v1/services/search" || failed=1
check_https "Admin" "https://${TEST_ADMIN_DOMAIN}/login" || failed=1
check_flutter_public "Patient" "$TEST_PATIENT_DOMAIN" || failed=1
check_flutter_public "Doctor" "$TEST_DOCTOR_DOMAIN" || failed=1
check_flutter_public "Provider" "$TEST_PROVIDER_DOMAIN" || failed=1

check_http_redirect "API redirect" "$TEST_API_DOMAIN" || failed=1
check_http_redirect "Admin redirect" "$TEST_ADMIN_DOMAIN" || failed=1
check_http_redirect "Patient redirect" "$TEST_PATIENT_DOMAIN" || failed=1
check_http_redirect "Doctor redirect" "$TEST_DOCTOR_DOMAIN" || failed=1
check_http_redirect "Provider redirect" "$TEST_PROVIDER_DOMAIN" || failed=1

if [[ "$failed" -ne 0 ]]; then
  echo "One or more public CarePoint V2 checks failed." >&2
  exit 1
fi

echo "All public CarePoint V2 HTTPS, redirect and Flutter asset checks passed."
