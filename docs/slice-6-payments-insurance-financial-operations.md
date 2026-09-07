# Slice 6 — Payments, Insurance & Financial Operations

## Purpose

Slice 6 introduces the financial domain required to connect a CarePoint appointment to a stable booking price, patient billing, external payment processing, insurance eligibility and prior authorization, provider financial ledger entries, refunds, receipts, and payout operations.

This slice is intentionally backend/API and persistence focused. Mobile billing and insurance screens are reserved for Slice 6.1.

## Non-goals

Slice 6 does not implement:

- direct card-data collection inside CarePoint;
- storage of PAN, CVV, magnetic-stripe data, card PINs, or raw payment credentials;
- a certified production PSP deployment;
- insurance claim submission, adjudication, EOB/ERA processing, remittance reconciliation, or denial management;
- tax/VAT engines;
- foreign-exchange conversion;
- accounting/ERP exports;
- provider reserve or negative-balance policies;
- patient/mobile hosted-payment UI.

Claims and EOB/revenue-cycle workflows belong to a later slice.

## Core principles

### Money representation

All monetary values are stored as integer minor units. Currency is a three-letter ISO-style code such as `USD`.

No floating-point arithmetic is used for persisted financial amounts.

### Booking-time price immutability

The price used for a booked appointment must not change when a provider edits the service price later.

PostgreSQL enforces this through the `carepoint_snapshot_appointment_pricing` trigger. On `Appointment` insertion, when an active `ServiceModality` exists, the same database transaction creates:

1. `PricingSnapshot`
2. `Invoice`

The snapshot captures:

- patient;
- provider;
- service;
- modality;
- canonical service name;
- currency;
- unit price;
- discount;
- tax;
- total.

Changing `ServiceModality.priceMinor` later does not update historical snapshots or invoices.

Legacy/test appointments for which no active matching `ServiceModality` exists are allowed to remain without a Slice 6 financial snapshot so historical development fixtures are not broken.

## Invoice lifecycle

Supported states:

```text
OPEN
PARTIALLY_PAID
PAID
VOID
REFUNDED
```

An invoice stores separate responsibility values:

- `totalMinor`
- `patientResponsibilityMinor`
- `insurerResponsibilityMinor`
- `amountPaidMinor`
- `amountRefundedMinor`
- `balanceDueMinor`

SQL constraints prohibit negative core amounts and require patient plus insurer responsibility to equal the invoice total.

### Appointment cancellation

`carepoint_void_unpaid_cancelled_invoice` runs when an appointment moves to `CANCELLED`.

If no patient payment has been collected, the invoice becomes:

```text
status = VOID
balanceDueMinor = 0
voidedAt = current time
```

A paid appointment is not silently refunded by the cancellation trigger. Refunds must use the explicit refund workflow.

## Payment boundary

`PaymentGatewayService` isolates CarePoint from the payment service provider.

Supported runtime adapters:

- `mock` — development/test only;
- `external` — production target.

Production rejects the mock adapter.

The external adapter requires:

```text
PAYMENT_GATEWAY_PROVIDER=external
PAYMENT_GATEWAY_BASE_URL=https://...
PAYMENT_GATEWAY_API_KEY=...
```

Production requires HTTPS.

### Card-data rule

CarePoint must never receive or persist raw PAN or CVV.

A client may supply an opaque PSP-generated `paymentMethodToken`. That token is forwarded to the PSP for the current request and is not written to CarePoint persistence.

The financial models contain no PAN, CVV, `cardNumber`, or `paymentMethodToken` column.

### Payment intents

Endpoint:

```text
POST /api/v1/billing/invoices/:invoiceId/payment-intents
```

The patient can pay only an invoice owned by that patient.

The requested amount must be positive and cannot exceed the current patient balance.

A payment intent records:

- CarePoint invoice reference;
- patient/provider ownership;
- amount/currency;
- gateway name;
- opaque gateway intent reference;
- idempotency key;
- lifecycle status;
- safe failure code.

### Payment idempotency

`BillingIdempotencyService` resolves the idempotency key before validating the current invoice balance.

This matters after a successful first request: the balance may already be zero, but an identical retry must still return the original `PaymentIntent` and receipt rather than fail or create a duplicate charge.

### Successful settlement

A successful payment is finalized using a PostgreSQL serializable transaction.

The transaction:

1. claims the payment intent;
2. marks it `SUCCEEDED`;
3. updates invoice paid amount and balance;
4. creates one `PaymentReceipt`;
5. creates a positive `ProviderLedgerEntry` of type `CHARGE`.

Serialization conflicts are retried.

### Hosted actions / SCA

An external PSP may return an HTTPS `actionUrl` for a hosted authentication/payment step such as 3DS/SCA. Slice 6 exposes this result but does not build the mobile hosted-flow UI. That belongs to Slice 6.1.

## Receipts

A successful CarePoint settlement creates one receipt per payment intent.

The receipt includes:

- receipt number;
- invoice;
- patient/provider;
- amount/currency;
- issuance timestamp.

## Refunds

Provider endpoint:

```text
POST /api/v1/provider/finance/payment-intents/:intentId/refunds
```

Finance operator endpoint:

```text
POST /api/v1/finance/payment-intents/:intentId/refunds
```

A provider can refund only a settled payment belonging to that provider. A role with `FINANCE_OPERATE` can operate across providers.

Refunds are idempotent and cannot exceed the remaining refundable amount of the original settled payment.

A successful refund:

- marks `PaymentRefund` as `SUCCEEDED`;
- updates invoice refund totals/status;
- creates a negative provider-ledger `REFUND` entry.

## Provider ledger

Provider endpoints:

```text
GET /api/v1/provider/finance/summary
GET /api/v1/provider/finance/ledger
GET /api/v1/provider/finance/appointments/:appointmentId
```

Ledger types:

```text
CHARGE
REFUND
PLATFORM_FEE
PAYOUT
```

Slice 6 generates CHARGE, REFUND, and PAYOUT entries. `PLATFORM_FEE` is reserved for later commercial configuration.

The provider summary derives balances by currency from ledger entries. Cross-currency balances are not combined.

## Provider payouts

Finance operator endpoint:

```text
POST /api/v1/finance/payouts
```

Before starting a payout CarePoint verifies:

- provider exists and is active;
- amount is positive;
- currency is valid;
- idempotency key is valid;
- ledger balance in that currency is sufficient.

A paid payout creates a negative `PAYOUT` ledger entry.

Production payout settlement/reconciliation remains dependent on the configured PSP and operational controls.

## Insurance coverage

Patient endpoints:

```text
GET  /api/v1/insurance/me/coverages
POST /api/v1/insurance/me/coverages
POST /api/v1/insurance/me/coverages/:coverageId/deactivate
GET  /api/v1/insurance/me/activity
```

CarePoint stores an opaque `externalPolicyRef` for payer/clearinghouse integration. Normal coverage API presentation removes that internal reference and returns only a flag indicating that the reference exists server-side.

Coverage has an explicit lifecycle and optional effective dates.

## Insurance gateway

`InsuranceGatewayService` isolates CarePoint from payer/clearinghouse APIs.

Adapters:

- `mock` — development/test only;
- `external` — production target.

Production rejects mock insurance operations and requires HTTPS plus a server-side API key.

Configuration:

```text
INSURANCE_GATEWAY_PROVIDER=external
INSURANCE_GATEWAY_BASE_URL=https://...
INSURANCE_GATEWAY_API_KEY=...
```

## Eligibility

Endpoint:

```text
POST /api/v1/insurance/appointments/:appointmentId/eligibility
```

Allowed for the patient who owns the appointment, its treating provider, or an authorized insurance/finance operator according to RBAC.

Eligibility is idempotent.

When a gateway returns `ELIGIBLE`, its patient and insurer estimates must allocate the full invoice total. CarePoint then updates:

- `patientResponsibilityMinor`;
- `insurerResponsibilityMinor`;
- patient `balanceDueMinor`.

Insurance responsibility cannot be recalculated after patient payment has started.

Mock acceptance uses a deterministic 30% patient / 70% insurer allocation.

## Prior authorization

Endpoint:

```text
POST /api/v1/insurance/appointments/:appointmentId/prior-authorization
```

Prior authorization is submitted by the treating provider or an insurance/finance operator, not by the patient account directly.

Supported states:

```text
NOT_REQUIRED
PENDING
APPROVED
DENIED
EXPIRED
CANCELLED
```

The operation may reference a previous eligibility check and is protected by its own idempotency key.

## Authorization

New permissions:

```text
PATIENT_MANAGE_BILLING
PATIENT_MANAGE_INSURANCE
PROVIDER_READ_FINANCIALS
PROVIDER_REFUND_PAYMENTS
INSURANCE_CHECK
INSURANCE_OPERATE
FINANCE_OPERATE
```

### Patient

Can:

- read own billing;
- create own payment intents;
- manage own insurance coverage;
- request eligibility for own appointment.

Cannot:

- read provider finance;
- perform provider payouts;
- submit provider-side prior authorization;
- refund arbitrary provider payments.

### Doctor / Other Provider

Can for their provider context:

- read own financial summary/ledger;
- read own appointment financial state;
- refund own settled payments;
- perform permitted insurance operations for their appointments.

### Admin

Receives finance and insurance operating permissions. This does not imply clinical PHI permission.

### Support

Receives no Slice 6 finance permission by default.

## Persistence

Primary new models:

```text
PricingSnapshot
Invoice
PaymentIntent
PaymentRefund
PaymentReceipt
ProviderLedgerEntry
ProviderPayout
InsuranceCoverage
InsuranceEligibilityCheck
PriorAuthorization
```

Migrations:

```text
20260907023000_payments_insurance_financial_operations
20260907023100_booking_pricing_snapshot_trigger
20260907023200_cancelled_appointment_invoice_state
```

## CI acceptance

`services/api/scripts/slice6-smoke.mjs` runs after the previous Slice 1–5 acceptance sequence.

It verifies:

1. booking automatically has a pricing snapshot and invoice;
2. cancelled unpaid booking invoice is `VOID`;
3. changing the live service price does not change the historical snapshot/invoice;
4. patient billing ownership works;
5. insurance internal policy reference is not emitted by normal coverage APIs;
6. eligibility allocates patient/insurer responsibility correctly;
7. prior authorization lifecycle is reachable through the treating provider;
8. payment settles through the mock PSP;
9. payment retry with the same idempotency key returns the same settlement;
10. prohibited card credential fields do not exist in persisted payment intent data;
11. invoice transitions to paid state;
12. provider finance shows the correct booking state and balance;
13. finance operator payout creates the expected ledger debit;
14. provider refund succeeds;
15. refund retry is idempotent;
16. ledger includes charge/refund/payout entries;
17. patient cannot access provider financial APIs.

Mocks are acceptance-test infrastructure only and are forbidden in production.

## Production deployment gates

Before real money or insurance transactions are enabled, a production deployment still requires:

- contract and certification with the selected PSP/acquirer;
- PCI DSS responsibility and SAQ-scope analysis;
- hosted tokenization/card collection controlled by the PSP;
- 3DS/SCA and regional payment-authentication requirements;
- signed webhook verification and replay protection if async PSP webhooks are used;
- payment/refund/payout reconciliation jobs;
- settlement exception handling;
- provider reserve, negative-balance, dispute, chargeback, and payout-hold policy;
- tax/VAT configuration by jurisdiction;
- multi-currency and FX policy if required;
- accounting/ERP export and financial close controls;
- payer/clearinghouse contracts and production connectivity;
- insurance claims, adjudication, EOB/ERA, denial, and remittance workflows;
- secrets management outside source control;
- audit/SIEM integration;
- country-specific healthcare and financial compliance review;
- operational monitoring, incident response, penetration testing, and disaster recovery exercises.

## Recommended follow-up

### Slice 6.1 — Mobile Billing & Insurance Integration

Connect Patient, Doctor and Other Provider Flutter experiences to the Slice 6 APIs, including PSP-hosted payment actions and localized financial presentation.

### Slice 6.2 — Claims, EOB & Revenue Cycle

Add claim submission, claim status, adjudication/EOB, remittance, denial/rework, reconciliation and payer-specific adapters without expanding CarePoint's card-data scope.
