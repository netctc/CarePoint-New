# Transport Phase 13 — Executive KPI Dashboard, Trend Comparison & Report Scheduling Contracts

Branch: `feature/transport-executive-kpi-phase13-20260930`

## Objective

Phase 13 adds executive transport reporting on top of Phase 11/12 without creating automated provider rankings or pretending that a background report-delivery worker already exists.

It provides:

- executive KPI comparison against the immediately preceding equal period
- aligned trend buckets
- descriptive KPI deltas
- persisted management-report schedule definitions
- next-run calculation for Daily / Weekly / Monthly schedules
- enable/disable schedule controls
- explicit external-scheduler execution contract
- audit evidence for KPI reads, schedule administration and recorded external runs

## Executive KPI API

`GET /admin/transport/executive-kpis?windowDays=30`

Permission:

`TRANSPORT_OPERATE`

Allowed `windowDays`:

- 7
- any bounded integer through 180

The comparison method is:

`EQUAL_PREVIOUS_PERIOD`

Example for a 30-day window:

- current: previous 30 days through now
- previous: the 30 days immediately before the current period

No seasonality adjustment, predictive ML or subjective rating is applied.

## KPI set

Current and previous periods include:

- request count
- completed count
- cancelled count
- completion rate
- cancellation rate
- Ground request count
- Air request count
- assignment SLA compliance
- resource-readiness SLA compliance
- departure SLA compliance
- requests with any SLA breach
- SLA-breach rate
- requests with critical incidents
- requests with active escalations

The API returns descriptive `current - previous` deltas.

A positive or negative delta is **not** labeled as good/bad, improved/worsened or best/worst.

Response metadata explicitly states:

- `automatedRating: false`
- `providerRanking: false`
- `machineLearning: false`

## Trend comparison

Trend buckets align the same relative part of the current and previous periods.

- windows <= 31 days: daily buckets
- windows > 31 days: 7-day buckets

Each aligned bucket includes:

- requests
- completed requests
- requests with an SLA breach

This is historical comparison only.

## Privacy boundary

The executive KPI endpoint selects operational timing/status fields only.

It does not return:

- patient identity
- patient contact
- pickup/destination addresses
- coordinates

Response metadata states:

- `patientIdentityIncluded: false`
- `patientLocationIncluded: false`

## Report scheduling persistence

Phase 13 adds:

`TransportManagementReportSchedule`

Fields include:

- name
- cadence
- weekday
- dayOfMonth
- hourUtc
- minuteUtc
- report window
- mode filter
- SLA filter
- optional providerId
- enabled
- nextRunAt
- lastRunAt
- deliveryMode
- creator/updater account IDs
- timestamps

Indexes:

- enabled + nextRunAt
- cadence + enabled
- providerId

## Schedule API

### Read schedules

`GET /admin/transport/report-schedules`

### Create schedule

`POST /admin/transport/report-schedules`

### Update / enable / disable

`PATCH /admin/transport/report-schedules/:scheduleId`

### Record externally executed run

`POST /admin/transport/report-schedules/:scheduleId/mark-run`

The last endpoint records:

- `lastRunAt`
- newly calculated `nextRunAt`

It does **not** generate or deliver a report.

Response and audit evidence explicitly say:

- `reportDeliveryPerformed: false`
- `automaticDeliveryAvailable: false`
- `executionMode: EXTERNAL_SCHEDULER_REQUIRED`

## Cadence rules

### Daily

UTC hour/minute.

If today's scheduled UTC time has passed, next run is tomorrow.

### Weekly

- weekday 0–6
- UTC hour/minute

If the current week's slot has passed, next run is the following week.

### Monthly

- day 1–28 only
- UTC hour/minute

The 1–28 bound avoids invalid dates across different calendar months.

## Report filters stored in schedule

- windowDays: 7–365
- mode: ALL / GROUND / AIR
- SLA: ALL / BREACHED / COMPLIANT / PENDING
- optional providerId

Phase 13 stores schedule policy only. The Phase 12 management-report endpoint remains the report-data source.

## Why delivery is external

At Phase 13 implementation time, CarePoint does not have an existing reusable cron/report-delivery worker inside the API.

Phase 13 therefore does not create a hidden scheduler or claim automatic delivery.

The persisted schedule contract is ready for a later scheduler/worker to:

1. query enabled due schedules
2. call the Phase 12 report generator
3. deliver through an approved channel
4. record the run

Automatic email/report delivery is **not active** in Phase 13.

## Admin UI

New component:

`TransportExecutiveKpiPanel`

It appears before the Phase 12 Command Center.

Features:

- 7 / 30 / 60 / 90 / 180-day comparison selector
- executive KPI cards with raw deltas
- aligned trend table
- schedule creation form
- Daily / Weekly / Monthly cadence
- UTC timing
- report window/mode/SLA filters
- enable/disable
- explicit "Record external run" action

The UI repeatedly states that schedule persistence does not mean automatic report delivery.

## Audit

Actions:

- `ADMIN_TRANSPORT_EXECUTIVE_KPI_READ`
- `ADMIN_TRANSPORT_REPORT_SCHEDULES_READ`
- `ADMIN_TRANSPORT_REPORT_SCHEDULE_CREATED`
- `ADMIN_TRANSPORT_REPORT_SCHEDULE_UPDATED`
- `ADMIN_TRANSPORT_REPORT_SCHEDULE_RUN_RECORDED`

Audit metadata does not contain patient identity/location.

## Database

New Prisma fragment:

`v2_transport_management_report_schedule.prisma`

Migration:

`20260930230000_v2_transport_management_report_schedule`

## Environment

No new environment variables are required.

No `.env` file is added or modified.

Phase 13 reuses existing transport SLA variables:

- `TRANSPORT_ASSIGNMENT_SLA_MINUTES`
- `TRANSPORT_RESOURCE_READY_SLA_MINUTES`
- `TRANSPORT_DEPARTURE_GRACE_MINUTES`

## Validation

The API test chain includes:

`npm run v2:transport-phase13`

The contract verifies:

- Prisma model + migration
- executive endpoint authorization
- current/previous equal-period semantics
- KPI/delta fields
- no automated rating/ranking/ML
- bounded schedule fields
- Daily/Weekly/Monthly next-run logic
- explicit external-scheduler boundary
- no report-delivery claim
- no patient/location projection
- no transport lifecycle/provider assignment mutation
- bounded Admin proxy forwarding
- Admin panel wiring
- no committed `.env`
