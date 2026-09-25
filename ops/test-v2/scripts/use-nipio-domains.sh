#!/usr/bin/env bash

# This file must be sourced so the exported values remain in the current shell:
#   source ops/test-v2/scripts/use-nipio-domains.sh 167.86.92.207

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "ERROR: source this script instead of executing it:" >&2
  echo "  source $0 <public-ipv4>" >&2
  exit 2
fi

ip="${1:-${TEST_VPS_IP:-}}"
if [[ ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "ERROR: a public IPv4 address is required." >&2
  return 2
fi

IFS=. read -r a b c d <<<"$ip"
for octet in "$a" "$b" "$c" "$d"; do
  if (( octet < 0 || octet > 255 )); then
    echo "ERROR: invalid IPv4 address." >&2
    return 2
  fi
done

export TEST_VPS_IP="$ip"
export TEST_API_DOMAIN="api-test.${ip}.nip.io"
export TEST_ADMIN_DOMAIN="admin-test.${ip}.nip.io"
export TEST_PATIENT_DOMAIN="patient-test.${ip}.nip.io"
export TEST_DOCTOR_DOMAIN="doctor-test.${ip}.nip.io"
export TEST_PROVIDER_DOMAIN="provider-test.${ip}.nip.io"
export CAREPOINT_API_PUBLIC_BASE="https://${TEST_API_DOMAIN}/api/v1"

printf 'CarePoint test domains loaded:\n'
printf '  API:      %s\n' "$TEST_API_DOMAIN"
printf '  Admin:    %s\n' "$TEST_ADMIN_DOMAIN"
printf '  Patient:  %s\n' "$TEST_PATIENT_DOMAIN"
printf '  Doctor:   %s\n' "$TEST_DOCTOR_DOMAIN"
printf '  Provider: %s\n' "$TEST_PROVIDER_DOMAIN"
