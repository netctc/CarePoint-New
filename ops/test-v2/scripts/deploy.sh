#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/ops/test-v2/compose.yaml"

required_vars=(
  TEST_API_DOMAIN TEST_ADMIN_DOMAIN TEST_PATIENT_DOMAIN TEST_DOCTOR_DOMAIN TEST_PROVIDER_DOMAIN
  CAREPOINT_API_PUBLIC_BASE TEST_POSTGRES_PASSWORD TEST_REDIS_PASSWORD
  MFA_ENVELOPE_KEY_BASE64 CLINICAL_ENVELOPE_KEY_BASE64 ORDER_ENVELOPE_KEY_BASE64
  ORDER_SIGNING_SECRET_BASE64 DOCUMENT_ENVELOPE_KEY_BASE64 DOCUMENT_SIGNING_SECRET_BASE64
  MESSAGING_ENVELOPE_KEY_BASE64 TELEHEALTH_ENVELOPE_KEY_BASE64 TELEHEALTH_MOCK_SIGNING_SECRET
)

for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required variable $name is not set" >&2
    exit 2
  fi
done

if [[ "$CAREPOINT_API_PUBLIC_BASE" != "https://${TEST_API_DOMAIN}/api/v1" ]]; then
  echo "ERROR: CAREPOINT_API_PUBLIC_BASE must equal https://${TEST_API_DOMAIN}/api/v1" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required." >&2
  exit 2
fi

docker compose version >/dev/null

cd "$ROOT_DIR"
export TEST_RELEASE_SHA="${TEST_RELEASE_SHA:-$(git rev-parse HEAD)}"
export TEST_RELEASE_VERSION="${TEST_RELEASE_VERSION:-entorno-v2}"

if [[ "$(git branch --show-current)" != "entorno-v2" ]]; then
  echo "WARNING: current branch is $(git branch --show-current); expected entorno-v2" >&2
fi

echo "==> Validating Compose configuration"
docker compose -f "$COMPOSE_FILE" config >/dev/null

echo "==> Building API, Admin and three Flutter Web applications"
docker compose -f "$COMPOSE_FILE" build --pull api admin patient-web doctor-web provider-web

echo "==> Starting PostgreSQL and Redis"
docker compose -f "$COMPOSE_FILE" up -d postgres redis

for _ in $(seq 1 60); do
  pg_status="$(docker inspect --format='{{.State.Health.Status}}' carepoint-v2-test-postgres-1 2>/dev/null || true)"
  redis_status="$(docker inspect --format='{{.State.Health.Status}}' carepoint-v2-test-redis-1 2>/dev/null || true)"
  if [[ "$pg_status" == "healthy" && "$redis_status" == "healthy" ]]; then
    break
  fi
  sleep 2
done

if [[ "$(docker inspect --format='{{.State.Health.Status}}' carepoint-v2-test-postgres-1 2>/dev/null || true)" != "healthy" ]]; then
  echo "ERROR: PostgreSQL did not become healthy" >&2
  exit 1
fi
if [[ "$(docker inspect --format='{{.State.Health.Status}}' carepoint-v2-test-redis-1 2>/dev/null || true)" != "healthy" ]]; then
  echo "ERROR: Redis did not become healthy" >&2
  exit 1
fi

echo "==> Applying Prisma migrations"
docker compose -f "$COMPOSE_FILE" run --rm api npm run db:deploy

if [[ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" && -n "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]]; then
  echo "==> Bootstrapping synthetic test admin (script refuses overwrite)"
  docker compose -f "$COMPOSE_FILE" run --rm api npm run db:bootstrap
else
  echo "==> BOOTSTRAP_ADMIN_EMAIL/PASSWORD not both set; skipping bootstrap"
fi

echo "==> Starting complete test stack"
docker compose -f "$COMPOSE_FILE" up -d api admin patient-web doctor-web provider-web

echo "==> Waiting for API health"
for _ in $(seq 1 60); do
  status="$(docker inspect --format='{{.State.Health.Status}}' carepoint-v2-test-api-1 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done

if [[ "$(docker inspect --format='{{.State.Health.Status}}' carepoint-v2-test-api-1 2>/dev/null || true)" != "healthy" ]]; then
  echo "ERROR: API did not become healthy. Inspect logs with:" >&2
  echo "docker compose -f $COMPOSE_FILE logs api" >&2
  exit 1
fi

echo
printf 'CarePoint V2 test stack started\n'
printf '  API (host loopback):      http://127.0.0.1:4000\n'
printf '  Admin (host loopback):    http://127.0.0.1:3000\n'
printf '  Patient web (loopback):   http://127.0.0.1:8080\n'
printf '  Doctor web (loopback):    http://127.0.0.1:8081\n'
printf '  Provider web (loopback):  http://127.0.0.1:8082\n'
printf '  Release SHA:               %s\n' "$TEST_RELEASE_SHA"
printf '\nConfigure host Nginx/Certbot before exposing the public test FQDNs.\n'
