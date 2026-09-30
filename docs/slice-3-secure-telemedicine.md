# Slice 3 - Secure Telemedicine

## Scope

Slice 3 adds the secure telemedicine foundation to confirmed `TELEMEDICINE` appointments. Telemedicine remains part of the appointment lifecycle, not a standalone room directory. A patient or provider can access a room only when the authenticated account owns the corresponding confirmed appointment.

## Security model

- The API is default-deny and telemedicine endpoints require `TELEHEALTH_JOIN` or `TELEHEALTH_OPERATE`.
- A patient can access only their own appointment.
- A Doctor or Other Provider can access only an appointment belonging to their active provider profile.
- Room names and participant identities are opaque CarePoint-generated values and contain no patient/provider names, emails or other direct PII.
- Join credentials are issued server-side and expire after five minutes.
- Readiness opens 30 minutes before the appointment.
- Room join opens 15 minutes before the confirmed appointment and closes 60 minutes after the scheduled end.
- Patient telemedicine consent (`telemedicine-v1`) is mandatory before either participant can join.
- Each participant must complete their own camera/microphone/network readiness check before joining.
- Recording is disabled in the MVP. There is no recording API, and PostgreSQL has a check constraint preventing `recordingEnabled=true`.
- Cancellation or no-show marks the associated telehealth session cancelled and blocks future join tokens.

## Provider abstraction

Business logic depends on `TelehealthProviderService`, not directly on UI SDK calls. The production adapter uses LiveKit server-side access tokens and webhook verification. A mock adapter exists only for non-production CI and development.

Production configuration:

```env
TELEHEALTH_PROVIDER=livekit
LIVEKIT_URL=wss://<livekit-host>
LIVEKIT_API_KEY=<server-api-key>
LIVEKIT_API_SECRET=<server-api-secret>
```

The API secret must never be shipped to a browser or mobile application. Mobile clients receive only a short-lived participant token for one opaque room.

## E2EE key handling

CarePoint generates a random 256-bit media encryption key per telehealth session. The plaintext key is returned only through the authenticated appointment-scoped join endpoint to an authorized participant. The database stores only the encrypted envelope:

- envelope version
- algorithm
- key id
- wrapped data-encryption key
- IV
- ciphertext

The current local AES-KW provider is permitted only outside production. Production must provide an external KMS/HSM adapter before telemedicine is enabled.

Example deployment variables for non-production only:

```env
TELEHEALTH_KEY_PROVIDER=local
TELEHEALTH_ENVELOPE_KEY_ID=local-telehealth-kek-v1
TELEHEALTH_ENVELOPE_KEY_BASE64=<32-byte-key-base64>
```

In production the runtime deliberately rejects the local provider.

## Session lifecycle

```text
CONFIRMED TELEMEDICINE APPOINTMENT
        |
        v
WAITING
  | patient accepts consent
  | patient + provider complete readiness
        v
READY
  | short-lived join credentials
  | LiveKit participant joined webhook
        v
ACTIVE
  | provider ends / room finishes
        v
ENDED
```

`CANCELLED` is terminal and can also be reached automatically from appointment cancellation/no-show.

## API

```text
GET  /api/v1/telehealth/appointments/:appointmentId
POST /api/v1/telehealth/appointments/:appointmentId/consent
POST /api/v1/telehealth/appointments/:appointmentId/readiness
POST /api/v1/telehealth/appointments/:appointmentId/join
POST /api/v1/telehealth/appointments/:appointmentId/end
POST /api/v1/telehealth/webhooks/livekit
```

The webhook route is publicly reachable by design but real production payloads are cryptographically verified by the LiveKit server SDK against the server API secret and raw request body.

## Flutter integration

The shared `mobile_core` package uses the official `livekit_client` SDK and provides a reusable secure room for Patient, Doctor and Other Provider applications.

The client flow is:

1. Load telehealth status from the authenticated API.
2. Patient reviews/accepts consent if required.
3. Perform camera and microphone readiness checks locally.
4. Request short-lived room credentials from CarePoint.
5. Configure LiveKit E2EE from the session key.
6. Prewarm and connect to the room.
7. Enable local microphone and camera.
8. Render local and remote video tracks.
9. Allow camera/microphone toggles.
10. Patient can leave; the appointment provider can end the shared session.

The same room component is linked from:

- Patient App -> My Appointments -> confirmed telemedicine appointment.
- Doctor App -> Agenda -> owned confirmed telemedicine appointment.
- Other Provider App -> Agenda -> owned confirmed telemedicine appointment when that provider category/service supports telemedicine.

## Native platform requirements before device release

The repository currently contains Flutter application source without complete generated Android/iOS runner scaffolds. Before producing device builds, generate/maintain the native runners and configure at minimum:

### iOS

`Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>CarePoint uses the camera during secure telemedicine visits.</string>
<key>NSMicrophoneUsageDescription</key>
<string>CarePoint uses the microphone during secure telemedicine visits.</string>
```

Background/audio behavior, deployment target and entitlements must be validated against the final application requirements.

### Android

Validate the generated manifest and runtime permissions for camera, microphone and network access, plus the final minimum SDK supported by the selected LiveKit Flutter release.

These native requirements are intentionally documented rather than faked in the repository while the platform runner projects do not yet exist.

## Recording and transcription

Recording is intentionally off in the MVP. Introducing recording or transcription later requires a separate privacy/compliance decision covering explicit consent, purpose, retention, residency, access controls, deletion and clinical-record classification.

## CI acceptance

The PostgreSQL/API acceptance scenario verifies:

1. Doctor onboarding and approval.
2. Real telemedicine service and confirmed appointment.
3. Non-participant receives HTTP 403.
4. Join is rejected before patient consent.
5. Patient consent is recorded.
6. Patient and provider readiness produce `READY`.
7. Both legitimate participants receive distinct short-lived participant tokens.
8. Both receive the same per-session E2EE key.
9. Plaintext E2EE key is absent from persisted ciphertext.
10. Recording remains disabled.
11. Provider webhook moves the session to `ACTIVE`.
12. Provider ending the session moves it to `ENDED`.
13. New joins are rejected after end.

Flutter CI additionally analyzes all three applications and tests the shared telehealth REST client methods.

## Production gates still required

Slice 3 provides the application architecture and secure workflow, but production activation requires:

- real LiveKit deployment/account and server credentials;
- external KMS/HSM implementation for the telehealth E2EE envelope key;
- generated and hardened Android/iOS runner projects with camera/microphone permissions;
- real-device audio/video/network testing, including degraded networks and reconnection;
- TURN/TLS and regional/media residency validation;
- privacy/security review of consent wording and retention;
- operational monitoring for room quality without logging PHI.
