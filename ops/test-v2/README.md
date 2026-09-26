# CarePoint V2 synthetic test environment

This directory defines the repeatable **non-production / synthetic-only** deployment lane for branch `entorno-v2`.

## Candidate boundary

- Functional baseline: merged `v2/development` SHA `e0368aa01dfb1362dce183079c95637045ce86d3`.
- The baseline includes the immutable integrated multi-app bundle from PR #442 and signed medication reconciliation P0 from PR #445.
- Environment synchronization branch: PR #447; its merge commit is intentionally recorded by Git history rather than hard-coded before merge.
- This lane is for technical/integration/UAT testing with synthetic data. It is **not** production-equivalent KSA acceptance and must not be used with real PHI/PII unless a separately approved data-governance decision explicitly permits it.

## Applications exposed

- API: `127.0.0.1:4200`
- Admin Web: `127.0.0.1:3200`
- Patient Flutter Web: `127.0.0.1:8280`
- Doctor Flutter Web: `127.0.0.1:8281`
- Other Provider Flutter Web: `127.0.0.1:8282`
- PostgreSQL and Redis are internal to the Docker network and have no host ports.

Host Nginx terminates TLS and routes the public test subdomains to those loopback ports.


### Flutter Web release configuration

The three Flutter Web applications are built in release mode. The test Docker build therefore injects all release-time values required by `CarePointMobileReleaseConfig`:

- `CAREPOINT_API_BASE` = the public HTTPS API base.
- `CAREPOINT_BUILD_ENV=staging`.
- `CAREPOINT_RELEASE_SHA` = the full 40-character deployed Git SHA.

Missing build environment or release SHA causes the Flutter application to fail before the login UI is rendered, while Nginx `/healthz` can still return 200. `smoke.sh` and `verify-public.sh` now check the Flutter root and generated JavaScript assets as well as `/healthz`.

The generic repository Dockerfile keeps its default image metadata, but this test lane overrides the API runtime `PORT` to `4200` and the Admin runtime `PORT` to `3200` in Compose. The Flutter Web containers still listen internally on port 80 and are published only to loopback ports `8280`, `8281` and `8282`.

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


### Synthetic integral-test data

After the API has been rebuilt from this branch, load or refresh the deterministic synthetic dataset:

```bash
export CAREPOINT_TEST_FIXTURE_PASSWORD='<test password with at least 16 characters>'
export CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN=carepoint.test
export CAREPOINT_TEST_FIXTURE_TIMEZONE=Asia/Riyadh
ops/test-v2/scripts/load-test-fixtures.sh
```

The loader is idempotent and safety-gated to databases whose name contains `test`, `pilot`, `staging` or `uat`. It creates/refreshes:

- one dedicated ADMIN and one SUPPORT account;
- five PATIENT accounts;
- one DOCTOR account for every active medical specialty;
- one OTHER_PROVIDER account for every active provider category;
- verified synthetic credentials and schedulable services where the category supports appointment modalities;
- appointment history spanning approximately the previous 30 days;
- open booking slots spanning approximately the next 30 days.

All managed accounts use the runtime value of `CAREPOINT_TEST_FIXTURE_PASSWORD`. The password is never committed or printed. MFA state is reset only for those managed synthetic accounts so privileged/provider accounts can perform a fresh test enrollment.

For a nip.io VPS, load all public hostnames into the current shell with:

```bash
source ops/test-v2/scripts/use-nipio-domains.sh 167.86.92.207
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
