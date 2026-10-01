# Transport Phase 24 — Artifact Integrity Attestation + Drift Detection

Branch: `feature/transport-report-integrity-phase24-20261001`

## Objective

Phase 24 adds durable integrity attestation for private Transport management-report CSV
artifacts.

CarePoint already persists SHA-256 and byte-length evidence at generation time. Phase 24
periodically re-reads live private artifacts and verifies that the stored object still matches
that evidence.

## Persisted state

`TransportManagementReportRun` adds:

- `artifactIntegrityStatus`
- `artifactIntegrityLastCheckedAt`
- `artifactIntegrityFailureAt`
- `artifactIntegrityFailureCode`

Initial status:

`PENDING`

Possible worker states:

- `VERIFIED`
- `MISMATCH`
- `CHECK_FAILED`

## Verification policy

`TransportReportIntegrityService`

Fixed policy:

- verification interval: 24 hours
- worker batch: 50
- hard batch maximum: 100

Eligible artifacts must:

- belong to a successful run
- still have a private object key
- still have persisted SHA-256
- not be purged
- not have an active purge claim
- never have been checked, or have a check older than 24 hours

Legal hold does not suppress integrity verification.

## Verification

The worker reads the private CSV through the provider-neutral artifact storage service and
recomputes:

- SHA-256
- UTF-8 byte length

If both match:

`VERIFIED`

If stored bytes differ from persisted evidence:

`MISMATCH`

Failure codes include:

- `SHA256_MISMATCH`
- `BYTE_LENGTH_MISMATCH`

If storage cannot be read or verification cannot complete:

`CHECK_FAILED`

A read/check failure is not treated as a confirmed artifact mismatch.

## Purge-race safety

The verifier selects only runs without an active purge claim.

Before persisting a result it rechecks:

- same object key
- artifact not deleted
- no purge claim

If the retention worker wins the race, the integrity result is skipped instead of writing a
false failure to a purged artifact.

## Cloud Run Job

The existing Transport report job now runs:

1. report generation
2. report-ready delivery notification
3. artifact integrity verification
4. artifact retention/purge

Structured output includes:

`integrity`

The job returns non-zero when the integrity cycle reports:

- one or more confirmed mismatches
- one or more check failures

## Generation behavior

Every newly generated artifact resets integrity state to:

`PENDING`

and clears prior verification/failure timestamps and codes.

## Secure download behavior

Phase 19 download grants are not issued for a run whose durable integrity state is already:

`MISMATCH`

A grant issued before a later mismatch is still protected because the download path performs
its own SHA-256/byte validation before returning bytes.

A successful secure download is itself a complete integrity verification and promotes the run
to:

`VERIFIED`

with a fresh `artifactIntegrityLastCheckedAt`.

## Audit evidence

Successful verification:

`SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_VERIFIED`

Confirmed mismatch:

`SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_MISMATCH`

Check/read failure:

`SYSTEM_TRANSPORT_REPORT_ARTIFACT_INTEGRITY_CHECK_FAILED`

Purpose:

`DATA_INTEGRITY`

## Governance timeline

Phase 23 now includes integrity events and current integrity state.

Integrity events are categorized as:

`INTEGRITY`

The Admin governance panel shows:

- integrity state
- last check timestamp
- failure code, if present

The execution ledger also shows the current integrity status next to the private artifact.

## Privacy

Integrity processing does not add patient identity/location data.

No CSV bytes, object keys or raw audit metadata are exposed to the Admin governance timeline.

## Environment

No new environment variables.

No `.env` file is added.

## Database migration

`20261001012000_v2_transport_report_artifact_integrity`

## Validation

`npm run v2:transport-phase24`

The smoke contract verifies:

- integrity state fields/index
- 24-hour verification interval
- bounded candidate selection
- SHA-256/byte verification
- VERIFIED/MISMATCH/CHECK_FAILED states
- purge-race safety
- generation reset to PENDING
- MISMATCH download-grant block
- secure-download VERIFIED promotion
- Cloud Run integration
- governance timeline integration
- Admin integrity surfaces
- package test-chain registration
