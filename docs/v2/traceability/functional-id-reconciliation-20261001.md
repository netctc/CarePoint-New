# V2 Functional Traceability Reconciliation — 2026-10-01

This evidence update reconciles the frozen V2 canonical functional-ID authority with current GitHub PR state and verified clean-integration replacements.

## Result

- MERGED_TO_MAIN: 109
- PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED: 10
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

The canonical authority uses the merged replacement PRs. Historical PRs remain in the evidence ledger via `superseded_by_pr`.

## Remaining partial history

The unresolved partial rows are intentionally retained because their closed-unmerged #228 ancestry has not yet been mapped to an explicit merged replacement for every canonical responsibility:

- PAT-086 (#227;#228)
- PAT-087 (#227;#228)
- PAT-088 (#227;#228)
- PAT-091 (#227;#228)
- PAT-100 (#227;#228)
- DOC-063 (#227;#228)
- BE-002 (#227;#228)
- BE-003 (#227;#228)
- BE-004 (#227;#228)
- BE-007 (#227;#228)

## Interpretation

MERGED_TO_MAIN means every PR currently referenced by that canonical ID has merged evidence in the reconciliation ledger.

PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED means the canonical ID still references a mixture of merged and closed-unmerged PR history. It is intentionally not treated as complete until the supersession relationship is verified.

CLOSED_UNMERGED_NEEDS_RECONCILIATION means all PR evidence currently attached to the ID is closed without merge.

UNCLAIMED_OR_NOT_RECONCILED remains unchanged for IDs without sufficient PR evidence.

No canonical ID, domain, or legacy alias was invented or removed. PR references are corrected only when a clean merged replacement is verified from GitHub history.
