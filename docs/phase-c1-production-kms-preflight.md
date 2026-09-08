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

## Required production key characteristics

Envelope-encryption keys must be AWS KMS keys with:

- `KeyUsage=ENCRYPT_DECRYPT`;
- `KeySpec=SYMMETRIC_DEFAULT`;
- `KeyState=Enabled`;
- `Enabled=true`.

Order/document attestation keys must be AWS KMS HMAC keys with:

- `KeyUsage=GENERATE_VERIFY_MAC`;
- `KeySpec=HMAC_256`;
- `KeyState=Enabled`;
- `Enabled=true`.

The configured workload identity must be able to call `kms:DescribeKey` for every key during startup. Runtime policies must additionally permit only the operations required by each domain, such as `kms:Encrypt`/`kms:Decrypt` for envelope keys and `kms:GenerateMac`/`kms:VerifyMac` for HMAC keys.

## Required environment configuration

A normal AWS production deployment requires `AWS_REGION` plus the following provider/key pairs:

```text
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
```

AWS access keys must not be stored in the CarePoint `.env` file. Production should use workload identity, an instance/task role, Kubernetes workload identity, or another deployment-native credential mechanism.

`AWS_ENDPOINT_URL_KMS` remains available for compatible test/private endpoints, but normal AWS production should leave it empty.

## Startup behavior

Production startup now follows this sequence:

```text
load environment
    |
    v
assertProductionKmsReady()
    |
    +--> validate provider names
    +--> require AWS_REGION and all KMS key identifiers
    +--> DescribeKey for each required key
    +--> validate Enabled / KeyState / KeyUsage / KeySpec
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

## Order attestation compatibility fix

The first C1 KMS-HMAC change made order attestation generation and verification asynchronous. `OrdersService` has now been updated to await those operations and to supply the stored signature algorithm and key identifier during verification.

That stored-key behavior is important for key rotation: records already signed with an older KMS key can continue to reference their persisted key ID instead of being implicitly verified only against the current environment key.

## CI and non-production behavior

The preflight returns immediately unless `NODE_ENV=production`. Existing CI continues to use local test KEKs/HMAC secrets and does not require AWS credentials.

This separation is intentional: CI proves application behavior and local cryptographic integration, while deployment preflight proves that production configuration can at least resolve enabled keys of the correct type through the deployed AWS identity.

## What Phase C1 does not claim

This code-level preflight does not by itself prove:

- automatic KMS key rotation is enabled or correctly scheduled;
- CloudTrail/SIEM ingestion is configured;
- VPC endpoints/network policies are resilient under failure;
- IAM policies satisfy final least-privilege review beyond the operations exercised/configured;
- cross-region disaster recovery of KMS keys;
- production load/chaos behavior.

Those remain infrastructure/release acceptance controls and should be verified in the target KSA/GCC production environment before go-live.

## Deployment acceptance checklist

1. Build and typecheck the exact release commit.
2. Configure the production workload identity and `AWS_REGION`.
3. Configure all KMS key IDs/ARNs listed above.
4. Confirm symmetric envelope keys are `SYMMETRIC_DEFAULT / ENCRYPT_DECRYPT`.
5. Confirm signing keys are `HMAC_256 / GENERATE_VERIFY_MAC`.
6. Start the API and confirm the KMS preflight completes without error.
7. Confirm `/api/v1/health/ready` succeeds only after normal PostgreSQL/Redis readiness requirements are also satisfied.
8. Execute a controlled production-like encrypt/decrypt and MAC generate/verify smoke test under the deployment identity before promoting traffic.
