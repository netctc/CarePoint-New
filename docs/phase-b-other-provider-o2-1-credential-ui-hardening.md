# Phase B — Other Provider O2.1: Credential UI Completeness Hardening

## Objective

Close the remaining client-side credentialing gap after Other Provider O2 without changing backend authorization, persistence, or runtime capability rules.

## Base

O2.1 starts from cumulative integration commit `db2dea08e02756f3c65f44975d96cbc0ea1c4ca3`, which already contains Other Provider O1 credentialing/access and O2 category capability enforcement.

## Changes

The Other Provider credentialing screen now computes the category's missing `requiredCredentialTypes` before review submission.

- **Submit for review** stays disabled while any required credential type is missing.
- The credential dialog prioritizes the next missing required type so multi-credential categories can be completed deterministically.
- A localized warning lists missing required credential types while the application is editable.
- Category modalities remain visible after onboarding starts by resolving them from the public category catalog or `providerCategory.capabilities.enabledModalities` when the self-state payload does not include the computed top-level field.

## Defense in depth

The client-side gate is usability hardening only. The API remains authoritative. O1 acceptance already proves that a direct incomplete submit returns `400` and leaves both Provider and ProviderOnboarding in `DRAFT`, so bypassing the mobile UI cannot weaken the credential completeness rule.

## Scope boundary

- no API contract change;
- no Prisma schema or migration;
- no RBAC/grant change;
- no new provider capability;
- no Doctor behavior change;
- no clinical, financial, transport, or FHIR logic change.

## Merge gate

Merge only after the exact final PR head passes:

1. general Node/API CI, including cumulative Phase B mobile acceptance and Slices 2–9;
2. Flutter shared client tests plus Patient, Doctor, and Other Provider analysis;
3. complete FHIR Slice 10.0–10.13 regression workflow.
