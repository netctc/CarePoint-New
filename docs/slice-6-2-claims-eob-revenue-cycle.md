# Slice 6.2 — Claims, EOB & Revenue Cycle

## Purpose

Slice 6.2 extends the Slice 6 financial domain with payer claims, adjudication, explanations of benefits (EOB), insurer remittances, denial/rework and revenue-cycle operations.

The canonical implementation language is English. Mobile presentation uses the existing EN/AR/FR/ES localization model, including real RTL for Arabic.

This slice does **not** make CarePoint a certified clearinghouse or a jurisdiction-specific claims processor. Production still requires payer/clearinghouse contracts, transaction mapping and compliance validation for the deployment market.

## Domain boundary

A claim is a financial object derived from existing platform records:

```text
Appointment + Invoice + InsuranceCoverage
                 ↓
          InsuranceClaim v1
                 ↓
           payer gateway
       ┌─────────┴─────────┐
       ↓                   ↓
  ADJUDICATED            DENIED
       ↓                   ↓
      EOB              rework v2
       ↓                   ↓
      PAID             resubmission
       ↓
  Remittance
       ↓
ProviderLedger: INSURANCE_PAYMENT
```

Claims do not duplicate the clinical record. Raw clinical notes, document bodies, card data and raw payer responses are not persisted in the claim tables.

## Claim lifecycle

Supported normalized statuses:

- `SUBMITTED`
- `ACCEPTED`
- `PENDING`
- `ADJUDICATED`
- `DENIED`
- `PAID`
- `VOID`

Every persisted transition produces a `ClaimEvent`.

Denied claims are corrected by creating a new immutable claim version. The previous version is retained and linked using `previousClaimId`.

## Submission gates

Initial claim submission requires:

1. authenticated treating provider or `REVENUE_CYCLE_OPERATE`;
2. completed appointment;
3. claimable invoice;
4. active/effective insurance coverage owned by the appointment patient;
5. current `ELIGIBLE` eligibility check;
6. non-expired eligibility response;
7. prior authorization absent, `NOT_REQUIRED`, or `APPROVED`;
8. no existing initial claim for the appointment.

Provider and patient identities are always derived server-side. Mobile requests do not supply authoritative `patientId` or `providerId` values.

## Adjudication and EOB

For adjudicated/denied/paid claims the payer adapter must return normalized amounts:

```text
allowed + adjustment = submitted
insurer payment + patient responsibility = allowed
```

The platform creates or updates one EOB per claim version.

Patient-facing claim presentation excludes internal gateway names, gateway claim references and internal rework codes. The patient sees normalized claim status, monetary allocation, public denial explanation and released EOB information.

## Invoice reconciliation

CarePoint does not silently rewrite financial history after money has already moved.

`ClaimReconciliationStatus`:

- `NOT_RECONCILED`
- `RECONCILED`
- `REVIEW_REQUIRED`

When adjudication has no adjustment and no conflicting patient payment/refund exists, patient/insurer responsibility may be safely reconciled to the invoice.

When the payer introduces an adjustment or adjudication conflicts with already-settled patient money, the claim becomes `REVIEW_REQUIRED` instead of silently modifying historical settlement.

## Remittance

A paid claim with a positive insurer payment creates exactly one `InsuranceRemittance` and exactly one provider-ledger credit:

```text
ProviderLedgerEntry.type = INSURANCE_PAYMENT
```

Remittance references and idempotency keys prevent retry-driven duplicate revenue.

## Payer / clearinghouse abstraction

`ClaimsGatewayService` isolates CarePoint from a specific payer protocol.

Development/test:

```text
CLAIMS_GATEWAY_PROVIDER=mock
```

Production:

```text
CLAIMS_GATEWAY_PROVIDER=external
CLAIMS_GATEWAY_BASE_URL=https://...
CLAIMS_GATEWAY_API_KEY=...
```

Production rejects the mock adapter and requires HTTPS plus a server-side API key.

The adapter is the future integration point for market-specific standards such as X12 837/835, FHIR Claim/ExplanationOfBenefit, insurer APIs or clearinghouse-specific formats. Those mappings are deliberately outside the normalized domain model.

## Persistence

New models:

- `InsuranceClaim`
- `ClaimEvent`
- `ExplanationOfBenefits`
- `InsuranceRemittance`

Provider ledger adds:

- `INSURANCE_PAYMENT`

Migration:

- `20260907033000_claims_eob_revenue_cycle`

## API

Patient:

```text
GET /api/v1/revenue-cycle/me
```

Provider:

```text
GET  /api/v1/provider/revenue-cycle/claims
POST /api/v1/provider/revenue-cycle/appointments/:appointmentId/claims
POST /api/v1/provider/revenue-cycle/claims/:claimId/refresh
POST /api/v1/provider/revenue-cycle/claims/:claimId/rework
```

Revenue-cycle operator:

```text
GET  /api/v1/revenue-cycle/claims?status=PAID
POST /api/v1/revenue-cycle/claims/:claimId/refresh
POST /api/v1/revenue-cycle/claims/:claimId/rework
```

## Authorization

New permissions:

- `PATIENT_READ_CLAIMS`
- `PROVIDER_MANAGE_CLAIMS`
- `REVENUE_CYCLE_OPERATE`

`SUPPORT` receives none of these permissions. Revenue-cycle permissions do not grant clinical-record PHI permissions.

## Mobile

Patient:

- Claims & EOB is reachable from Health Record;
- claim versions/status/reconciliation are visible;
- released EOB allocation and public denial messages are visible;
- internal payer gateway references are not displayed.

Doctor / Other Provider:

- a dedicated Claims & EOB action is available from the provider workspace;
- completed appointments can be submitted using their latest eligible coverage;
- claims can be refreshed;
- denied claims can be corrected and resubmitted as a new version;
- EOB and remittance summaries are visible.

Doctor and Other Provider authentication boundaries remain independent.

## Acceptance test

`services/api/scripts/slice62-smoke.mjs` verifies:

- claim submission and idempotent retry;
- patient denial from provider submission;
- adjudication and EOB creation;
- safe invoice reconciliation;
- patient-safe claim presentation;
- `PAID` settlement;
- exactly-once remittance and `INSURANCE_PAYMENT` ledger credit;
- high-value denial and `REVIEW_REQUIRED`;
- immutable denial rework into version 2;
- no second divergent rework from the same old version;
- corrected claim adjudication/payment;
- complete claim-event history;
- provider and revenue-operator boundaries;
- absence of raw policy, clinical and payment credential fields in claim persistence.

## Production gates

Before using Slice 6.2 for real payer transactions, deployment must add and validate at least:

- payer/clearinghouse onboarding and credentials;
- jurisdiction-specific coding and claim-scrubbing rules;
- X12/FHIR/vendor mapping where applicable;
- signed webhook/callback verification and replay prevention;
- ERA/835 or equivalent remittance ingestion;
- payer-specific acknowledgement and rejection processing;
- clearinghouse connectivity, retry and outage procedures;
- denial work queues, correction governance and appeal processes;
- accounting/GL reconciliation and settlement controls;
- secrets management and rotation;
- audit/SIEM monitoring;
- privacy and healthcare-regulatory review;
- threat modeling and penetration testing;
- disaster recovery and operational reconciliation exercises.

No part of this slice should be represented as payer-certified or legally compliant for a particular country until those production gates are completed.
