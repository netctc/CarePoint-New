# V2 Functional Traceability Reconciliation — 2026-10-01

This evidence update reconciles the frozen V2 canonical functional-ID authority with current GitHub PR state.

## Result

- MERGED_TO_MAIN: 84
- PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED: 34
- CLOSED_UNMERGED_NEEDS_RECONCILIATION: 1
- UNCLAIMED_OR_NOT_RECONCILED: 111
- Total canonical IDs: 230

## Interpretation

MERGED_TO_MAIN means every PR currently referenced by that canonical ID is merged and the V2 promotion is already present on main.

PARTIAL_PR_HISTORY_RECONCILIATION_REQUIRED means the canonical ID references a mixture of merged and closed-unmerged PR history. It is intentionally not treated as complete until the supersession relationship is verified.

CLOSED_UNMERGED_NEEDS_RECONCILIATION means all PR evidence currently attached to the ID is closed without merge.

UNCLAIMED_OR_NOT_RECONCILED remains unchanged for IDs without PR evidence.

No canonical ID, domain, legacy alias, or PR reference was invented or removed by this reconciliation.
