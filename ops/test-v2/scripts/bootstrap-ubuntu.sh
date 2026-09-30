#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 2
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "ERROR: this bootstrap is intended for Ubuntu." >&2
  exit 2
fi
case "${VERSION_ID:-}" in
  22.04|24.04|26.04) ;;
  *) echo "WARNING: Ubuntu ${VERSION_ID:-unknown} is not one of the explicitly validated releases (22.04/24.04/26.04)." >&2 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg openssl nginx fail2ban ufw python3 python3-venv libaugeas0

# Install Docker Engine from Docker's official apt repository.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker nginx fail2ban

# Certbot in an isolated venv, following current Certbot guidance.
if [[ ! -x /opt/certbot/bin/certbot ]]; then
  python3 -m venv /opt/certbot
  /opt/certbot/bin/pip install --upgrade pip
  /opt/certbot/bin/pip install certbot certbot-nginx
fi
ln -sf /opt/certbot/bin/certbot /usr/local/bin/certbot

cat <<'EOF'

CarePoint V2 VPS prerequisites installed.

SECURITY: this script intentionally does NOT enable or rewrite UFW rules because changing
SSH access remotely can lock out the operator. Before exposing the server, allow only the
actual SSH management source/port plus 80/tcp and 443/tcp, then enable UFW. Example only:

  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow from <ADMIN_PUBLIC_IP>/32 to any port <SSH_PORT> proto tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw enable

Docker-published ports can bypass some UFW rules. CarePoint's test Compose binds application
ports to 127.0.0.1 and leaves PostgreSQL/Redis un-published; verify this remains true before use.
Do not add the deployment user to the docker group unless root-equivalent Docker access is intended.

Next: clone CarePoint-New, checkout entorno-v2, export runtime-only variables, configure Nginx,
then run ops/test-v2/scripts/deploy.sh.
EOF
