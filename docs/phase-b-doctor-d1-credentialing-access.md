# Phase B — Doctor D1: Credentialing, Onboarding & Access Center

## Objective

Provide the Doctor mobile app with a production-safe self-service credentialing gate so that only an `ACTIVE` doctor enters the clinical provider workspace.

## Functional behavior

- `GET /api/v1/onboarding/me` returns the authenticated provider's own onboarding/access state only.
- Fresh doctors see the credentialing center instead of an unusable clinical workspace.
- Doctors can select an active medical specialty, start onboarding, add a medical-license credential, and submit for review.
- `DRAFT` and `REQUEST_CHANGES` applications remain editable.
- `PENDING_REVIEW` is read-only while governance review is in progress.
- `APPROVED` + Provider `ACTIVE` unlocks the existing Doctor workspace.
- Provider `SUSPENDED` blocks workspace access and self-restart of onboarding.
- Provider `ACTIVE` also cannot restart onboarding and accidentally downgrade itself to `DRAFT`.

## Security and privacy boundary

The self-state endpoint is restricted to `DOCTOR` and `OTHER_PROVIDER` principals through `PROVIDER_SELF_ONBOARD` plus an explicit role boundary. It uses Prisma `select` projections and does not expose:

- `userId`
- `reviewerActorId`
- `reviewedByActorId`
- password hashes
- access/refresh tokens

The Doctor app receives only the provider/onboarding/credential fields required to render its own credentialing state.

## Acceptance

`services/api/scripts/doctor-d1-smoke.mjs` validates an isolated lifecycle:

1. fresh Doctor self-state;
2. PATIENT role isolation;
3. DRAFT onboarding creation;
4. medical-license capture;
5. submit to `PENDING_REVIEW`;
6. Admin credential verification and approval;
7. transition to Provider `ACTIVE` and `accessReady=true`;
8. rejection of onboarding restart while `ACTIVE`;
9. provider suspension and server-session revocation;
10. `SUSPENDED` workspace block and restart protection;
11. credentialing lifecycle audit events;
12. minimized self-state payload.

The D1 smoke is chained after Patient P1 inside the existing cumulative B9 acceptance wrapper, so normal Node CI fails if Doctor D1 regresses.

## Database impact

No Prisma schema change and no database migration are required.
