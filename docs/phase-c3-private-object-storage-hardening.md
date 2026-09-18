# Phase C3 - Private Object-Storage Hardening

## Purpose

Phase C3 converts the production S3 assumptions used by clinical documents and FHIR Bulk Data into a fail-closed startup boundary. CarePoint already encrypted application payloads and explicitly requested SSE-KMS for stored S3 objects, but the API could previously start without proving that the target buckets were private, correctly encrypted or subject to the required Bulk Data expiration policy.

C3 starts from the fully accepted Phase C2 dependency/supply-chain head `f63437f794781a679bd2f5c81775fe8195538817`.

## Covered storage domains

The preflight covers:

- encrypted clinical-document objects under `DOCUMENT_S3_PREFIX`;
- FHIR Bulk Data NDJSON artifacts under `BULK_EXPORT_S3_PREFIX`;
- `DOCUMENT_S3_KMS_KEY_ID`;
- `BULK_EXPORT_S3_KMS_KEY_ID`, with the existing fallback to the document storage KMS key when a dedicated Bulk Data key is not configured.

Document and Bulk Data storage may share one private bucket/key. The startup inspection deduplicates shared bucket and KMS lookups while still applying the Bulk Data lifecycle requirement to its own prefix.

## Production startup sequence

Production now starts with:

```text
load environment
    |
    v
Phase C1 KMS application-key preflight
    |
    v
Phase C3 private object-storage preflight
    |
    +--> validate providers / region / storage key IDs
    +--> DescribeKey for unique storage KMS keys
    +--> inspect unique S3 buckets
    +--> validate bucket privacy and default encryption
    +--> validate Bulk Data lifecycle retention
    |
    +--> any failure: do not create NestJS / do not accept traffic
    |
    v
NestFactory.create(...)
```

The C3 preflight returns immediately outside `NODE_ENV=production`, preserving local and CI adapters.

## Storage KMS requirements

Every configured storage KMS key must be:

- enabled and in `KeyState=Enabled`;
- customer-managed (`KeyManager=CUSTOMER`);
- `KeyUsage=ENCRYPT_DECRYPT`;
- `KeySpec=SYMMETRIC_DEFAULT`;
- represented by valid KMS metadata in `AWS_REGION`.

The bucket default-encryption KMS reference must resolve to the same validated storage key used by the corresponding CarePoint storage domain. CarePoint continues to send an explicit `SSEKMSKeyId` on every clinical-document and Bulk Data `PutObject`; the default-encryption requirement is an additional bucket-level safety net.

Both normal `aws:kms` and the stronger S3 `aws:kms:dsse` default-encryption algorithms are accepted when they use the configured key.

## S3 bucket privacy requirements

Each production bucket must be reachable by the deployed workload and must satisfy all of these controls:

1. Bucket region matches `AWS_REGION`.
2. All four S3 Block Public Access controls are true:
   - `BlockPublicAcls`;
   - `IgnorePublicAcls`;
   - `BlockPublicPolicy`;
   - `RestrictPublicBuckets`.
3. Object Ownership includes `BucketOwnerEnforced`, disabling ACL-based ownership/access.
4. Default server-side encryption uses KMS with the configured CarePoint storage key.

`AWS_ENDPOINT_URL_S3` is development/test-only and is rejected in production by both the startup preflight and the document/Bulk Data storage adapters.

## Verified Bulk Data lifecycle

C3 removes the old trust-based production condition:

```text
BULK_EXPORT_STORAGE_LIFECYCLE_CONFIRMED=true
```

The flag is no longer used. Instead, CarePoint reads the actual bucket lifecycle configuration during startup.

An Enabled expiration rule must cover `BULK_EXPORT_S3_PREFIX` and expire objects no later than:

```text
ceil(BULK_EXPORT_RETENTION_SECONDS / 86400)
```

With the default `BULK_EXPORT_RETENTION_SECONDS=86400`, an Enabled rule covering `carepoint/bulk-export` (or a broader parent/all-objects prefix) must expire current objects within 1 day.

S3 lifecycle execution is asynchronous and day-granular. Application cleanup remains useful for prompt logical expiry; the bucket rule is the durable storage backstop if application cleanup is delayed or unavailable.

## AWS permissions required by the startup identity

C3 adds read-only control-plane checks during application startup. The workload identity needs only the relevant configured buckets/keys and should be scoped as narrowly as the deployment platform permits.

Typical startup permissions include:

- `kms:DescribeKey` on the document/Bulk storage KMS keys;
- `s3:ListBucket` / `HeadBucket` access;
- `s3:GetBucketLocation`;
- `s3:GetBucketPublicAccessBlock`;
- `s3:GetEncryptionConfiguration`;
- `s3:GetBucketOwnershipControls`;
- `s3:GetLifecycleConfiguration`.

Runtime document/Bulk operations additionally require the already expected object permissions (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`) for the configured prefixes, plus the SSE-KMS permissions required by S3 such as `kms:GenerateDataKey` for writes and `kms:Decrypt` for reads.

Static long-lived AWS credentials must not be stored in `.env`; use workload/instance/task identity.

## Deterministic acceptance

`services/api/scripts/c3-object-storage-preflight-smoke.mjs` injects fake bucket and KMS inspectors and requires no AWS credentials. It covers:

- non-production bypass;
- deduplication of shared bucket/key inspection;
- missing region/provider/bucket/key configuration;
- production custom S3 endpoint rejection;
- invalid retention configuration;
- bucket region mismatch;
- incomplete Block Public Access;
- non-`BucketOwnerEnforced` ownership;
- non-KMS default encryption;
- wrong default encryption key;
- disabled/wrong-type/non-customer storage KMS keys;
- cross-region storage KMS rejection;
- missing, disabled, wrong-prefix or over-retention lifecycle policies;
- S3/KMS access failures with domain-specific startup errors.

The API workspace now exposes this smoke as its `test` target, so the existing root workspace test gate executes C3 without requiring a new GitHub Actions workflow.

## What C3 does not claim

C3 verifies the application-visible storage boundary at startup. It does not by itself prove:

- full bucket-policy least-privilege analysis beyond the effective Block Public Access/ownership controls checked here;
- organization SCP effectiveness;
- S3 access-log/CloudTrail/SIEM ingestion;
- VPC endpoint policy correctness;
- cross-region replication/disaster-recovery design;
- Object Lock/WORM retention, which is not appropriate to enable implicitly because CarePoint has deletion/retention workflows;
- malware scanning effectiveness for uploaded clinical documents;
- immutable OCI/runtime infrastructure controls.

Those remain separate release/infrastructure acceptance controls.
