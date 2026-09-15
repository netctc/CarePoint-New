# Phase C10 — Static Security and Secret-Leak Prevention Gate

## 1. Objective

Phase C10 closes the source-code security-analysis gap left after Phase C2 dependency hardening.

C2 proves the committed dependency graph and rejects high-severity dependency vulnerabilities. C10 adds two independent controls over the source repository itself:

1. a deterministic CarePoint-owned repository scanner for high-confidence secret leaks and prohibited runtime security constructs;
2. GitHub CodeQL semantic analysis for JavaScript/TypeScript using the `security-extended` query suite.

Neither control changes the CarePoint npm dependency graph.

## 2. Security architecture

```text
pull request / main push
        |
        +--> normal CI
        |      |
        |      +--> npm test
        |              |
        |              +--> C10 scanner self-test
        |              +--> full tracked-repository scan
        |
        +--> Security Analysis workflow
               |
               +--> Repository Security Gate
               |      +--> scanner self-test
               |      +--> full tracked-repository scan
               |
               +--> CodeQL SAST
                      +--> javascript-typescript
                      +--> security-extended
```

The deterministic scanner is intentionally executed both inside the normal API acceptance chain and in the dedicated security workflow. This means a repository security regression fails the established CI path even if CodeQL configuration or code-scanning infrastructure is temporarily unavailable.

## 3. Deterministic repository scanner

File:

```text
.ci/repository-security-scan.mjs
```

The scanner enumerates tracked files with Git rather than recursively reading the working directory. Untracked local files, `node_modules`, build output and other non-repository content therefore do not affect the result.

Large/binary artifacts are excluded from text parsing, while tracked secret environment files are rejected by pathname.

### 3.1 High-confidence secret signatures

The scanner detects representative high-confidence credential formats including:

- PEM private-key material;
- AWS access-key identifiers;
- GitHub access tokens;
- Slack tokens;
- Stripe live secret keys;
- SendGrid API keys;
- Google API keys.

The scanner also detects hardcoded sensitive literals/fallbacks in runtime source when the identifier indicates a password, passcode, secret, API key, token, private key or client secret.

### 3.2 Tracked environment files

A tracked `.env` or `.env.*` secret file is rejected. Only documentation templates ending in `.example`, `.sample` or `.template` are permitted.

This complements `.gitignore`; it does not rely on developers remembering to keep a particular secret file untracked.

### 3.3 Prohibited runtime constructs

Runtime application source is rejected when it contains:

- disabled TLS certificate verification;
- dynamic `eval(...)` / `new Function(...)` execution;
- MD5/SHA-1 use through Node `createHash`/`createHmac`;
- embedded username/password credentials in HTTP(S), PostgreSQL or Redis URLs.

These are intentionally narrow, high-confidence rules. C10 does not attempt to replace semantic SAST with regular expressions; CodeQL provides the deeper data-flow analysis layer.

## 4. Safe failure output

A source-security tool must not transform a secret leak into a CI-log leak.

The C10 scanner therefore prints only:

```text
<RULE_ID> <path>:<line>
```

It does not print the matched credential, literal or line content.

Example:

```text
GITHUB_TOKEN services/api/src/example.ts:27
```

The developer can inspect the source locally with appropriate access, remove/revoke the secret, and rerun the scan without the CI system redisclosing it.

## 5. Scanner self-test

The scanner supports:

```bash
node .ci/repository-security-scan.mjs --self-test
```

The self-test constructs synthetic forbidden values at runtime so the scanner source does not itself contain credential-like fixtures. It verifies every major secret/runtime rule plus a safe control case.

Expected marker:

```text
Phase C10 repository security scanner self-test passed
```

## 6. Full repository scan

Run from the repository root:

```bash
node .ci/repository-security-scan.mjs
```

Expected marker:

```text
Phase C10 repository security scan passed: <N> tracked text files scanned
```

Any finding exits non-zero.

## 7. CodeQL SAST

Workflow:

```text
.github/workflows/security-analysis.yml
```

C10 uses the official GitHub CodeQL action pinned to the exact reviewed commit:

```text
6f5948dfacef28e207b48d0905cf90c03365536d
```

The workflow uses:

```text
language: javascript-typescript
queries: security-extended
```

Pinning to an immutable SHA follows the same action-supply-chain practice already used by the existing CarePoint workflows.

The workflow does not use `continue-on-error`; an analysis failure is a failed security gate rather than advisory telemetry.

## 8. Workflow triggers

Security Analysis runs on:

- every pull request;
- pushes to `main`;
- a weekly scheduled scan.

The schedule gives CodeQL a periodic opportunity to evaluate the unchanged codebase with updated query/database tooling, while PR/main execution blocks newly introduced issues as part of normal delivery.

## 9. Permissions

The workflow defaults to read-only repository content permissions.

The CodeQL job is granted only the additional permissions needed for code-scanning result publication:

- `contents: read`;
- `packages: read`;
- `security-events: write`.

No workflow job receives repository content write permission.

## 10. Handling a secret finding

If C10 identifies a real secret:

1. do not copy the secret into an issue, PR comment or CI log;
2. revoke/rotate the credential at the issuing provider immediately;
3. remove it from the current source tree;
4. determine whether Git history also contains the credential;
5. if history contains it, treat repository history cleanup as a separate controlled change—rotation is required even if history is rewritten;
6. inspect provider/audit logs for unauthorized use;
7. rerun C10 and the full regression suite;
8. record the incident through the security operations process.

Passing C10 after deletion does not make an exposed credential safe again; provider-side rotation is mandatory.

## 11. Handling a static-analysis finding

For a CodeQL alert:

1. confirm the data flow and affected runtime path;
2. remediate the root cause rather than suppressing the query by default;
3. add a deterministic regression test where practical;
4. rerun CodeQL and normal CI;
5. use a query exclusion/suppression only when the finding is demonstrably false positive and the rationale is reviewed/documented.

C10 deliberately contains no broad baseline suppression file.

## 12. Relationship to other CarePoint controls

C10 complements rather than replaces:

- C1/C8 — KMS configuration and rotation readiness;
- C2 — canonical dependency graph, pinned package locks and dependency audit;
- C3 — private object storage;
- C4 — Redis production readiness;
- C5 — PostgreSQL production readiness;
- C6 — safe OpenTelemetry export;
- C7 — durable notification outbox;
- C9 — durable PHI-neutral SIEM audit export;
- runtime Nest/HTTP security controls and Admin B7 security operations.

A clean dependency audit does not prove application source safety, and clean SAST does not prove third-party dependency safety. Both gates remain required.

## 13. Deterministic C10 acceptance

API acceptance includes:

```bash
npm --workspace @carepoint/api run c10:static-security
```

The C10 smoke test verifies:

- scanner self-test passes;
- the current tracked repository passes the scanner;
- every required high-confidence rule remains present;
- the scanner uses `git ls-files`;
- failure output is rule/path/line oriented and does not print matched values;
- the Security Analysis workflow exists;
- pull-request, main and scheduled triggers are present;
- CodeQL init/analyze are both pinned to the approved exact SHA;
- unpinned `@vN` CodeQL references are absent;
- JavaScript/TypeScript and `security-extended` are configured;
- `security-events: write` is scoped to the CodeQL job;
- `continue-on-error` is absent;
- the C10 acceptance remains chained into the API test sequence.

Expected marker:

```text
Phase C10 static security gate acceptance passed
```

## 14. CI acceptance criteria

C10 is complete only when the exact final branch head passes all existing gates plus the new Security Analysis workflow:

- C2 canonical package count and lock hash unchanged;
- dependency audit with zero reported vulnerabilities;
- production build;
- C1 and C3–C10 deterministic acceptance chain;
- all PostgreSQL migrations and bootstrap;
- IAM persistence;
- Admin B1–B9;
- application Slice 2–9;
- Flutter shared/mobile tests and analyses;
- FHIR Slice 10.0–10.13;
- Repository Security Gate;
- CodeQL SAST.

As with previous phases, validation occurs through a temporary stacked PR and the PR is closed without merge after the branch itself is proven green.
