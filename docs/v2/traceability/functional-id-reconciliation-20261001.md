# V2 Functional Traceability Reconciliation — 2026-10-01

This evidence update reconciles the frozen V2 canonical functional-ID authority with current GitHub PR state and verified clean-integration replacements.

## Result

- MERGED_TO_MAIN: 119
- PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED: 0
- CLOSED_UNMERGED_NEEDS_RECONCILIATION: 0
- UNCLAIMED_OR_NOT_RECONCILED: 111
- Total canonical IDs: 230

## Verified historical replacements

The following stale/combined PR paths have verified merged replacements:

- #236 -> #233 + #235 (split Other Provider workspace/forms/workflow evidence)
- #271 -> #445 (signed medication reconciliation)
- #274 -> #448 (allergy reconciliation)
- #275 -> #449 (structured problem list)
- #279 -> #424 (contextual glucose observations)
- #281 -> #320 (longitudinal laboratory series)
- #283 -> #425 (Doctor Mobile contextual glucose trends)

## Historical #228 reconciliation

PR #228 was a closed-unmerged stacked aggregate. Its canonical responsibilities are no longer needed as active evidence because the original merged parent #227 explicitly claims the remaining ten clinical-profile foundation IDs, while the snapshot/specialized clinical responsibilities are separately evidenced by merged PRs such as #230, #445, #448 and #449.

PR #463 later imported the missing Clinical Facts A6 capability selectively into the promoted V2 line, but this reconciliation deliberately does **not** use #463 to inflate canonical claims that are already explicitly supported by #227.

Therefore #228 remains in the evidence ledger with zero active canonical references rather than being treated as a merged implementation.

## Interpretation

MERGED_TO_MAIN means every PR currently referenced by that canonical ID has merged evidence in the reconciliation ledger.

UNCLAIMED_OR_NOT_RECONCILED remains unchanged for IDs without sufficient PR evidence.

No canonical ID, domain, or legacy alias was invented or removed. PR references are corrected only when merged GitHub evidence explicitly supports the canonical responsibility.
