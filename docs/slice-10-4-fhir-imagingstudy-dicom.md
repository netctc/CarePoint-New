# Slice 10.4 - FHIR R4 ImagingStudy and Secure DICOM Interoperability

## Objective

Slice 10.4 extends the CarePoint FHIR R4 facade with a protected `ImagingStudy` read representation backed by CarePoint clinical imaging references.

The implementation preserves the security properties already established by the clinical-document subsystem. FHIR does not become a second PACS access path and does not expose the configured DICOMweb base URL, raw PACS references, credentials, or image bytes.

## Endpoint

`GET /api/v1/fhir/R4/ImagingStudy/:documentId`

The identifier is the CarePoint `ClinicalDocument.id` of an `IMAGING_REFERENCE` document.

Authentication is required. Authorization is delegated to the existing clinical-document access model before any DICOM metadata is inspected.

## Authorization model

The FHIR facade first executes the canonical `DocumentsService.documentContent()` access path. Therefore the existing controls remain authoritative:

- patient self-access only after the imaging reference has been released to the patient;
- authoring provider access;
- treatment-relationship access;
- supported clinical-document consent access;
- removed/unavailable documents are not readable;
- cross-patient access remains denied.

After authorization, `DocumentsImagingInteropService` decrypts the stored metadata internally only to inspect the DICOMweb reference. The raw reference is never returned to the FHIR caller.

## DICOMweb validation

`DicomWebService.inspectReference()` validates that a stored reference:

- uses the configured DICOMweb provider;
- belongs to the configured PACS protocol, host and base path;
- contains no embedded credentials;
- represents a syntactically valid DICOM study/series/instance path;
- contains valid DICOM UIDs.

The method returns only structured identifiers and the fact that proxying is required. It does not return the PACS base URL.

## Study-level scope

Slice 10.4 deliberately exposes only **study-level** references as FHIR `ImagingStudy` resources.

Series-level and instance-level stored references are rejected with HTTP `409` / FHIR `OperationOutcome` for this endpoint. CarePoint does not currently persist enough standardized modality and SOP-class metadata to construct FHIR `ImagingStudy.series` / `instance` elements without inventing clinical facts.

A later slice can add those elements once the source domain stores the required DICOM metadata explicitly.

## FHIR mapping

| CarePoint source | FHIR R4 |
| --- | --- |
| `ClinicalDocument.id` | `ImagingStudy.id` |
| DICOM Study Instance UID | `identifier.system = urn:dicom:uid`, `identifier.value = urn:oid:{uid}` |
| available imaging reference | `status = available` |
| `patientId` | `subject.reference = Patient/{patientId}` |
| `encounterRef` | `encounter.reference = Encounter/{encounterRef}` |
| safe title / description | `description` |

The resource intentionally omits `endpoint`, direct retrieval URLs, `series`, `instance`, acquisition timestamps, modality, body site and counts unless CarePoint has authoritative source data for them.

## PACS and privacy boundary

FHIR responses do **not** expose:

- `DICOMWEB_BASE_URL`;
- the encrypted `externalReference` value;
- PACS host names or routing paths;
- DICOMweb credentials;
- direct WADO-RS/QIDO-RS/STOW-RS URLs;
- imaging binary content.

The existing `DocumentReference` behavior for `EXTERNAL_REFERENCE` documents also remains intentionally non-retrievable: its FHIR attachment has no direct URL.

## CapabilityStatement

The FHIR `CapabilityStatement` now advertises:

- `ImagingStudy` with `read` interaction;
- existing Slice 10.0-10.3 resources unchanged.

`software.version` is reported as `slice-10.4`.

## Auditing

Successful FHIR reads write `FHIR_IMAGING_STUDY_READ` audit events with:

- actor account;
- clinical-document object id;
- access basis;
- FHIR version;
- DICOM scope;
- `proxyRequired = true`.

The underlying clinical-document access path also continues to produce its normal access audit events.

## Acceptance coverage

`services/api/scripts/slice104-smoke.mjs` validates:

- CapabilityStatement advertises `ImagingStudy` and Slice 10.4;
- a DICOM study UID is normalized through the configured DICOMweb allowlist;
- outside-PACS references are rejected;
- an authorized provider can read the FHIR ImagingStudy;
- the DICOM UID maps to `urn:dicom:uid` / `urn:oid:{uid}`;
- Patient and Encounter references are correct;
- PACS host/path/internal reference values never appear in FHIR payloads;
- an unreleased patient read is denied;
- cross-patient reads are denied before and after release;
- the corresponding external `DocumentReference` has no direct attachment URL;
- series-scoped references cannot be represented as a fabricated study;
- a released patient can read the ImagingStudy.

The Slice 10 workflow runs the cumulative Slice 10 smoke tests, Slice 10.3 diagnostics/documents validation, and the Slice 10.4 imaging validation.

## Non-goals

This slice does not implement:

- a DICOMweb HTTP proxy;
- image pixel retrieval;
- QIDO-RS search;
- WADO-RS retrieval;
- STOW-RS upload;
- FHIR `Endpoint` resources;
- FHIR ImagingStudy search;
- FHIR `ImagingSelection`;
- series/instance details without authoritative source metadata.

## Suggested next increment

A logical next increment is **Slice 10.5 - FHIR Search, Pagination and Interoperability Hardening**, adding controlled search interactions for the mature resources, consistent paging, `_id`/patient/encounter filters where appropriate, and stronger conformance/negative-contract tests without weakening existing CarePoint authorization boundaries.
