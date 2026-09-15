# Release 1 R1 — Security Hardening Reconciliation Evidence

This evidence records the deliberate reconciliation of the alternate post-C15 security-hardening line into the canonical Release 1 integration branch.

## Integration baseline

- Canonical Release 1 parent: `acd7a917a398d458f4a7fcf57f4afe364ade207d`
- C19 implementation baseline ancestor: `1e69631a435ad63fe93a902a389d034eb769dd1c`
- Alternate C16–C18 hardening parent: `524946baa1a3424197172b5ccbe696ce63161f9b`
- Common pre-divergence base: `4b8ff5504e6ebab7d4abb790c268bb3ecb6a6c86`

## Alternate controls retained

- C16 hosted payment action trust
- C17 bounded inbound request bodies
- C18 global raw-body minimization

## C19-line controls retained

- C16 Admin backend egress resilience
- C17 LiveKit endpoint readiness
- C18 SMART public endpoint readiness
- C19 browser origin readiness

## Deliberate conflict resolution

`services/api/src/main.ts` retains browser-origin, LiveKit and SMART readiness while adding payment-action and inbound-body production preflights. The application is created with `{ cors: false }`, and JSON/form body parsers use validated bounded limits. Global raw-body capture is not enabled.

`services/api/package.json` wires all retained focused hardening smoke tests into one canonical test chain.

`services/api/.env.example` retains SMART public endpoint configuration while adding explicit inbound-body limits and the hosted-payment action-origin allowlist.

`services/api/src/modules/billing/payment-gateway.service.ts` adopts the trusted hosted-payment action URL validation from the alternate hardening line while retaining the existing C13 financial egress controls.

## Validation policy

The integration is not considered complete solely because the histories are reconciled. The exact integrated SHA must pass the mandatory CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR/SMART workflows before R1 is marked complete.
