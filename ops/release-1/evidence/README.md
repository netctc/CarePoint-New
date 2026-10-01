# CarePoint External Evidence Intake

This directory is the governed repository location for **sanitized external/human Go-Live evidence files** referenced by the Phase 32 evidence index.

## Important release binding

Do not infer the evidence release SHA from the latest tooling/CI pull request.

Every evidence file must use the exact `releaseCandidate.sourceSha` required by:

- `ops/release-1/final-go-live-gate-readiness-phase31.json`
- `ops/release-1/go-live-evidence-index.example.json`

If release governance intentionally changes that candidate, update the governing contracts first and re-run their canonical validation. Do not silently rebind evidence to a newer SHA.

## Recommended filenames

| Gate | Recommended evidence file |
| --- | --- |
| LIVE-01-PRODUCTION-INFRASTRUCTURE | `production-infrastructure.json` |
| LIVE-02-EXTERNAL-PROVIDERS | `external-providers.json` |
| LIVE-03-SIGNED-MOBILE-RELEASES | `signed-mobile-releases.json` |
| LIVE-04-INDEPENDENT-SECURITY-ASSESSMENT | `independent-security-assessment.json` |
| LIVE-05-HUMAN-UAT | `human-uat.json` |
| LIVE-06-RESILIENCE-RPO-RTO | `resilience-rpo-rto.json` |
| LIVE-07-KSA-MARKET-CLINICAL-APPROVALS | `ksa-market-clinical-approvals.json` |
| LIVE-08-DEPLOYMENT-ROLLBACK-REHEARSAL | `deployment-rollback-rehearsal.json` |

Filenames are recommendations; the Phase 32 evidence index remains authoritative.

## Evidence rules

Repository evidence must contain only sanitized metadata and references.

Never commit:

- passwords, access/refresh tokens or cookies;
- API keys, private keys or signing material;
- raw provider credentials;
- PHI or raw PII;
- restricted penetration-test report bodies;
- unredacted infrastructure secrets;
- production secret values.

Use approved external systems for restricted source evidence and store only stable, non-secret references here.

## Workflow

1. Start from the approved gate template referenced by Phase 31.
2. Replace placeholders with real sanitized evidence/reference values.
3. Keep the file under this directory.
4. Run the single-gate preflight:

```bash
npm run v2:release-external-gate-preflight -- \
  <LIVE-GATE-ID> \
  ops/release-1/evidence/<evidence-file.json>
```

5. A successful preflight must still report:
   - `acceptanceRecorded=false`;
   - `gateClosed=false`;
   - `indexModified=false`;
   - `PREFLIGHT_PASSED_NOT_ACCEPTANCE`.
6. Obtain real human/external acceptance metadata.
7. Add the evidence file SHA-256 and acceptance references to the governed Phase 32 evidence index.
8. Run the full Phase 32 validator.
9. Only 8/8 accepted evidence can advance to human release authorization.

## Safety boundary

A preflight pass is **not** gate acceptance.

A green automated workflow is **not** production acceptance.

No evidence intake action authorizes merge, deployment, release closure or project closure.

No new production environment variables are required.

No .env file belongs in this directory.
