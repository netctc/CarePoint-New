# Phase C1 - Production KMS Preflight

## Purpose

Phase C1 closes the production deployment gap left explicit in Slice 9: CarePoint already supported AWS KMS-backed envelope encryption and HMAC attestation, but the API could previously start before proving that the deployment identity could resolve the configured production keys.

The Phase C1 preflight is deliberately fail-closed. When `NODE_ENV=production`, the API validates the required KMS configuration before NestJS is created and before the process accepts HTTP traffic.

## Covered security domains

The startup gate validates the production key configuration for:

- MFA secret envelope encryption;
- clinical record envelope encryption;
- clinical order and laboratory-result envelope encryption;
- clinical order and laboratory-result attestation;
- clinical document envelope encryption;
- clinical document attestation;
- secure-message envelope encryption;
- telehealth session-key envelope encryption.

Object-storage encryption keys such as `DOCUMENT_S3_KMS_KEY_ID` and `BULK_EXPORT_S3_KMS_KEY_ID` are not application envelope keys and remain a storage/infrastructure hardening concern rather than part of this C1 application-key gate.

## Required production key characteristics

Every application KMS key resolved by C1 must:

- be enabled with `KeyState=Enabled` and `Enabled=true`;
- be customer-managed (`KeyManager=CUSTOMER`);
- return a valid KMS key ARN;
- reside in the configured `AWS_REGION`;
- reside in `AWS_KMS_ACCOUNT_ID` when the optional 12-digit account pin is configured.

Envelope-encryption keys additionally require:

- `KeyUsage=ENCRYPT_DECRYPT`;
- `KeySpec=SYMMETRIC_DEFAULT`.

Order/document attestation keys additionally require:

- `KeyUsage=GENERATE_VERIFY_MAC`;
- `KeySpec=HMAC_256`;
- support for `HMAC_SHA_256` in the KMS-reported MAC algorithms.

`AWS_ENDPOINT_URL_KMS` is development/test-only. C1 rejects production startup when a custom KMS endpoint is configured, preventing an accidental production deployment from using LocalStack or another non-AWS compatibility endpoint.

## Required environment configuration

A normal AWS production deployment requires `AWS_REGION` plus the following provider/key pairs:

```text
AWS_REGION=<production-region>
# Optional defence-in-depth pin for the AWS account owning all C1 application keys.
AWS_KMS_ACCOUNT_ID=<12-digit-account-id>

MFA_KEY_PROVIDER=aws-kms
MFA_KMS_KEY_ID=<key-id-or-arn>

CLINICAL_KEY_PROVIDER=aws-kms
CLINICAL_KMS_KEY_ID=<key-id-or-arn>

ORDER_KEY_PROVIDER=aws-kms
ORDER_KMS_KEY_ID=<key-id-or-arn>
ORDER_SIGNING_PROVIDER=aws-kms-hmac
ORDER_SIGNING_KMS_KEY_ID=<hmac-key-id-or-arn>

DOCUMENT_KEY_PROVIDER=aws-kms
DOCUMENT_KMS_KEY_ID=<key-id-or-arn>
DOCUMENT_SIGNING_PROVIDER=aws-kms-hmac
DOCUMENT_SIGNING_KMS_KEY_ID=<hmac-key-id-or-arn>

MESSAGING_KEY_PROVIDER=aws-kms
MESSAGING_KMS_KEY_ID=<key-id-or-arn>

TELEHEALTH_KEY_PROVIDER=aws-kms
TELEHEALTH_KMS_KEY_ID=<key-id-or-arn>

AWS_ENDPOINT_URL_KMS=
```

AWS access keys must not be stored in the CarePoint `.env` file. Production should use workload identity, an instance/task role, Kubernetes workload identity, or another deployment-native credential mechanism.

## Startup behavior

Production startup now follows this sequence:

```text
load environment
    |
    v
assertProductionKmsReady()
    |
    +--> require AWS_REGION
    +--> reject custom AWS_ENDPOINT_URL_KMS
    +--> validate optional AWS_KMS_ACCOUNT_ID
    +--> validate provider names
    +--> require all application KMS key identifiers
    +--> DescribeKey for every required key
    +--> require customer-managed + enabled key
    +--> validate KeyUsage / KeySpec / HMAC algorithm
    +--> validate ARN region and optional account pin
    |
    +--> any failure: process does not bootstrap the API
    |
    v
NestFactory.create(...)
    |
    v
HTTP hardening / CORS / global prefix
    |
    v
listen on configured port
```

This prevents a deployment from reporting a live application process while critical PHI cryptographic dependencies are invalid.

## Runtime IAM boundary

The configured workload identity must be able to call `kms:DescribeKey` for every C1 key during startup. Runtime policies must additionally permit only the operations required by each domain:

- envelope keys: `kms:Encrypt`, `kms:Decrypt`, `kms:DescribeKey`;
- HMAC attestation keys: `kms:GenerateMac`, `kms:VerifyMac`, `kms:DescribeKey`.

Final key policies should scope those permissions to the exact CarePoint workload identity and exact key ARNs used by the deployment.

## Order attestation compatibility and rotation

The initial C1 KMS-HMAC change made order attestation generation and verification asynchronous. `OrdersService` awaits those operations and supplies the persisted signature algorithm and key identifier during verification.

That stored-key behavior is important for key rotation: records signed with an older KMS HMAC key can continue to reference their persisted key ID instead of being implicitly verified only against the current environment key.

The same principle is preserved for encrypted envelopes: C1 validates the current production key inventory at startup but does not impose a blanket rule that historical ciphertext must reference only the currently configured KEK. A production rotation procedure must retain decrypt permission for historical KMS keys until all dependent data has been safely re-encrypted or expired according to policy.

## Deterministic C1 acceptance

`services/api/scripts/c1-kms-preflight-smoke.mjs` tests the compiled preflight without AWS credentials by injecting deterministic `DescribeKey` responses.

The acceptance covers:

- non-production bypass without KMS calls;
- a valid eight-key production inventory;
- missing `AWS_REGION`;
- production custom KMS endpoint rejection;
- invalid optional AWS account pin format;
- local provider rejection in production;
- missing key identifiers;
- disabled keys;
- AWS-managed instead of customer-managed keys;
- incorrect HMAC key specification;
- missing `HMAC_SHA_256` support;
- cross-region keys;
- cross-account keys when account pinning is enabled;
- malformed KMS key ARNs;
- `AccessDenied`/unreachable key handling.

The C1 acceptance runs in GitHub Actions after the API build and before the normal Node regression suite.

## CI and non-production behavior

The runtime preflight returns immediately unless `NODE_ENV=production`. Existing functional CI continues to use local test KEKs/HMAC secrets and does not require AWS credentials.

The deterministic C1 test explicitly exercises production validation through an injected metadata reader. This proves the application validation logic without granting CI production AWS credentials.

Deployment acceptance must still prove the real production workload identity and network path against the live KMS keys.

## What Phase C1 does not claim

This code-level preflight does not by itself prove:

- automatic KMS key rotation is enabled or correctly scheduled;
- CloudTrail/SIEM ingestion is configured;
- VPC endpoint/network-policy resilience under failure;
- final least-privilege IAM/key-policy review beyond the operations required by CarePoint;
- cross-region disaster recovery of KMS keys;
- S3/DICOM/Bulk Export bucket KMS policy correctness;
- production load/chaos behavior.

Those remain infrastructure/release acceptance controls and should be verified in the target KSA/GCC production environment before go-live.

## Deployment acceptance checklist

1. Build and typecheck the exact release commit.
2. Configure the production workload identity and `AWS_REGION`.
3. Optionally configure `AWS_KMS_ACCOUNT_ID` as a 12-digit account pin.
4. Ensure `AWS_ENDPOINT_URL_KMS` is empty in production.
5. Configure all C1 KMS key IDs/ARNs listed above.
6. Confirm every application key is customer-managed, enabled and in the intended region/account.
7. Confirm envelope keys are `SYMMETRIC_DEFAULT / ENCRYPT_DECRYPT`.
8. Confirm signing keys are `HMAC_256 / GENERATE_VERIFY_MAC` and support `HMAC_SHA_256`.
9. Start the API and confirm the KMS preflight completes without error.
10. Confirm `/api/v1/health/ready` succeeds only after normal PostgreSQL/Redis readiness requirements are also satisfied.
11. Execute controlled production-like encrypt/decrypt and MAC generate/verify operations under the deployment identity before promoting traffic.
12. Document rotation and historical-key retention procedures before the first production key rotation.
