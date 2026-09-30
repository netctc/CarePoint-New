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

Required credentials are captured using the existing onboarding credential service and submitted through the same governance process used by Admin. The API remains authoritative for completeness: if any category-required credential type is missing, submit is rejected with `400` and the onboarding remains `DRAFT`.

## Account & security

Both pending and active Other Provider users can open the reusable `ProfessionalAccountWorkspace` for account status, MFA and session management. No new IAM implementation is introduced.

## Domain isolation

- Doctor specialties are never presented as Other Provider categories.
- `/other-provider-categories` explicitly reports `excludesDoctors=true`.
- A `DOCTOR` principal cannot start `/onboarding/other-providers`.
- An `OTHER_PROVIDER` principal cannot start `/onboarding/doctors`.
- `GET /onboarding/me` remains restricted to the authenticated provider principal and returns only that account's own minimized state.
- ACTIVE and SUSPENDED restart protection is inherited from the provider self-onboarding guard introduced in Doctor D1.

## Acceptance

`services/api/scripts/other-provider-o1-smoke.mjs` uses isolated accounts plus a deterministic category fixture requiring two independent credential types. It validates:

1. fresh OTHER_PROVIDER self-state;
2. PATIENT role isolation;
3. public category taxonomy excluding Doctors;
4. bidirectional Doctor / Other Provider onboarding separation;
5. DRAFT category onboarding;
6. first required credential capture;
7. incomplete submit rejection with the lifecycle still in `DRAFT`;
8. second required credential capture;
9. submit to `PENDING_REVIEW` only after all required types are present;
10. Admin verification of every credential;
11. approval to Provider `ACTIVE`;
12. promotion of the selected `OtherProviderProfile` category;
13. promotion of all verified required credentials;
14. ACTIVE restart protection;
15. suspension revoking server sessions;
16. SUSPENDED workspace/restart protection;
17. minimized self-state payload throughout the lifecycle;
18. audit trail for the complete governance lifecycle.

O1 is chained after Patient P1 and Doctor D1/D2 in the cumulative B9 acceptance wrapper.

## Database impact

No Prisma schema change and no database migration are required.
