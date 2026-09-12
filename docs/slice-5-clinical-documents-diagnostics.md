# Slice 5 — Clinical Documents, Attachments & Diagnostic Results

## Scope

Slice 5 adds secure clinical document storage and diagnostic reporting on top of the encrypted clinical encounter and clinical-order foundations.

## Storage boundary

Binary files are not stored in PostgreSQL. PostgreSQL keeps an opaque object key, SHA-256 content digest, lifecycle state, media type/size, and AES-256-GCM envelope metadata. File name, title, description, external imaging reference, report findings and report impressions are encrypted.

Development/test uses a private local filesystem adapter under `DOCUMENT_STORAGE_LOCAL_ROOT`. `NODE_ENV=production` rejects the local adapter. Production requires a private object-storage implementation such as S3, Azure Blob or GCS plus KMS/HSM-backed key wrapping.

The current JSON/base64 upload API is intentionally capped at 8 MiB. Large DICOM studies should ultimately remain in PACS/VNA and be represented in CarePoint by encrypted opaque references; they should not be transported through the application API as giant JSON payloads.

## ClinicalDocument

Kinds:
- `CLINICAL_ATTACHMENT`
- `LAB_REPORT`
- `IMAGING_REPORT`
- `IMAGING_REFERENCE`
- `PATHOLOGY_REPORT`
- `PATIENT_UPLOAD`
- `OTHER`

Storage modes:
- `ENCRYPTED_BLOB`
- `EXTERNAL_REFERENCE`

Provider-created documents are private from the patient until explicitly released. Patient uploads are immediately visible to that patient but do not automatically grant a provider access without a treatment relationship or consent.

## DiagnosticReport

Types:
- `IMAGING`
- `PATHOLOGY`
- `OTHER`

Lifecycle:

`DRAFT -> FINAL -> RELEASED`

Draft content is encrypted but unsigned. Finalization verifies the encrypted payload digest and records an application-level HMAC-SHA256 clinical attestation in development/test. A patient can only retrieve reports after `RELEASED`. Releasing a report also releases its attached clinical document when applicable.

This attestation is an integrity/authorship control, not a legally qualified electronic signature.

## Authorization

Patient:
- own released documents;
- own released diagnostic reports;
- own patient uploads.

Doctor / Other Provider:
- own authorship;
- active treatment relationship; or
- active consent with scope `CLINICAL_DOCUMENT_READ` and version `clinical-documents-v1`.

Admin and Support do not receive document PHI permissions by default.

## API

### Documents
- `POST /api/v1/clinical-documents/appointments/:appointmentId/upload`
- `POST /api/v1/clinical-documents/appointments/:appointmentId/reference`
- `POST /api/v1/clinical-documents/me/upload`
- `GET /api/v1/clinical-documents/me`
- `GET /api/v1/clinical-documents/patients/:patientId`
- `GET /api/v1/clinical-documents/:documentId/content`
- `POST /api/v1/clinical-documents/:documentId/release`
- `POST /api/v1/clinical-documents/:documentId/remove`

### Diagnostic reports
- `POST /api/v1/diagnostic-reports/appointments/:appointmentId`
- `POST /api/v1/diagnostic-reports/:reportId/finalize`
- `POST /api/v1/diagnostic-reports/:reportId/release`
- `GET /api/v1/diagnostic-reports/me`
- `GET /api/v1/diagnostic-reports/patients/:patientId`
- `GET /api/v1/diagnostic-reports/:reportId`

## Mobile integration

Patient Health Record links to a multilingual Documents & Diagnostics workspace showing only released resources. Doctor and Other Provider Clinical Chart links to the provider workspace for imaging references, diagnostic reports, finalization and release.

The shared mobile client exposes binary upload APIs, but this slice deliberately does not introduce a native cross-platform file-picker plugin. Native file picking, PDF/image rendering, offline caching and device-level secure temporary-file handling should be completed together with Android/iOS runner hardening.

## CI acceptance

The Slice 5 smoke test verifies:
- PHI markers are absent from PostgreSQL document/report rows;
- plaintext document bytes are absent from the local object store;
- Admin PHI access is denied;
- provider-created documents and diagnostic reports remain hidden from the patient before release;
- final report attestation is present;
- released files decrypt to the original content;
- encrypted external imaging references decrypt only after authorized access;
- patient uploads use the same encrypted storage boundary.

## Production gates

Before real clinical documents are accepted:
1. Replace local object storage with private production object storage.
2. Replace local KEK/signing adapters with KMS/HSM-backed implementations.
3. Add malware scanning and content-disarm policy for uploaded files.
4. Add retention/legal-hold/deletion policy.
5. Add DICOM/PACS/VNA integration where diagnostic imaging is in scope.
6. Complete platform-native secure file selection/viewing and temporary-file controls.
7. Complete penetration testing, threat modeling and healthcare regulatory validation for the deployment jurisdiction.
