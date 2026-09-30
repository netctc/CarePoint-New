# Release 1 R1 — Scoped LiveKit Webhook Raw-Body Reconciliation

## Context

The first CI run on the reconciled Release 1 integration SHA `5e7094999d65ec41dde50d47dbc34ea57948d9e9` proved that the alternate C18 assumption no longer matched the later telehealth implementation.

The alternate C18 hardening line had been created from the post-C15 state and correctly required that no API source retained raw request bodies globally. The later secure-telemedicine line, however, legitimately requires the exact signed LiveKit webhook payload because `WebhookReceiver` verifies the provider signature against the original raw bytes.

The first integrated C18 smoke therefore failed on the three telehealth raw-body consumers instead of silently accepting an unsafe merge. This was a useful release-integration finding rather than a reason to remove LiveKit webhook verification.

## Resolution

Release 1 keeps the C18 security objective but narrows raw-body retention to the single LiveKit webhook route:

`POST /api/v1/telehealth/webhooks/livekit`

The Nest application now disables automatic global body-parser installation, registers a bounded raw-body capture middleware only for that exact route, and then installs the normal bounded JSON and form parsers for all other application traffic.

Global `rawBody: true` is not enabled.

## Bounded webhook capture

The LiveKit webhook raw-body capture has a fixed 256 KiB maximum. Requests that declare or exceed a larger body are rejected with HTTP 413 before the telehealth controller processes them.

The controller now also fails closed when no raw payload was captured instead of returning a successful empty 204 response.

No `raw-body` package or other body-retention dependency is added.

## Acceptance

The C18 focused acceptance now verifies all of the following:

- raw-body references are restricted to the dedicated LiveKit capture helper and telehealth webhook verification flow;
- Nest automatic global body parsing is disabled;
- `rawBody: true` is absent;
- the exact LiveKit webhook route is registered before the normal JSON parser;
- the C17 bounded JSON/form parser limits remain active;
- the LiveKit raw payload limit is exactly 256 KiB;
- an ordinary signed-style payload is retained byte-for-byte for downstream verification;
- oversized streamed and declared-length payloads are rejected with HTTP 413;
- the controller rejects a missing raw payload;
- no new raw-body dependency is introduced.

## Release gate

This reconciliation is not complete until the exact follow-up SHA passes CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR. The earlier successful security/recovery/FHIR results on `5e709499...` remain useful evidence, but the code changed and therefore the complete gate must be repeated on the new SHA.
