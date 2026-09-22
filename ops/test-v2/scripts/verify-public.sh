#!/usr/bin/env bash
set -Eeuo pipefail

required_vars=(
  TEST_API_DOMAIN TEST_ADMIN_DOMAIN TEST_PATIENT_DOMAIN TEST_DOCTOR_DOMAIN TEST_PROVIDER_DOMAIN
)
for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required variable $name is not set." >&2
    exit 2
  fi
done

check_https() {
  local name="$1" url="$2"
  printf '%-20s %s ... ' "$name" "$url"
  if curl --fail --silent --show-error --location \
      --retry 3 --retry-delay 2 --connect-timeout 5 --max-time 20 \
      "$url" >/dev/null; then
    echo PASS
  else
    echo FAIL
    return 1
  fi
}

check_http_redirect() {
  local name="$1" domain="$2"
  local effective
  printf '%-20s http://%s -> HTTPS ... ' "$name" "$domain"
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
check_https "Patient" "https://${TEST_PATIENT_DOMAIN}/healthz" || failed=1
check_https "Doctor" "https://${TEST_DOCTOR_DOMAIN}/healthz" || failed=1
check_https "Provider" "https://${TEST_PROVIDER_DOMAIN}/healthz" || failed=1

check_http_redirect "API redirect" "$TEST_API_DOMAIN" || failed=1
check_http_redirect "Admin redirect" "$TEST_ADMIN_DOMAIN" || failed=1
check_http_redirect "Patient redirect" "$TEST_PATIENT_DOMAIN" || failed=1
check_http_redirect "Doctor redirect" "$TEST_DOCTOR_DOMAIN" || failed=1
check_http_redirect "Provider redirect" "$TEST_PROVIDER_DOMAIN" || failed=1

if [[ "$failed" -ne 0 ]]; then
  echo "One or more public CarePoint V2 checks failed." >&2
  exit 1
fi

echo "All public CarePoint V2 HTTPS checks passed."
