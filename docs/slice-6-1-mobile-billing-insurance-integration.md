# Slice 6.1 — Mobile Billing & Insurance Integration

## Purpose

Slice 6.1 connects the CarePoint Patient, Doctor and Other Provider Flutter applications to the Slice 6 billing, insurance and provider-finance APIs.

The mobile layer does not expand CarePoint's card-data scope. Card number, CVV, PIN and raw card credentials are never requested by CarePoint UI.

## Shared mobile architecture

The shared package remains:

```text
packages/mobile_core
```

Slice 6.1 adds:

```text
financial_api.dart
financial_localization.dart
financial_workspace.dart
```

`carepoint_api.dart` declares `financial_api.dart` as a library part so financial calls reuse the same authenticated request pipeline, bearer token, refresh-token rotation and API error handling already used by the rest of the mobile applications.

## Hosted payment dependency

The mobile core adds Flutter `url_launcher` for PSP-hosted payment actions.

CarePoint validates the PSP action URL before launch:

```text
scheme = https
host != empty
```

`http:`, `javascript:` and malformed URLs are rejected.

The hosted page is opened using the external application/browser mode.

This design keeps payment credential entry outside CarePoint.

## Patient Financial Hub

The Patient app adds a fourth primary destination:

```text
Search
Visits
Health Record
Finance
```

Finance contains two internal views:

```text
Billing
Insurance
```

### Billing

The Billing view uses:

```text
GET  /api/v1/billing/me
POST /api/v1/billing/invoices/:invoiceId/payment-intents
POST /api/v1/billing/payment-intents/:intentId/refresh
```

It displays:

- invoice number and status;
- total;
- patient responsibility;
- insurer responsibility;
- amount paid;
- balance due;
- receipts.

### Payment flow

For a payable invoice:

```text
Patient taps Pay securely
        ↓
CarePoint creates idempotent PaymentIntent
        ↓
SUCCEEDED? ── yes ──> refresh billing / show receipt
        │
        no
        ↓
PSP actionUrl present and HTTPS?
        ↓
Open external hosted payment page
        ↓
Patient returns to CarePoint
        ↓
Check payment status
        ↓
POST payment-intents/:id/refresh
```

The mobile idempotency key is generated from the current timestamp and invoice identifier.

The UI intentionally contains no:

```text
card-number field
CVV field
PIN field
card-expiry field
CarePoint card vault
```

`paymentMethodToken` remains available only as an optional low-level API parameter for future PSP-native tokenization integrations. Slice 6.1 does not render a UI that asks the user for it.

## Patient insurance

The Patient app uses:

```text
GET  /api/v1/insurance/me/coverages
POST /api/v1/insurance/me/coverages
POST /api/v1/insurance/me/coverages/:coverageId/deactivate
GET  /api/v1/insurance/me/activity
POST /api/v1/insurance/appointments/:appointmentId/eligibility
```

A patient may enter:

- payer code;
- payer name;
- policy/member reference;
- optional plan label;
- optional effective dates.

The policy/member reference is submitted once to the backend as `externalPolicyRef`. Normal coverage views use the Slice 6 presentation service and do not return that value.

The mobile UI never renders `externalPolicyRef` after creation.

### Eligibility

The patient selects an active coverage and one of their appointments.

The request contains:

```text
coverageId
idempotencyKey
```

It does not contain a patient identity supplied by the UI. Patient identity remains derived from the authenticated account on the server.

The resulting insurance activity view displays eligibility and prior-authorization status.

## Doctor and Other Provider finance

Doctor and Other Provider keep separate applications and separate login boundaries.

Both applications expose an authenticated Finance launcher that opens the shared `ProviderFinancialWorkspace`.

The workspace uses:

```text
GET  /api/v1/provider/finance/summary
GET  /api/v1/provider/finance/ledger
GET  /api/v1/provider/finance/appointments/:appointmentId
POST /api/v1/provider/finance/payment-intents/:intentId/refunds
POST /api/v1/insurance/appointments/:appointmentId/prior-authorization
```

### Summary

Balances are displayed separately by currency.

No cross-currency arithmetic is performed on the client.

### Ledger

The provider can inspect:

```text
CHARGE
REFUND
PLATFORM_FEE
PAYOUT
```

For charge entries containing a payment-intent reference, the provider can submit a refund amount and optional reason.

The backend remains authoritative for:

- provider ownership;
- refundable amount;
- idempotency;
- settlement state;
- invoice transition;
- ledger entry creation.

The mobile client cannot override these rules.

### Appointment finance

The provider can inspect an appointment's:

- pricing snapshot;
- invoice;
- patient/insurer responsibility;
- eligibility history;
- prior-authorization history.

If eligibility exists, the provider can submit prior authorization using the coverage and eligibility references returned by the server.

The patient app does not expose this provider-side action.

## Localization

Financial copy is available for:

```text
en
ar
fr
es
```

Arabic relies on the existing application-level `Directionality` and therefore renders as real RTL.

Identifiers, routes, enum values and engineering terminology remain canonical English.

## Mobile tests

`packages/mobile_core/test/financial_mobile_test.dart` verifies:

1. patient billing request uses authenticated bearer access;
2. hosted payment intent omits `paymentMethodToken` when not supplied;
3. payment intent refresh uses the authenticated client;
4. insurance coverage creation does not send a patient identity;
5. eligibility does not send a patient identity;
6. provider appointment-finance API is reachable through the shared client;
7. prior authorization uses coverage and eligibility references;
8. provider refund uses the provider-finance endpoint;
9. HTTPS hosted-payment URLs are accepted;
10. HTTP, JavaScript and malformed hosted-payment URLs are rejected.

The existing CI additionally continues to run:

- all Node/TypeScript builds and tests;
- all PostgreSQL migrations;
- Slices 1–6 backend acceptance flows;
- shared Flutter mobile-core tests;
- Patient app analysis;
- Doctor app analysis;
- Other Provider app analysis.

## Production limitations

Slice 6.1 is not equivalent to a production-certified payment deployment.

Production still requires the Slice 6 gates, including:

- selected PSP/acquirer production adapter;
- hosted tokenized card collection;
- PCI DSS scope/responsibility review;
- 3DS/SCA where applicable;
- signed webhook verification and replay protection;
- reconciliation and settlement exception handling;
- dispute/chargeback handling;
- provider payout policy;
- payer/clearinghouse production connectivity;
- secrets management;
- mobile deep-link/return-flow hardening if automatic hosted-payment return is added;
- jurisdiction-specific healthcare and financial compliance review.

The current hosted flow deliberately uses an external browser plus explicit status refresh rather than claiming an unimplemented automatic PSP callback/deep-link flow.

## Deferred work

### Slice 6.2 — Claims, EOB & Revenue Cycle

Recommended next financial slice:

- claim creation and submission;
- claim status tracking;
- adjudication;
- EOB/ERA;
- remittance;
- denial and rework queues;
- payer adapters;
- reconciliation controls.

Secure mobile Keychain/Keystore persistence for authentication tokens remains a separate mobile-hardening requirement inherited from Slice 2.1 and is not solved by Slice 6.1.
