# Release 1 R1 — Other Provider O2/O2.1 Reconciliation

## Context

The Release 1 branch audit identified one functional Phase B line that was not an ancestor of the C19-based release line:

`feature/phase-b-other-provider-o2-1-credential-ui-hardening`

Its head is `710e832abc599a258da0498dc14da7ca2f39d98b`. The line contains the Other Provider O2 category-capability enforcement and O2.1 credential UI hardening required to preserve the flexible Other Provider model in Release 1.

## Conflict analysis

The common ancestor between the O2/O2.1 line and the current Release 1 line is `56d58dfb6eade33d4d0699566365e226760b7f65`.

The O2/O2.1 line changes exactly the following functional surfaces:

- Other Provider mobile access and capability-aware workspace;
- provider category capability service;
- scheduling service-publication enforcement;
- clinical order capability enforcement;
- clinical encounter write capability enforcement;
- provider onboarding/credential presentation;
- Other Provider O1/O2 acceptance scripts and supporting documentation.

The later Release 1 line from the common ancestor through the R1 security-hardening candidate does not modify those O2/O2.1 target files. The functional reconciliation can therefore adopt the latest O2/O2.1 versions without overwriting later Release 1 hardening work.

## Release 1 behavior retained

The integration preserves the provider-category capability contract, including:

- allowed service modalities / service publication scope;
- allowed clinical order types;
- whether the category may write clinical encounters;
- API-side enforcement even if a client attempts a forbidden action;
- mobile-side removal/disablement of actions the provider category is not allowed to perform;
- credential-category UX hardening and required-credential submission checks.

## Validation

The exact integrated SHA must repeat all Release 1 mandatory workflows. In addition, the Other Provider O2 acceptance script must run against the started API so both permitted and denied provider-capability paths are exercised.

No merge to `main` is permitted as part of this reconciliation.
