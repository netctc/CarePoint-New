# CarePoint Release 1 — GCP/KSA G7 final acceptance runbook

This document is an operator procedure. It does not grant production acceptance by itself.

## Purpose

G7 is the final human and evidence gate for the CarePoint Release 1 GCP/KSA production profile. It runs only after the engineering contracts for G1–G6 are merged and after a final Release Candidate has been frozen and exercised in the protected production-equivalent environment.

Accepted provider profile:

- Provider: Google Cloud Platform (`gcp`)
- Jurisdiction: Saudi Arabia (`SA`)
- Primary region: `me-central2` (Dammam)
- Approved GCP Release 1 region set: `me-central2` only
- Geographic DR remains unproven for Release 1 until a separate second Saudi GCP region is explicitly approved and rehearsed.

Regional/multi-zone HA, PITR and soft-delete recovery must not be described as cross-region disaster recovery.

## Security and evidence boundary

Do not commit or paste into GitHub:

- `.env` files;
- service-account JSON/private keys;
- passwords, API keys, access/refresh tokens or bearer credentials;
- production database URLs or connection strings;
- PHI, patient identifiers, raw clinical documents or database dumps;
- sensitive raw cloud-resource inventory when policy requires restricted storage.

Use opaque restricted evidence references in the final manifest. Human approval records and real G5/G6/G7 evidence remain in the approved restricted evidence store.

## Required final evidence

Before G7 validation, prepare all of the following for one exact frozen RC SHA and release version:

1. Final G5 immutable deployment evidence for API and Admin, including the G5e bundle reference.
2. Final infrastructure evidence conforming to `carepoint.release-infrastructure-evidence/v1`.
3. GCP infrastructure overlay fields/resources required by `.ci/release-infrastructure-gcp-evidence-contract.mjs`.
4. Final G6a Cloud SQL PITR rehearsal evidence.
5. Final G6b Memorystore failover/recovery evidence.
6. Final G6c Cloud Storage soft-delete restore evidence.
7. A G7 manifest derived from `ops/release-1/gcp-final-acceptance-manifest.example.json`.

All evidence must refer to the same exact frozen RC. Do not rebuild images or substitute a later commit after evidence collection.

## Required human approvals

The final infrastructure evidence must contain APPROVE decisions from exactly these roles:

Operations, SRE, Database, Security, Privacy, Product

Each approval must include an opaque non-secret approver reference, an approval evidence reference and an approval timestamp. Approval evidence belongs in the restricted evidence store; do not place personal signatures, private contact information or internal authentication material in the repository.

The six approvals are a mandatory gate. CI contract checks cannot create, simulate or substitute them.

## Preconditions

Confirm that:

- the GCP readiness engineering branch contains all approved G1–G7 contracts;
- the final RC SHA is frozen only after the G7 contract is available;
- G5 immutable deployment evidence refers to that exact RC;
- G6a/G6b/G6c were executed against that exact RC and protected production-equivalent topology;
- Cloud SQL and Cloud Storage measured RPO remain <= 15 minutes where RPO applies;
- Cloud SQL, Memorystore and Cloud Storage recovery RTO remain <= 120 minutes;
- the final infrastructure evidence has `approved=true` and `overallStatus=PASS`;
- all mandatory infrastructure controls and destinations pass the base validator;
- GCP resources and telemetry destinations remain inside the approved `SA` / `me-central2` profile;
- no second Saudi GCP region is represented as approved;
- geographic DR is not claimed.

## Final validation procedure

Check out the exact frozen RC SHA in a clean workspace. Do not validate from a later branch head.

Place the restricted evidence files in a protected local/operator workspace outside the repository. Use paths to those local files when invoking the validators.

First validate the final infrastructure evidence directly:

```bash
node .ci/release-infrastructure-evidence-contract.mjs \
  --validate /restricted/gcp/final-infrastructure.json

node .ci/release-infrastructure-gcp-evidence-contract.mjs \
  --validate /restricted/gcp/final-infrastructure.json
```

Then validate the complete G6 continuity chain:

```bash
node .ci/release-gcp-continuity-bundle-contract.mjs \
  --validate-bundle \
  /restricted/gcp/g6a-cloud-sql.json \
  /restricted/gcp/g6b-memorystore.json \
  /restricted/gcp/g6c-cloud-storage.json \
  --out /restricted/gcp/g6d-continuity-result.json
```

Finally run the G7 acceptance gate:

```bash
node .ci/release-gcp-final-acceptance-contract.mjs \
  --validate-final \
  /restricted/gcp/g7-manifest.json \
  /restricted/gcp/final-infrastructure.json \
  /restricted/gcp/g6a-cloud-sql.json \
  /restricted/gcp/g6b-memorystore.json \
  /restricted/gcp/g6c-cloud-storage.json \
  --out /restricted/gcp/g7-final-acceptance-result.json
```

The command must fail closed for any SHA/version mismatch, missing approval, failed base/GCP infrastructure control, failed continuity objective, changed provider/region, invented second Saudi region or geographic-DR claim.

## Acceptance result

Only the real operator execution above, on the exact frozen RC with all restricted evidence present, may produce a result containing:

`productionAcceptance=true`

The result also preserves:

- `provider=gcp`;
- `jurisdiction=SA`;
- `region=me-central2`;
- `productionRecoveryEvidence=true`;
- `secondSaudiRegionApproved=false`;
- `geographicDrProven=false`.

A pull-request/CI contract artifact must never be interpreted as this result. CI evidence remains `productionAcceptance=false` and `productionRecoveryEvidence=false`.

## Post-validation actions

After the G7 result is stored in the restricted evidence system:

1. Record the opaque G7 final record reference in the release evidence index.
2. Confirm no evidence file containing secrets, PHI or sensitive live inventory entered Git history.
3. Update tracker #185 with the exact RC SHA, release version and sanitized evidence references only.
4. Mark G1–G7 tracker items complete only when their corresponding real evidence is present.
5. Close #185 only after the final G7 result exists and the GCP profile is independently deployable.
6. Keep OCI/KSA tracking and `release/release-1-oci-stable` intact; GCP acceptance does not supersede OCI.

## Geographic DR decision

The current Release 1 GCP/KSA scope proves recovery and regional HA behavior inside `me-central2`. It does not prove loss-of-region recovery. A future geographic-DR design requires a separately approved Saudi GCP region, data-residency review, replication/failover design, live rehearsal and new measured recovery evidence before `geographicDrProven=true` can ever be asserted.
