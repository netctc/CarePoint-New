# Internationalization and Language Policy

CarePoint is implemented internally in **English**. Source code, API field names, domain events, database enum values, audit actions, technical documentation and commit messages use English as the canonical engineering language.

The product UI supports these locales from the first implementation slice:

- `en` - English (source locale)
- `ar` - Arabic, full right-to-left layout
- `fr` - French
- `es` - Spanish

## Rules

1. Business enums and identifiers are never translated. For example, `DOCTOR`, `OTHER_PROVIDER`, `TELEMEDICINE` and `EMERGENCY_AMBULANCE` remain stable across all clients and APIs.
2. User-facing labels are translated at the presentation layer.
3. Arabic switches the full application direction to RTL, including navigation placement, alignment, chevrons and reading order.
4. Dynamic medical specialties and Other Provider categories store a canonical code/slug plus required `en/ar/fr/es` labels.
5. Person names, legal entity names, identifiers and clinical source data are not automatically translated.
6. English is the fallback locale if a future optional translation is unavailable.
7. Dates, numbers, currencies, pluralization and accessibility labels must use locale-aware formatting as the respective workflows are implemented.
8. Patient-facing emergency actions must remain equally prominent in every locale and must not move behind a language-specific navigation pattern.

## Current implementation

The Next.js admin portal includes a persistent language selector and dynamically changes the document `lang` and `dir` attributes. The Flutter mobile applications use a shared localization package and switch `Directionality` for Arabic.

The current translation dictionaries are intentionally source-controlled so UI changes and translation changes are reviewed together. A translation-management platform can be introduced later without changing domain contracts.
