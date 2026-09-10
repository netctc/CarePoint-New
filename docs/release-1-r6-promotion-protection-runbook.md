# Release 1 R6/R10 — Protected Promotion Path Runbook

## Purpose

This runbook closes the configuration/evidence gap tracked by #84. It defines the official Release 1 promotion path and the repository-administration evidence required before `release/release-1-integration-go-live-readiness` may be promoted to `main`.

This document does **not** authorize a production promotion. The canonical Release 1 branch remains the integration line and `main` remains frozen until the Release Authority completes Go/No-Go.

## Current observed state

At the start of this increment, GitHub reported:

- `main`: `protected=false`.
- `release/release-1-integration-go-live-readiness`: `protected=false`.
- Repository rulesets: none returned by the repository rulesets endpoint.
- Exact candidate `30893162bd2847f35d6b9e54a8036700621979ec` had a failing independent GitHub Advanced Security check named `CodeQL`, reporting six new High alerts. This is tracked by #124.

Therefore #84 and R6 are currently **BLOCKED**.

## Official Release 1 promotion path

Only this path is approved for normal Release 1 promotion:

1. Work and stabilization occur on `release/release-1-integration-go-live-readiness` through reviewed pull requests.
2. The exact Release Candidate SHA is frozen and all mandatory machine and human gates are evaluated against that SHA.
3. A dedicated promotion pull request is opened from `release/release-1-integration-go-live-readiness` to `main` only after all Release 1 gate owners report acceptance.
4. The promotion PR requires at least one valid approving review, all mandatory checks on the latest candidate SHA, resolved conversations, and final Release Authority approval.
5. Direct push, force push and branch deletion are not normal promotion mechanisms.
6. Temporary validation PRs used to trigger workflows are never merged to `main`.

## Preferred GitHub configuration

Use a repository **branch ruleset** where available. A classic branch-protection rule is acceptable only if it enforces equivalent behavior. GitHub rulesets can require pull requests, required status checks and code-scanning results, and can block force pushes. Rulesets can also expose their active configuration to repository readers, which is useful for release audit evidence.

Recommended ruleset name:

`Release 1 protected promotion`

Set enforcement to `Active` and target both exact branches:

- `main`
- `release/release-1-integration-go-live-readiness`

During non-destructive validation, the same ruleset may additionally target a disposable branch pattern such as `release-policy-validation/*`. Remove that temporary target after evidence is captured if it is not needed operationally.

### Required branch rules

Configure at least the following:

- Require a pull request before merging.
- Require at least **1 approving review**.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merging.
- Require status checks to pass before merging.
- Prefer strict/up-to-date required checks for the final promotion path unless Release Authority documents another choice.
- Block force pushes.
- Block branch deletion.
- Do not grant ordinary direct-push bypass.
- Bypass, if retained at all, must be a documented break-glass path with named authority and auditable procedure.
- Where the repository/plan exposes code-scanning merge protection, require acceptable code-scanning results in addition to the explicit `CodeQL` status check.

Do not use a broad administrator bypass as the normal release mechanism.

## Exact mandatory status-check names

GitHub required status checks are configured by check/job name, so use the observed names from the exact validated candidate rather than workflow display names.

The promotion policy evidence contract requires the following current set:

| Check name | Purpose / expected source |
| --- | --- |
| `node` | Main Node/API/Admin CI — GitHub Actions |
| `flutter` | Shared mobile analysis/tests — GitHub Actions |
| `Repository Security Gate` | Repository scanner — GitHub Actions |
| `CodeQL SAST (javascript-typescript)` | CodeQL analysis/upload execution — GitHub Actions |
| `CodeQL` | Independent code-scanning result — GitHub Advanced Security |
| `PostgreSQL 16 Backup Restore Drill` | Recovery gate — GitHub Actions |
| `fhir` | FHIR/SMART interoperability gate — GitHub Actions |
| `evidence` | Exact-SHA Release Candidate evidence bundle — GitHub Actions |
| `R3 infrastructure evidence contract` | R3 machine contract — GitHub Actions |
| `R4 external-provider evidence contract` | R4 machine contract — GitHub Actions |
| `R5 signed mobile release evidence contract` | R5 machine contract — GitHub Actions |
| `R7 UAT evidence contract` | R7 UAT evidence schema/contract — GitHub Actions |
| `R9 market readiness evidence contract` | R9 market/legal/clinical evidence schema/contract — GitHub Actions |

Important: `CodeQL SAST (javascript-typescript)` being green does **not** replace the independent `CodeQL` result. Candidate `30893162bd2847f35d6b9e54a8036700621979ec` proved that the analysis job can succeed while the downstream code-scanning check fails. #124 must be closed or formally accepted under the approved security policy, the final independent `CodeQL` result must be PASS, and unresolved Critical/High security findings must be zero before promotion evidence can be accepted.

R8/R10 currently contain several jobs named only `contract`. Do not blindly add a generic `contract` required-check context because required status checks do not distinguish workflow/event/matrix identity by name alone. Rename those jobs to unique stable release-gate names before making them mandatory repository contexts, or enforce their outcome through a uniquely named aggregator gate.

## Administrator execution procedure

A repository administrator, organization owner, or role with permission to edit repository rules must perform these steps in GitHub:

1. Open repository **Settings → Rules → Rulesets** (or the repository's equivalent branch-protection page if classic protection is used).
2. Create/edit `Release 1 protected promotion` as an active branch ruleset.
3. Target `main` and `release/release-1-integration-go-live-readiness` exactly.
4. Configure PR requirement, minimum approvals, stale-approval dismissal, conversation resolution and no normal bypass.
5. Enable required status checks and add the exact mandatory contexts listed above.
6. Where GitHub offers an expected source/app for a check, bind GitHub Actions checks to GitHub Actions and the independent `CodeQL` check to GitHub Advanced Security rather than accepting an arbitrary producer.
7. Enable force-push/deletion blocking.
8. If code-scanning merge protection is available, require code-scanning results at the approved severity threshold as defense in depth.
9. Save/activate the ruleset.
10. Capture the active ruleset/protection configuration, ruleset identifier, target patterns, bypass list, review rules and required checks as evidence.

The GitHub connection used by the Release 1 automation does not have repository-administration write access, so the contract workflow cannot perform these settings changes itself.

## Non-destructive verification protocol

Do not merge anything to stale `main` merely to test protection. Use a disposable validation branch governed by the **same active ruleset**, plus read-only proof that the same ruleset targets `main` and the canonical release branch.

Recommended test pattern:

1. Create `release-policy-validation/<date-or-id>` from an innocuous base.
2. Ensure the active ruleset includes this disposable branch pattern for the duration of the test.
3. With an ordinary non-bypass identity, prove direct update is rejected and retain the Git/GitHub rejection output.
4. Open a validation PR to the disposable protected branch with a deliberately failing required check and prove merge is blocked.
5. Restore the check, leave the PR without approval and prove merge remains blocked by review policy.
6. Obtain the required approval, ensure every required check passes, and prove the merge path becomes eligible.
7. Merge only the disposable validation PR if a successful-path proof is required; never use this verification to merge Release 1 into `main`.
8. Prove force-push and deletion protection using the disposable protected branch and ordinary non-bypass identity.
9. Confirm through the active ruleset view/API that identical policy targets `main` and `release/release-1-integration-go-live-readiness`.
10. Remove the disposable branch after evidence capture if permitted by the validation policy, without weakening the production branch targets.

If the organization requires proof on the exact release branch itself, use only a method approved by the repository administrator that cannot silently mutate the branch if protection was misconfigured.

## Evidence package required by `release-promotion-policy-evidence-contract.mjs`

Final accepted evidence must include:

- Exact final Release Candidate SHA and Release Candidate evidence reference.
- Protection/ruleset evidence for both `main` and the canonical release branch.
- Active policy snapshot/reference.
- PR-required/direct-push-denied policy.
- Minimum approvals >= 1.
- Stale approvals dismissed.
- Conversation resolution required.
- Force pushes and deletion disabled.
- Explicit bypass policy.
- Every mandatory check PASS on the exact candidate.
- Independent `CodeQL` PASS.
- Zero unresolved Critical/High security findings.
- #124 CLOSED or formally accepted with authority/residual-risk/review evidence.
- Verification proof for direct push denial, failing-check merge blocking, approval enforcement, force-push denial, deletion denial and successful approved PR path.
- Final Release Authority approval.

The committed example `ops/release-1/promotion-policy-evidence.example.json` is deliberately `BLOCKED` and non-approved. The CI workflow validates only the schema and fail-closed behavior; its generated metadata explicitly states `repositoryProtectionApplied=false` and `productionPromotionAuthorized=false`.

## Acceptance / closure rule for #84

Close #84 only after all of the following are true:

- GitHub visibly reports effective protection/ruleset enforcement for both target branches.
- Mandatory check configuration includes the independent `CodeQL` result and the exact required CI/security/recovery/interoperability/evidence contexts.
- #124 no longer represents an unresolved Critical/High security release blocker.
- Non-destructive enforcement tests are captured and accepted.
- The final evidence JSON validates with:

```bash
node .ci/release-promotion-policy-evidence-contract.mjs --validate <accepted-evidence.json>
```

- Release Authority accepts the repository-governance evidence.

Passing `Release 1 Promotion Policy Evidence Contract` by itself does not close #84; that workflow proves the contract is fail-closed, not that an administrator has applied repository protection.

## GitHub reference documentation

- Rules available for repository rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- Creating repository rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
- Managing branch-protection rules: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule
- Troubleshooting required status checks: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks
