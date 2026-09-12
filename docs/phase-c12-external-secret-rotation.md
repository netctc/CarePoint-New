# Phase C12 — External integration secret rotation

## Objective

C12 removes production payment, insurance, claims, notification, SIEM and LiveKit credentials from plaintext process environment variables and makes credential rollover possible without restarting the CarePoint API.

Production credentials are stored as AWS KMS ciphertext in small mounted files. The API reads the ciphertext file when the credential is needed, hashes the ciphertext, and only calls KMS again when the ciphertext changes. An atomic file replacement therefore activates a new external credential on the next request/worker delivery without a process restart.

## Protected credentials

| C12 secret name | Production ciphertext file variable | Legacy plaintext variable |
| --- | --- | --- |
| `payment-gateway-api-key` | `PAYMENT_GATEWAY_API_KEY_KMS_FILE` | `PAYMENT_GATEWAY_API_KEY` |
| `insurance-gateway-api-key` | `INSURANCE_GATEWAY_API_KEY_KMS_FILE` | `INSURANCE_GATEWAY_API_KEY` |
| `claims-gateway-api-key` | `CLAIMS_GATEWAY_API_KEY_KMS_FILE` | `CLAIMS_GATEWAY_API_KEY` |
| `notification-gateway-api-key` | `NOTIFICATION_GATEWAY_API_KEY_KMS_FILE` | `NOTIFICATION_GATEWAY_API_KEY` |
| `siem-export-api-key` | `SIEM_EXPORT_API_KEY_KMS_FILE` | `SIEM_EXPORT_API_KEY` |
| `livekit-api-key` | `LIVEKIT_API_KEY_KMS_FILE` | `LIVEKIT_API_KEY` |
| `livekit-api-secret` | `LIVEKIT_API_SECRET_KMS_FILE` | `LIVEKIT_API_SECRET` |

Legacy plaintext variables remain available only for development/test compatibility. C12 rejects them in `NODE_ENV=production`.

## Dedicated KMS key

C12 adds `EXTERNAL_SECRET_KMS_KEY_ID` to the C1/C8 production KMS inventory. Production must configure:

```text
EXTERNAL_SECRET_KEY_PROVIDER=aws-kms
EXTERNAL_SECRET_KMS_KEY_ID=alias/carepoint/external-secrets
```

The alias is subject to the same controls as the other C1/C8 symmetric application keys:

- customer-managed KMS key;
- enabled and in `AWS_REGION`;
- `ENCRYPT_DECRYPT` / `SYMMETRIC_DEFAULT`;
- customer-managed alias under `AWS_KMS_ALIAS_PREFIX`;
- automatic KMS key rotation enabled;
- rotation period no greater than `AWS_KMS_MAX_ROTATION_DAYS`.

The workload IAM policy should grant `kms:Decrypt` for this key only to the CarePoint API runtime role and should constrain the encryption context when the platform/IAM tooling supports that condition.

## Encryption context

Every ciphertext must be created with both context values:

```text
purpose=carepoint-external-secret
secret=<C12 secret name>
```

The resolver supplies the same context to KMS Decrypt. A ciphertext generated for one C12 secret cannot therefore be substituted for another without KMS rejecting the decrypt operation.

Example for a payment gateway credential:

```bash
umask 077
printf '%s' "$NEW_PAYMENT_GATEWAY_API_KEY" > /tmp/payment-api-key.plain
aws kms encrypt \
  --region "$AWS_REGION" \
  --key-id "$EXTERNAL_SECRET_KMS_KEY_ID" \
  --plaintext fileb:///tmp/payment-api-key.plain \
  --encryption-algorithm SYMMETRIC_DEFAULT \
  --encryption-context purpose=carepoint-external-secret,secret=payment-gateway-api-key \
  --query CiphertextBlob \
  --output text > /run/carepoint-secrets/payment-api-key.kms.b64.next
chmod 600 /run/carepoint-secrets/payment-api-key.kms.b64.next
rm -f /tmp/payment-api-key.plain
mv /run/carepoint-secrets/payment-api-key.kms.b64.next /run/carepoint-secrets/payment-api-key.kms.b64
```

Use an equivalent secret-management automation rather than shell history for real production values. The example illustrates the required KMS context and atomic replacement semantics; it is not a recommendation to type credentials into an interactive shell.

## Rotation procedure

1. Create the new credential in the external provider while the previous credential remains valid.
2. Encrypt the new value with `EXTERNAL_SECRET_KMS_KEY_ID` and the exact C12 encryption context for that secret.
3. Write the base64 ciphertext to a new file in the same filesystem as the active mounted file.
4. Restrict permissions so the file is not group/world writable.
5. Atomically rename the new ciphertext over the active path.
6. Exercise a non-destructive provider operation or normal health transaction and verify success.
7. Confirm there are no authentication failures in SIEM/observability.
8. Revoke the previous external-provider credential only after the new credential is proven active.

The resolver reads the active ciphertext on every secret lookup and caches plaintext only when the ciphertext SHA-256 digest is unchanged. Changing the file therefore causes one new KMS decrypt and then reuses the new value.

## Fail-closed behavior

Production startup fails before `NestFactory.create()` when any C12 secret cannot be resolved. Runtime resolution also fails closed when:

- a legacy plaintext production variable is present;
- a ciphertext file path is absent or relative;
- the path is not a regular file;
- the file is group/world writable;
- ciphertext is not canonical base64 or exceeds the size limit;
- `EXTERNAL_SECRET_KMS_KEY_ID` is missing;
- KMS cannot decrypt with the required encryption context;
- decrypted plaintext is empty, oversized, or contains CR/LF/NUL characters.

Provider/KMS exception messages are not copied into C12 startup errors.

## Operational constraints

- Use atomic file replacement. Do not rewrite the active file in place.
- Do not put plaintext credentials in `.env`, deployment manifests, GitHub Actions variables, logs, command output, tickets, or source control.
- Do not configure `EXTERNAL_SECRET_KMS_ENDPOINT` in production.
- The ciphertext files may be backed by a secrets sidecar/agent, CSI volume, or deployment mechanism, provided it preserves the C12 file contract and atomic rollover behavior.
- Automatic KMS material rotation does not require re-encrypting these files because the KMS key identity remains stable and KMS retains material required for old ciphertexts.
- External-provider credential rotation and KMS key-material rotation are separate operations.

## Acceptance

`npm test -w @carepoint/api` includes `c12:external-secret-rotation` and verifies:

- all seven external credentials are mapped;
- encryption-context binding;
- unchanged ciphertext is cached;
- atomic ciphertext replacement triggers re-decryption without restart;
- production plaintext variables fail closed;
- path and file-permission controls;
- every gateway resolves its credential through C12;
- the preflight runs before Nest application creation;
- no Secrets Manager package or dependency-graph change is introduced.

C1 and C8 acceptance are also extended from eight to nine production KMS references, with seven symmetric keys subject to automatic-rotation validation and two HMAC keys subject to manual rollover-age validation.
