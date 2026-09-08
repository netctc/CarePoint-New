# Phase B — Other Provider O1: Credentialing, Access & Account Foundation

## Objective

Prevent unapproved Other Provider accounts from entering the operational provider workspace and give them a category-driven self-service credentialing flow that remains separate from the Doctor specialty domain.

## Functional scope

The Other Provider mobile app now gates its existing operational workspace through `OtherProviderAccessGate`.

- `DRAFT` / `REQUEST_CHANGES`: category and credential workflow remains editable.
- `PENDING_REVIEW`: operational workspace stays locked while governance reviews credentials.
- `APPROVED` + Provider `ACTIVE`: existing services, availability, appointments, finance, communications and transport workspaces unlock.
- Provider `SUSPENDED`: operational access stays blocked and onboarding cannot be restarted to bypass suspension.

The category screen uses the live `/other-provider-categories` taxonomy and displays:

- localized category labels;
- provider family;
- required credential types;
- enabled modalities.

Required credentials are captured using the existing onboarding credential service and submitted through the same governance process used by Admin.

## Account & security

Both pending and active Other Provider users can open the reusable `ProfessionalAccountWorkspace` for account status, MFA and session management. No new IAM implementation is introduced.

## Domain isolation

- Doctor specialties are never presented as Other Provider categories.
- `/other-provider-categories` explicitly reports `excludesDoctors=true`.
- `GET /onboarding/me` remains restricted to the authenticated provider principal and returns only that account's own minimized state.
- ACTIVE and SUSPENDED restart protection is inherited from the provider self-onboarding guard introduced in Doctor D1.

## Acceptance

`services/api/scripts/other-provider-o1-smoke.mjs` validates:

1. fresh OTHER_PROVIDER self-state;
2. PATIENT role isolation;
3. public category taxonomy excluding Doctors;
4. DRAFT category onboarding;
5. all required credential types from the selected category;
6. submit to `PENDING_REVIEW`;
7. Admin verification of every credential;
8. approval to Provider `ACTIVE`;
9. OtherProviderProfile category promotion;
10. ACTIVE restart protection;
11. suspension revoking server sessions;
12. SUSPENDED workspace/restart protection;
13. minimized self-state payload;
14. audit trail for the complete governance lifecycle.

O1 is chained after Patient P1 and Doctor D1/D2 in the cumulative B9 acceptance wrapper.

## Database impact

No Prisma schema change and no database migration are required.
