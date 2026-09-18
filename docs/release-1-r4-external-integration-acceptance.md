# Release 1 — R4 External Integration Activation and End-to-End Acceptance

Status: **IN PROGRESS / NO-GO**  
Workstream: R4 of #70  
Tracking issue: #80  
Canonical branch: `release/release-1-integration-go-live-readiness`  
R4 starting baseline: `73a3c35fdc126a3af1e6f7bf0542e37d8c100031`

## 1. Purpose

R4 proves that every external dependency enabled for the approved Release 1 launch works through the real non-mock provider path, including authentication, network trust, functional success, negative cases, retries/idempotency, observability and operational ownership.

Source-code adapters and mock tests are implementation evidence only. They do not prove launch-provider readiness.

## 2. Scope policy

An integration is a Release 1 blocker only when it is required by the approved launch scope or by an enabled Release 1 workflow. Optional/post-MVP integrations may remain disabled and documented as deferred.

For every enabled production integration:

- mock mode must be rejected;
- secrets must come from the approved secret mechanism;
- production endpoints must satisfy the configured HTTPS/WSS and origin/egress policies;
- timeouts must be bounded;
- provider responses must be bounded before parsing where applicable;
- redirects must be rejected or allowlisted intentionally;
- retries must be idempotent where duplicate side effects are possible;
- PHI, credentials and payment-card data must not leak through external payloads or logs;
- provider outage behavior must fail safely and be observable.

## 3. Static integration inventory

| Integration | Current repository evidence | R4 static disposition | Real evidence required |
| --- | --- | --- | --- |
| LiveKit | Real room/token provider, production mock forbidden, hardened endpoint validation | READY FOR REAL E2E | Project/account, room lifecycle, webhook, TURN/network, real-device media |
| PSP/acquirer | External intent/refund/payout path, idempotency, hardened egress and hosted-action trust, production mock forbidden | READY FOR REAL E2E | Merchant environment, payment lifecycle, webhook/callback, refund, settlement/reconciliation |
| Insurance eligibility/prior auth | External gateway, bounded response and financial egress, production mock forbidden | READY FOR REAL E2E | Launch payer/clearinghouse/network, real eligibility/prior-auth cases |
| Claims/EOB/remittance | External submit/status/adjudication/denial/remittance gateway, idempotency, production mock forbidden | READY FOR REAL E2E | Launch payer route, claim lifecycle, EOB/remittance, certification/profile evidence |
| Push/SMS/email | External PUSH/EMAIL/SMS gateway, PHI-neutral payload policy, production mock forbidden | READY FOR REAL E2E | Provider credentials/sender setup, delivery, opt-out, retry/DLQ; #78 appointment orchestration |
| DICOMweb/PACS | HTTPS-only production reference validation, same-endpoint restriction, UID validation, proxy-required descriptor | CONDITIONAL | Real PACS endpoint/auth/proxy/access-control and clinical round-trip if enabled |
| ClamAV | Real INSTREAM scanner, production mock forbidden, fails on transport/timeout/unexpected response/malware | READY FOR REAL E2E | Runtime service, signature updates, clean/malware/outage tests, throughput |
| Mapping/geocoding/routing | Transport persists coordinates/addresses and operational ETA, but no obvious external routing/geocoding adapter was found in the Release 1 tree | SCOPE DECISION / POSSIBLE BLOCKER | Provider selection/adapter/privacy/coverage/ETA proof if required for launch |

## 4. LiveKit / telemedicine acceptance

### Existing implementation position

The telehealth provider supports real LiveKit operation and production refuses the mock provider. The real path creates and deletes rooms and mints participant tokens using configured LiveKit credentials.

### Required E2E scenarios

- [ ] Production/staging-equivalent LiveKit project/account identified.
- [ ] Endpoint uses the allowed HTTPS/WSS scheme and approved region/location.
- [ ] Credentials delivered through approved secret handling.
- [ ] Room creation succeeds from CarePoint.
- [ ] Patient token joins only the authorized room.
- [ ] Doctor token joins only the authorized room.
- [ ] Unauthorized participant/room attempt is rejected.
- [ ] Patient + Doctor audio/video succeeds on real Android and iOS devices.
- [ ] Camera/microphone permissions and denied-permission states are acceptable.
- [ ] TURN/fallback path succeeds on restrictive/mobile networks.
- [ ] Consent/readiness gates remain enforced before join.
- [ ] Session termination invalidates operational access as intended.
- [ ] Signed LiveKit webhook is delivered and accepted.
- [ ] Replayed/invalid webhook is rejected.
- [ ] Provider outage/timeout produces a safe user/operations state.
- [ ] Recording remains disabled unless separately approved.

### Exit evidence

Capture provider project reference, region, exact CarePoint SHA, device matrix, network matrix, webhook test, failure-mode test and operational owner. Do not capture media/PHI in public artifacts.

## 5. PSP / acquirer acceptance

### Existing implementation position

The billing layer contains a real external payment gateway path with idempotency, bounded response handling, trusted hosted-action URLs and production prohibition of the mock gateway.

### Required E2E scenarios

- [ ] Launch PSP/acquirer and merchant environment identified.
- [ ] API credentials delivered through approved secret handling.
- [ ] Payment intent creation succeeds.
- [ ] Hosted payment action URL is accepted only from the approved origin.
- [ ] Successful customer payment updates CarePoint exactly once.
- [ ] Failed payment is represented correctly.
- [ ] Customer cancel/back path is represented correctly.
- [ ] Provider timeout/network failure does not create duplicate charge state.
- [ ] Duplicate callback/webhook/retry remains idempotent.
- [ ] Refund succeeds and is reflected in CarePoint financial state.
- [ ] Repeated refund attempt cannot over-refund.
- [ ] Provider payout succeeds if enabled for launch.
- [ ] Settlement/reconciliation links CarePoint payment/invoice/reference to PSP settlement.
- [ ] No PAN/CVV/raw card data is persisted or logged by CarePoint.

### Launch note

The application-side generic gateway does not itself establish certification or acquiring approval. Those artifacts must be recorded as external release evidence where required.

## 6. Insurance eligibility and prior authorization acceptance

- [ ] Launch payer, clearinghouse or national network identified.
- [ ] Authentication/profile/version agreed.
- [ ] Eligible patient/policy scenario succeeds.
- [ ] Ineligible scenario returns normalized CarePoint result.
- [ ] Coverage limitations are represented correctly.
- [ ] Prior authorization submission succeeds where required.
- [ ] Pending/approved/denied prior-auth states are exercised.
- [ ] Duplicate retry is safe.
- [ ] Payer timeout/unavailable path is safe and observable.
- [ ] No full upstream response is exposed to unauthorized clients/logs.
- [ ] Market-specific profile/certification evidence is linked where required.

## 7. Claims / EOB / remittance acceptance

The current external claims contract supports submission and status refresh, including normalized adjudication/EOB amounts, denial information and paid/remittance state.

Required scenarios:

- [ ] Initial claim submission succeeds with an idempotency key.
- [ ] Duplicate submission/retry does not create a duplicate claim side effect.
- [ ] Accepted/pending status is exercised.
- [ ] Adjudicated response includes consistent allowed/insurer/patient/adjustment amounts.
- [ ] Denial code/public message flow is exercised.
- [ ] Corrected/reworked claim flow is exercised.
- [ ] Paid claim includes a remittance reference.
- [ ] Invalid/inconsistent payer response is rejected safely.
- [ ] Payer timeout/5xx/retry path is safe and observable.
- [ ] Reconciliation/EOB evidence is available to authorized financial workflows.
- [ ] Launch-market certification/profile evidence is linked where applicable.

## 8. Push / SMS / email acceptance

### Existing implementation position

The notification gateway supports `PUSH`, `EMAIL` and `SMS`; production rejects the mock provider and external payloads are constrained to PHI-neutral content.

### Required E2E scenarios

- [ ] Enabled launch channels are explicitly selected.
- [ ] Provider account/project/domain/sender identifiers are approved.
- [ ] Credentials delivered through approved secret handling.
- [ ] Push reaches representative Android and iOS devices if enabled.
- [ ] SMS reaches representative launch-country numbers if enabled.
- [ ] Email reaches representative launch-domain recipients if enabled.
- [ ] Invalid destination/provider rejection is handled correctly.
- [ ] User/channel preference opt-out is respected.
- [ ] Retry/backoff and dead-letter behavior are observed.
- [ ] Provider payload contains no unnecessary PHI.
- [ ] Logs/telemetry contain no message secrets or PHI.
- [ ] Once #78 is implemented, booking confirmation/status/reminder events are proven through the real channels.

## 9. DICOMweb / PACS acceptance

### Existing implementation position

The DICOM service rejects embedded credentials and off-endpoint references, enforces HTTPS in production, validates DICOM UIDs and marks structured references as requiring proxy access.

This is useful boundary protection, but static normalization does not prove PACS authentication, network access or the complete retrieval/rendering workflow.

### Required scenarios if PACS is launch-enabled

- [ ] PACS/DICOMweb provider and endpoint identified.
- [ ] Authentication mechanism approved and secret-managed.
- [ ] TLS/certificate validation succeeds.
- [ ] Study UID reference accepted.
- [ ] Series UID reference accepted.
- [ ] Instance UID reference accepted.
- [ ] Invalid UID rejected.
- [ ] Off-domain/off-base reference rejected.
- [ ] Direct browser exposure does not bypass CarePoint authorization.
- [ ] Proxy/backend access enforces patient/care-team authorization.
- [ ] Representative imaging reference is visible in the authorized clinical workflow.
- [ ] Provider outage/oversized/invalid response is safely handled.
- [ ] PHI exposure in URLs/logs is reviewed and minimized.

If DICOM/PACS is not part of the approved Release 1 launch, disable it and record the scope decision rather than leaving an unvalidated production endpoint enabled.

## 10. ClamAV acceptance

Required scenarios:

- [ ] Runtime ClamAV endpoint identified.
- [ ] Service is reachable only from intended application/network identities.
- [ ] Signature update process is operational and monitored.
- [ ] Known clean representative clinical document is accepted.
- [ ] EICAR test artifact is rejected.
- [ ] Scanner unavailable path fails closed.
- [ ] Scanner timeout path fails closed.
- [ ] Unexpected scanner response fails closed.
- [ ] Representative maximum-size document scan completes within the accepted latency/SLO.
- [ ] Scanner health/signature age alerting has an owner.

## 11. Mapping, geocoding and routing decision

### Current source finding

The medical-transport implementation already persists pickup/destination coordinates and optional addresses, supports request/assignment/status progression and accepts operational ETA values. The R4 source review did not identify an obvious external geocoder/router/map-provider adapter or provider-specific configuration in the canonical branch.

### Release decision required

The approved Release 1 flows require sufficient location context for clinic/home-visit and basic emergency/transport operation, but advanced map/dispatch capability must not be pulled into R1 merely because it is desirable.

Record one of these decisions:

**A. Provider-backed routing/geocoding is required for launch**

Then R4 requires:

- [ ] provider selected;
- [ ] server-side/provider adapter and configuration implemented;
- [ ] address-to-coordinate validation where required;
- [ ] route/ETA calculation where required;
- [ ] home-visit service-coverage check integrated with #75;
- [ ] API key restrictions/secret handling;
- [ ] location minimization and retention reviewed;
- [ ] provider data-processing/residency terms accepted;
- [ ] graceful degradation so nonessential map failure cannot delay an urgent emergency request.

**B. Provider-backed routing/geocoding is not required for Release 1**

Then document the approved operational model using supplied coordinates/address/manual ETA, ensure #75's P0 visit-context/coverage requirements are still satisfied, and defer advanced routing/dispatch to the later roadmap.

## 12. Cross-provider security and failure-mode matrix

For every enabled provider, capture:

| Control | Expected evidence |
| --- | --- |
| Mock disabled in production | Startup or real-path proof |
| Secret delivery | Approved secret reference, never secret value |
| Endpoint trust | HTTPS/WSS, allowed host/origin, no embedded credentials |
| Timeout | Bounded timeout test |
| Redirect policy | Rejected or explicit trusted allowlist |
| Response bound | Oversized response test where applicable |
| Idempotency | Duplicate financial/claims/event test |
| Retry behavior | Safe retry/backoff evidence |
| PHI minimization | Payload/log review |
| Observability | Correlated success/failure without secrets/PHI |
| Provider outage | Safe user/system state |
| Operational owner | Named team/role and escalation path |

## 13. R4 evidence record template

| Field | Value |
| --- | --- |
| Evidence ID | `R4-...` |
| Integration | LiveKit / PSP / Insurance / Claims / Notifications / DICOM / ClamAV / Maps |
| Environment |  |
| Date/time |  |
| Release SHA |  |
| Provider/account reference | Non-secret identifier only |
| Endpoint class | hostname/service class; no credentials |
| Scenario |  |
| Result | PASS / FAIL / CONDITIONAL / DEFERRED |
| Evidence location | Run/log/test artifact/ticket |
| Owner |  |
| Exception/waiver |  |
| Revalidation date |  |

Never store access tokens, API keys, private keys, raw payment-card data, PHI, clinical documents or unredacted provider payloads in GitHub evidence.

## 14. Relationship to open P0 closure issues

- #75: discovery, scheduling buffers/exceptions, clinic context and home-visit context/coverage.
- #76: WEB-05 clinical workspace; relevant to DICOM/clinical result UAT when enabled.
- #77: residency and retention/deletion; must govern every external provider's data destination/retention.
- #78: booking/status reminder orchestration; required before appointment notification E2E can be considered complete.
- #79: infrastructure acceptance; supplies network, KMS/secrets, edge, worker and recovery prerequisites for R4.

R3 and R4 may progress in parallel but neither can be declared complete based solely on application source.

## 15. Exit decision

R4 may move to **READY** only when:

- every integration enabled for the approved Release 1 launch has a real provider/account and environment;
- real success and required negative/failure scenarios pass on the exact candidate SHA;
- production paths do not fall back to mocks;
- required provider contracts/certifications/profile approvals are linked where applicable;
- location/PHI/payment data handling is accepted by R6/R9 where relevant;
- operational monitoring and ownership are recorded;
- any integration not launch-enabled is explicitly disabled and classified as deferred/non-blocking.

Until then R4 remains **IN PROGRESS / NO-GO**.

`main` remains unchanged until the Release Candidate satisfies the final Go/No-Go gates.