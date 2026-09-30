# Transport Provider Split — Phase 1

## Objective

Separate medical transport from the general Health Provider experience while preserving all existing transport code, data models, API routes and historical records.

Phase 1 is a presentation and administration split. It does **not** disable the transport backend.

## Environment flag

`TRANSPORT_MODULE_ENABLED`

Accepted enabled values in Admin are `1`, `true`, `yes` and `on` (case-insensitive). Any other value, including an unset variable, is treated as disabled.

The default state is **disabled**.

### Admin

The Admin application reads `TRANSPORT_MODULE_ENABLED` at runtime.

When disabled:
- the Transport Providers navigation entry is hidden;
- the dedicated Transport Providers page returns not found;
- transport providers are excluded from the general Other Providers administration view;
- transport-provider onboarding cases are excluded from the general Other Providers governance queue;
- transport provider categories are hidden from generic provider master-data and taxonomy views.

When enabled:
- a dedicated **Transport Providers** section is available in Admin;
- only `MEDICAL_TRANSPORT_GROUND`, `MEDICAL_TRANSPORT_AIR` and `EMERGENCY_AMBULANCE` provider families are shown in that section.

### Patient Mobile

The Patient application reads the same flag through Flutter compile-time configuration:

```bash
flutter run --dart-define=TRANSPORT_MODULE_ENABLED=true
```

or, for a disabled build:

```bash
flutter run --dart-define=TRANSPORT_MODULE_ENABLED=false
```

When disabled:
- emergency ambulance and scheduled medical transport quick actions are hidden;
- transport-related notifications are hidden from the Patient notification centre.

The underlying Patient transport pages and API client code remain unchanged and can be re-exposed by enabling the flag.

## Explicitly unchanged in Phase 1

- Doctor Mobile
- Health Provider Mobile
- transport API modules and routes
- Prisma transport models and migrations
- transport resources, handoff, incidents and advanced lifecycle logic
- historical transport data

## Next phases

Later phases can introduce the dedicated Transport Provider application boundary, transport-specific provider onboarding extensions, fleet/crew administration, dispatch operations and transport-provider mobile workflows without reworking the Phase 1 visibility contract.
