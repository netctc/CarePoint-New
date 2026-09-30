# Phase B9 — Admin Analytics & Operational Intelligence

## Objective

Phase B9 activates Admin module 07 as a cross-domain, aggregate-only operational analytics workspace. It compares bounded rolling periods without exposing patient/provider identity, clinical content, policy identifiers, room credentials, encryption material or transaction-level rows.

## Analytics model

`GET /api/v1/admin/operations/analytics/workspace?days=7|30|90` compares the selected rolling period with the immediately preceding period of the same duration.

The endpoint returns only aggregated platform measures:

- appointment volume, outcomes and modality mix;
- Telehealth appointment/session initialization and lifecycle counts;
- invoices issued and successful payments grouped by currency;
- claim volume, status mix, review-required count and denial rate;
- security-event, denied-event and replay-denial counts;
- emergency ambulance demand and scheduled ground/air medical transport demand;
- a current provider-network snapshot with active doctors, active other providers and onboarding-review count.

## Deterministic trend signals

B9 computes Current vs Previous trend objects for appointment volume, no-show rate, claim denial rate, denied security events, Telehealth initialization rate and emergency demand.

Each signal contains current value, previous value, direction, percentage delta when mathematically defined, and whether the change is favorable for metrics where higher/lower has an explicit operational meaning. These are deterministic comparisons, not AI predictions and not clinical recommendations.

## Privacy boundary

The analytics response is deliberately PHI-neutral and aggregate-only. It excludes:

- patient identity and patient/profile IDs;
- provider identity and provider IDs;
- appointment, invoice and claim IDs;
- clinical records, diagnoses, observations and documents;
- payer policy identifiers and gateway references;
- Telehealth room names/tokens;
- E2EE keys, wrapped keys, IVs and ciphertext.

No new clinical authorization or Telehealth participant capability is introduced.

## Admin Web

- protected page: `/analytics`;
- protected BFF: `GET /api/admin/analytics/workspace?days=7|30|90`;
- navigation module 07 now links to `/analytics`;
- EN/AR/FR/ES presentation;
- responsive current/previous KPI, trend, outcome, modality, Telehealth, finance, claims, security, provider-network and mobility panels.

The BFF retains CarePoint bearer tokens in HttpOnly server-side flows and only returns the already aggregated backend response.

## Acceptance gate

`services/api/scripts/admin-b9-smoke.mjs` creates isolated synthetic fixtures in both the current and previous seven-day windows and verifies:

- PATIENT receives 403 from Admin analytics;
- unsupported period values receive 400;
- appointment, Telehealth, finance, claims, security and mobility aggregates contain expected fixture activity;
- a fixture-only test currency proves invoice/payment period separation;
- deterministic trend signals are present;
- provider network snapshot is present;
- response JSON contains no patient/provider identity, transaction IDs, policy/gateway identifiers, room credentials or encryption material;
- Admin BFF returns the analytics workspace without bearer material;
- authenticated `/analytics` renders successfully.

## Non-goals

- no database migration;
- no analytics warehouse or replicated reporting database;
- no raw dataset export;
- no patient/provider drill-down;
- no clinical analytics;
- no AI forecasting or clinical decision support;
- no RBAC expansion;
- no modification of B3/B6/B7/B8 operational source-of-truth workflows.
