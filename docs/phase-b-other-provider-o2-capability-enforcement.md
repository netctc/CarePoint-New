# Phase B — Other Provider O2: Category Capability Enforcement

## Objective

Make `ProviderCategory.capabilities` an authoritative runtime boundary for active Other Provider accounts instead of catalog metadata only.

O2 applies only to `OTHER_PROVIDER`. Doctor behavior continues to be controlled by the Doctor role/domain and is intentionally unaffected by category restrictions.

## Capability model already present in CarePoint

Other Provider categories already define two capability groups:

- `enabledModalities`
  - `CLINIC`
  - `TELEMEDICINE`
  - `HOME_VISIT`
- `clinicalOrderCapabilities`
  - `PRESCRIPTION`
  - `LABORATORY`
  - `LAB_RESULT_ENTRY`
  - `LAB_RESULT_VALIDATE`

O2 does not add new capability names or expand RBAC.

## Backend enforcement

`ProviderCategoryCapabilityService` resolves the authenticated active Other Provider, its `OtherProviderProfile`, active category and live capability JSON.

### Scheduling

The category modality boundary is enforced before mutations:

1. create Provider Service;
2. reactivate an existing Service;
3. create an Availability Rule;
4. generate Availability from existing rules.

This includes legacy data. A service/rule created before O2 cannot be reactivated or used to generate new availability if its modality is no longer allowed by the provider category.

Denied requests return `403` and do not mutate service/rule/slot state.

### Clinical Orders

All category-modelled clinical write actions pass through the same capability resolver:

- create prescription → `PRESCRIPTION`;
- create laboratory order → `LABORATORY`;
- enter laboratory result → `LAB_RESULT_ENTRY`;
- validate laboratory result → `LAB_RESULT_VALIDATE`.

The existing OrdersService capability check for order creation remains in place as defense in depth.

O2 closes a previous own-authorship bypass where an Other Provider could enter or validate the result of its own laboratory order without the corresponding category capability.

Reading clinical orders, clinical records/documents and releasing an already validated result are not newly restricted because no separate ProviderCategory capability exists for those operations.

## Mobile alignment

The active Other Provider app resolves the approved category capability context from its minimized `/onboarding/me` state.

The shared Provider workspace receives:

- allowed service modalities;
- allowed clinical-order actions.

As a result:

- new services only offer allowed modalities;
- new availability rules only use allowed service modalities;
- availability generation operates only on allowed rules;
- prescription/lab creation controls are shown only when authorized;
- lab result entry/validation controls are shown only when authorized.

Doctor passes `null` capability filters to the shared workspace and preserves its previous behavior.

## Acceptance

`services/api/scripts/other-provider-o2-smoke.mjs` uses isolated direct domain fixtures and validates:

1. category with only `CLINIC` and `LABORATORY`;
2. `HOME_VISIT` service creation is denied with no Service mutation;
3. `CLINIC` service creation succeeds;
4. `CLINIC` availability rule succeeds;
5. legacy forbidden service cannot be reactivated;
6. legacy forbidden availability rule cannot be created;
7. legacy forbidden rule cannot generate slots;
8. `PRESCRIPTION` is denied;
9. `LABORATORY` creation succeeds;
10. own-order `LAB_RESULT_ENTRY` is denied and creates no result;
11. adding `LAB_RESULT_ENTRY` to the category enables the operation without a role change;
12. own-order `LAB_RESULT_VALIDATE` is denied without state mutation;
13. adding `LAB_RESULT_VALIDATE` enables validation;
14. normal validated-result release remains functional.

O2 is chained after Patient P1, Doctor D1/D2 and Other Provider O1 in the cumulative B9 acceptance step.

## Database impact

No Prisma schema change and no database migration are required.
