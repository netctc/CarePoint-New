# CarePoint Release 1 — GCP/KSA G6d continuity closure

## Purpose

G6d is the technical closure gate for R3-GCP Phase G6. It does not execute another recovery event. It combines the final restricted evidence from:

- G6a — Cloud SQL PITR/restore rehearsal;
- G6b — Memorystore Standard HA failover/application recovery rehearsal;
- G6c — Cloud Storage clinical-object soft-delete/restore rehearsal.

The bundle is valid only when all three evidence files describe the same exact frozen Release Candidate, the same Release 1 version, the same G5e immutable deployment bundle, and the accepted Saudi Arabia GCP region `me-central2`.

G6d is not production acceptance. G7 human approvals remain separate.

## Safety boundary

Do not place any of the following in Git, workflow artifacts, issue comments or pull-request comments:

- `.env` files;
- service-account JSON/private keys;
- access or refresh tokens;
- database connection strings;
- Redis credentials;
- patient identifiers or PHI;
- raw production object names/content;
- raw private resource inventory when an opaque evidence reference is sufficient.

Keep final G6a/G6b/G6c evidence in the approved restricted evidence store.

## Required inputs

Obtain the final real evidence files generated and privately validated for the exact frozen RC:

1. G6a Cloud SQL PITR evidence with `productionRecoveryEvidence=true`.
2. G6b Memorystore failover evidence with `productionRecoveryEvidence=true`.
3. G6c Cloud Storage recovery evidence with `productionRecoveryEvidence=true`.

All three must already have passed their original phase validator. G6d invokes those validators again before cross-slice aggregation.

## Exact-RC execution

Check out the exact frozen RC SHA represented by all three evidence files. Do not run G6d from a later documentation or evidence-only commit and do not rebuild the RC.

Example operator sequence:

```bash
git checkout --detach <EXACT_FROZEN_RC_SHA>
test "$(git rev-parse HEAD)" = "<EXACT_FROZEN_RC_SHA>"
test -z "$(git status --porcelain)"

node .ci/release-gcp-continuity-bundle-contract.mjs \
  --validate-bundle \
  /restricted/g6a-cloud-sql.json \
  /restricted/g6b-memorystore.json \
  /restricted/g6c-cloud-storage.json \
  --out /restricted/g6d-continuity-result.json
```

The three input paths and the output path above are examples only. Do not commit the real evidence files.

## Cross-slice controls

The validator rejects the bundle unless all of the following are true:

- G6a schema/phase is the Cloud SQL PITR final-evidence contract.
- G6b schema/phase is the Memorystore failover final-evidence contract.
- G6c schema/phase is the Cloud Storage recovery final-evidence contract.
- every slice uses the exact same 40-hex RC source SHA;
- every slice uses the exact same release version;
- every slice references the same G5e immutable deployment bundle;
- every slice is `gcp`, `SA`, `me-central2`;
- all three slices have final production recovery evidence;
- none of the slices grants production acceptance;
- none of the slices claims geographic DR;
- Cloud SQL measured RPO is <= 900 seconds;
- Cloud Storage measured RPO is <= 900 seconds;
- Cloud SQL measured RTO is <= 7200 seconds;
- Memorystore application recovery is <= 7200 seconds;
- Cloud Storage measured RTO is <= 7200 seconds.

Memorystore has no database-style RPO in G6d because CarePoint treats it as ephemeral, non-authoritative state. Its required continuity measurement is application recovery time after failover.

## Aggregate metrics

G6d reports:

- `overallApplicableRpoSeconds` = maximum of Cloud SQL RPO and Cloud Storage RPO;
- `overallRtoSeconds` = maximum of Cloud SQL RTO, Memorystore application-recovery time and Cloud Storage RTO;
- `rpoObjectiveSeconds` = `900`;
- `rtoObjectiveSeconds` = `7200`.

A final G6d result sets `phaseComplete=true` only when these objectives and every cross-slice control pass.

## Geographic DR decision

The current Release 1 GCP/KSA topology has one approved Saudi region: `me-central2`.

Therefore the G6d result must retain:

- `secondSaudiRegionApproved=false`;
- `geographicDrClaimed=false`;
- `geographicDrProven=false`.

Cloud SQL regional HA, Memorystore Standard HA, Cloud Storage soft-delete recovery and multi-zone behavior are continuity controls inside the accepted regional architecture. They are not evidence of recovery from total regional loss.

If a second Saudi GCP region is later formally approved, geographic DR requires a separate architecture decision, residency/privacy review, implementation, rehearsal and evidence contract. Do not reinterpret this G6d result retroactively.

## Evidence review

After validation, verify the sanitized G6d result contains:

- the exact RC SHA and release version;
- `provider=gcp`;
- `jurisdiction=SA`;
- `region=me-central2`;
- the common opaque G5e evidence reference;
- component and aggregate recovery metrics;
- `phaseComplete=true`;
- `productionRecoveryEvidence=true`;
- `geographicDrProven=false`;
- `productionAcceptance=false`.

Store the result in the restricted Release 1 evidence location and record only its approved opaque reference/hash in later acceptance material.

## G6 completion boundary

Passing G6d means the Release 1 GCP/KSA candidate has internally consistent, measured continuity evidence for the scoped Cloud SQL, Memorystore and clinical Cloud Storage recovery scenarios and meets the Release 1 RPO/RTO objectives for those scenarios.

It does **not** mean:

- a total `me-central2` outage has been recovered;
- geographic DR is implemented;
- a second Saudi GCP region exists or is approved;
- production deployment has been accepted;
- compliance/privacy/security/product sign-off has been granted.

Those claims remain outside G6.

## Next phase — G7

After the real G6d bundle passes on the exact frozen RC, proceed to G7 final acceptance. G7 requires the designated human approval roles:

- Operations;
- SRE;
- Database;
- Security;
- Privacy;
- Product.

Final GCP live evidence must pass the base production-infrastructure validator plus the GCP extension validator on the exact RC. G7 must not infer approval from CI contract evidence.
