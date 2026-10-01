# External Gate Evidence Preflight

This helper lets an external owner validate one sanitized Go-Live evidence file against the **same Phase 32 rules** before submitting it into the governed 8-gate index.

It **does not accept a gate**, does not close an issue, does not authorize release activity, and **does not modify the real evidence index**.

## Usage

```bash
npm run v2:release-external-gate-preflight -- \
  LIVE-01-PRODUCTION-INFRASTRUCTURE \
  ops/release-1/evidence/production-infrastructure.json
```

The evidence file must already be stored under:

`ops/release-1/evidence/`

Example/template files are rejected.

## What it checks

The helper creates an ephemeral, repository-local Phase 32 index containing:

- the requested gate as temporary validation scaffold;
- the other seven gates as `PENDING`;
- the real SHA-256 of the supplied evidence;
- `productionAcceptance=false`;
- `mainMergeAllowed=false`;
- aggregate decision `BLOCKED`.

It then invokes the existing Phase 32 validator. A successful preflight requires Phase 32 to report exactly one structurally/semantically valid gate and seven pending gates.

The temporary scaffold is deleted in a `finally` block.

## Successful result

A successful command returns:

- `phase32RulesPassed=true`;
- `acceptanceRecorded=false`;
- `gateClosed=false`;
- `indexModified=false`;
- `finalDecision=PREFLIGHT_PASSED_NOT_ACCEPTANCE`.

Real acceptance still requires the governed evidence index, real acceptance references/timestamps, and the normal Phase 32 aggregate workflow.

Never place secrets, credentials, signing material, restricted penetration-test details, PHI or raw PII in repository evidence files.

No new production environment variables.

No .env file is added.

No database migration.
