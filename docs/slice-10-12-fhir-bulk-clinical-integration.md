# Slice 10.12 — FHIR Bulk Data Clinical Domain Integration

## Purpose

Slice 10.12 extends the hardened asynchronous FHIR Bulk Data export introduced in Slices 10.10–10.11 to a deliberately bounded set of clinical resources without bypassing CarePoint's encrypted domain services.

The export surface now supports:

- `Patient`
- `Appointment`
- `Encounter`
- `Observation`
- `MedicationRequest`
- `ServiceRequest`
- `DiagnosticReport`

`DocumentReference`, `ImagingStudy`, clinical document binaries and raw DICOM/PACS references are intentionally excluded from this slice.

## SMART backend authorization

The backend-client registry accepts the following additional system scopes:

- `system/Encounter.rs`
- `system/Observation.rs`
- `system/MedicationRequest.rs`
- `system/ServiceRequest.rs`
- `system/DiagnosticReport.rs`

These scopes are interpreted by CarePoint as authorization for the corresponding resource type inside the protected Bulk Data `$export` operation only in Slice 10.12. They do **not** enable interactive backend-service reads/searches of those clinical resources.

Direct system-token requests to the existing Encounter, Observation, MedicationRequest, ServiceRequest and DiagnosticReport endpoints fail closed with FHIR `OperationOutcome` 403 responses. Patient and Appointment retain the narrower interactive system behavior introduced in Slice 10.9.

## Domain security boundary

The bulk layer does not decrypt clinical ciphertext or inspect cryptographic material directly. New internal export bridges remain owned by the corresponding domain modules:

### Clinical records

`ClinicalSystemExportService` selects the latest encrypted clinical record for each documented encounter, validates the record/appointment patient and provider relationship, then decrypts through `ClinicalEnvelopeService`.

Only the resulting domain view is handed to the FHIR mapper. AES envelope fields are never exposed to the FHIR exporter or output artifacts.

### Clinical orders and laboratory results

`OrdersSystemExportService` verifies the existing clinical-order attestation before decrypting a prescription or laboratory order through `OrdersEnvelopeService`.

Laboratory result payloads are decrypted only when the result is `RELEASED`. The existing validated-result attestation is verified before the released result is materialized for FHIR Observation mapping.

An ENTERED or VALIDATED-but-unreleased laboratory result is not eligible for Bulk Data Observation export.

### Diagnostic reports

`DocumentsSystemExportService` exports only `RELEASED` diagnostic reports. It verifies the stored diagnostic report signature and payload digest before decrypting the report envelope through `DocumentsEnvelopeService`.

`DRAFT` and `FINAL` but unreleased reports remain outside the backend Bulk Data output.

## FHIR mappings

### Encounter

A documented CarePoint appointment is represented as an ambulatory FHIR Encounter with:

- Patient subject
- Practitioner participant
- Appointment reference
- service/modality context
- appointment period
- `in-progress` or `finished` status based on CarePoint encounter finalization

### Observation

The Observation export combines two protected sources:

1. vital signs from the latest decrypted clinical record for each documented encounter;
2. observations from released laboratory results only.

Laboratory observations retain their `ServiceRequest` `basedOn` reference and are always emitted as `final` after the release gate.

### MedicationRequest

Prescription orders are mapped after order-attestation verification and decryption. Medication coding, dosage text, quantity, refill count and requester/encounter references use the same semantics as the interactive FHIR facade.

### ServiceRequest

Laboratory orders are mapped after order-attestation verification and decryption. Test concepts, priority, patient instructions, requester and encounter references are preserved.

A ServiceRequest may be present before a result is released; this does not expose the unreleased result itself.

### DiagnosticReport

Only released diagnostic reports are mapped. Findings/impression/recommendation and configured codes are materialized after signature verification and envelope decryption.

A relative `DocumentReference/{id}` relationship may be present when a report is associated with a clinical document, but the document itself, binary bytes, object-storage location and PACS reference are not exported in Slice 10.12.

## Asynchronous protocol and output protection

Slice 10.12 preserves all Slice 10.10–10.11 controls:

- `Prefer: respond-async`
- 202 kickoff with protected `Content-Location`
- same-backend-client ownership for polling, download and cancellation
- exact per-resource SMART system-scope enforcement
- `application/fhir+ndjson` output
- deterministic file partitioning
- default 1,000 resources per file
- resource-count and payload-byte safety caps
- private output URLs with access-token requirement
- SHA-256 and byte-length validation before download
- no-store response hardening
- artifact retention/expiry
- distributed rate limiting
- cancellation and artifact cleanup

## `_typeFilter`

Slice 10.12 does not broaden `_typeFilter` semantics.

Strict `_typeFilter` remains limited to:

- `Patient?_id=...`
- `Appointment?patient=...&status=...`

A filter targeting Encounter, Observation, MedicationRequest, ServiceRequest or DiagnosticReport is rejected explicitly rather than silently ignored.

## `_since` semantics

For orders, released laboratory results and released diagnostic reports, CarePoint can apply `_since` against domain `updatedAt` timestamps while still bounding the query by the export `transactionTime`.

Encounter and vital-sign resources are derived from encrypted clinical records plus mutable appointment state. `ClinicalRecord` does not currently maintain an `updatedAt`/version-history model sufficient to reconstruct an exact historical FHIR Encounter snapshot. For these derived resources Slice 10.12 therefore uses a conservative policy: documented Encounter/vital resources may be included even when `_since` is supplied rather than risk omitting changed clinical information.

This behavior is documented intentionally and is not presented as exact incremental MVCC semantics.

## Audit trail

Domain and FHIR layers record bounded metadata without PHI payloads, bearer tokens or cryptographic material. New events include:

- `CLINICAL_SYSTEM_EXPORT_SNAPSHOT`
- `CLINICAL_ORDER_SYSTEM_EXPORT_SNAPSHOT`
- `DIAGNOSTIC_REPORT_SYSTEM_EXPORT_SNAPSHOT`
- `FHIR_BULK_CLINICAL_DOMAIN_SNAPSHOT`

Existing Bulk Data lifecycle events continue to record kickoff, completion/failure, status access, download, cancellation and client-denied actions.

## Acceptance coverage

`services/api/scripts/slice1012-smoke.mjs` validates an end-to-end encrypted fixture:

- clinical record and vital export
- prescription -> MedicationRequest
- laboratory order -> ServiceRequest
- released laboratory result -> final Observation
- unreleased laboratory result exclusion
- released DiagnosticReport inclusion
- FINAL but unreleased DiagnosticReport exclusion
- all five new system scopes in SMART discovery
- explicit bulk-only 403 policy on interactive system clinical routes
- exact missing-scope rejection
- rejection of clinical `_typeFilter`
- absence of ciphertext, wrapped keys, signatures, binary content and storage/PACS references in NDJSON
- expected domain/FHIR audit events

The dedicated Slice 10 FHIR workflow runs the cumulative interoperability acceptance through Slice 10.12, while the repository CI continues to validate the complete Node/API and Flutter surfaces.

## Non-goals

Slice 10.12 does not claim:

- dynamic SMART client registration
- wildcard system scopes
- clinical resource writes through FHIR
- interactive backend-service clinical reads/searches
- DocumentReference or ImagingStudy bulk export
- document binary or DICOM/PACS bulk export
- exact historical reconstruction of mutable clinical encounter state
- full Bulk Data certification or conformance beyond the documented CarePoint subset
