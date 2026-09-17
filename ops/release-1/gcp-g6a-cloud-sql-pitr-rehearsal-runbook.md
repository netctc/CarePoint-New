# GCP G6a Cloud SQL PITR / Restore Rehearsal Runbook

## Purpose

This runbook closes the Cloud SQL portion of Release 1 GCP Phase G6 with measured production-equivalent recovery evidence. It does not grant production acceptance and it does not prove geographic disaster recovery.

The accepted Release 1 GCP/KSA database profile remains:

- jurisdiction `SA`;
- primary region `me-central2`;
- Cloud SQL for PostgreSQL 16 or later;
- `REGIONAL` high availability;
- automated backups enabled;
- point-in-time recovery enabled;
- public IPv4 disabled;
- private networking or Private Service Connect;
- TLS enforced;
- keyless runtime/deployment identity.

Multi-zone `REGIONAL` HA is availability evidence inside the approved region. It must never be represented as cross-region geographic DR.

## Safety boundary

Do not place any of the following in source control, workflow inputs, uploaded evidence, issue comments, or PR comments:

- database passwords or connection strings;
- service-account JSON/private keys;
- access tokens or API keys;
- `.env` files;
- PHI, patient identifiers, or clinical payloads;
- database dumps;
- unrestricted live cloud inventory.

Use only non-PHI continuity markers for recovery measurement. The sanitized evidence contract stores hashes/references rather than database contents or live instance identifiers.

## Required evidence before starting

The operator must have:

1. the exact frozen RC source SHA and release version;
2. approved G5e immutable deployment bundle evidence for that RC;
3. current G3b Cloud SQL production preflight evidence;
4. a protected `gcp-production-equivalent` GitHub environment;
5. keyless Workload Identity Federation configured for the recovery operator identity;
6. a recovery service account with only the Cloud SQL permissions required to inspect and clone the approved source instance;
7. an approved private-network execution path for restored database and application validation.

The GitHub-hosted control-plane workflow is intentionally not allowed to weaken private networking merely to reach the restored database.

## Protected GitHub variables

Configure these outside source control:

```text
GCP_PROJECT_ID=<approved-project-id>
GCP_WIF_PROVIDER=<approved-workload-identity-provider-resource>
GCP_RECOVERY_SERVICE_ACCOUNT=<approved-recovery-service-account>
CAREPOINT_GCP_CLOUD_SQL_INSTANCE=<approved-source-cloud-sql-instance>
```

No static credential variable is permitted.

## 1. Prepare a non-PHI continuity marker

Before the rehearsal, use the approved operational recovery-test mechanism to create or identify a timestamped **non-PHI synthetic continuity marker** in the source database.

Record through restricted evidence storage:

- marker identifier/reference;
- marker committed timestamp;
- evidence that it contains no patient or clinical information.

Do not paste the marker payload into GitHub.

The marker is used to measure actual data loss. RPO is not inferred merely from the requested PITR timestamp.

## 2. Establish the incident cutoff and PITR target

Record an RFC3339 UTC incident/cutoff timestamp. Select a PITR target at or before the cutoff and no more than 15 minutes before it.

The workflow rejects a PITR target outside the 900-second objective window, but final RPO is measured from the latest successfully recovered non-PHI marker.

## 3. Run the protected PITR workflow

Run **GCP Cloud SQL PITR Rehearsal** manually from the exact frozen RC context with:

- `source_sha`;
- `release_version`;
- `g5_bundle_evidence_ref`;
- `point_in_time_utc`;
- `incident_cutoff_utc`.

The workflow must authenticate through GitHub OIDC + Workload Identity Federation. It must not use a service-account key.

The workflow performs only the control-plane portion:

1. verifies the exact frozen RC checkout;
2. verifies the source Cloud SQL production profile;
3. creates a point-in-time clone in `me-central2`;
4. waits for the restored clone to become `RUNNABLE`;
5. verifies private-only networking, `REGIONAL` HA, backups/PITR and TLS on the clone;
6. captures sanitized instance-identity hashes and timing evidence;
7. leaves the clone available for approved private data-plane validation.

The uploaded clone-run evidence deliberately declares:

```text
requiresPrivateDataPlaneValidation=true
productionRecoveryEvidence=false
geographicDrClaimed=false
productionAcceptance=false
```

A successful clone workflow alone does **not** complete G6a.

## 4. Validate the restored database from the approved private network

Using the approved in-VPC/private execution path, validate the restored clone without enabling public IPv4.

Record restricted evidence showing at minimum:

- successful TLS/private connectivity;
- PostgreSQL major version meets the application minimum;
- expected schema/migration state exists;
- the latest recovered non-PHI continuity marker and its committed UTC timestamp;
- critical integrity checks pass;
- no unexpected patient-data export or dump was created by the rehearsal.

The latest recovered marker timestamp must not be newer than the selected PITR timestamp.

## 5. Validate application recovery

Against the restored database through the approved private path, prove the Release 1 API can reach an operational recovery state using the same immutable RC identity.

Capture restricted references for:

- exact RC SHA/version;
- restored-database application startup/readiness result;
- required database-dependent readiness checks;
- time at which application/data validation completed.

Do not copy production secrets, connection strings, or application logs containing sensitive data into the sanitized evidence file.

## 6. Measure RPO

Use:

```text
RPO = incidentCutoffUtc - latestRecoveredMarkerUtc
```

Acceptance requires:

```text
RPO <= 900 seconds
```

The final validator recomputes the value and rejects a supplied metric that does not match the timestamps.

## 7. Measure RTO

Use:

```text
RTO = dataValidationCompletedAtUtc - recoveryStartedAtUtc
```

`recoveryStartedAtUtc` is captured when the PITR recovery operation begins. `dataValidationCompletedAtUtc` is the time at which private restored-data and application recovery validation have completed successfully.

Acceptance requires:

```text
RTO <= 7200 seconds
```

The final validator recomputes the value from the evidence timestamps.

## 8. Remove the temporary recovery clone

After all required validation evidence has been captured, remove the temporary PITR clone through the approved operator process.

Verify deletion and record a restricted cleanup evidence reference plus `cleanupCompletedAtUtc`.

The automated clone workflow intentionally does **not** delete the instance because data-plane validation happens after the control-plane job. Final G6a evidence is rejected unless temporary-clone cleanup is explicitly verified.

## 9. Compose final G6a evidence

Copy `ops/release-1/gcp-cloud-sql-pitr-rehearsal.example.json` to an approved restricted evidence workspace, not to the repository, and populate it using sanitized references only.

Required final controls are:

```text
keylessAuthentication=true
sourcePreflightVerified=true
pitrCloneCreated=true
restoredInstanceRunnable=true
restoredInstancePrivateOnly=true
sameKsaRegion=true
dataPlaneValidationPassed=true
applicationRecoveryValidated=true
temporaryCloneCleanupVerified=true
geographicDrClaimed=false
productionRecoveryEvidence=true
productionAcceptance=false
```

`topology.geographicDrProven` must remain `false`.

## 10. Validate final evidence on the exact RC checkout

From the exact frozen RC checkout run:

```bash
node .ci/release-gcp-cloud-sql-pitr-rehearsal-contract.mjs --validate /restricted/path/g6a-cloud-sql-pitr.json --out /restricted/path/g6a-result.json
```

A valid result proves the measured Cloud SQL PITR/restore rehearsal met the Release 1 RPO/RTO objectives for this production-equivalent test. It still does not grant production acceptance and does not establish a second GCP/KSA geographic DR region.

## Exit criteria

G6a Cloud SQL recovery evidence is complete only when all of the following are true:

- exact G5e RC identity is linked;
- source G3b production profile was verified;
- PITR clone was created in `me-central2` using keyless identity;
- restored clone remained private-only and `RUNNABLE`;
- private data-plane validation passed;
- application recovery validation passed;
- measured RPO is at most 15 minutes;
- measured RTO is at most 120 minutes;
- temporary clone cleanup is verified;
- no geographic DR claim is made;
- `productionAcceptance=false` remains explicit.

Cache recovery, object-storage recovery/versioning, geographic-DR policy and final human approvals remain separate G6/G7 work.
