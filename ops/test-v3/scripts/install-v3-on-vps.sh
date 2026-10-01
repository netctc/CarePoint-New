#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# CarePoint Entorno V3 - VPS installer/updater
# Synthetic/non-production only.
#
# Defaults are intentionally specific to the current VPS test environment.
# No .env file is created. Persistent V3 secrets live outside the repository
# in /root/.config/carepoint-v3/runtime-secrets.sh (mode 0600).

V2_REPO="/opt/carepoint/app/CarePoint-New"
V3_PARENT="/opt/carepoint-v3/app"
V3_REPO="/opt/carepoint-v3/app/CarePoint-New"
V3_BRANCH="entorno-v3"
COMPOSE_FILE_REL="ops/test-v3/compose.yaml"
SECRETS_DIR="/root/.config/carepoint-v3"
SECRETS_FILE="${SECRETS_DIR}/runtime-secrets.sh"
REPORT_DIR="/root/carepoint-v3-reports"

PUBLIC_IP="167.86.92.207"
TEST_API_DOMAIN="api.167.86.92.207.nip.io"
TEST_ADMIN_DOMAIN="admin.167.86.92.207.nip.io"
TEST_PATIENT_DOMAIN="patient.167.86.92.207.nip.io"
TEST_DOCTOR_DOMAIN="doctor.167.86.92.207.nip.io"
TEST_PROVIDER_DOMAIN="provider.167.86.92.207.nip.io"
TEST_TRANSPORT_PROVIDER_DOMAIN="transportprovider.167.86.92.207.nip.io"
CERTBOT_EMAIL="maassaf@gmail.com"
BOOTSTRAP_ADMIN_EMAIL="admin@carepoint.test"

V3_PORTS=(4300 3300 8380 8381 8382 8383)
V2_PORTS=(4200 3200 8280 8281 8282)

PREFLIGHT_ONLY=false
SKIP_TLS=false
SKIP_RICH_DATA=false
SKIP_CACHE_CLEAN=false
ASSUME_YES=false

for arg in "$@"; do
  case "$arg" in
    --preflight-only) PREFLIGHT_ONLY=true ;;
    --skip-tls) SKIP_TLS=true ;;
    --skip-rich-data) SKIP_RICH_DATA=true ;;
    --skip-cache-clean) SKIP_CACHE_CLEAN=true ;;
    --yes|-y) ASSUME_YES=true ;;
    -h|--help)
      cat <<'EOF'
Usage:
  bash ops/test-v3/scripts/install-v3-on-vps.sh [options]

Options:
  --preflight-only     Run checks only; change nothing.
  --skip-tls           Install HTTP routing but do not request/renew TLS.
  --skip-rich-data     Do not reset/load the rich synthetic dataset.
  --skip-cache-clean   Do not prune Docker build cache older than 7 days.
  --yes, -y            Skip the final interactive deployment confirmation.

Default deployment:
  V2 remains untouched.
  V3 repo: /opt/carepoint-v3/app/CarePoint-New
  V3 ports: API 4300, Admin 3300, Patient 8380, Doctor 8381,
            Provider 8382, Transport Provider 8383.
EOF
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $arg" >&2
      exit 64
      ;;
  esac
done

log(){ printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

require_root(){
  [[ "${EUID}" -eq 0 ]] || die "Run this installer as root."
}

require_cmd(){
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

is_v3_container_port(){
  local port="$1"
  docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null |
    grep -Eq "^carepoint-v3-test-.*127\.0\.0\.1:${port}->"
}

port_in_use(){
  local port="$1"
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"
}

check_v3_ports(){
  local failures=0
  for port in "${V3_PORTS[@]}"; do
    if port_in_use "$port"; then
      if is_v3_container_port "$port"; then
        log "Port $port is already owned by the existing V3 stack; safe for update."
      else
        echo "PORT CONFLICT: $port is already in use by a non-V3 process/container." >&2
        failures=1
      fi
    else
      log "Port $port is free."
    fi
  done
  [[ "$failures" -eq 0 ]] || die "Resolve V3 host-port conflicts before deployment."
}

check_v2(){
  [[ -d "$V2_REPO/.git" ]] || die "V2 repository not found at $V2_REPO"
  log "V2 repository found: $V2_REPO"

  local expected=(4200 3200 8280 8281 8282)
  for port in "${expected[@]}"; do
    if port_in_use "$port"; then
      log "V2 port $port is listening."
    else
      echo "WARNING: expected V2 port $port is not currently listening." >&2
    fi
  done

  docker ps --format '{{.Names}}' | grep -q '^carepoint-v2-test-' ||
    echo "WARNING: no running carepoint-v2-test containers detected." >&2
}

check_resources(){
  log "Host resource summary:"
  free -h || true
  df -h / || true
  docker system df || true

  local available_kb
  available_kb="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
  if [[ -n "$available_kb" && "$available_kb" -lt 3145728 ]]; then
    echo "WARNING: less than ~3 GiB RAM available. Running V2 and V3 together may be unstable." >&2
  fi

  local free_kb
  free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
  if [[ -n "$free_kb" && "$free_kb" -lt 20971520 ]]; then
    echo "WARNING: less than ~20 GiB disk free. Docker builds may exhaust disk." >&2
  fi
}

check_domains(){
  local failures=0
  local domains=(
    "$TEST_API_DOMAIN"
    "$TEST_ADMIN_DOMAIN"
    "$TEST_PATIENT_DOMAIN"
    "$TEST_DOCTOR_DOMAIN"
    "$TEST_PROVIDER_DOMAIN"
    "$TEST_TRANSPORT_PROVIDER_DOMAIN"
  )

  for domain in "${domains[@]}"; do
    local resolved
    resolved="$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
    if [[ "$resolved" == "$PUBLIC_IP" ]]; then
      log "DNS OK: $domain -> $resolved"
    else
      echo "WARNING: $domain resolves to '${resolved:-<nothing>}' instead of $PUBLIC_IP." >&2
      failures=1
    fi
  done

  if [[ "$failures" -ne 0 ]]; then
    echo "WARNING: TLS issuance may fail until all nip.io names resolve correctly." >&2
  fi
}

snapshot_v2_state(){
  mkdir -p "$REPORT_DIR"
  local file="$REPORT_DIR/pre-v3-$(date '+%Y%m%d-%H%M%S').txt"
  {
    echo "CarePoint V2 state before V3 deployment"
    date
    hostname
    echo
    echo "V2 git:"
    git -C "$V2_REPO" status --short --branch || true
    git -C "$V2_REPO" rev-parse HEAD || true
    echo
    echo "Docker:"
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
    echo
    echo "Listeners:"
    ss -ltnp || true
    echo
    echo "Nginx:"
    nginx -T 2>&1 || true
  } >"$file"
  log "V2/VPS pre-deployment snapshot saved: $file"
}

ensure_packages(){
  require_cmd git
  require_cmd docker
  require_cmd ss
  require_cmd curl
  require_cmd openssl
  docker compose version >/dev/null || die "Docker Compose plugin is required."

  local need_apt=false
  command -v nginx >/dev/null 2>&1 || need_apt=true
  command -v certbot >/dev/null 2>&1 || need_apt=true

  if [[ "$need_apt" == "true" ]]; then
    log "Installing Nginx/Certbot prerequisites."
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx
  fi
}

prepare_repo(){
  mkdir -p "$V3_PARENT"

  # Refresh the remote branch through the already-installed V2 checkout first.
  log "Fetching $V3_BRANCH using the existing V2 repository credentials/configuration."
  git -C "$V2_REPO" fetch --prune origin "+refs/heads/$V3_BRANCH:refs/remotes/origin/$V3_BRANCH"
  git -C "$V2_REPO" show-ref --verify --quiet "refs/remotes/origin/$V3_BRANCH" ||
    die "origin/$V3_BRANCH is not available in the V2 repository."

  if [[ ! -d "$V3_REPO/.git" ]]; then
    log "Creating independent V3 checkout at $V3_REPO"
    git clone --no-hardlinks "$V2_REPO" "$V3_REPO"
    git -C "$V3_REPO" fetch "$V2_REPO" "refs/remotes/origin/$V3_BRANCH:refs/heads/$V3_BRANCH"
    git -C "$V3_REPO" remote set-url origin "$(git -C "$V2_REPO" remote get-url origin)"
  fi

  [[ -z "$(git -C "$V3_REPO" status --porcelain)" ]] ||
    die "V3 checkout contains uncommitted changes. Resolve them before continuing."

  git -C "$V3_REPO" fetch --prune origin "+refs/heads/$V3_BRANCH:refs/remotes/origin/$V3_BRANCH"
  git -C "$V3_REPO" checkout "$V3_BRANCH"
  git -C "$V3_REPO" merge --ff-only "origin/$V3_BRANCH"

  log "V3 checkout HEAD: $(git -C "$V3_REPO" rev-parse HEAD)"
}

generate_b64_secret(){ openssl rand -base64 32 | tr -d '\n'; }
generate_hex_secret(){ openssl rand -hex 32 | tr -d '\n'; }

prompt_secret(){
  local var_name="$1" prompt="$2" min_len="$3" confirm="${4:-false}"
  local value="${!var_name:-}"

  if [[ -n "$value" ]]; then
    [[ "${#value}" -ge "$min_len" ]] ||
      die "$var_name from the persisted secret file is shorter than $min_len characters."
    return
  fi

  while true; do
    read -r -s -p "$prompt: " value
    echo
    if [[ "${#value}" -lt "$min_len" ]]; then
      echo "Value must contain at least $min_len characters." >&2
      continue
    fi

    if [[ "$confirm" == "true" ]]; then
      local again
      read -r -s -p "Confirm $prompt: " again
      echo
      [[ "$value" == "$again" ]] || { echo "Values do not match." >&2; continue; }
    fi

    printf -v "$var_name" '%s' "$value"
    export "$var_name"
    return
  done
}

persist_secret(){
  local name="$1" value="${!1}"
  printf 'export %s=%q\n' "$name" "$value" >>"$SECRETS_FILE.tmp"
}

load_or_create_secrets(){
  mkdir -p "$SECRETS_DIR"

  if [[ -f "$SECRETS_FILE" ]]; then
    chmod 600 "$SECRETS_FILE"
    # shellcheck disable=SC1090
    source "$SECRETS_FILE"
    log "Loaded existing V3 runtime secrets from $SECRETS_FILE"
  fi

  prompt_secret TEST_POSTGRES_PASSWORD "V3 PostgreSQL password" 16 true
  prompt_secret TEST_REDIS_PASSWORD "V3 Redis password" 16 true
  prompt_secret BOOTSTRAP_ADMIN_PASSWORD "V3 Admin password for $BOOTSTRAP_ADMIN_EMAIL" 16 true
  prompt_secret CAREPOINT_TEST_FIXTURE_PASSWORD "Password shared by generated synthetic fixture users" 16 true

  export MFA_ENVELOPE_KEY_BASE64="${MFA_ENVELOPE_KEY_BASE64:-$(generate_b64_secret)}"
  export CLINICAL_ENVELOPE_KEY_BASE64="${CLINICAL_ENVELOPE_KEY_BASE64:-$(generate_b64_secret)}"
  export ORDER_ENVELOPE_KEY_BASE64="${ORDER_ENVELOPE_KEY_BASE64:-$(generate_b64_secret)}"
  export ORDER_SIGNING_SECRET_BASE64="${ORDER_SIGNING_SECRET_BASE64:-$(generate_b64_secret)}"
  export DOCUMENT_ENVELOPE_KEY_BASE64="${DOCUMENT_ENVELOPE_KEY_BASE64:-$(generate_b64_secret)}"
  export DOCUMENT_SIGNING_SECRET_BASE64="${DOCUMENT_SIGNING_SECRET_BASE64:-$(generate_b64_secret)}"
  export MESSAGING_ENVELOPE_KEY_BASE64="${MESSAGING_ENVELOPE_KEY_BASE64:-$(generate_b64_secret)}"
  export TELEHEALTH_ENVELOPE_KEY_BASE64="${TELEHEALTH_ENVELOPE_KEY_BASE64:-$(generate_b64_secret)}"
  export TELEHEALTH_MOCK_SIGNING_SECRET="${TELEHEALTH_MOCK_SIGNING_SECRET:-$(generate_b64_secret)}"
  export REGISTRATION_OTP_PEPPER="${REGISTRATION_OTP_PEPPER:-$(generate_hex_secret)}"

  : >"$SECRETS_FILE.tmp"
  chmod 600 "$SECRETS_FILE.tmp"
  for name in     TEST_POSTGRES_PASSWORD TEST_REDIS_PASSWORD BOOTSTRAP_ADMIN_PASSWORD CAREPOINT_TEST_FIXTURE_PASSWORD     MFA_ENVELOPE_KEY_BASE64 CLINICAL_ENVELOPE_KEY_BASE64 ORDER_ENVELOPE_KEY_BASE64     ORDER_SIGNING_SECRET_BASE64 DOCUMENT_ENVELOPE_KEY_BASE64 DOCUMENT_SIGNING_SECRET_BASE64     MESSAGING_ENVELOPE_KEY_BASE64 TELEHEALTH_ENVELOPE_KEY_BASE64 TELEHEALTH_MOCK_SIGNING_SECRET     REGISTRATION_OTP_PEPPER
  do
    persist_secret "$name"
  done
  mv "$SECRETS_FILE.tmp" "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"

  log "Persistent V3 runtime secrets are stored outside Git at $SECRETS_FILE (0600)."
}

export_runtime(){
  export TEST_API_DOMAIN TEST_ADMIN_DOMAIN TEST_PATIENT_DOMAIN TEST_DOCTOR_DOMAIN TEST_PROVIDER_DOMAIN
  export TEST_TRANSPORT_PROVIDER_DOMAIN CERTBOT_EMAIL BOOTSTRAP_ADMIN_EMAIL
  export CAREPOINT_API_PUBLIC_BASE="https://${TEST_API_DOMAIN}/api/v1"
  export TEST_RELEASE_VERSION="entorno-v3"
  export TEST_RELEASE_SHA="$(git -C "$V3_REPO" rev-parse HEAD)"
  export REGISTRATION_OTP_DELIVERY_MODE="display"

  export CAREPOINT_RICH_TEST_DATA_CONFIRM="RESET_AND_CREATE_RICH_SYNTHETIC_DATA"
  export CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN="carepoint.test"
  export CAREPOINT_TEST_FIXTURE_TIMEZONE="Asia/Riyadh"
  export CAREPOINT_RICH_TEST_PATIENT_COUNT="300"
  export CAREPOINT_RICH_TEST_DOCTORS_PER_SPECIALTY="2"
  export CAREPOINT_RICH_TEST_PROVIDERS_PER_CATEGORY="2"

  # The master installer deliberately owns the rich reset sequence.
  export LOAD_SYNTHETIC_TEST_FIXTURES="false"
  export LOAD_SYNTHETIC_PILOT_FIXTURES="false"
}

clean_build_cache(){
  if [[ "$SKIP_CACHE_CLEAN" == "true" ]]; then
    log "Docker build-cache cleanup skipped."
    return
  fi
  log "Pruning Docker build cache older than seven days (active containers/images/volumes are not removed)."
  docker builder prune -af --filter 'until=168h' || true
}

compose(){
  docker compose -f "$V3_REPO/$COMPOSE_FILE_REL" "$@"
}

had_v3_before=false
nginx_site_created_by_run=false

rollback_on_error(){
  local code="$?"
  trap - ERR
  echo >&2
  echo "V3 INSTALLATION FAILED (exit $code)." >&2

  if [[ "$had_v3_before" == "false" && -d "$V3_REPO" ]]; then
    echo "Rolling back newly-created V3 runtime without deleting volumes..." >&2
    compose down --remove-orphans || true

    if [[ "$nginx_site_created_by_run" == "true" ]]; then
      rm -f /etc/nginx/sites-enabled/carepoint-v3-test
      rm -f /etc/nginx/sites-available/carepoint-v3-test
      nginx -t && systemctl reload nginx || true
    fi
  else
    echo "A V3 stack existed before this run; automatic teardown is skipped to avoid destroying a known-good environment." >&2
  fi

  echo "V2 was never stopped or modified by this rollback." >&2
  exit "$code"
}

deploy_v3(){
  cd "$V3_REPO"
  chmod +x ops/test-v3/scripts/*.sh || true

  if docker ps --format '{{.Names}}' | grep -q '^carepoint-v3-test-'; then
    had_v3_before=true
  fi

  # Do not create the final admin before the rich reset, because the reset
  # intentionally truncates application data.
  local saved_admin_password="$BOOTSTRAP_ADMIN_PASSWORD"
  unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD

  log "Building/migrating/starting the isolated V3 stack."
  bash ops/test-v3/scripts/deploy.sh

  export BOOTSTRAP_ADMIN_EMAIL="admin@carepoint.test"
  export BOOTSTRAP_ADMIN_PASSWORD="$saved_admin_password"

  if [[ "$SKIP_RICH_DATA" != "true" ]]; then
    log "Stopping V3 application surfaces while the guarded rich dataset reset runs."
    compose stop api admin patient-web doctor-web provider-web transport-provider-web || true

    log "Loading 330-day rich synthetic dataset, including extended Transport Provider history."
    compose --profile rich-test-data run --rm rich-test-data

    log "Creating the requested V3 admin AFTER the rich reset."
    compose run --rm       -e BOOTSTRAP_ADMIN_EMAIL       -e BOOTSTRAP_ADMIN_PASSWORD       api npm run db:bootstrap

    log "Restarting V3 application surfaces."
    compose up -d api admin patient-web doctor-web provider-web transport-provider-web
  else
    log "Rich dataset reset skipped by request."
    log "Ensuring requested admin exists."
    compose run --rm       -e BOOTSTRAP_ADMIN_EMAIL       -e BOOTSTRAP_ADMIN_PASSWORD       api npm run db:bootstrap
  fi

  for _ in $(seq 1 60); do
    local status
    status="$(docker inspect --format='{{.State.Health.Status}}' carepoint-v3-test-api-1 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && break
    sleep 2
  done

  [[ "$(docker inspect --format='{{.State.Health.Status}}' carepoint-v3-test-api-1 2>/dev/null || true)" == "healthy" ]] ||
    die "V3 API did not become healthy after data load."

  log "Running local V3 smoke tests."
  bash ops/test-v3/scripts/smoke.sh
}

configure_nginx_tls(){
  cd "$V3_REPO"

  if [[ ! -e /etc/nginx/sites-available/carepoint-v3-test ]]; then
    nginx_site_created_by_run=true
  fi

  log "Installing V3 Nginx HTTP routing with six distinct domains."
  ISSUE_TLS=false bash ops/test-v3/scripts/install-nginx-tls.sh

  if [[ "$SKIP_TLS" == "true" ]]; then
    log "TLS issuance skipped. HTTP routing is installed."
    return
  fi

  check_domains

  log "Requesting/validating TLS for the six V3 nip.io domains."
  export ISSUE_TLS=true
  export CERTBOT_EMAIL
  bash ops/test-v3/scripts/install-nginx-tls.sh

  log "Running public HTTPS verification."
  bash ops/test-v3/scripts/verify-public.sh
}

verify_v2_unchanged(){
  log "Verifying V2 remained online."
  if [[ -x "$V2_REPO/ops/test-v2/scripts/smoke.sh" ]]; then
    bash "$V2_REPO/ops/test-v2/scripts/smoke.sh"
  else
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4200/api/v1/services/search >/dev/null
    curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3200/login >/dev/null
  fi
}

final_report(){
  local report="$REPORT_DIR/v3-deploy-$(date '+%Y%m%d-%H%M%S').txt"
  mkdir -p "$REPORT_DIR"
  {
    echo "CarePoint Entorno V3 deployment report"
    date
    echo "V3 HEAD: $(git -C "$V3_REPO" rev-parse HEAD)"
    echo
    echo "Domains:"
    printf '%s\n'       "$TEST_API_DOMAIN" "$TEST_ADMIN_DOMAIN" "$TEST_PATIENT_DOMAIN"       "$TEST_DOCTOR_DOMAIN" "$TEST_PROVIDER_DOMAIN" "$TEST_TRANSPORT_PROVIDER_DOMAIN"
    echo
    echo "Docker:"
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    echo
    echo "Listeners:"
    ss -ltnp | grep -E ':(3200|3300|4200|4300|8280|8281|8282|8380|8381|8382|8383)\b' || true
    echo
    echo "Disk/RAM:"
    free -h
    df -h /
  } >"$report"
  chmod 600 "$report"
  log "Deployment report saved: $report"
}

main(){
  require_root
  require_cmd awk
  require_cmd grep
  require_cmd getent

  ensure_packages
  check_resources
  check_v2
  check_v3_ports
  check_domains

  if [[ "$PREFLIGHT_ONLY" == "true" ]]; then
    log "Preflight-only mode complete. No changes were made."
    exit 0
  fi

  if [[ "$ASSUME_YES" != "true" ]]; then
    echo
    echo "V2 will remain active at: $V2_REPO"
    echo "V3 will be installed/updated at: $V3_REPO"
    echo "V3 ports: 4300, 3300, 8380, 8381, 8382, 8383"
    echo "Rich synthetic dataset reset: $([[ "$SKIP_RICH_DATA" == "true" ]] && echo NO || echo YES)"
    echo "TLS issuance: $([[ "$SKIP_TLS" == "true" ]] && echo NO || echo YES)"
    echo
    read -r -p "Type DEPLOY_ENTORNO_V3 to continue: " confirmation
    [[ "$confirmation" == "DEPLOY_ENTORNO_V3" ]] || die "Deployment cancelled."
  fi

  trap rollback_on_error ERR

  snapshot_v2_state
  prepare_repo
  load_or_create_secrets
  export_runtime
  clean_build_cache
  deploy_v3
  configure_nginx_tls
  verify_v2_unchanged
  final_report

  trap - ERR

  echo
  echo "============================================================"
  echo "CAREPOINT ENTORNO V3 DEPLOYMENT COMPLETE"
  echo "============================================================"
  echo "V2 remains active and untouched."
  echo "V3 repository: $V3_REPO"
  echo "V3 HEAD: $(git -C "$V3_REPO" rev-parse HEAD)"
  echo "API: https://$TEST_API_DOMAIN"
  echo "Admin: https://$TEST_ADMIN_DOMAIN"
  echo "Patient: https://$TEST_PATIENT_DOMAIN"
  echo "Doctor: https://$TEST_DOCTOR_DOMAIN"
  echo "Provider: https://$TEST_PROVIDER_DOMAIN"
  echo "Transport Provider: https://$TEST_TRANSPORT_PROVIDER_DOMAIN"
  echo "Admin account: $BOOTSTRAP_ADMIN_EMAIL"
  echo "Secrets file: $SECRETS_FILE (0600, outside repository)"
  echo
  echo "No .env file was created."
}

main "$@"
