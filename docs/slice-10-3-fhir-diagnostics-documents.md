# Slice 10.3 — FHIR Diagnostic Reports and Clinical Documents

## Objective

Slice 10.3 extends CarePoint's read-only FHIR R4 interoperability facade with authorized diagnostic reports and clinical document references.

The interoperability layer does not introduce a second clinical-document permission model. It reuses the existing `DocumentsService` boundaries for diagnostic reports, encrypted clinical documents, release state, treatment relationships, consent, integrity verification, and audit.

## FHIR endpoints

All routes are below `/api/v1/fhir/R4` and return `application/fhir+json`.

| Endpoint | Protection | Behavior |
| --- | --- | --- |
| `GET /metadata` | Public | CapabilityStatement now advertises `DiagnosticReport` and `DocumentReference` and reports software version `slice-10.3`. |
| `GET /DiagnosticReport/:reportId` | Bearer session | Maps an authorized CarePoint diagnostic report. Patient access remains release-gated. |
| `GET /DocumentReference/:documentId` | Bearer session | Maps an authorized CarePoint clinical document without embedding the encrypted binary payload. |

## Authorization and release model

### DiagnosticReport

`FhirDocumentsService` delegates the read to `DocumentsService.getDiagnosticReport()` before mapping any clinical data.

Existing CarePoint rules therefore remain authoritative:

- Patient can read only their own `RELEASED` diagnostic reports.
- The authoring provider can read their own draft/final/released report.
- A different provider requires an existing clinical access basis and cannot read another provider's draft report.
- Administrative roles do not gain diagnostic PHI access merely because the request uses a FHIR route.

### DocumentReference

FHIR document reads pass through `DocumentsService.documentContent()`.

This preserves the existing document rules:

- Patient access requires the document to be `AVAILABLE` and `releasedToPatient = true`.
- The authoring provider has `OWN_AUTHORSHIP` access.
- Other providers require a valid treatment/consent/ownership basis.
- Removed/unavailable documents remain inaccessible.
- Binary integrity and envelope decryption checks still execute inside the document service.

The FHIR mapper intentionally discards `contentBase64`. A `DocumentReference` never embeds the document binary.

## DiagnosticReport mapping

CarePoint diagnostic reports are represented as FHIR R4 `DiagnosticReport` resources.

Key mappings:

- CarePoint report id -> `DiagnosticReport.id`
- `DRAFT` -> `status = preliminary`
- `FINAL` or `RELEASED` -> `status = final`
- CarePoint diagnostic type -> custom code in `urn:carepoint:diagnostic-report-type`
- patient -> `subject = Patient/{patientId}`
- encounter appointment -> `encounter = Encounter/{appointmentId}`
- authoring provider -> `performer` and `resultsInterpreter`
- report creation -> `effectiveDateTime`
- finalization/release instant -> `issued`
- findings/impression/recommendation -> `conclusion`
- diagnostic codes -> `conclusionCode`
- attached CarePoint document -> `presentedForm.url = DocumentReference/{documentId}`

FHIR `final` does not by itself imply patient release. CarePoint's release gate remains authoritative: a patient cannot retrieve a final-but-unreleased report.

## DocumentReference mapping

CarePoint clinical documents are represented as FHIR R4 `DocumentReference` resources.

Key mappings:

- CarePoint document id -> `DocumentReference.id`
- available document -> `status = current`
- unreleased document -> `docStatus = preliminary`
- released document -> `docStatus = final`
- CarePoint document kind -> custom coding in `urn:carepoint:clinical-document-kind`
- patient -> `subject = Patient/{patientId}`
- authoring provider -> `author = Practitioner/{providerId}` when present
- encounter appointment -> `context.encounter = Encounter/{appointmentId}` when present
- document creation time -> `date`
- encrypted binary document -> protected CarePoint download route in `content.attachment.url`
- storage mode -> coding in `urn:carepoint:document-storage-mode`

The protected binary URL is:

```text
/api/v1/clinical-documents/{documentId}/download
```

That endpoint already enforces the document authorization boundary and private/no-store download controls.

For external imaging references, the mapper does not expose a raw PACS/DICOMweb origin or internal reference. The DocumentReference describes the external-reference storage mode without publishing the protected backend reference.

## Privacy and security properties

Slice 10.3 preserves the security controls already implemented in Slice 5/5.1:

- document binary remains encrypted at rest;
- document metadata remains encrypted at rest;
- final diagnostic reports continue to require attestation verification;
- patient document/report visibility remains release-gated;
- FHIR responses do not include `contentBase64`;
- FHIR does not expose raw PACS references;
- cross-patient reads return FHIR `OperationOutcome` errors;
- FHIR-specific audit events are written in addition to the underlying clinical-document/report audit events.

FHIR audit actions introduced here:

- `FHIR_DIAGNOSTIC_REPORT_READ`
- `FHIR_DOCUMENT_REFERENCE_READ`

## Acceptance coverage

`services/api/scripts/slice103-smoke.mjs` creates isolated test identities and validates:

1. CapabilityStatement advertises `DiagnosticReport` and `DocumentReference` and reports Slice 10.3.
2. An authoring doctor can read an unreleased DocumentReference.
3. The patient and an unrelated patient are denied the unreleased document.
4. DocumentReference contains exact Patient, Practitioner, and Encounter references.
5. DocumentReference exposes only the protected CarePoint download URL and does not embed binary content.
6. The authoring doctor can read a draft DiagnosticReport as `preliminary`.
7. The patient and unrelated patient are denied the draft report.
8. DiagnosticReport references the correct Patient, Encounter, Practitioner, and DocumentReference.
9. Finalization maps the report to FHIR `final` while the patient remains denied before release.
10. Releasing the report makes both DiagnosticReport and its attached DocumentReference available to the patient.
11. Released DocumentReference still does not embed binary PHI.

The ordinary Slice 10 smoke test continues to validate Patient, Practitioner, Appointment, Encounter, vital Observation, MedicationRequest, ServiceRequest, and released laboratory Observation behavior.

## Explicit non-goals

Slice 10.3 does not yet implement:

- FHIR create/update/delete operations;
- `DiagnosticReport` or `DocumentReference` search endpoints;
- `Binary` resource exposure;
- public document URLs;
- direct PACS/DICOM binary transfer through the FHIR facade;
- ImagingStudy mapping;
- Composition mapping;
- SMART on FHIR/OAuth authorization;
- national implementation-guide profiles;
- terminology-server validation;
- bulk export or subscriptions.

These capabilities can be added incrementally without weakening CarePoint's existing release, encryption, integrity, and authorization boundaries.
