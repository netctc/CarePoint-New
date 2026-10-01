# Transport Phase 30 — Advanced Transport Live HTTP Acceptance

Branch: quality/transport-advanced-live-http-phase30-20261001

## Objective

Phase 30 adds real HTTP acceptance for the advanced Transport capabilities introduced after the
original Slice 8 flow.

Slice 8 already validates the core request/dispatch/status journey. Phase 30 deliberately avoids
duplicating that coverage and focuses on the advanced layers that previously had only static
contract smokes.

## Live journey

The Phase 30 acceptance covers:

1. saved locations CRUD and cross-patient isolation;
2. route-preview fallback when no external routing provider is configured;
3. scheduled transport request creation remains available without route preview;
4. transport unit creation through the Admin API;
5. resource assignment and resource idempotency replay;
6. tracking blocked before EN_ROUTE;
7. explicit shareWithPatient consent before tracking starts;
8. provider heartbeat persistence and heartbeat idempotency;
9. patient live tracking visibility and cross-patient denial;
10. automated trip milestones without lifecycle authority;
11. Admin telemetry overview;
12. deterministic smart dispatch evaluation without auto-assignment or lifecycle mutation;
13. live operations, performance analytics and command-center visibility;
14. privacy stop for tracking;
15. telemetry audit metadata excludes coordinates;
16. report schedule creation;
17. durable report run queueing and execution;
18. private local report artifact in CI;
19. durable delivery handoff/outbox;
20. one-time secure report download;
21. second download attempt rejected;
22. download-time SHA-256 verification;
23. compliance manifest export with privacy exclusions and external-signing boundary.

## External dependency policy

The CI environment does not configure a Google Routes provider.

Phase 30 therefore verifies the supported route-preview fallback:

- routeProvider = none
- routePreviewAvailable = false
- available = false
- reason = NOT_CONFIGURED

Booking and transport operations continue normally.

No Google Maps key or other routing secret is required by this acceptance.

## Security boundaries

The journey verifies:

- Patient cannot access Admin Transport surfaces.
- Saved locations do not cross patient ownership boundaries.
- Live tracking cannot cross patient ownership boundaries.
- Tracking requires explicit shareWithPatient=true.
- Smart dispatch cannot mutate the authoritative lifecycle.
- Delivery listings do not expose artifactObjectKey.
- Report download uses a one-time token.
- The token is transported in the POST body, not a public URL.
- A consumed download token cannot be reused.
- The compliance manifest excludes raw audit metadata, storage keys, CSV content, patient identity,
  patient contact and patient location.

## Reporting boundary

The report artifact uses LOCAL_PRIVATE storage because CI is non-production.

The production cloud runtime remains unchanged and continues to require the approved GCP/OCI
object-storage contract.

Phase 30 does not claim automatic artifact email delivery. It validates the durable handoff/outbox
and secure same-origin download path.

## CI placement

The live acceptance runs after the existing F3.2 live/mobile journeys and before final failure-log
collection. This keeps the Phase 30 synthetic data from influencing older acceptance suites.

The static Phase 30 contract remains in the normal API npm test chain.

## Database

No new Prisma model and no new migration.

## Environment

No new production environment variables.

No .env file is added.

Phase 30 reuses the CI credentials already required by the existing live acceptance suite.

## Validation

Structural:

npm run v2:transport-phase30

Live HTTP:

npm run v2:transport-phase30-live-http
