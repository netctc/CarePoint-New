#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ! -r /etc/os-release ]]; then
  echo "ERROR: /etc/os-release is unavailable; expected Ubuntu/Debian host." >&2
  exit 2
fi

# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *)
    echo "ERROR: unsupported host OS '${ID:-unknown}'. This bootstrap targets Ubuntu/Debian." >&2
    exit 2
    ;;
esac

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=()
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "ERROR: sudo is required when not running as root." >&2
    exit 2
  fi
  SUDO=(sudo)
fi

export DEBIAN_FRONTEND=noninteractive

printf '==> Installing base host packages\n'
"${SUDO[@]}" apt-get update
"${SUDO[@]}" apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git nginx certbot python3-certbot-nginx

if ! command -v docker >/dev/null 2>&1; then
  printf '==> Installing Docker Engine from the official repository\n'
  "${SUDO[@]}" install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
    | "${SUDO[@]}" gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  "${SUDO[@]}" chmod a+r /etc/apt/keyrings/docker.gpg

  arch="$(dpkg --print-architecture)"
  codename="${VERSION_CODENAME:-}"
  if [[ -z "$codename" ]]; then
    echo "ERROR: VERSION_CODENAME is unavailable in /etc/os-release." >&2
    exit 2
  fi

  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/%s %s stable\n' \
    "$arch" "$ID" "$codename" \
    | "${SUDO[@]}" tee /etc/apt/sources.list.d/docker.list >/dev/null

  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  printf '==> Docker already installed: %s\n' "$(docker --version)"
fi

printf '==> Enabling Docker and Nginx\n'
"${SUDO[@]}" systemctl enable --now docker
"${SUDO[@]}" systemctl enable --now nginx

if ! docker compose version >/dev/null 2>&1; then
  if "${SUDO[@]}" docker compose version >/dev/null 2>&1; then
    echo "NOTE: current user cannot access Docker without sudo yet." >&2
  else
    echo "ERROR: Docker Compose v2 plugin is unavailable." >&2
    exit 1
  fi
fi

if [[ "${EUID}" -ne 0 && -n "${USER:-}" ]]; then
  if ! id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
    printf '==> Adding %s to docker group\n' "$USER"
    "${SUDO[@]}" usermod -aG docker "$USER"
    echo "NOTE: log out/in once before running Docker without sudo." >&2
  fi
fi

printf '==> Validating Nginx\n'
"${SUDO[@]}" nginx -t

cat <<'EOF'
Host bootstrap complete.
Next steps:
  1. Export the variables from ops/test-v2/variables.required.txt using real test-only values.
  2. Run ops/test-v2/scripts/configure-nginx-tls.sh after DNS points to this VPS.
  3. Run ops/test-v2/scripts/deploy.sh from the repository root.
EOF
