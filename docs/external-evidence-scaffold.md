# External Evidence Scaffold

Use this helper to create a local working copy of the approved evidence template for one external Go-Live gate.

It does **not** generate evidence, does not approve anything, and does not record gate acceptance.

## Create the recommended file

```bash
npm run v2:release-external-evidence-scaffold -- LIVE-01-PRODUCTION-INFRASTRUCTURE
```

The file is created under `ops/release-1/evidence/` with exclusive-create semantics. Existing files are never overwritten.

## Inspect without writing

```bash
npm run v2:release-external-evidence-scaffold -- LIVE-01-PRODUCTION-INFRASTRUCTURE --stdout
```

## What the helper changes

Only the governed current release SHA is populated where the approved template contains `release.sourceSha` or `releaseCandidate.sourceSha`.

All real evidence, status, approval, acceptance, timestamp, provider, device, security, UAT, resilience, regulatory and deployment fields remain exactly as the approved template defines them.

## Required workflow

1. Generate or inspect the scaffold.
2. Complete it with real sanitized external/human evidence.
3. Do not commit secrets, PHI/PII, signing material or restricted report bodies.
4. Run:
   `npm run v2:release-external-gate-preflight -- <gate-id> <evidence-file>`
5. Only after preflight passes and real acceptance metadata exists, update the governed Phase 32 evidence index.

A scaffold is **not evidence**.
A preflight pass is **not acceptance**.
A green CI result is **not production authorization**.

No new production environment variables.
No .env file.
No database migration.
