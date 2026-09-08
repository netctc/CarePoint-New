# Phase C — C1a Production KMS Readiness & Fail-Closed Startup

## Objective

Close the deployment gap left by Slice 9: CarePoint must not advertise readiness or accept production traffic when its AWS KMS envelope-encryption dependencies are missing, misconfigured or unusable.

This slice hardens the existing encryption implementation; it does not change encrypted payload formats, database schemas or application-domain permissions.

## Covered envelope domains

Production validates all six existing KMS-backed envelope domains:

1. MFA secrets — `MFA_KMS_KEY_ID`;
2. clinical records — `CLINICAL_KMS_KEY_ID`;
3. clinical orders/results — `ORDER_KMS_KEY_ID`;
4. clinical documents — `DOCUMENT_KMS_KEY_ID`;
5. secure messaging — `MESSAGING_KMS_KEY_ID`;
6. telehealth session-key material — `TELEHEALTH_KMS_KEY_ID`.

Each probe uses the same domain-specific AWS KMS `EncryptionContext.purpose` as the application path.

## Startup behavior

When `NODE_ENV=production`:

- every envelope provider must resolve to `aws-kms`;
- every domain KMS key ID must be configured;
- `AWS_REGION` or `AWS_DEFAULT_REGION` must be configured;
- an implicit custom `AWS_ENDPOINT_URL_KMS` is rejected;
- a custom production endpoint requires `AWS_KMS_ALLOW_CUSTOM_ENDPOINT=true` and HTTPS;
- before `app.listen()`, CarePoint performs an Encrypt → Decrypt round-trip using each configured domain key and validates the recovered 256-bit DEK.

Any configuration or KMS/IAM/network/key-policy failure aborts startup before the API accepts traffic.

Non-production can request the same startup probe with `AWS_KMS_STARTUP_PROBE=true`.

## Readiness behavior

`GET /api/v1/health` remains lightweight liveness and does not call AWS.

`GET /api/v1/health/ready` now requires:

- PostgreSQL;
- Redis;
- KMS readiness.

The readiness response exposes only a boolean KMS dependency state and whether KMS is required; it does not expose key IDs, ARNs, credentials or AWS error details.

Successful KMS probes are cached for a short bounded interval (`AWS_KMS_HEALTH_CACHE_MS`, default 30 seconds) to avoid turning orchestration readiness polling into excessive KMS traffic.

## Custom endpoint boundary

`AWS_ENDPOINT_URL_KMS` remains usable for development/test compatible endpoints.

Production custom endpoints are fail-closed by default. They require an explicit `AWS_KMS_ALLOW_CUSTOM_ENDPOINT=true` opt-in and must use HTTPS. Normal AWS deployments should leave the endpoint override empty and use AWS regional KMS endpoints through workload identity / instance/task/pod roles.

## CI acceptance

CI deliberately has no production AWS credentials. `phase-c-c1-kms-smoke.mjs` therefore separates configuration acceptance from live deployment validation:

- confirms local/test readiness reports KMS healthy but not required;
- confirms a complete six-domain production KMS configuration is recognized;
- rejects a production local envelope provider;
- rejects a missing domain key;
- rejects missing AWS region;
- rejects implicit custom KMS endpoints;
- rejects HTTP production custom endpoints;
- accepts an explicitly opted-in HTTPS private endpoint configuration;
- rejects unsupported provider values.

The actual Encrypt/Decrypt round-trip is implemented in `AwsKmsKeyProvider.healthCheck()` and is mandatory at real production startup, where workload credentials and the real KMS policy/network path exist.

## Security properties

- No raw KEK is stored in CarePoint environment variables.
- Probe plaintext is random 256-bit material and is zeroed after validation.
- The probe does not persist PHI, MFA secrets or application data.
- No fallback to local AES-KW is permitted in production.
- Readiness does not disclose KMS key identifiers or raw AWS errors.

## Database impact

No Prisma schema change and no database migration are required.

## Follow-up C1b

Clinical Document attestation already supports AWS KMS HMAC. Clinical Order attestation still uses a development-only local HMAC implementation and deliberately rejects production. C1b wires the same KMS/HSM-grade signing boundary into Orders and adds signing-key readiness probes without changing stored attestation semantics for existing local/test records.
