# Release 1 — R9 Provider Current-Credential Enforcement

Status: **CODE-SIDE CONTROL IMPLEMENTED / MARKET POLICY ACCEPTANCE PENDING**  
R9 workstream: #91  
P0 blocker: #93  
Canonical branch: `release/release-1-integration-go-live-readiness`

## 1. Purpose

This change closes a generic engineering gap identified while reviewing #93: a credential that had been administratively marked `VERIFIED` could satisfy onboarding activation even when its explicit `validUntil` timestamp was already expired, and the central authorization layer did not independently re-evaluate required credential currency for later provider operations.

The control is deliberately policy-neutral. It does **not** define a KSA regulator, credential issuer, mandatory validity period, grace period, reverification cadence, scope-of-practice rule or suspension SLA. Those remain market/clinical/regulatory decisions owned by #93.

## 2. Approved-specification traceability

The approved CarePoint specification requires provider credentials to carry type, issuer, number, validity, document and review state; a suspended provider cannot receive new bookings or initiate clinical services. The provider onboarding workflow also requires validity/minimum requirements to be checked before activation, and the acceptance criteria state that a Doctor cannot activate without a required current credential.

This implementation therefore enforces only an invariant already represented by the product model: when a credential has an explicit validity window, it cannot count as a current required credential outside that window.

## 3. Current-credential rule

A credential counts as current when:

- it has the required credential type;
- its review/promotion status is verified where that status applies;
- `validFrom`, when present, is not in the future;
- `validUntil`, when present, is strictly later than the decision instant.

A missing validity bound is **not** interpreted as a guessed market expiry rule. Whether a launch policy requires an expiry date for a given credential type remains an explicit #93 policy input.

## 4. Activation control

`ProviderCredentialGovernanceService` is invoked before the existing onboarding approval transaction.

For Doctors, the currently configured required type remains `medical-license`.

For Other Providers, required types continue to come from the versionable `ProviderCategory.requiredCredentialTypes` configuration.

If any required type lacks a current verified credential, activation is denied before the provider is moved to `ACTIVE`. The denial is audited as `PROVIDER_APPROVAL_DENIED_CREDENTIAL_VALIDITY` using credential-type metadata only; credential numbers/documents are not copied into the denial evidence.

## 5. Runtime operational-access control

`ProviderOperationalCredentialService` is enforced by the global API access guard **after** normal authentication and role permission evaluation.

For authenticated Doctor/Other Provider principals, operational permissions now require:

- the matching provider profile to remain `ACTIVE`;
- an active Other Provider category where applicable;
- all configured required credential types to have a current `VERIFIED` promoted credential.

The gate is intentionally not applied to `PROVIDER_SELF_ONBOARD`, `SELF_SESSION_MANAGE` or `SELF_NOTIFICATION_MANAGE`. This prevents an expired credential from being used for clinical/financial/service operations while preserving access to the provider's self-service/session/remediation paths.

The runtime denial is audited as `PROVIDER_OPERATIONAL_ACCESS_DENIED` with a bounded reason and missing credential types only.

## 6. Automated acceptance

Two permanent gates are added:

1. `r9:provider-credential-validity` — deterministic rule/wiring acceptance in the API test chain.
2. `R9 provider current-credential enforcement acceptance` — live CI scenario against PostgreSQL/API.

The live scenario proves both Doctor and Other Provider behavior:

- an already-expired required credential can be reviewed but cannot activate the provider;
- a provider with a current required credential can perform an operational service action;
- after the promoted required credential is synthetically expired in the disposable CI database, the same operational action is denied immediately;
- provider self-service/remediation access remains available;
- restoring the Doctor credential to a current date restores operational access without inventing a market-specific grace rule;
- denial audit evidence does not contain the synthetic credential number.

All fixtures are synthetic and unique per run. No production provider credential or personal data is used.

## 7. What this does not close

#93 must remain open. Release 1 still needs approved KSA/launch-market decisions for:

- authoritative license/registration verification sources;
- credential types and documentary evidence by provider category;
- whether expiry dates are mandatory for each credential;
- renewal/reverification cadence and grace/no-grace policy;
- suspension/revocation propagation SLA;
- specialty/privilege/scope-of-practice mapping;
- ambulance operator/vehicle/crew/equipment requirements;
- evidence-retention rules and named Clinical/Regulatory approvers.

Once those inputs are approved, CarePoint configuration and any additional policy-specific enforcement must be validated against the exact Release Candidate.

## 8. Release decision

Code-side current-credential enforcement: **READY FOR EXACT-SHA VALIDATION**.  
KSA/provider policy acceptance: **BLOCKED / PENDING #93**.  
This document is engineering evidence, not a licensing or regulatory certification.
