# Phase C1 — AWS KMS Production Readiness

## Objective

Make CarePoint fail closed before serving production traffic when application envelope-encryption or wired HMAC signing keys are missing, disabled, mis-typed, cross-region, cross-account, or otherwise incompatible with their cryptographic purpose.

C1 starts from cumulative integration commit `c0a6306295ce76394a3171ed054a39d8ab60d6df` after Phase B completion.

## Production startup gate

`KmsReadinessModule` runs during Nest application bootstrap when `NODE_ENV=production`.

The API will not finish startup unless:

- `AWS_REGION` is configured;
- `AWS_ENDPOINT_URL_KMS` is empty (custom/LocalStack KMS endpoints are development/test only);
- every production envelope domain uses `aws-kms`;
- every required envelope KMS key is configured;
- the wired document attestation provider uses `aws-kms-hmac` and has its HMAC key configured;
- every unique KMS key passes `DescribeKey` validation.

Validation is deduplicated by cryptographic kind + configured key ID so a shared CMK is described once during startup.

## Envelope CMK requirements

The following runtime keys are validated as envelope keys:

- `MFA_KMS_KEY_ID`
- `CLINICAL_KMS_KEY_ID`
- `ORDER_KMS_KEY_ID`
- `DOCUMENT_KMS_KEY_ID`
- `MESSAGING_KMS_KEY_ID`
- `TELEHEALTH_KMS_KEY_ID`

Each must resolve to a KMS key that is:

- `Enabled`;
- customer-managed (`KeyManager=CUSTOMER`);
- `KeyUsage=ENCRYPT_DECRYPT`;
- `KeySpec=SYMMETRIC_DEFAULT`;
- in `AWS_REGION`;
- in `AWS_KMS_ACCOUNT_ID` when that optional account pin is configured.

`AwsKmsKeyProvider` memoizes the metadata validation and reuses the validated canonical ARN for Encrypt/Decrypt. It also rejects envelopes or KMS responses that reference a different key. Existing KMS `EncryptionContext.purpose` values remain unchanged, so C1 does not change the encrypted envelope format.

## HMAC requirements

`DOCUMENT_SIGNING_KMS_KEY_ID` is validated before startup and must resolve to a customer-managed, enabled:

- `KeyUsage=GENERATE_VERIFY_MAC`;
- `KeySpec=HMAC_256`;
- HMAC key supporting `HMAC_SHA_256`;
- key in the configured region/account boundary.

`DocumentsAttestationService` now uses the common validated `AwsKmsHmacProvider` rather than constructing an unvalidated KMS client directly. The persisted algorithm remains `AWS-KMS-HMAC-SHA256`; no document signature schema migration is introduced.

## Explicit C1 boundaries

### Orders attestation

The existing `OrdersAttestationService` is synchronous and still carries the legacy production blocker requiring an external signing adapter. Migrating it to KMS HMAC requires making order creation, order verification, and laboratory validation attestation calls asynchronous. That is deliberately isolated as **Phase C1.1** rather than mixed into this readiness slice.

`ORDER_SIGNING_KMS_KEY_ID` is documented/reserved but is not part of C1 startup readiness until C1.1 wires it into the runtime.

### Object-storage KMS keys

`DOCUMENT_S3_KMS_KEY_ID` and `BULK_EXPORT_S3_KMS_KEY_ID` are storage encryption controls and are not application envelope keys. Their bucket/key-policy validation belongs to the private object-storage hardening slice (C3).

## Test strategy

`services/api/scripts/phase-c1-kms-smoke.mjs` runs against the compiled API modules with fake KMS clients; no AWS credentials or external calls are required.

It validates:

- valid envelope-key metadata;
- invalid key state, manager, usage, and spec rejection;
- region and optional AWS account pinning;
- production custom endpoint rejection;
- canonical KMS key-ID enforcement on Encrypt/Decrypt;
- encryption-context preservation;
- per-provider metadata validation memoization;
- valid HMAC metadata and GenerateMac/VerifyMac behavior;
- production configuration inventory and missing-key/provider rejection.

The C1 smoke is chained into the existing Slice 9 security/resilience acceptance step, so the historical CI workflow does not need a new protected workflow literal.

## Database impact

No Prisma schema change and no database migration.

## Production IAM minimums

Application workload identity should be scoped to the specific configured keys. C1 requires metadata-read permission (`kms:DescribeKey`) in addition to the runtime cryptographic operations already required by each adapter:

- envelope CMKs: `kms:Encrypt`, `kms:Decrypt`, `kms:DescribeKey`;
- document HMAC key: `kms:GenerateMac`, `kms:VerifyMac`, `kms:DescribeKey`.

Do not place static AWS access keys in CarePoint environment files; use the platform workload identity / instance-role mechanism.
