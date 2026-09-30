# GCP G6c — Cloud Storage recovery rehearsal runbook

## Purpose

This runbook validates recoverability of the CarePoint Release 1 GCP/KSA **clinical-documents** object-storage domain after an accidental object deletion.

It is a recovery/continuity control. It is not a deployment workflow, not a geographic disaster-recovery claim, and not production acceptance.

The accepted Release 1 GCP/KSA location remains:

- jurisdiction: `SA`
- region: `me-central2`
- provider: Google Cloud Storage

## Recovery model

G6c exercises Cloud Storage soft delete with a synthetic non-PHI marker object:

1. bind the rehearsal to the exact frozen RC SHA/version and approved G5e bundle;
2. authenticate with GitHub OIDC + Workload Identity Federation;
3. force Cloud Storage CLI traffic through `https://storage.me-central2.rep.googleapis.com/`;
4. inspect the clinical bucket and verify region, public-access prevention, uniform bucket-level access, default CMEK and soft-delete retention;
5. write a small synthetic continuity marker under the clinical prefix;
6. read it back and record its SHA-256 digest;
7. delete it;
8. prove the object is visible only as soft-deleted;
9. restore the latest soft-deleted generation;
10. read it back and prove byte-for-byte integrity;
11. remove the restored live synthetic object;
12. emit only sanitized evidence.

The final live object is removed, but Cloud Storage soft delete intentionally retains the deleted synthetic generation until the configured soft-delete retention expires. The marker contains no PHI, patient identifiers, credentials or secrets.

## Preconditions

The operator must have an approved frozen Release Candidate and restricted G5e immutable deployment-bundle evidence for the same source SHA/version.

The protected GitHub environment `gcp-production-equivalent` must provide these non-secret variables:

- `GCP_PROJECT_ID`
- `GCP_WIF_PROVIDER`
- `GCP_RECOVERY_SERVICE_ACCOUNT`
- `CAREPOINT_DOCUMENT_BUCKET_REF`
- `CAREPOINT_DOCUMENT_STORAGE_KEY_REF`

Do not store any of the following in the repository, workflow inputs or uploaded evidence:

- `.env` files;
- service-account JSON;
- private keys;
- access/refresh tokens;
- API keys;
- database passwords or connection strings;
- PHI or patient identifiers;
- raw clinical documents;
- production object names or bucket names in the uploaded evidence.

## Required bucket profile

The workflow fails closed unless the clinical bucket proves all of the following:

- location exactly `me-central2`;
- public access prevention `enforced`;
- uniform bucket-level access enabled;
- default customer-managed encryption key equal to the approved `CAREPOINT_DOCUMENT_STORAGE_KEY_REF`;
- soft-delete retention at least 7 days and less than 90 days.

The soft-delete window is the recovery mechanism for the deletion scenario covered by G6c. It does not establish cross-region or geographic DR.

## Run the rehearsal

Dispatch `.github/workflows/gcp-cloud-storage-recovery.yml` with:

- `source_sha`: the exact 40-character frozen RC SHA;
- `release_version`: the approved frozen RC version;
- `g5_bundle_evidence_ref`: the restricted G5e evidence reference.

The workflow checks out `source_sha` exactly before authenticating to Google Cloud.

## Expected behavior

The workflow writes only a synthetic marker resembling:

```text
carepoint-g6c-continuity
source=<frozen-sha>
version=<release-version>
run=<github-run-id>
attempt=<github-run-attempt>
```

This marker is operational test data, not clinical data.

The workflow then:

- uploads and re-downloads the marker;
- records the pre-delete digest;
- starts the recovery timer;
- soft-deletes the object;
- lists the exact object with `--soft-deleted`;
- restores the latest soft-deleted generation;
- downloads the restored object;
- requires the restored digest to equal the original digest;
- requires measured RTO <= 7200 seconds;
- records measured RPO as `0` seconds for this exact deletion/soft-delete scenario because the exact deleted generation is restored without content loss;
- removes the restored live object.

That RPO statement applies only to the tested accidental-deletion scenario while the object remains inside the configured soft-delete window. It is not a regional-disaster RPO claim.

## Regional endpoint boundary

The rehearsal uses:

`https://storage.me-central2.rep.googleapis.com/`

through `CLOUDSDK_API_ENDPOINT_OVERRIDES_STORAGE`.

G6c therefore proves that the recovery operation itself used the supported `me-central2` regional Cloud Storage endpoint.

G6c does **not** by itself claim that every existing CarePoint application request uses a regional API endpoint. Application-runtime endpoint hardening is a separate runtime concern and must not be inferred from this rehearsal.

## Evidence output

The uploaded `recovery.json` contains:

- exact source SHA and release version;
- opaque G5e evidence reference;
- `SA` / `me-central2` scope;
- SHA-256 hash of bucket identity, not the bucket name;
- SHA-256 hash of synthetic object identity, not the object name;
- soft-delete retention duration;
- pre-delete and restored content SHA-256 digests;
- recovery start/completion timestamps;
- measured RPO/RTO;
- boolean controls proving the rehearsal steps;
- `geographicDrClaimed=false`;
- `productionAcceptance=false`.

Raw bucket metadata, raw object paths, marker files and temporary downloads are deleted before artifact upload.

## Acceptance thresholds

A final G6c evidence record is valid only when:

- the exact frozen RC is bound;
- G5e is bound;
- WIF/keyless authentication was used;
- the regional endpoint was used;
- the clinical bucket controls passed;
- soft delete was enabled with the accepted retention window;
- the object was created, read, soft-deleted and restored;
- restored content matched exactly;
- measured RPO <= 900 seconds;
- measured RTO <= 7200 seconds;
- the restored live synthetic object was removed;
- `geographicDrClaimed=false`;
- `productionRecoveryEvidence=true`;
- `productionAcceptance=false`.

The contract validator is:

```bash
node .ci/release-gcp-cloud-storage-recovery-contract.mjs \
  --validate-final <restricted-recovery.json> <exact-source-sha>
```

## Failure handling

If any step fails:

1. do not edit the evidence to force a pass;
2. do not weaken bucket public-access, CMEK or residency controls;
3. do not switch to a global endpoint merely to make the rehearsal pass;
4. do not use static Google credentials;
5. inspect the failed control and correct the production-equivalent configuration;
6. rerun against the same frozen RC only after the underlying issue is corrected.

If a run fails after creating the synthetic object, an authorized operator should use the protected environment to check whether the exact synthetic object remains live and remove it. Do not bulk-delete or bulk-restore clinical objects.

## Explicit non-claims

A successful G6c rehearsal does not prove:

- a second approved Saudi GCP region exists;
- geographic DR;
- recovery from total `me-central2` regional loss;
- Cloud SQL or Memorystore recovery (covered separately by G6a/G6b);
- FHIR bulk-export regeneration continuity;
- final G7 human approvals;
- production acceptance.

Those claims require separate evidence and must remain false until independently proven.
