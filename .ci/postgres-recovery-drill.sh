#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  C11_SOURCE_DATABASE_URL
  C11_RESTORE_DATABASE_URL
  C11_SOURCE_PORT
  C11_RESTORE_PORT
  C11_PGUSER
  C11_PGPASSWORD
  C11_SOURCE_DB
  C11_RESTORE_DB
  C11_API_PORT
  REDIS_URL
)
for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "C11 required environment variable is missing: ${name}" >&2
    exit 1
  fi
done

if [[ "$C11_SOURCE_PORT" == "$C11_RESTORE_PORT" ]]; then
  echo "C11 source and restore PostgreSQL ports must be different." >&2
  exit 1
fi

POSTGRES_IMAGE="${C11_POSTGRES_IMAGE:-postgres:16}"
DUMP_FILE="/tmp/carepoint-c11-recovery.dump"
LIST_FILE="/tmp/carepoint-c11-recovery.list"
API_LOG="/tmp/carepoint-c11-restored-api.log"
API_PID=""
umask 077

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -f "$DUMP_FILE" "$LIST_FILE" "$API_LOG"
}
trap cleanup EXIT

export DATABASE_URL="$C11_SOURCE_DATABASE_URL"
npm run db:deploy
node .ci/postgres-recovery-fixture.mjs seed

echo "C11 creating logical backup from the isolated source PostgreSQL cluster"
docker run --rm --network host \
  -e "PGPASSWORD=$C11_PGPASSWORD" \
  "$POSTGRES_IMAGE" \
  pg_dump \
    --host=127.0.0.1 \
    --port="$C11_SOURCE_PORT" \
    --username="$C11_PGUSER" \
    --dbname="$C11_SOURCE_DB" \
    --format=custom \
    --no-owner \
    --no-privileges \
  > "$DUMP_FILE"

test -s "$DUMP_FILE"
chmod 600 "$DUMP_FILE"

docker run --rm -i "$POSTGRES_IMAGE" pg_restore --list < "$DUMP_FILE" > "$LIST_FILE"
for required_object in 'AuditEvent' 'SiemAuditDelivery' '_prisma_migrations'; do
  if ! grep -Fq "$required_object" "$LIST_FILE"; then
    echo "C11 backup archive is missing required database object: $required_object" >&2
    exit 1
  fi
done

echo "C11 restoring archive into an independent clean PostgreSQL cluster"
docker run --rm --network host -i \
  -e "PGPASSWORD=$C11_PGPASSWORD" \
  "$POSTGRES_IMAGE" \
  pg_restore \
    --host=127.0.0.1 \
    --port="$C11_RESTORE_PORT" \
    --username="$C11_PGUSER" \
    --dbname="$C11_RESTORE_DB" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    --no-privileges \
  < "$DUMP_FILE"

export DATABASE_URL="$C11_RESTORE_DATABASE_URL"
node .ci/postgres-recovery-fixture.mjs verify

npx prisma migrate status --schema services/api/prisma

echo "C11 starting CarePoint API against the restored PostgreSQL cluster"
PORT="$C11_API_PORT" npm --workspace @carepoint/api run start > "$API_LOG" 2>&1 &
API_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${C11_API_PORT}/api/v1/health" > /dev/null; then
    echo "Phase C11 PostgreSQL disaster recovery acceptance passed"
    exit 0
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "C11 restored API terminated before becoming healthy." >&2
    cat "$API_LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

echo "C11 restored API did not become healthy within the acceptance window." >&2
cat "$API_LOG" >&2 || true
exit 1
