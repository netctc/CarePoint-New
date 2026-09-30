# CarePoint Next - Implementation Plan

## Release 1 / MVP

P0 scope from the specification:

- IAM/MFA and revocable sessions.
- Global patient identity and consent.
- Independent provider onboarding and credential lifecycle.
- Dedicated Doctor application for all specialties/sub-specialties.
- Flexible non-doctor healthcare and medical-transport taxonomy.
- Services, prices, modalities, availability and booking.
- Clinic, telemedicine and home visits.
- Scheduled medical transport.
- One-tap emergency ambulance request and basic dispatch lifecycle.
- Basic encounter, notifications, payments, administration, audit and PHI encryption.

## Delivery slices

### Slice 0 - Foundation (this branch)

- Monorepo and design tokens.
- English engineering baseline plus EN/AR/FR/ES UI localization and Arabic RTL.
- Shared domain contracts.
- PostgreSQL schema baseline.
- API health, specialty taxonomy, other-provider taxonomy and emergency ambulance endpoints.
- Clinical Aurora admin shell.
- Patient Mobile emergency entry point.
- Doctor and Other Provider mobile shells.
- Envelope encryption primitive.

### Slice 1 - Identity and provider onboarding

- Patient/provider/admin identities.
- MFA, session rotation, account states.
- Credential review.
- Provider activation/suspension.
- Consent and audit foundations.

### Slice 2 - Services, scheduling and booking

- Provider service catalog.
- Modality-specific price/duration.
- Availability templates/slots.
- Concurrency-safe reservation transaction.
- Cancellation/rebooking/no-show.

### Slice 3 - Telemedicine and encounter

- Telehealth provider abstraction.
- Waiting room and readiness.
- Ephemeral room token endpoint.
- Consent check before join.
- Basic clinical encounter and encrypted record payload.

### Slice 4 - Payments and production hardening

- PSP abstraction and idempotent webhooks.
- Receipts/refunds baseline.
- Outbox, notifications and observability.
- Security, privacy, load and resilience tests.

## Post-MVP

Dependents/family, advanced ambulance tracking/dispatch, FHIR/NPHIES, e-prescription, external labs, RPM/wearables, AI-assisted features and service extraction remain later releases.
