# Phase C8 — Production KMS Rotation Readiness

## 1. Objective

Phase C8 closes the production key-rotation gap left after Phase C1. C1 proves that the CarePoint application keys are real, enabled, customer-managed AWS KMS keys with the expected region, account, usage and key specification. C8 adds a second fail-closed startup gate that proves those same application keys are operated through stable customer-managed aliases and that their rotation model is compatible with the key type.

The phase covers the eight application KMS references already governed by C1:

| Domain | Environment variable | Usage | Rotation model |
| --- | --- | --- | --- |
| MFA envelopes | `MFA_KMS_KEY_ID` | `ENCRYPT_DECRYPT` | AWS KMS automatic rotation |
| Clinical records | `CLINICAL_KMS_KEY_ID` | `ENCRYPT_DECRYPT` | AWS KMS automatic rotation |
| Orders/results | `ORDER_KMS_KEY_ID` | `ENCRYPT_DECRYPT` | AWS KMS automatic rotation |
| Order attestation | `ORDER_SIGNING_KMS_KEY_ID` | `GENERATE_VERIFY_MAC` / `HMAC_256` | Manual replacement + alias rollover |
| Clinical documents | `DOCUMENT_KMS_KEY_ID` | `ENCRYPT_DECRYPT` | AWS KMS automatic rotation |
| Document attestation | `DOCUMENT_SIGNING_KMS_KEY_ID` | `GENERATE_VERIFY_MAC` / `HMAC_256` | Manual replacement + alias rollover |
| Secure messaging | `MESSAGING_KMS_KEY_ID` | `ENCRYPT_DECRYPT` | AWS KMS automatic rotation |
| Telehealth session material | `TELEHEALTH_KMS_KEY_ID` | `ENCRYPT_DECRYPT` | AWS KMS automatic rotation |

C8 deliberately does not create, rotate, disable or delete KMS keys. Infrastructure provisioning remains an operator/IaC responsibility. The application verifies the production state before it accepts traffic.

## 2. Why customer-managed aliases are mandatory

Production configuration must reference each of the eight application keys by a customer-managed KMS alias rather than a raw key UUID or key ARN.

Default prefix:

```text
alias/carepoint/
```

The prefix can be changed with `AWS_KMS_ALIAS_PREFIX`, but it must remain a customer-managed alias namespace and must end with `/`.

Aliases provide two operational properties required by CarePoint:

1. Application configuration stays stable while an HMAC key is replaced or while an emergency replacement key is introduced.
2. A rotation can be performed by changing the alias target instead of distributing a new key identifier through every runtime configuration surface.

C8 rejects raw key IDs and raw key ARNs for the eight C1 application references in production.

## 3. Startup order and fail-closed behavior

The production bootstrap now runs the security gates in this order:

```text
C1 KMS metadata readiness
  -> C8 KMS rotation readiness
  -> C3 private object storage
  -> C5 PostgreSQL readiness
  -> C4 Redis readiness
  -> C6 OTLP readiness
  -> Nest application creation/listen
```

`assertProductionKmsRotationReady()` executes before `NestFactory.create()` and before the application listens on the network. A production deployment therefore fails closed if its KMS rotation posture cannot be verified.

Non-production environments skip the C8 AWS calls so local development and deterministic CI acceptance can use injected test adapters.

## 4. Symmetric encryption-key rotation policy

For every `ENCRYPT_DECRYPT` requirement, C8 performs the following checks:

1. The configured value is a KMS alias under `AWS_KMS_ALIAS_PREFIX`.
2. The alias resolves to a concrete KMS target key.
3. Automatic KMS key rotation is enabled for that concrete target.
4. The reported rotation period is valid and does not exceed `AWS_KMS_MAX_ROTATION_DAYS`.

Default:

```text
AWS_KMS_MAX_ROTATION_DAYS=365
```

The accepted policy range is 90–365 days. CarePoint therefore cannot be started in production with a symmetric application key whose automatic rotation is disabled or whose configured rotation period is weaker than the deployment policy.

C1 remains responsible for validating that the resolved target is customer-managed, enabled, in the correct region/account and uses `SYMMETRIC_DEFAULT` with `ENCRYPT_DECRYPT`.

## 5. HMAC signing-key rollover policy

AWS KMS HMAC keys do not use the same automatic rotation mechanism as symmetric encryption keys. C8 therefore enforces a manual rollover model for:

- `ORDER_SIGNING_KMS_KEY_ID`
- `DOCUMENT_SIGNING_KMS_KEY_ID`

The operational model is:

```text
stable CarePoint alias
        |
        +--> current HMAC_256 key

rotation event:
  create new HMAC_256 key
  validate it
  repoint the same CarePoint alias
        |
        +--> new HMAC_256 key
```

C8 resolves the alias target and verifies that the concrete HMAC target has not exceeded:

```text
AWS_KMS_HMAC_MAX_KEY_AGE_DAYS=365
```

The accepted configuration range is 1–365 days. A stale HMAC target causes production startup to fail closed until the alias is repointed to a sufficiently recent valid key.

C1 separately verifies `HMAC_256`, `GENERATE_VERIFY_MAC` and `HMAC_SHA_256` capability.

## 6. Historical decrypt/verification safety

Alias rollover is safe only if historical objects do not depend on the alias continuing to point to the old key.

CarePoint already preserves the concrete KMS key identifier returned after alias resolution:

- envelope encryption persists the concrete `keyId` associated with encrypted material;
- order attestation persists `result.KeyId` returned by KMS;
- document attestation persists `result.KeyId` returned by KMS;
- HMAC verification passes the stored concrete key id to `VerifyMac`.

As a result, moving `alias/carepoint/orders-signing` or `alias/carepoint/documents-signing` to a replacement HMAC key affects new signatures while historical signatures continue to be checked against the exact key that created them.

### Critical retention rule

An old KMS key must not be disabled or scheduled for deletion while any retained CarePoint record still references that concrete key id. This applies to encrypted MFA data, clinical records, orders/results, clinical documents, messages, telehealth material and KMS-backed attestations.

Alias rollover and old-key retirement are therefore separate operational decisions.

## 7. Production configuration

Recommended baseline:

```dotenv
AWS_REGION=me-south-1
AWS_KMS_ACCOUNT_ID=<12-digit-account-id>
AWS_KMS_ALIAS_PREFIX=alias/carepoint/
AWS_KMS_MAX_ROTATION_DAYS=365
AWS_KMS_HMAC_MAX_KEY_AGE_DAYS=365

MFA_KEY_PROVIDER=aws-kms
MFA_KMS_KEY_ID=alias/carepoint/mfa

CLINICAL_KEY_PROVIDER=aws-kms
CLINICAL_KMS_KEY_ID=alias/carepoint/clinical

ORDER_KEY_PROVIDER=aws-kms
ORDER_KMS_KEY_ID=alias/carepoint/orders
ORDER_SIGNING_PROVIDER=aws-kms-hmac
ORDER_SIGNING_KMS_KEY_ID=alias/carepoint/orders-signing

DOCUMENT_KEY_PROVIDER=aws-kms
DOCUMENT_KMS_KEY_ID=alias/carepoint/documents
DOCUMENT_SIGNING_PROVIDER=aws-kms-hmac
DOCUMENT_SIGNING_KMS_KEY_ID=alias/carepoint/documents-signing

MESSAGING_KEY_PROVIDER=aws-kms
MESSAGING_KMS_KEY_ID=alias/carepoint/messaging

TELEHEALTH_KEY_PROVIDER=aws-kms
TELEHEALTH_KMS_KEY_ID=alias/carepoint/telehealth
```

Real account identifiers, credentials and secret material must remain in the deployment secret/configuration system and must not be committed to source control.

## 8. Required AWS permissions for the runtime preflight

The workload identity used by the API needs read-only KMS metadata permissions sufficient for C1 and C8, including the ability to:

- describe the configured KMS keys;
- list aliases so the configured aliases can be resolved;
- read rotation status for symmetric encryption targets.

Application-domain runtime permissions such as encrypt/decrypt or generate/verify MAC remain governed separately by the key policies and IAM policies required by each functional module.

The C8 preflight itself does not call alias mutation, key creation, key deletion or rotation mutation APIs.

## 9. Operational runbook

### 9.1 Symmetric encryption keys

Routine rotation is performed by AWS KMS automatic rotation on the current alias target.

Operator procedure:

1. Confirm the alias points to the intended customer-managed symmetric key.
2. Confirm automatic rotation is enabled.
3. Confirm the rotation period is at or below `AWS_KMS_MAX_ROTATION_DAYS`.
4. Run/deploy the CarePoint API; C1 and C8 must both pass.
5. Preserve old key material according to AWS KMS rotation semantics and CarePoint data-retention requirements.

For an emergency manual replacement, create a compatible customer-managed symmetric key, validate it, repoint the alias, and retain the old key while historical CarePoint ciphertext still depends on it.

### 9.2 HMAC signing keys

Operator procedure:

1. Create a new customer-managed `HMAC_256` key in the same required AWS region/account.
2. Ensure the key is enabled and usable for `GENERATE_VERIFY_MAC` with `HMAC_SHA_256`.
3. Validate application/key policy access before switching production traffic.
4. Repoint the existing CarePoint signing alias to the new HMAC key.
5. Restart/redeploy the API so C1 and C8 execute against the new alias target.
6. Generate a controlled new attestation and confirm the persisted attestation contains the new concrete KMS `KeyId`.
7. Verify an older attestation and confirm it still validates using its previously persisted concrete `KeyId`.
8. Keep the old HMAC key enabled while retained historical attestations reference it.
9. Retire/delete the old HMAC key only through an explicit data-retention and cryptographic-dependency review.

## 10. Fail-closed conditions

Production startup fails if any of the following is true:

- `AWS_REGION` is missing;
- a development/test KMS endpoint override is configured;
- the alias prefix is invalid or uses the AWS-managed alias namespace;
- a configured application KMS reference is a raw key id/ARN instead of an alias;
- an alias is outside the configured CarePoint prefix;
- an alias cannot be resolved to a target key;
- a symmetric key does not have automatic rotation enabled;
- a symmetric rotation period exceeds the configured maximum;
- an HMAC target has no valid creation timestamp;
- an HMAC target exceeds the configured maximum age;
- AWS metadata required for the check cannot be read.

AWS exceptions are propagated by sanitized exception class/name only. The C8 wrapper does not include the original AWS error message in the startup failure, reducing the chance that credentials, endpoint details or provider response content are reflected into logs.

## 11. Deterministic acceptance test

C8 is part of the API `npm test` chain:

```bash
npm run c8:kms-rotation-preflight
```

The acceptance test verifies:

- non-production no-op behavior;
- all eight aliases are inspected;
- six symmetric targets require automatic rotation;
- two HMAC targets require manual rollover freshness;
- invalid/missing regions and endpoint overrides fail;
- invalid alias namespaces and raw key IDs fail;
- disabled/overdue symmetric rotation fails;
- stale or malformed HMAC targets fail;
- provider error messages are not reflected into the C8 error;
- order and document attestation code persists concrete KMS KeyIds and verifies using the stored KeyId.

Expected success marker:

```text
Phase C8 KMS rotation readiness acceptance passed
```

## 12. CI acceptance criteria

C8 is complete only when the branch passes the existing full CarePoint validation stack against the exact final head:

- canonical C2 npm dependency graph and lock hash unchanged;
- high-severity dependency audit passes with zero reported vulnerabilities;
- production build passes;
- C1 KMS acceptance passes;
- C3–C8 API preflight/acceptance chain passes;
- all database migrations and bootstrap pass;
- IAM persistence acceptance passes;
- Admin B1–B9 pass;
- application Slice 2–9 pass, including the C7 durable notification flow;
- Flutter shared/mobile tests and analyses pass;
- FHIR Slice 10.0–10.13 pass.

The validation PR is temporary and must be closed without merge after the branch itself has been proven green, preserving the established phase-stacking workflow.
