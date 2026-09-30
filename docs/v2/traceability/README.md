# CarePoint V2 functional ID authority

Status: **FROZEN v1**  
Freeze date: **2026-09-20**  
Canonical source: `CarePoint_New_Inventario_Aplicaciones_Paginas_Funcionalidades_V2_2026-09-18.xlsx`  
Canonical proposed-function total: **230**

This directory is the single engineering authority for CarePoint V2 functional IDs used by issues, pull requests, release evidence and completion reporting.

## Canonical ranges

| Domain | Canonical proposed IDs | Count |
| --- | --- | ---: |
| Admin | `ADM-071..ADM-112` | 42 |
| Patient Mobile | `PAT-083..PAT-140` | 58 |
| Doctor Mobile | `DOC-053..DOC-090` | 38 |
| Other Provider Mobile | `PRV-057..PRV-092` | 36 |
| Backend | `BE-001..BE-056` | 56 |
| **Total** |  | **230** |

`functional-id-authority-v1.csv` enumerates every canonical proposed ID exactly once. A row being claimed by a PR means only that the PR declares implementation evidence for that canonical requirement; it does **not** by itself mean the requirement is merged, accepted or production-ready.

## Historical preliminary IDs

A preliminary 2026-09-18 functional draft restarted several application namespaces at `PAT-001`, `DOC-001`, etc. Those raw IDs collide with already implemented baseline functions in the consolidated inventory. They are therefore **not valid canonical V2 proposed IDs**.

Historical references are preserved only as namespace-qualified aliases, for example:

- `PRELIM-2026-09-18:PAT-001` -> canonical `PAT-083` for the Patient health summary.
- `PRELIM-2026-09-18:DOC-018` -> canonical `DOC-078` for doctor referral creation.
- `PRELIM-2026-09-18:BE-038` -> canonical `BE-033` for the referral service. Canonical `BE-038` is the follow-up service, so numeric equality would be incorrect.
- `PRELIM-2026-09-18:BE-050` described a correction/reconciliation workflow. Canonical `BE-050` is V2 PHI encryption. The preliminary ID therefore has no exact canonical target and must not claim canonical `BE-050`.

The complete set of currently observed historical aliases is recorded in `legacy-id-aliases-v1.csv`.

## Freeze rules

1. **Canonical identity is immutable.** After v1, an existing canonical ID must not be reassigned to a different semantic requirement.
2. **Numeric equality is not semantic equality.** This is especially important for `BE-*` IDs because the preliminary and consolidated inventories reused numbers for different meanings.
3. **New issues and PRs must use canonical IDs.** A historical alias may be included only as supplementary traceability, always with its namespace prefix.
4. **Existing PR history is preserved.** Do not rewrite or erase earlier PR descriptions merely to hide ID drift. Add or update canonical traceability while keeping the historical alias visible where useful.
5. **One-to-many mappings stay explicit.** If one preliminary item was split into multiple canonical requirements, use `SPLIT_PARTIAL`; do not manufacture a one-to-one mapping.
6. **Extensions stay extensions.** `BASE_EXTENSION` or `NO_EXACT_CANONICAL_MATCH` work is not counted as completion of a canonical proposed row unless a canonical target is explicitly reconciled.
7. **No silent inventory expansion.** A feature with no exact canonical row requires an explicit inventory-amendment decision before it can become a new canonical requirement.
8. **Completion is evidence-based.** A canonical row may be considered complete only after implementation, acceptance criteria and merged-SHA validation are reconciled. PR-body claims alone are insufficient.
9. **Security semantics are independent of traceability.** This authority does not weaken authorization, consent, audit, encryption, PHI minimization or any release/security gate.
10. **Source language remains English** for repository engineering artifacts, consistent with the V2 governance workspace.

## Traceability states

- `CLAIMED_BY_ACTIVE_PR`: one or more current V2 PRs claim the canonical ID.
- `UNCLAIMED_OR_NOT_RECONCILED`: no current PR claim has been reconciled yet. This does not prove the requirement is unimplemented.

Legacy mapping types:

- `EXACT`: semantic requirement maps one-to-one to a canonical row.
- `SPLIT_PARTIAL`: the preliminary requirement spans more than one canonical row and/or contains additional behavior.
- `PARTIAL`: only part of the preliminary semantics is covered by the canonical target.
- `BASE_EXTENSION`: work extends an implemented baseline capability or canonical backend service without a dedicated canonical proposed application row.
- `NO_EXACT_CANONICAL_MATCH`: no safe one-to-one target exists in the frozen 230-row authority.

## Change control

Changes to the v1 files require a reviewed PR against `v2/development`. Corrections may add evidence, PR references or qualified aliases, but must not mutate the meaning of an existing canonical ID. Any future expansion of the functional inventory must use a new authority version and explicit migration notes rather than silently modifying v1.