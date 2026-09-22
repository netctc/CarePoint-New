# CarePoint V2 synthetic test environment

This directory defines the repeatable **non-production / synthetic-only** deployment lane for branch `entorno-v2`.

## Candidate boundary

- Base commit: `6b360e7b41176078aee278f88f6e62f644c5dccb` (`v2/development`, merged PR #374).
- PR #375 (`DOC-082` clinical signature) is intentionally **not included** until its CI is green and it is merged.
- This lane is for technical/integration/UAT testing with synthetic data. It is **not** production-equivalent KSA acceptance and must not be used with real PHI/PII unless a separately approved data-governance decision explicitly permits it.

## Applications exposed

- API: `127.0.0.1:4000`
- Admin Web: `127.0.0.1:3000`
- Patient Flutter Web: `127.0.0.1:8080`
- Doctor Flutter Web: `127.0.0.1:8081`
- Other Provider Flutter Web: `127.0.0.1:8082`
- PostgreSQL and Redis are internal to the Docker network and have no host ports.

Host Nginx terminates TLS and routes the public test subdomains to those loopback ports.

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

The script validates required variables, builds all five applications, starts PostgreSQL/Redis, runs Prisma migrations, optionally bootstraps the admin account, and starts the test stack.

Run local smoke checks:

```bash
ops/test-v2/scripts/smoke.sh
```

## Nginx / TLS

1. Install Nginx and Certbot on the Ubuntu host.
2. Copy `nginx/carepoint-v2-http.conf.template` to `/etc/nginx/sites-available/carepoint-v2-test`.
3. Replace the five `__..._DOMAIN__` placeholders with the chosen test FQDNs.
4. Enable the site and run `nginx -t`.
5. Point DNS A/AAAA records to the VPS.
6. Run Certbot with all five names; let Certbot upgrade the Nginx server blocks to HTTPS.
7. Set `CAREPOINT_API_PUBLIC_BASE=https://<api-domain>/api/v1` and `CAREPOINT_ADMIN_PUBLIC_ORIGIN=https://<admin-domain>` before building/deploying.

## Data policy

- Synthetic personas only.
- Payment / insurance / claims / notification / telehealth adapters remain mock unless an explicit sandbox is being tested.
- Test storage and keys are isolated from production.
- Logs must not contain raw clinical payloads or credentials.
- The environment must display/operate as NON-PRODUCTION.

## Updating the candidate

Do not automatically fast-forward `entorno-v2` from open PRs. Promote a new `v2/development` SHA only after its required checks are green and the merged SHA is recorded in the test manifest/report. Keep the previous working candidate available for rollback.