# Slice 2.1 — Mobile/API Integration

This slice replaces the scheduling mock data in all three Flutter applications with the real Slice 2 REST API.

## Shared mobile client

`packages/mobile_core/lib/carepoint_api.dart` provides:

- API base URL via `--dart-define=CAREPOINT_API_BASE=...`.
- Password login plus MFA challenge completion.
- Access/refresh-token session handling and one automatic refresh retry after HTTP 401.
- Public service and availability discovery.
- Patient booking, appointment listing and cancellation.
- Provider service, agenda and availability-rule operations.

The default Android-emulator URL is `http://10.0.2.2:4000/api/v1`. Production builds must pass the HTTPS API URL explicitly.

## Patient application

Real flows:

1. PATIENT login/MFA.
2. Search active provider services.
3. Filter Clinic / Telemedicine / Home Visit.
4. View live UTC-backed availability rendered in device local time.
5. Book using a unique mobile idempotency key.
6. View own appointments.
7. Cancel an active appointment and release slot inventory.

Emergency Ambulance remains explicitly separate from the ordinary appointment model.

## Doctor application

The Doctor app accepts only a `DOCTOR` account and uses the shared provider workspace to:

- read the authenticated doctor's agenda;
- list owned services;
- create a bookable service with modality, duration and price;
- list recurring availability rules;
- create an availability rule;
- materialize the next 30 days of slots.

## Other Provider application

The Provider app accepts only an `OTHER_PROVIDER` account. It uses the same scheduling workspace while preserving the hard Doctor/Other-Provider application boundary.

## Localization and RTL

The connected UI continues to support English, Arabic, French and Spanish. Arabic is rendered RTL. Server service labels are resolved using the active locale with the canonical service name as fallback.

## Runtime configuration

Example:

```bash
flutter run \
  --dart-define=CAREPOINT_API_BASE=https://api.example.com/api/v1 \
  --dart-define=CAREPOINT_TIMEZONE=Asia/Beirut
```

`CAREPOINT_TIMEZONE` is the initial IANA value suggested when creating provider availability rules. Providers can edit it before saving.

## Security boundaries

- The mobile client never supplies patient/provider identity as booking authority.
- Patient and provider ownership continues to be derived server-side from the bearer session.
- The login gate rejects a valid account when its role does not match the application domain.
- Tokens are currently held in process memory only. Persistent device credential storage is intentionally deferred to the dedicated mobile hardening slice, where Keychain/Keystore-backed storage and device-level session revocation will be added.
