# Release 1 — R5 Mobile Native Release Readiness

Status: **BLOCKED / NO-GO**  
Workstream: R5 of #70  
Tracking issue: #81  
Canonical branch: `release/release-1-integration-go-live-readiness`  
R5 starting baseline: `a9df116d4048e5f85658c2118ec07ebb53eb9a32`

## 1. Purpose

R5 converts the existing Flutter/Dart application logic into production-grade mobile deliverables: native Android/iOS projects, secure platform configuration, reproducible release builds, signing, installable artifacts and real-device acceptance for the clinically important workflows.

The existing Flutter implementation is substantial, but `flutter analyze` is not evidence that an app can be safely shipped to Android or iOS.

## 2. Static repository finding

At the start of R5:

- `apps/patient-mobile/` contains `lib/` and `pubspec.yaml` only.
- `apps/doctor-mobile/` contains `lib/` and `pubspec.yaml` only.
- `apps/provider-mobile/` contains `lib/` and `pubspec.yaml` only.
- No `android/` runner directory is present under the three app roots.
- No `ios/` runner directory is present under the three app roots.
- CI resolves dependencies and analyzes all apps; `mobile_core` is analyzed and unit-tested.
- CI does not currently build APK/AAB artifacts or iOS archives/IPAs.

The shared `mobile_core` already depends on `flutter_secure_storage`, `livekit_client`, `http` and `url_launcher`. Patient Mobile additionally depends on `geolocator`. These are useful feature foundations, but native entitlements, permissions, Keychain/Keystore behavior, signing, deep links, push configuration and store release configuration require real Android/iOS runners.

R5 therefore begins **BLOCKED FOR PRODUCTION MOBILE RELEASE**.

## 3. Application identity decisions

Before generating final production platform projects, approve and record:

| Decision | Patient | Doctor | Other Provider |
| --- | --- | --- | --- |
| Product display name | TBD | TBD | TBD |
| Android application ID | TBD | TBD | TBD |
| iOS bundle ID | TBD | TBD | TBD |
| Minimum Android version | TBD | TBD | TBD |
| Minimum iOS version | TBD | TBD | TBD |
| Apple Developer owner/team | TBD | TBD | TBD |
| Android signing owner | TBD | TBD | TBD |
| Store listing owner | TBD | TBD | TBD |
| Launch countries | TBD | TBD | TBD |
| Launch languages | TBD | TBD | TBD |

Do not invent these values in code. They are product/release-management inputs.

## 4. Native runner implementation

For each application:

- [ ] Generate/commit Android project files compatible with the pinned Flutter toolchain.
- [ ] Generate/commit iOS project/workspace files compatible with the pinned Flutter toolchain.
- [ ] Set approved application/bundle IDs.
- [ ] Set display name and branding assets.
- [ ] Configure release and debug environments so production cannot silently use development endpoints.
- [ ] Keep private signing/provisioning material outside the repository.
- [ ] Ensure generated platform files are minimal and reviewable; remove unused platform permissions/capabilities.

## 5. Release environment configuration

Define an explicit build-time contract for at least:

- API base URL;
- public/deep-link return domains where required;
- environment identifier;
- optional provider/project identifiers that are safe to embed in a client;
- feature flags whose production behavior must be fixed at build/release time.

Requirements:

- [ ] Release builds require HTTPS production/staging API URLs.
- [ ] A release build cannot fall back to `localhost` or a test URL.
- [ ] Secrets are never provided through `dart-define` or committed config.
- [ ] Candidate SHA/version/build number are traceable in release metadata.
- [ ] Environment/flavor naming is consistent across all three apps.

## 6. Secure token storage and lifecycle

Validate `flutter_secure_storage` against the actual native stores:

- [ ] Android uses secure Keystore-backed behavior.
- [ ] iOS uses Keychain-backed behavior.
- [ ] Access/refresh/session material is not written to plain preferences/files.
- [ ] Application logs do not include tokens.
- [ ] Logout clears the intended local credentials.
- [ ] Server-side revocation/expiry is reflected after app resume.
- [ ] App reinstall/restore behavior is understood and documented.
- [ ] Device backup behavior does not expose inappropriate session material.

## 7. Sensitive-content lifecycle

The approved UX requires strong privacy on mobile, especially for clinical data.

- [ ] Sensitive screens are obscured in app switcher/background snapshots where required.
- [ ] Returning from background revalidates session state.
- [ ] High-risk actions use the approved reauthentication policy.
- [ ] Lock-screen notification previews remain PHI-neutral.
- [ ] Clipboard/share behavior for clinical data is reviewed and minimized where needed.
- [ ] Screen-capture policy is explicitly decided per platform; do not add blanket blocking without product/privacy approval.

## 8. Native permissions

### Patient Mobile

- [ ] Location permission for Emergency Ambulance/transport/home-visit context.
- [ ] Camera permission for telemedicine.
- [ ] Microphone permission for telemedicine.
- [ ] Clinical file/photo access only if the implemented workflow requires it.

### Doctor Mobile

- [ ] Camera permission for telemedicine.
- [ ] Microphone permission for telemedicine.
- [ ] Clinical file/photo access only where required.

### Other Provider Mobile

- [ ] Location permission only for the approved field-service/transport workflow.
- [ ] Background location is disabled unless explicitly approved and operationally necessary.
- [ ] Camera/file permissions only where service-completion evidence requires them.

Across all apps:

- [ ] Android manifest is least privilege.
- [ ] iOS usage-description strings are accurate and understandable.
- [ ] Denied/restricted/approximate permission states are usable.
- [ ] Platform privacy manifests/required-reason declarations are completed where applicable.

## 9. Telemedicine device acceptance

Real LiveKit acceptance is shared with R4 but R5 owns native-device behavior.

Test at minimum:

- [ ] Patient Android join/call/end.
- [ ] Patient iOS join/call/end.
- [ ] Doctor Android join/call/end.
- [ ] Doctor iOS join/call/end.
- [ ] Camera denied.
- [ ] Microphone denied.
- [ ] Incoming phone-call/audio interruption.
- [ ] Background/foreground transition.
- [ ] Bluetooth headset where supported.
- [ ] Wired headset where supported.
- [ ] Wi-Fi to cellular transition.
- [ ] Restrictive network/TURN path.
- [ ] Session termination and media cleanup.

Do not capture patient media in ordinary release-test artifacts.

## 10. Location, Emergency Ambulance and transport acceptance

- [ ] Patient emergency one-touch entry is visible without scroll on representative devices.
- [ ] Emergency request succeeds with precise location.
- [ ] Approximate location state is handled safely.
- [ ] Location denied state provides the approved fallback/manual context.
- [ ] Location timeout/failure does not dead-end the urgent flow.
- [ ] Scheduled medical transport creation works on Patient Android/iOS.
- [ ] Other Provider assigned-job progression works on Android/iOS.
- [ ] EN_ROUTE / ARRIVED / TRANSPORTING / COMPLETED states remain usable during network interruptions.
- [ ] Location/background behavior matches the approved privacy policy.

## 11. Hosted payments, browser return and deep links

Where external-browser payment is launch-enabled:

- [ ] Define Android App Link and/or custom scheme only as approved.
- [ ] Define iOS Universal Link and/or custom scheme only as approved.
- [ ] Return domain association files/configuration are owned and validated.
- [ ] Return cannot be trusted solely from client parameters; CarePoint re-reads authoritative payment state from API/provider.
- [ ] Invalid/malformed return links fail safely.
- [ ] Authentication/session state is rechecked after browser return.
- [ ] No payment secrets/card data enter the application URL.

## 12. Push notification readiness

The backend has a PUSH channel, but native client delivery requires a platform implementation and provider decision.

If push is launch-enabled:

- [ ] Select push provider/project.
- [ ] Add required Flutter/native client dependency/configuration.
- [ ] Configure Android push application/project.
- [ ] Configure APNs entitlement and credentials flow for iOS.
- [ ] Implement device-token registration.
- [ ] Handle token rotation.
- [ ] Remove/disable token on logout/account lifecycle as required.
- [ ] Use PHI-neutral notification content.
- [ ] Notification tap opens only an authorized app route after session validation.
- [ ] Background/terminated notification behavior is tested.
- [ ] #78 appointment notification/reminder scenarios are included once implemented.

If push is not launch-enabled, disable it explicitly and record the channel decision in R4/R5 evidence.

## 13. Accessibility and localization

The approved UX target includes WCAG-equivalent accessible behavior, text scaling and Arabic RTL support.

For all three apps:

- [ ] English smoke test.
- [ ] Arabic RTL smoke test.
- [ ] Any other launch language smoke test.
- [ ] Large text / platform text scaling.
- [ ] Screen-reader navigation for critical paths.
- [ ] Accessible labels for emergency, booking, join-call, payment and clinical actions.
- [ ] Critical status never relies only on color.
- [ ] Medication/specialty/diagnosis/instruction text is not dangerously truncated.
- [ ] Touch targets are appropriate for primary/critical actions.

## 14. Build and signing pipeline

### Android

- [ ] `flutter build appbundle --release` succeeds for each app.
- [ ] Release application ID/version/build number are correct.
- [ ] Release signing occurs through approved secret CI/build infrastructure.
- [ ] AAB signature is verified.
- [ ] Artifact SHA-256 checksum is recorded.
- [ ] Internal/closed-track install succeeds before production rollout.

### iOS

- [ ] Release archive succeeds for each app on macOS/Xcode runner/environment.
- [ ] Correct bundle ID/team/entitlements are present.
- [ ] Signing/provisioning occurs through approved secure infrastructure.
- [ ] TestFlight/internal distribution succeeds before production rollout.
- [ ] Artifact/build identity is traceable to the exact source SHA.

Never commit keystores, `.p12`, private certificates, provisioning secrets or store API private keys.

## 15. CI changes required

The current CI provides Dart static-analysis confidence but no native build confidence.

Add permanent gates:

- [ ] Patient Android release-build gate.
- [ ] Doctor Android release-build gate.
- [ ] Other Provider Android release-build gate.
- [ ] Patient iOS compile/archive gate on macOS.
- [ ] Doctor iOS compile/archive gate on macOS.
- [ ] Other Provider iOS compile/archive gate on macOS.
- [ ] Keep `mobile_core` unit tests.
- [ ] Add app-level tests for high-risk navigation/state logic where practical.
- [ ] Keep signing out of ordinary untrusted PR workflows.
- [ ] Add controlled/manual signed-release workflow if required by credential policy.

## 16. Real-device acceptance matrix

Use this as the minimum evidence table and extend it for supported OS versions.

| App | Platform | Device/OS | High-risk workflows | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| Patient | Android | TBD | Auth, booking, emergency, location, telehealth, payment return, notifications | TBD | TBD |
| Patient | iOS | TBD | Auth, booking, emergency, location, telehealth, payment return, notifications | TBD | TBD |
| Doctor | Android | TBD | Auth, queue, patient snapshot, clinical workflow, telehealth, notifications | TBD | TBD |
| Doctor | iOS | TBD | Auth, queue, patient snapshot, clinical workflow, telehealth, notifications | TBD | TBD |
| Other Provider | Android | TBD | Auth, jobs, route/location, status progression, completion, notifications | TBD | TBD |
| Other Provider | iOS | TBD | Auth, jobs, route/location, status progression, completion, notifications | TBD | TBD |

## 17. Store/privacy readiness

Before external distribution:

- [ ] Privacy policy URL/content matches actual mobile data flows.
- [ ] Apple privacy declarations match actual data collection/use.
- [ ] Google Play Data Safety form matches actual data collection/use.
- [ ] Health/location/payment declarations are reviewed.
- [ ] Support/contact URLs and account-deletion workflow are identified if required.
- [ ] Age/content/medical disclaimers are reviewed by product/legal where applicable.
- [ ] Screenshots/store metadata contain no PHI/test secrets.

R9 owns final market/regulatory approval; R5 supplies platform evidence.

## 18. Exit decision

R5 may move to **READY** only when:

- all launch apps have committed native Android/iOS runners;
- approved app/bundle IDs and minimum OS versions are fixed;
- permissions/privacy configuration is complete;
- release builds are reproducible;
- secure signing/distribution works;
- high-risk workflows pass on representative real devices;
- native LiveKit, location, deep-link/payment and push behavior is validated where enabled;
- accessibility/Arabic RTL checks pass;
- release artifacts are traceable to the exact candidate SHA.

Until then R5 remains **BLOCKED / NO-GO**.

`main` remains unchanged until the Release Candidate satisfies the final Go/No-Go gates.