# Transport Phase 26 — Compliance Evidence Export + Governance Manifest

Branch: `feature/transport-compliance-manifest-phase26-20261001`

## Objective

Phase 26 exports a privacy-preserving compliance evidence package for a Transport
management-report run.

The export is integrity-bound but is not falsely presented as cryptographically signed when
no approved signing service/key has been configured.

## Endpoint

`GET /admin/transport/report-runs/:runId/compliance-manifest`

Permission:

`TRANSPORT_OPERATE`

The export reuses Phase 23 governance evidence and includes:

- run summary
- artifact governance state
- retention / legal-hold state
- artifact integrity state
- delivery/download evidence
- ordered approved governance timeline
- audit-chain sequence/hash evidence
- canonical manifest SHA-256

## Canonicalization

Manifest schema:

`carepoint.transport.governance-manifest.v1`

Canonicalization:

`SORTED_JSON_KEYS_V1`

The service recursively sorts object keys, preserves array order, serializes canonical JSON,
and computes:

`manifestSha256 = SHA-256(canonicalJson)`

## Audit-chain evidence

The manifest includes:

- eventCount
- integrityEventCount
- missingIntegrityRecords
- firstSequence
- lastSequence
- lastEventHash

The export never includes raw audit metadata.

## Signing boundary

Current output is explicit:

- `status: EXTERNAL_SIGNING_REQUIRED`
- `cryptographicSignaturePerformed: false`
- `approvedSignerConfigured: false`
- `signingKeyReferenceIncluded: false`

This is intentional. Phase 26 does not invent a local private key, commit a secret, or claim
a cryptographic signature that does not exist.

A later production-signing phase can sign `manifestSha256` through an approved KMS/HSM
without changing the manifest payload.

## Privacy

The export excludes:

- raw audit metadata
- private object-storage key
- CSV content
- patient identity
- patient contact
- patient location

## Admin UI

The governance panel adds:

`Export compliance manifest`

The browser downloads a JSON file:

`carepoint-transport-compliance-manifest-<runId>.json`

The file includes the canonical SHA-256 integrity digest and the explicit external-signing
boundary.

## Audit

Export action:

`ADMIN_TRANSPORT_REPORT_COMPLIANCE_MANIFEST_EXPORTED`

Object type:

`TRANSPORT_REPORT_GOVERNANCE`

Purpose:

`COMPLIANCE_EVIDENCE`

## GitHub Actions acceleration

Phase 26 also introduces a two-tier validation strategy.

### Fast stacked-PR lane

For feature PRs whose base is another feature branch:

- CI remains active
- Security Analysis remains active
- superseded Security runs are cancelled automatically

### Full canonical integration lane

The 18 heavy validation workflows now run for PRs targeting:

- `main`
- `v2/development`
- `entorno-v2`
- `release/**`

They retain workflow_dispatch/push behavior already defined by each workflow.

Heavy gates include UAT, market readiness, promotion, PostgreSQL acceptance/recovery,
mobile, containers, FHIR, resilience, performance, infrastructure, deployment and release
evidence.

This removes repeated full-release validation from every stacked Transport micro-phase while
preserving the complete matrix before canonical integration.

## Environment

No new environment variables.

No `.env` file is added.

## Database

No database migration is required.

## Validation

`npm run v2:transport-phase26`

The contract verifies:

- canonical manifest schema
- SHA-256 digest generation
- sorted-key canonicalization
- audit-chain summary
- explicit non-signing boundary
- privacy exclusions
- Admin JSON export
- 18 heavy workflow branch filters
- heavy workflow concurrency presence
- Security Analysis cancel-in-progress
- package test-chain registration
