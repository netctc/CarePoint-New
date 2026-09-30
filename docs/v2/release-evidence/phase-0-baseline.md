# Phase 0 Baseline Evidence

- Baseline tag: `Inicio_V2`
- Source SHA: `604f522412c8da6668ee2df42ce58ec3994798c5`
- Evidence capture date: 2026-09-19
- GitHub Actions runs observed for this exact SHA: 31
- Successful runs: 30
- Failed runs: 1

| Workflow | Event | Conclusion | Run |
| --- | --- | --- | --- |
| Availability Journeys PostgreSQL | pull_request | **success** | [35290322262](https://github.com/netctc/CarePoint-New/actions/runs/35290322262) |
| CI | pull_request | **success** | [35290322250](https://github.com/netctc/CarePoint-New/actions/runs/35290322250) |
| Deployment Rehearsal Contract | pull_request | **success** | [35290322305](https://github.com/netctc/CarePoint-New/actions/runs/35290322305) |
| External Integration Acceptance Contract | pull_request | **success** | [35290322325](https://github.com/netctc/CarePoint-New/actions/runs/35290322325) |
| GCP Admin Cloud Run Deployment Contract | pull_request | **success** | [35290322287](https://github.com/netctc/CarePoint-New/actions/runs/35290322287) |
| GCP Artifact Registry Promotion | workflow_dispatch | **failure** | [35294144006](https://github.com/netctc/CarePoint-New/actions/runs/35294144006) |
| GCP Artifact Registry Promotion Contract | pull_request | **success** | [35290322295](https://github.com/netctc/CarePoint-New/actions/runs/35290322295) |
| GCP Cloud Run Deployment Contract | pull_request | **success** | [35290322248](https://github.com/netctc/CarePoint-New/actions/runs/35290322248) |
| GCP Cloud SQL PITR Rehearsal Contract | pull_request | **success** | [35290322360](https://github.com/netctc/CarePoint-New/actions/runs/35290322360) |
| GCP Cloud Storage Recovery Contract | pull_request | **success** | [35290322335](https://github.com/netctc/CarePoint-New/actions/runs/35290322335) |
| GCP Continuity Bundle Closure Contract | pull_request | **success** | [35290322334](https://github.com/netctc/CarePoint-New/actions/runs/35290322334) |
| GCP Final Acceptance Contract | pull_request | **success** | [35290322404](https://github.com/netctc/CarePoint-New/actions/runs/35290322404) |
| GCP Immutable Deployment Bundle Contract | pull_request | **success** | [35290322291](https://github.com/netctc/CarePoint-New/actions/runs/35290322291) |
| GCP Immutable RC Freeze Contract | pull_request | **success** | [35290322247](https://github.com/netctc/CarePoint-New/actions/runs/35290322247) |
| GCP Memorystore Failover Rehearsal Contract | pull_request | **success** | [35290322346](https://github.com/netctc/CarePoint-New/actions/runs/35290322346) |
| Mobile Native Compatibility | pull_request | **success** | [35290322395](https://github.com/netctc/CarePoint-New/actions/runs/35290322395) |
| Mobile Release Evidence Contract | pull_request | **success** | [35290322259](https://github.com/netctc/CarePoint-New/actions/runs/35290322259) |
| Patient Profile PostgreSQL | pull_request | **success** | [35290322251](https://github.com/netctc/CarePoint-New/actions/runs/35290322251) |
| Performance Harness Contract | pull_request | **success** | [35290322374](https://github.com/netctc/CarePoint-New/actions/runs/35290322374) |
| PostgreSQL Recovery | pull_request | **success** | [35290322254](https://github.com/netctc/CarePoint-New/actions/runs/35290322254) |
| Production Infrastructure Acceptance Contract | pull_request | **success** | [35290322363](https://github.com/netctc/CarePoint-New/actions/runs/35290322363) |
| Release 1 Container Compatibility | pull_request | **success** | [35290322356](https://github.com/netctc/CarePoint-New/actions/runs/35290322356) |
| Release 1 Immutable Containers | push | **success** | [35290318388](https://github.com/netctc/CarePoint-New/actions/runs/35290318388) |
| Release 1 Immutable Containers | pull_request | **success** | [35290322330](https://github.com/netctc/CarePoint-New/actions/runs/35290322330) |
| Release 1 Market Readiness Evidence Contract | pull_request | **success** | [35290322370](https://github.com/netctc/CarePoint-New/actions/runs/35290322370) |
| Release 1 Promotion Policy Evidence Contract | pull_request | **success** | [35290322280](https://github.com/netctc/CarePoint-New/actions/runs/35290322280) |
| Release 1 UAT Evidence Contract | pull_request | **success** | [35290322267](https://github.com/netctc/CarePoint-New/actions/runs/35290322267) |
| Release Candidate Evidence | pull_request | **success** | [35290322469](https://github.com/netctc/CarePoint-New/actions/runs/35290322469) |
| Resilience Rehearsal Contract | pull_request | **success** | [35290322350](https://github.com/netctc/CarePoint-New/actions/runs/35290322350) |
| Security Analysis | pull_request | **success** | [35290322339](https://github.com/netctc/CarePoint-New/actions/runs/35290322339) |
| Slice 10 FHIR | pull_request | **success** | [35290323385](https://github.com/netctc/CarePoint-New/actions/runs/35290323385) |

## Interpretation
Successful CI, mobile compatibility and security runs at the exact baseline SHA provide archived API/Admin/Flutter/security baseline evidence.

The failed **GCP Artifact Registry Promotion** dispatch is preserved as an explicit deployment/promotion exception; it is not represented as a successful test.

The Phase 0 bootstrap PR must run the repository pull-request checks again before merge into `v2/development`.
