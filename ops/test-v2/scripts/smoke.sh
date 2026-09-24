#!/usr/bin/env bash
set -Eeuo pipefail

check_url() {
  local name="$1" url="$2"
  printf '%-18s %s ... ' "$name" "$url"
  if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
    echo PASS
  else
    echo FAIL
    return 1
  fi
}

failed=0
check_url "API search" "http://127.0.0.1:4200/api/v1/services/search" || failed=1
check_url "Admin login" "http://127.0.0.1:3200/login" || failed=1
check_url "Patient web" "http://127.0.0.1:8280/healthz" || failed=1
check_url "Doctor web" "http://127.0.0.1:8281/healthz" || failed=1
check_url "Provider web" "http://127.0.0.1:8282/healthz" || failed=1

if [[ "$failed" -ne 0 ]]; then
  echo "One or more local test services failed." >&2
  exit 1
fi

echo "All local CarePoint V2 test service checks passed."
