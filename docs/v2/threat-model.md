# CarePoint V2 Phase 0 Threat Model

## Assets
Patient identity/contact data; longitudinal clinical data; questionnaires/observations/documents/care plans; consent grants/revocations; provider identity/credentials/capabilities; authentication/MFA/session artifacts; audit evidence; emergency/transport/home-visit location data; offline mobile data; encryption keys; external gateway credentials.

## Trust boundaries
1. Patient mobile ↔ API.
2. Doctor mobile ↔ API.
3. Other Provider mobile ↔ API.
4. Admin web ↔ API.
5. API ↔ PostgreSQL/Redis/object storage.
6. API/workers ↔ payment, telehealth, notification, laboratory/FHIR/device gateways.
7. Local mobile storage ↔ authenticated application session.

| Threat | Required V2 control |
| --- | --- |
| BOLA/IDOR | Object-level authorization on every clinical/consent/resource access; negative tests. |
| Stale/over-broad consent | Reauthorize scope, provider, purpose and expiry at access time. |
| Cross-provider leakage | Provider independence/capability checks enforced server-side. |
| PHI leakage in logs/audit/notifications | Structured minimization; no raw clinical/location/contact payloads in generic channels. |
| Replay/tampering | Authn/authz, idempotency where applicable, concurrency/version checks, immutable audit. |
| Offline exposure | Minimize cached PHI; protected storage; session/scope-bound queue; safe wipe rules. |
| Key compromise | Envelope encryption, production KMS/HSM, rotation/recovery evidence, no repository secrets. |
| Gateway spoofing | Signed callbacks/webhooks, allowlisted egress, bounded payloads, replay protection. |
| Privilege escalation | MFA for privileged roles, least privilege, explicit permission/capability checks. |
| Unsafe clinical automation | Deterministic/configured alerts unless separately governed clinical AI is approved. |

## Required security tests
Positive/negative authorization; cross-patient/provider BOLA; consent lifecycle; audit PHI-minimization; encryption/key preflight; idempotency/concurrency; offline replay/scope isolation; gateway signature/contract tests.

## Governance note
Legal/privacy/clinical classification and retention are jurisdiction-dependent. Engineering must not claim completion without the required policy approval.
