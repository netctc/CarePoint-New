# Release 1 R5 — release-safe mobile configuration and native compatibility

This document records the repository-owned portion of Release 1 mobile hardening that can be completed without inventing production application identifiers, Apple/Android signing ownership, store credentials, production domains or real-device acceptance evidence.

Related work: #81 (R5), #114 (this engineering increment), #70 (master tracker).

## What this increment changes

### Release-safe API configuration

`packages/mobile_core/lib/mobile_release_config.dart` centralizes validation of the mobile API endpoint boundary.

Development/test builds retain the Android-emulator default `http://10.0.2.2:4000/api/v1` when no endpoint is supplied. Release/product execution is fail-closed instead: it requires `CAREPOINT_BUILD_ENV` to be `staging` or `production`, requires a full 40-character `CAREPOINT_RELEASE_SHA`, requires an explicit `CAREPOINT_API_BASE`, requires HTTPS, and rejects loopback/emulator plus `.local`, `.test`, `.example` and `.invalid` hosts.

`CarePointLoginGate`, which is the shared authentication entry used by the three launch apps, resolves its default `CarePointApi` through this boundary before restoring or creating a mobile session. A caller that deliberately injects a `CarePointApi` remains responsible for supplying an already-reviewed endpoint; this injection path is retained for tests and explicit integration composition.

The production/staging domain itself is intentionally not hard-coded because #81 records that this is an Operations/Product input still requiring approval.

### Native compatibility gate

`.github/workflows/mobile-native-compatibility.yml` adds two unsigned/non-production compatibility jobs for each launch application:

- Android debug compilation on Ubuntu for Patient, Doctor and Other Provider;
- iOS simulator debug compilation on macOS for Patient, Doctor and Other Provider.

The workflow checks out the exact PR head SHA, verifies the tracked Flutter lock remains unchanged after dependency resolution, generates an ephemeral platform runner using the explicit validation-only namespace `io.carepoint.validation`, compiles the application and uploads sanitized checksum/metadata evidence.

The validation-only runner is never promoted, signed, published or treated as a launch identity. The generated runner exists only inside the CI workspace and is discarded after the job.

## What this proves

A green gate proves that the current Dart/Flutter application and plugin graph can be generated and compiled against Android and iOS simulator platform templates with the pinned Flutter toolchain, and that the build is attributable to the exact candidate SHA.

It also proves the release API configuration policy through unit tests in `mobile_release_config_test.dart`.

## What this does NOT prove

This increment does not satisfy the #81 production mobile exit criteria by itself. In particular it does not provide or approve:

- production Android application IDs or iOS bundle IDs;
- committed launch `android/` / `ios/` runner projects;
- app names, icons, splash assets or store metadata;
- minimum supported Android/iOS versions;
- Apple Developer team/provisioning profiles or Android release keystore ownership;
- signed AAB/APK/IPA release artifacts;
- APNs/Android push provider configuration;
- app-link/universal-link domains;
- production/staging API domains;
- final camera/microphone/location/privacy manifest declarations;
- rooted/jailbroken-device policy;
- real LiveKit, location/emergency, payment-return, push, RTL/accessibility or lifecycle testing on physical devices.

Those values and evidences remain explicit #81 blockers and must not be inferred from the validation-only CI namespace.

## Release configuration contract

Future signed release automation must pass at least:

```text
CAREPOINT_BUILD_ENV=production|staging
CAREPOINT_API_BASE=https://<approved-api-host>/api/v1
CAREPOINT_RELEASE_SHA=<exact 40-character candidate SHA>
```

A production signing workflow must additionally bind the approved application/bundle identity, build number/version, signing credential owner and immutable artifact digest to the same exact source SHA. Signing secrets and private keys must remain in an approved secret/signing service and must never be committed to the repository or attached to public evidence.

## R5 status after this increment

#114 may close once the exact candidate SHA passes CI, security analysis and all six native compatibility jobs. #81 must remain open until the production runner identities/configuration, signed artifacts and physical-device acceptance evidence are supplied and verified.
