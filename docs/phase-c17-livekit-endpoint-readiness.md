# Phase C17 — LiveKit endpoint readiness

## Objective

Phase C17 hardens the client-facing LiveKit endpoint used by CarePoint secure telemedicine. The API issues a short-lived participant JWT and returns `LIVEKIT_URL` in the same join material. A production URL therefore controls where a patient or provider device will present a valid room token.

C17 makes that routing decision fail closed before the Nest application starts and validates it again immediately before LiveKit JWT issuance.

C17 does not replace Phase C12 secret controls. `livekit-api-key` and `livekit-api-secret` remain resolved through the existing external-secret/KMS path, and the production external-secret preflight still runs before the C17 endpoint preflight.

## Threats addressed

Before C17, the LiveKit provider verified that a URL string existed but did not validate the endpoint itself. A malformed or unintended production `LIVEKIT_URL` could therefore be returned to the client together with a valid participant token.

The relevant configuration failure modes were:

- clear-text `ws://` in production;
- non-WebSocket schemes such as `http://`, `https://` or `ftp://`;
- embedded URL credentials;
- query-string or fragment data inside the configured endpoint;
- `localhost`, loopback or unspecified addresses that would resolve on the patient/provider device rather than to the intended telehealth service;
- an unsupported or missing production telehealth provider that was discovered only after application startup.

## Controls implemented

### 1. Shared telehealth provider policy

`services/api/src/infrastructure/http/livekit-endpoint.ts` centralizes provider and endpoint validation.

Supported provider names are only:

```text
mock
livekit
```

`mock` remains available outside production so the existing Slice 3 development/CI flow is unchanged.

When `NODE_ENV=production`, startup requires:

```text
TELEHEALTH_PROVIDER=livekit
```

### 2. Client-facing LiveKit URL validation

When LiveKit is used, `LIVEKIT_URL` must be an absolute WebSocket URL.

Development/test accepts `ws://` or `wss://`, which preserves local LiveKit usage such as:

```text
ws://127.0.0.1:7880
```

Production requires `wss://` and rejects:

- `ws://`;
- any non-WebSocket scheme;
- embedded username/password credentials;
- query strings;
- URL fragments;
- `localhost` and `*.localhost`;
- IPv4 loopback in `127.0.0.0/8`;
- IPv6 loopback `::1`;
- unspecified hosts `0.0.0.0` and `::`.

C17 intentionally does not block all private RFC1918/private-DNS addresses because an enterprise/VPN LiveKit deployment can legitimately expose a private hostname to managed client devices.

Reverse-proxy paths remain supported and the validated configured value is returned unchanged. For example:

```text
wss://telehealth.example.com/livekit/
```

remains exactly that value after validation.

### 3. Startup fail-closed readiness

`assertProductionTelehealthReady()` executes before `NestFactory.create()`.

The production startup sequence therefore rejects an invalid provider or LiveKit URL before the API accepts traffic.

The existing C12 external-secret preflight runs first, so production still verifies the encrypted LiveKit API key/secret material independently of this endpoint policy.

### 4. Defense in depth before JWT issuance

`TelehealthProviderService` no longer reads a raw `LIVEKIT_URL` when constructing LiveKit join material. It calls the shared `validatedLiveKitUrl()` policy first.

An invalid client-facing endpoint fails before:

- the LiveKit secrets are resolved for the request;
- an `AccessToken` is constructed;
- a participant JWT is emitted.

The webhook path continues to use LiveKit's `WebhookReceiver` with the C12-managed API credentials; C17 does not weaken or replace webhook signature verification.

## Configuration

The existing API `.env.example` already contains all C17 configuration keys, so no new environment variable is introduced.

Development/test example:

```text
TELEHEALTH_PROVIDER=mock
LIVEKIT_URL=ws://127.0.0.1:7880
```

Production example:

```text
TELEHEALTH_PROVIDER=livekit
LIVEKIT_URL=wss://telehealth.example.com
LIVEKIT_API_KEY_KMS_FILE=/run/secrets/livekit-api-key.kms
LIVEKIT_API_SECRET_KMS_FILE=/run/secrets/livekit-api-secret.kms
```

The actual encrypted secret file paths and endpoint hostname are deployment-specific and must not be committed with live credentials.

## Acceptance

The API workspace now exposes:

```text
npm run c17:livekit-endpoint-readiness
```

and wires it into the existing API `test` chain. No permanent workflow change is required.

The C17 smoke verifies:

- non-production mock compatibility;
- explicit production `livekit` requirement;
- required `LIVEKIT_URL`;
- `ws://`/`wss://` scheme rules;
- production WSS enforcement;
- credentials/query/fragment rejection;
- localhost, IPv4/IPv6 loopback and unspecified-host rejection;
- preservation of valid reverse-proxy paths;
- failure before secret resolution/JWT issuance for an invalid endpoint;
- successful LiveKit compact-JWT generation for a valid endpoint;
- execution of the production telehealth preflight before Nest creation;
- use of the shared endpoint policy by `TelehealthProviderService`;
- absence of a new client/HTTP dependency.

The permanent Slice 3 secure-telemedicine acceptance remains unchanged and continues to exercise consent, readiness, participant isolation, E2EE-key handling, mock webhook state transitions and session lifecycle behavior.

## C2 validation maintenance discovered during C17

The first C17 CI attempt exposed independent mobile dependency-resolution drift. The frozen C16 run, using Flutter `3.47.2`, resolved and verified `flutter_secure_storage 10.3.1`. A later runner with the same Flutter version resolved `10.3.2`, causing all four tracked mobile lock checksums to fail before any Flutter test ran. C17 had not modified any mobile source, `pubspec.yaml`, lockfile or checksum manifest.

The repository already tracked lockfiles for `10.3.1`, and that version had passed the complete C16 Flutter analysis/test suite. To preserve the purpose of the C2 canonical-lock gate rather than silently accepting resolver drift, `packages/mobile_core/pubspec.yaml` now pins the direct dependency to:

```text
flutter_secure_storage: 10.3.1
```

instead of the previous compatible range `^10.3.1`.

No mobile lockfile or checksum manifest is regenerated by this maintenance change. The intent is to make a fresh `flutter pub get` reproduce the already-reviewed lock graph exactly and to require an explicit future change when secure-storage is upgraded.

## Change boundaries

C17 introduces no:

- database migration;
- new package dependency;
- `package-lock.json` change;
- mobile lockfile regeneration;
- retry behavior;
- permanent GitHub workflow change;
- new secret storage mechanism.

The functional phase remains limited to telehealth provider configuration and the client-facing LiveKit endpoint boundary. The only additional change is the exact-version C2 reproducibility pin documented above, discovered and justified by CI evidence during validation.
