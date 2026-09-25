#!/usr/bin/env bash
set -Eeuo pipefail

check_url() {
  local name="$1" url="$2"
  printf '%-24s %s ... ' "$name" "$url"
  if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
    echo PASS
  else
    echo FAIL
    return 1
  fi
}

check_flutter() {
  local name="$1" base="$2"
  check_url "$name root" "$base/" || return 1
  check_url "$name bootstrap" "$base/flutter_bootstrap.js" || return 1
  check_url "$name main" "$base/main.dart.js" || return 1
  check_url "$name health" "$base/healthz" || return 1
}

failed=0
check_url "API search" "http://127.0.0.1:4200/api/v1/services/search" || failed=1
check_url "Admin login" "http://127.0.0.1:3200/login" || failed=1
check_flutter "Patient web" "http://127.0.0.1:8280" || failed=1
check_flutter "Doctor web" "http://127.0.0.1:8281" || failed=1
check_flutter "Provider web" "http://127.0.0.1:8282" || failed=1

if [[ "$failed" -ne 0 ]]; then
  echo "One or more local CarePoint V2 test service checks failed." >&2
  exit 1
fi

echo "All local CarePoint V2 test service and Flutter asset checks passed."
