# Phase B — Doctor D2: Professional Account & Security Center

## Objective

Give an active Doctor a dedicated self-service security surface without duplicating clinical, financial, or communications workflows already present in the Doctor application.

## Functional scope

The Doctor app exposes a new Account & Security entry point from the active workspace. The reusable `ProfessionalAccountWorkspace` provides:

- current CarePoint account status;
- provider/credentialing access summary;
- medical specialty or provider category when available;
- credential review state and validity date;
- MFA status, enrollment and confirmation;
- signed-in device/session inventory;
- current-device marker;
- remote session revocation;
- revoke-all-sessions control;
- secure sign-out of the current device.

Notification preferences remain in the existing Communications workspace, avoiding a second source of truth.

## Security boundary

D2 reuses the existing IAM and provider self-service contracts. It does not add RBAC grants or new clinical access.

The acceptance checks that account/session responses do not expose password hashes, refresh-token hashes, refresh tokens, or other bearer material. MFA setup material is returned only to the authenticated account owner during enrollment.

## Shared design

`packages/mobile_core/lib/professional_account_workspace.dart` is deliberately provider-generic so the same hardened account/session/MFA behavior can later be reused by the Other Provider app. D2 integrates it only into Doctor at this stage.

## Acceptance

`services/api/scripts/doctor-d2-smoke.mjs` creates an isolated active Doctor account and validates:

1. account self-service and ACTIVE provider summary;
2. two independent server sessions;
3. current-device detection;
4. remote-session revocation;
5. absence of refresh-token material in session inventory;
6. MFA enrollment and durable confirmation;
7. protection against re-enrolling an already enabled MFA factor;
8. revoke-all invalidating the current bearer session.

Doctor D2 is chained after Patient P1 and Doctor D1 inside the cumulative B9 acceptance wrapper.

## Database impact

No Prisma schema change and no database migration are required.
