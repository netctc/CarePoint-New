# CarePoint Entorno V3 online test lane

This directory defines the **non-production / synthetic-only** online test lane for branch `entorno-v3`.

## Purpose

`entorno-v3` starts from the final technical checkpoint validated on 2026-10-01:

`4ff25214d12be1b6ac213b6ad91f63157111738d`

That checkpoint completed the canonical technical validation and evidence-operation tooling. Production infrastructure and the eight external/human Go-Live gates are still not complete.

This lane exists so the consolidated system can be exercised online before production infrastructure is finalized.

## Boundaries

- Synthetic/staging data only.
- No real PHI/PII/card data.
- PostgreSQL and Redis remain internal to Docker.
- Payment, insurance, claims, notification, DICOM and telehealth remain mock/sandbox unless explicitly testing a sandbox integration.
- `REGISTRATION_OTP_DELIVERY_MODE=display` is allowed only in this non-production lane.
- Do not reuse production secrets.
- Do not commit `.env` files.

## Public applications

The V3 stack exposes six HTTPS test endpoints through host Nginx:

- API → loopback `4200`
- Admin Web → loopback `3200`
- Patient Flutter Web → loopback `8280`
- Doctor Flutter Web → loopback `8281`
- Other Provider Flutter Web → loopback `8282`
- Transport Provider Flutter Web → loopback `8283`

## Host preparation

Use Ubuntu 24.04 LTS.

The existing bootstrap remains valid:

```bash
sudo bash ops/test-v2/scripts/bootstrap-ubuntu.sh
```

No production infrastructure dependency is required for this synthetic lane.

## Configure domains

For temporary VPS testing with nip.io:

```bash
source ops/test-v3/scripts/use-nipio-domains.sh <VPS_PUBLIC_IPV4>
```

Or export the six `TEST_*_DOMAIN` values manually.

## Required variables

Use `ops/test-v3/variables.required.txt` as the checklist.

Configure values manually in the shell, Dokploy/VPS secret store or CI secret store. No `.env` file is included.

## Deploy

```bash
git checkout entorno-v3
git pull --ff-only
chmod +x ops/test-v3/scripts/*.sh

export TEST_RELEASE_VERSION=entorno-v3
# export all required test-only secrets and domains

ops/test-v3/scripts/deploy.sh
ops/test-v3/scripts/smoke.sh
```

Install public routing:

```bash
sudo -E bash ops/test-v3/scripts/install-nginx-tls.sh
```

After DNS propagation, enable TLS:

```bash
export ISSUE_TLS=true
export CERTBOT_EMAIL=<operator-email>
sudo -E bash ops/test-v3/scripts/install-nginx-tls.sh
```

Then verify:

```bash
ops/test-v3/scripts/verify-public.sh
```

## Rich synthetic dataset

The existing V2 synthetic data tooling remains the data generator used by V3 because it already covers the current schema and full rich dataset.

Use the same guarded variables described in `ops/test-v2/README.md`, then run through the V3 Compose stack.

## Release identity

`ops/test-v3/scripts/deploy.sh` defaults:

- `TEST_RELEASE_SHA` to the checked-out Git SHA.
- `TEST_RELEASE_VERSION=entorno-v3`.

All Flutter Web apps receive the same release SHA and the HTTPS test API base at build time.

## What a green Entorno V3 test means

A green V3 test lane proves that the consolidated branch is structurally buildable/deployable for online synthetic testing.

It does **not** mean:

- production infrastructure is accepted;
- real provider integrations are accepted;
- signed mobile production releases exist;
- independent pentest/UAT/resilience/KSA approvals are complete;
- production deployment or project closure is authorized.
