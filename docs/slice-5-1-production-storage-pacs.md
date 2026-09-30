# Slice 5.1 — Production Clinical Storage & PACS Hardening

## Purpose

Slice 5.1 hardens the Slice 5 clinical-document domain for production infrastructure. It does not change the canonical clinical ownership model or introduce a second document domain.

The main production boundaries are:

- private object storage for encrypted clinical binaries;
- KMS-backed envelope-key wrapping;
- KMS-backed diagnostic-report attestation;
- mandatory malware scanning before persistence;
- server-controlled DICOMweb/PACS references;
- authenticated private binary download;
- stricter cross-provider ABAC for clinical documents and diagnostic reports.

Canonical engineering language remains English. UI localization remains EN/AR/FR/ES with Arabic RTL.

## Storage architecture

Clinical binaries remain encrypted by CarePoint before object storage:

```text
Clinical file
  -> malware scan
  -> random data-encryption key
  -> AES-256-GCM application encryption
  -> DEK wrapped by KMS
  -> encrypted object
  -> private S3
  -> S3 SSE-KMS defense-in-depth
```

PostgreSQL stores only the opaque object key, integrity digest, lifecycle state and encryption-envelope metadata. It does not store plaintext file contents, titles, filenames, descriptions or PACS URLs.

### Development/test

`DOCUMENT_STORAGE_PROVIDER=local` is allowed only outside production.

### Production

`DOCUMENT_STORAGE_PROVIDER=s3` is supported. Required configuration:

- `AWS_REGION`
- `DOCUMENT_S3_BUCKET`
- `DOCUMENT_S3_KMS_KEY_ID`
- optional `DOCUMENT_S3_PREFIX`

The S3 adapter does not create public URLs and never enables public ACL access. Workload identity / instance roles should be used instead of static AWS access keys in environment variables.

## KMS envelope encryption

`DOCUMENT_KEY_PROVIDER=aws-kms` uses AWS KMS `Encrypt` / `Decrypt` to wrap and unwrap the 256-bit document DEK. The KMS encryption context is fixed to the CarePoint clinical-document purpose.

Required:

- `DOCUMENT_KMS_KEY_ID`
- `AWS_REGION`

The existing local AES-KW adapter remains development/test only and is rejected in production.

## Diagnostic-report attestation

`DOCUMENT_SIGNING_PROVIDER=aws-kms-hmac` supports an AWS KMS HMAC key for application-level report integrity/authorship attestation.

Required:

- `DOCUMENT_SIGNING_KMS_KEY_ID`
- `AWS_REGION`

The local HMAC secret remains development/test only. This attestation is an application integrity/authorship control; it must not be represented as a jurisdiction-specific qualified electronic signature unless an approved legal signing service is integrated.

## Malware scanning

All uploaded binary documents are scanned before encryption, object storage or database persistence.

Production uses:

```text
DOCUMENT_SCAN_PROVIDER=clamav
CLAMAV_HOST=...
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=15000
```

The adapter uses the ClamAV INSTREAM protocol. Scan failures are fail-closed: an unavailable scanner or unexpected response prevents persistence.

The mock scanner is allowed only in development/test and exists solely for deterministic CI acceptance coverage.

## Private download

CarePoint adds:

```text
GET /api/v1/clinical-documents/:documentId/download
```

The endpoint:

1. authenticates the caller;
2. applies the existing patient/provider ABAC decision;
3. fetches the encrypted object from private storage;
4. decrypts it with the document envelope;
5. verifies its SHA-256 content digest;
6. returns the binary through the authenticated API.

Security headers include:

- `Cache-Control: private, no-store, max-age=0`
- `Pragma: no-cache`
- `X-Content-Type-Options: nosniff`

No S3 object URL, bucket key or presigned storage URL is exposed to the mobile client.

## DICOMweb / PACS

Production imaging references use:

```text
DICOMWEB_PROVIDER=dicomweb
DICOMWEB_BASE_URL=https://.../
```

CarePoint accepts DICOM Study / Series / SOP Instance UIDs and constructs references only below the configured DICOMweb base URL. An absolute reference is accepted only if it has the same protocol, host and configured path prefix.

This prevents arbitrary external imaging URLs from becoming trusted clinical references.

The raw PACS reference is encrypted at rest and is not returned through the normal document presentation API. Clients receive only a descriptor indicating that a server-side DICOMweb proxy/viewer flow is required.

Large DICOM studies should remain in PACS/VNA. The existing 8 MiB CarePoint binary upload limit is intentionally retained for ordinary clinical attachments and small DICOM objects.

## ABAC hardening

Provider access-basis precedence is now:

1. `TREATMENT_RELATIONSHIP`
2. `PATIENT_CONSENT`
3. `OWN_AUTHORSHIP`

This prevents an existing author relationship from accidentally narrowing a currently treating provider to only their own documents.

Cross-provider diagnostic-report rules:

- `DRAFT`: authoring provider only;
- `FINAL`: available to a provider with treatment relationship or valid patient consent;
- `RELEASED`: same provider rules plus patient access.

Admin and Support still receive no clinical-document PHI permission by role.

## CI acceptance

The Slice 5.1 smoke test verifies:

- malware rejection occurs before persistence;
- plaintext PHI does not appear in PostgreSQL;
- plaintext PHI does not appear in object storage;
- treatment relationship outranks own-authorship fallback;
- cross-provider DRAFT reports are denied;
- FINAL reports become readable to a treatment-related provider;
- patient release gate remains enforced;
- private binary download returns the correct authenticated bytes;
- download responses are `no-store` and `nosniff`;
- Admin binary download receives 403;
- raw PACS references are not exposed by the document API;
- production DICOM UID normalization stays inside the configured PACS base;
- an external DICOM origin is rejected.

The complete accumulated regression suite continues to cover IAM, booking concurrency, telemedicine, encrypted clinical records, clinical orders/laboratory and Slice 5 document lifecycle.

## Production validation still required

This slice wires concrete production adapters but does not claim that a real deployment has already been certified. Before PHI production go-live, validate at least:

- real S3 bucket policy, Block Public Access and encryption configuration;
- IAM least-privilege policies for S3 and KMS;
- KMS key rotation / alias / recovery / deletion policy;
- real KMS HMAC key lifecycle;
- ClamAV high availability, signature update and failure monitoring;
- PACS/VNA/DICOMweb authentication and network segmentation;
- DICOM viewer/proxy authorization and audit trail;
- secure retention, legal hold and deletion requirements;
- regional data-residency requirements;
- penetration test and threat model;
- disaster recovery and object-versioning policy.

No new Prisma migration is required by Slice 5.1 because it hardens adapters and access behavior around the existing Slice 5 document/report persistence model.
