# CarePoint V2 synthetic test environment

This directory defines the repeatable **non-production / synthetic-only** deployment lane for branch `entorno-v2`.

## Candidate boundary

- Functional baseline: current `v2/development` head `0e473de12f3d0b71885d5f3843f984f08bec6329`, synchronized into `entorno-v2` by PR #399.
- PR #375 (`DOC-082` clinical signature / MFA-assured Doctor signatures) is included because it was merged into `v2/development` on 2026-09-22 before this synchronization.
- Synchronization merge commit: `122975790c23c3df514ad94653fc954b00962244`.
- This lane is for technical/integration/UAT testing with synthetic data. It is **not** production-equivalent KSA acceptance and must not be used with real PHI/PII unless a separately approved data-governance decision explicitly permits it.

## Applications exposed

- API: `127.0.0.1:4000`
- Admin Web: `127.0.0.1:3000`
- Patient Flutter Web: `127.0.0.1:8080`
- Doctor Flutter Web: `127.0.0.1:8081`
- Other Provider Flutter Web: `127.0.0.1:8082`
- PostgreSQL and Redis are internal to the Docker network and have no host ports.

Host Nginx terminates TLS and routes the public test subdomains to those loopback ports.

## Recommended Ubuntu host

Ubuntu 24.04 LTS is the preferred baseline. A host that also builds all three Flutter Web apps should normally have at least 4 vCPU / 8 GB RAM / 80 GB SSD; 8 vCPU / 16 GB RAM / 120 GB SSD provides more comfortable build headroom. These are test-environment sizing recommendations, not production capacity figures.

## Host bootstrap

From a fresh Ubuntu VPS after creating a non-root sudo operator account:

```bash
sudo bash ops/test-v2/scripts/bootstrap-ubuntu.sh
```

The script installs Docker Engine from Docker's official apt repository, Nginx, Fail2ban and Certbot. It deliberately does **not** enable UFW because blindly rewriting a remote firewall can lock out SSH. Configure the real management IP/SSH port first, then allow only management SSH plus TCP 80/443.

Docker-published ports can interact with firewall policy, so the Compose lane binds API/Admin/mobile web ports to numeric loopback only and does not publish PostgreSQL or Redis.

## Required host variables

Do **not** commit `.env` files or secrets. Export the values listed in `variables.required.txt` in the deployment shell, CI secret store, or VPS secret manager.

Generate test-only secrets, for example:

```bash
openssl rand -hex 24        # DB / Redis password (URL-safe)
openssl rand -base64 32     # each local envelope/signing key
```

Use independent values for each key. Never copy production secrets into this environment.

## Deploy

From the repository root on the VPS:

```bash
git checkout entorno-v2
chmod +x ops/test-v2/scripts/*.sh
ops/test-v2/scripts/deploy.sh
```

The script validates required variables, builds API/Admin plus all three Flutter Web apps, starts PostgreSQL/Redis, runs Prisma migrations, optionally bootstraps the admin account and optionally loads the repository's synthetic private-pilot fixtures.

Run local smoke checks:

```bash
ops/test-v2/scripts/smoke.sh
```

## Nginx / TLS

Create five DNS records pointing to the VPS, export the five `TEST_*_DOMAIN` values, then install the HTTP routing:

```bash
sudo -E bash ops/test-v2/scripts/install-nginx-tls.sh
```

After DNS has propagated, request certificates:

```bash
export CERTBOT_EMAIL=<operator-email>
export ISSUE_TLS=true
sudo -E bash ops/test-v2/scripts/install-nginx-tls.sh
```

The installer validates the Nginx configuration, obtains one certificate covering the five test names, enables HTTPS redirect, reloads Nginx and runs a Certbot renewal dry-run.

After TLS is active, verify the five public endpoints and HTTP-to-HTTPS redirects:

```bash
ops/test-v2/scripts/verify-public.sh
```

## Data policy

- Synthetic personas only.
- Payment / insurance / claims / notification / telehealth adapters remain mock unless an explicit sandbox is being tested.
- Test storage and keys are isolated from production.
- Logs must not contain raw clinical payloads or credentials.
- PostgreSQL and Redis must remain unexposed on the host network.
- The environment must display/operate as NON-PRODUCTION.

## Validation gates

- `Entorno V2 Test Lane`: Node build, three Flutter Web builds, Compose configuration and deployment-script contract checks.
- `Entorno V2 VPS Contract`: deployment-script syntax and synthetic-lane boundary checks, including the public verification script.
- Run `smoke.sh` after every VPS deployment.
- Run `verify-public.sh` after DNS/TLS activation or routing changes.

A green test-lane workflow means the branch is structurally deployable; it does not close Release 1 KSA production, regulatory, security-assessment, real-provider, disaster-recovery or human-UAT gates.

## Updating the candidate

Do not automatically fast-forward `entorno-v2` from open PRs. Promote a new `v2/development` SHA only after its required checks are green and the merged SHA is recorded in the test manifest/report. Keep the previous working candidate available for rollback.
