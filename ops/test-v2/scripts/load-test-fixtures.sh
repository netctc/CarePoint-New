#!/usr/bin/env bash
set -Eeuo pipefail

if [[ -z "${CAREPOINT_TEST_FIXTURE_PASSWORD:-}" ]]; then
  echo "ERROR: CAREPOINT_TEST_FIXTURE_PASSWORD is required (minimum 16 characters)." >&2
  exit 2
fi
if [[ ${#CAREPOINT_TEST_FIXTURE_PASSWORD} -lt 16 ]]; then
  echo "ERROR: CAREPOINT_TEST_FIXTURE_PASSWORD must contain at least 16 characters." >&2
  exit 2
fi

export CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN="${CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN:-carepoint.test}"
export CAREPOINT_TEST_FIXTURE_TIMEZONE="${CAREPOINT_TEST_FIXTURE_TIMEZONE:-Asia/Riyadh}"
export CAREPOINT_TEST_FIXTURES_CONFIRM="CREATE_SYNTHETIC_TEST_FIXTURES"

api_container="$(docker ps \
  --filter 'label=com.docker.compose.project=carepoint-v2-test' \
  --filter 'label=com.docker.compose.service=api' \
  --format '{{.ID}}' | head -n 1)"

if [[ -z "$api_container" ]]; then
  echo "ERROR: the carepoint-v2-test API container is not running." >&2
  echo "Deploy the stack first, then run this script." >&2
  exit 1
fi

echo "==> Ensuring reference specialties and provider categories"
docker exec "$api_container" npm run db:bootstrap

echo "==> Loading idempotent synthetic integral-test fixtures"
docker exec \
  -e CAREPOINT_TEST_FIXTURES_CONFIRM \
  -e CAREPOINT_TEST_FIXTURE_PASSWORD \
  -e CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN \
  -e CAREPOINT_TEST_FIXTURE_TIMEZONE \
  "$api_container" npm run db:test-fixtures

echo
echo "Synthetic fixtures loaded. Password was not printed."
echo "Email domain: $CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN"
echo "Timezone: $CAREPOINT_TEST_FIXTURE_TIMEZONE"
