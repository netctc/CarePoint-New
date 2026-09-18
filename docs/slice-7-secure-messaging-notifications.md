# Slice 7 — Secure Messaging, Notifications & Care Coordination

## Purpose

Slice 7 introduces secure healthcare communication without turning messaging into an alternative authorization path to clinical data. Conversations are appointment-bound, membership is explicit, care-team expansion is controlled, message content is encrypted at rest, and external notifications carry PHI-neutral template references rather than clinical text.

The implementation serves the Patient, Doctor, and Other Provider applications while preserving the Doctor vs Other Provider domain boundary.

## Security model

### Direct conversation creation

A new direct conversation must reference an existing CarePoint appointment with status `CONFIRMED` or `COMPLETED`.

The API derives both participants server-side:

- the Patient from `Appointment.patientId`;
- the healthcare Provider from `Appointment.providerId` and its linked CarePoint account.

The caller must be either the appointment Patient or the appointment Provider. Requests do not accept an authoritative `patientId` or `providerId` for direct conversation creation.

This prevents a Provider from opening an arbitrary patient conversation merely because the Provider role has messaging permission.

### Membership

`CareConversationParticipant` is the authorization boundary for reading and sending within an existing conversation.

An authenticated account must have an active participant row. `ADMIN` and `SUPPORT` do not receive secure-message read permissions simply because they can operate platform or notification functions.

### Care-team expansion

Only a Provider who is already a Provider participant may add another Provider.

The target Provider must be active and linked to a CarePoint account. Access requires one of these server-side bases:

1. `TREATMENT_RELATIONSHIP` — the target Provider has a `CONFIRMED` or `COMPLETED` appointment with the Patient within the configured treatment window; or
2. `PATIENT_CONSENT` — an active, unexpired, provider-specific consent with:
   - scope `CARE_COORDINATION`;
   - version `care-coordination-v1`;
   - the exact target `providerId`.

A provider-free/global consent is deliberately not treated as a substitute for provider-specific care-coordination consent.

## Encrypted message persistence

Conversation subjects and message bodies have no plaintext persistence columns.

Stored envelope fields include:

- algorithm;
- key identifier;
- wrapped data key;
- IV;
- ciphertext.

The current development/test adapter uses `PhiEnvelopeEncryption` with AES-256-GCM and a local AES-KW key provider.

Configuration:

```text
MESSAGING_KEY_PROVIDER=local
MESSAGING_ENVELOPE_KEY_ID=local-messaging-kek-v1
MESSAGING_ENVELOPE_KEY_BASE64=...
```

The runtime deliberately refuses production secure-message encryption until an external KMS/HSM adapter is wired. Local environment KEKs are not a production design.

## Idempotency

Conversation creation is idempotent per creator account and client conversation identifier:

```text
(createdByAccountId, clientConversationId)
```

Message sending is idempotent per sender account and client message identifier:

```text
(senderAccountId, clientMessageId)
```

A message identifier already used in another conversation is rejected.

Notification events also have a unique dedupe key, and each notification has at most one delivery row per channel.

## Read receipts and lifecycle

Every sender receives an immediate read receipt for their own message.

Opening/marking a conversation read creates missing account-specific receipts using `skipDuplicates`, making the operation retry-safe.

Conversation status:

```text
OPEN
CLOSED
```

A closed conversation rejects new messages with a conflict response. Existing history remains readable to active members.

## Clinical-document attachments

Messages may reference existing `ClinicalDocument` rows. The attachment relation contains only the document identifier.

An attachment does **not**:

- release a ClinicalDocument to the Patient;
- create a new clinical-document authorization grant;
- bypass the existing clinical-document download/content authorization service.

The sender-side validation requires:

- the document exists;
- it belongs to the same Patient as the conversation;
- it is `AVAILABLE`;
- Providers may attach their own document or a document already released to the Patient.

The Slice 7 acceptance test attaches an unreleased Provider document to a message and then verifies that the Patient still receives HTTP 403 when requesting the document content through the clinical-document API.

## Notification architecture

### Preferences

Each account owns a `NotificationPreference` with:

- locale (`en`, `ar`, `fr`, `es`);
- in-app enabled;
- push enabled;
- email enabled;
- SMS enabled.

### External endpoints

PUSH and SMS endpoints are stored as opaque provider references. The API does not return the underlying `externalEndpointRef`; it exposes only that an external reference is stored.

### PHI-neutral outbox

`NotificationEvent` persists:

- account identifier;
- event type;
- entity type and entity identifier;
- `safeTitleKey`;
- `safeBodyKey`;
- read state.

It does not persist a secure-message body, clinical note, diagnosis, prescription text, attachment content, or arbitrary notification prose.

For a secure message the generic keys are:

```text
notification.message.title
notification.message.body
```

The external notification adapter receives these safe keys and internal entity references, not decrypted message text.

### Delivery behavior

Channels:

```text
IN_APP
PUSH
EMAIL
SMS
```

Delivery statuses:

```text
PENDING
SENT
FAILED
SKIPPED
```

Secure-message persistence is authoritative. External notification delivery is best-effort: a PUSH/EMAIL/SMS provider failure does not roll back a message that has already been committed.

The development/test adapter is `mock`. Production defaults to the external adapter and forbids mock delivery.

Configuration:

```text
NOTIFICATION_GATEWAY_PROVIDER=external
NOTIFICATION_GATEWAY_BASE_URL=https://notification-provider.example/
NOTIFICATION_GATEWAY_API_KEY=...
```

Production requires HTTPS.

## Authorization permissions

Slice 7 adds:

```text
PATIENT_SECURE_MESSAGE
PROVIDER_SECURE_MESSAGE
CARE_COORDINATION_MANAGE
SELF_NOTIFICATION_MANAGE
NOTIFICATION_OPERATE
```

Key boundaries:

- Patient: secure messaging + own notification controls;
- Doctor: provider secure messaging + care coordination + own notification controls;
- Other Provider: same communications capabilities while remaining a separate provider domain;
- Support: own safe notifications only, no secure healthcare-message access;
- Admin: notification operation capabilities but no secure healthcare-message read permission from the Admin role alone.

## APIs

### Secure communications

```text
GET  /api/v1/communications/conversations
POST /api/v1/communications/conversations
GET  /api/v1/communications/conversations/:conversationId
POST /api/v1/communications/conversations/:conversationId/messages
POST /api/v1/communications/conversations/:conversationId/read
POST /api/v1/communications/conversations/:conversationId/close
POST /api/v1/communications/conversations/:conversationId/participants
```

### Notifications

```text
GET   /api/v1/notifications/preferences
PATCH /api/v1/notifications/preferences
GET   /api/v1/notifications/endpoints
POST  /api/v1/notifications/endpoints
POST  /api/v1/notifications/endpoints/:endpointId/deactivate
GET   /api/v1/notifications
POST  /api/v1/notifications/:notificationId/read
```

## Mobile integration

All mobile communication calls reuse the existing `CarePointApi` bearer-session and refresh-token flow.

### Patient

From Health Record the Patient can open **Messages & notifications** and:

- see secure conversations;
- see unread counts;
- create a conversation from a confirmed/completed appointment;
- read/send secure messages;
- close a conversation;
- view and mark notifications read;
- manage in-app, push, email, and SMS preferences;
- register an opaque PUSH endpoint reference.

### Doctor

The Doctor app exposes the shared communications workspace while retaining the `DOCTOR` login boundary. Doctors can use their own appointments for new direct conversations and, when authorized, coordinate additional care-team Providers.

### Other Provider

The Other Provider app exposes the same communications infrastructure while retaining the `OTHER_PROVIDER` login boundary. It does not merge Doctor and Other Provider identities or onboarding domains.

### Localization

The shared communications UI supports:

```text
en
ar
fr
es
```

Arabic uses the existing real RTL directionality.

## Audit

The service records metadata-only audit events including:

```text
CARE_CONVERSATION_CREATED
CARE_CONVERSATION_READ
CARE_CONVERSATION_MARKED_READ
CARE_MESSAGE_SENT
CARE_PARTICIPANT_ADD_DENIED
CARE_PARTICIPANT_ADDED
CARE_CONVERSATION_CLOSED
NOTIFICATION_PREFERENCES_UPDATED
NOTIFICATION_ENDPOINT_REGISTERED
NOTIFICATION_ENDPOINT_DEACTIVATED
```

Message subject/body content is not written to audit metadata.

## CI acceptance

`services/api/scripts/slice7-smoke.mjs` creates self-contained Patient and Doctor fixtures and verifies:

- appointment-bound conversation creation;
- conversation retry idempotency;
- message retry idempotency;
- AES-256-GCM encrypted-at-rest subject/body persistence;
- Admin denied secure-message access;
- unrelated Provider denied secure-message access;
- notification preference persistence;
- opaque endpoint API redaction;
- mock PUSH delivery;
- PHI-neutral notification persistence;
- attachment relation does not grant ClinicalDocument content access;
- unread/read receipt behavior;
- unauthorized care-team addition denied;
- treatment-related Provider care-team addition allowed;
- added care-team Provider can read/send;
- closed conversation rejects new messages;
- communications audit coverage without message-body PHI.

Mobile-core tests additionally validate request shapes and shared workspace rendering.

## Production gates

Slice 7 establishes the application boundary but is not presented as production-complete messaging infrastructure. Before production rollout, CarePoint still requires at minimum:

1. external KMS/HSM implementation and key-rotation procedures for messaging envelopes;
2. production notification-provider integration and secret management;
3. signed callback/webhook verification and replay protection where delivery providers use callbacks;
4. mobile Keychain/Keystore token persistence and device/session hardening;
5. abuse controls, Redis-backed rate limiting, spam/flood protections and message-size gateway limits;
6. retention, legal-hold, deletion and jurisdiction-specific healthcare messaging policies;
7. push lock-screen privacy review and PHI-neutral template governance;
8. endpoint lifecycle/device revocation and push-token rotation;
9. delivery retry/dead-letter operational procedures;
10. observability, SIEM, threat modeling, penetration testing and disaster-recovery exercises.

No production claim should imply end-to-end encrypted messaging between devices: Slice 7 implements server-side envelope encryption at rest and secure authorization boundaries. Transport security and any future device-to-device cryptographic protocol must be assessed separately.
