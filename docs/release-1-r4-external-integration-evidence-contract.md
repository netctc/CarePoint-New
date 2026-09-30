# Release 1 R4 external-provider activation and E2E evidence contract

Status: repository-side acceptance mechanism only. This contract does **not** claim that a launch provider, merchant/payer account, notification sender, PACS, ClamAV runtime or mapping provider has been provisioned or accepted.

Tracked by supporting #118, parent #80 and master #70.

## Purpose

R4 already inventories the Release 1 integration adapters and documents the real end-to-end acceptance required for LiveKit, PSP/acquirer, insurance, claims, notifications, DICOM/PACS, ClamAV and mapping/routing. Static adapters and CI mocks cannot establish real provider readiness.

`.ci/release-external-integration-evidence-contract.mjs` makes the final sanitized R4 evidence record machine-checkable and binds it to the exact Release Candidate. `ops/release-1/external-integration-evidence.example.json` is deliberately `approved=false` / `overallStatus=DRAFT`; it is a collection worksheet, not launch evidence.

## Final validation command

Check out the exact Release Candidate SHA, collect sanitized evidence from the approved provider/control-plane/restricted evidence systems, and run:

```bash
node .ci/release-external-integration-evidence-contract.mjs --validate /path/to/release-1-r4-evidence.json --out /path/to/validated-r4-summary.json
```

The validator resolves `git rev-parse HEAD`; a different `release.sourceSha` is rejected.

## Release and environment binding

Final R4 evidence must carry:

- full 40-character Release Candidate SHA and release version;
- immutable API and Admin SHA-256 digests;
- Release Candidate evidence reference from R10;
- accepted infrastructure evidence reference from R3;
- production-equivalent or production environment identifier/topology reference;
- approved external-provider launch-scope reference.

A final record captured directly against production additionally requires explicit production-validation approval. The repository workflow never calls real providers or mutates provider accounts.

## Explicit launch-scope decisions

The evidence records booleans for telemedicine, payments, provider payouts, insurance, prior authorization, claims, push, SMS, email, DICOM, clinical uploads and provider-backed maps/routing. These values must come from the approved Release 1 launch scope and market profile; the repository supplies no default provider selection.

Every integration family is then either:

- `ENABLED` + `PASS` because its approved launch feature is enabled; or
- `DISABLED` + `NOT_APPLICABLE` because the approved scope disables it, with explicit rationale and approval references.

A final enabled integration may not use `MOCK`/sandbox fallback as the production path. Disabled integrations may not carry a provider account/endpoint or success/failure E2E claim.

## Integration families and mandatory E2E assertions

### LiveKit

When telemedicine is enabled, real-provider evidence must prove room create/terminate, authorized Patient+Doctor join, unauthorized-room denial, real Android/iOS media, permission states, TURN/fallback under restrictive/mobile networking, signed webhook authenticity/replay handling, consent/readiness before join, session termination and recording-policy enforcement. Recording approval is required if recording is enabled.

### PSP/acquirer

When payments are enabled, evidence must prove payment-intent creation, trusted hosted-action origin, success/failure/cancel paths, timeout without duplicate charge, webhook/callback authenticity, replay/idempotency, refund and over-refund prevention, absence of PAN/CVV persistence, and settlement/reconciliation. Provider payout evidence becomes mandatory only when the approved scope enables payouts.

### Insurance eligibility / prior authorization

When insurance is enabled, evidence must prove eligible/ineligible cases, normalized coverage limitations, safe timeout behavior, duplicate retry safety and bounded upstream exposure. Full prior-authorization lifecycle evidence is additionally required only when the approved scope enables prior authorization.

### Claims / EOB / remittance

When claims are enabled, evidence must prove submission, duplicate-submission idempotency, accepted/pending/adjudicated/denied outcomes, internally consistent EOB amounts, rework, paid/remittance reference, invalid-response rejection, safe payer timeout/retry and authorized reconciliation.

### Notifications

If any of push/SMS/email is enabled, the evidence `enabledChannels` must exactly match those launch-scope booleans and every enabled channel requires its own real-delivery evidence reference. R4 also requires invalid-destination handling, opt-out/preferences, retry/backoff/dead-letter behavior, PHI-neutral provider payloads and real appointment confirmation/status/reminder delivery from the #78 orchestration path.

### DICOM/PACS

When DICOM is enabled, evidence must prove study/series/instance reference round-trip, invalid UID rejection, off-domain reference rejection, no direct-browser authorization bypass, backend/proxy care-team authorization, authorized clinical visibility, safe outage/invalid-response behavior and minimized PHI in URLs/logs.

### ClamAV

When clinical uploads are enabled, evidence must prove a clean file is accepted, the EICAR test is rejected, scanner outage/timeout/unexpected response all fail closed, signature freshness is monitored, and representative maximum-size scanning has been exercised.

### Mapping/routing

The R4 source inventory explicitly leaves provider-backed mapping as a launch-scope decision. If enabled, evidence must prove address/coordinate behavior, route/ETA behavior, #75 home-visit coverage integration, location minimization, provider data terms, and that a nonessential map outage cannot block urgent emergency dispatch. If disabled, the approved manual/coordinate-based operating model must be referenced instead of inventing a provider.

## Common provider controls

Every enabled integration also must prove the real provider path, production mock rejection, approved secret delivery, endpoint trust, bounded timeout/response handling, safe failure state, PHI/credential leakage review, sanitized observability and operational ownership/escalation.

Each enabled integration records non-secret provider/account and endpoint-class references; secret-delivery, data-governance, privacy and residency evidence references; success/failure/observability evidence; test window; owner/escalation; revalidation reference/date; and whether provider certification/profile evidence is required. Certification evidence is mandatory when the approved decision marks it required.

## Approval boundary

Final R4 evidence always requires explicit `APPROVE` records from Operations, Security, Privacy and Product. Finance approval is additionally required when payments, insurance or claims are launch-enabled. Clinical approval is additionally required when telemedicine, DICOM, clinical uploads or provider-backed maps/routing are enabled.

This does not replace R9 licensing/regulatory/clinical-safety acceptance or any external certification authority. It only requires the final R4 evidence to link the relevant approved records.

## Sensitive-data guardrails

The validator is reference-oriented and rejects common credential-bearing, PHI-like and card-data keys, plus private-key blocks, bearer/JWT-like values, embedded URL credentials and secret/token query or assignment patterns. Do not place provider credentials, webhook signing material, PAN/CVV, real patient identifiers, unredacted payer payloads, clinical documents, raw provider messages or restricted penetration evidence in public GitHub artifacts.

## CI contract workflow

`.github/workflows/external-integration-contract.yml` validates only this repository contract. It:

1. checks out the exact PR head SHA;
2. verifies checkout identity;
3. runs positive and fail-closed self-tests;
4. confirms the example remains a non-approved DRAFT with all eight integration records and approval placeholders;
5. emits a sanitized contract artifact containing the exact source SHA and SHA-256 fingerprints of the validator/template.

The workflow does not resolve DNS to a provider, authenticate to a provider, create rooms/payments/claims, deliver notifications, query PACS, scan clinical files, call maps APIs or assert a launch certification.

## Closure rule

Completing #118 means the R4 evidence format and machine-checking mechanism are validated. Parent #80 remains `IN PROGRESS / NO-GO` until every integration enabled by the approved launch scope is actually configured against its intended non-mock provider/account, required positive and negative scenarios are executed on the exact final RC, provider/privacy/certification evidence is linked, real-device evidence is available where required, and the sanitized final record passes this contract.
