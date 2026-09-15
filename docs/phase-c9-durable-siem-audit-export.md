# Phase C9 — Durable SIEM Audit Export

## 1. Objective

Phase C9 closes the production SIEM integration gap without making an external SIEM a synchronous dependency of CarePoint business requests.

The design keeps PostgreSQL `AuditEvent` as the canonical security/audit record and adds a durable one-to-one export work item (`SiemAuditDelivery`) created in the same database transaction. A leased worker then exports a PHI-neutral representation to the configured SIEM over HTTPS with bounded timeout, retry/backoff and idempotency semantics.

Core invariant:

```text
business/security action
        |
        v
DatabaseAuditService.write()
        |
        +-- PostgreSQL transaction ---------------------------+
        |                                                     |
        |  AuditEvent + matching SiemAuditDelivery(PENDING)   |
        +-----------------------------------------------------+
        |
        v
request may complete

SIEM worker (asynchronous)
        |
        +--> claim lease --> build PHI-neutral payload
                         --> HTTPS SIEM export
                         --> SENT
                         --> or retry/backoff
                         --> or FAILED after bounded attempts
```

A production audit record can therefore not be committed through `DatabaseAuditService` without its SIEM delivery work item also being committed.

## 2. Scope

C9 includes:

- PostgreSQL-backed SIEM delivery state;
- transactionally coupled audit/outbox creation;
- atomic claim/lease semantics for multiple API instances;
- bounded retry with exponential backoff;
- terminal failure state after a configurable attempt budget;
- PHI-neutral security event presentation aligned with Admin B7;
- HTTPS-only production gateway configuration;
- Bearer authentication supplied only through runtime configuration;
- pseudonymous idempotency keys;
- fail-closed production preflight before Nest application creation;
- deterministic acceptance coverage;
- operational configuration and runbook.

C9 does **not** provision a particular SIEM vendor, create vendor-side indexes/rules, or define SOC escalation procedures. Those remain deployment/operations responsibilities.

## 3. Durable data model

### `AuditEvent`

`AuditEvent` remains the source of truth and keeps the complete internal audit context required by CarePoint.

C9 adds:

```text
AuditEvent 1 --- 0..1 SiemAuditDelivery
```

### `SiemAuditDelivery`

Fields:

| Field | Purpose |
| --- | --- |
| `auditEventId` | Unique link to the canonical `AuditEvent` |
| `status` | `PENDING`, `SENT` or `FAILED` |
| `attemptCount` | Number of claimed export attempts |
| `availableAt` | Earliest time the item may be retried |
| `leaseOwner` | Worker instance currently owning the item |
| `leaseUntil` | Lease expiry/recovery boundary |
| `exportedAt` | Successful terminal export timestamp |
| `errorCode` | Sanitized error classification only |
| `createdAt` / `updatedAt` | Operational lifecycle timestamps |

Indexes on `(status, availableAt)` and `leaseUntil` support efficient recovery and retry scans.

Migration:

```text
20260908212000_durable_siem_audit_outbox
```

## 4. Transactional audit/outbox coupling

`DatabaseAuditService.write()` now wraps canonical audit persistence and SIEM work-item creation in one Prisma transaction whenever SIEM forwarding is active.

Production always enables this path. Development/test may leave `SIEM_EXPORT_ENABLED=false` to avoid altering fixtures and local databases that do not need SIEM delivery.

If creation of the `SiemAuditDelivery` row fails, the `AuditEvent` transaction also fails. This preserves the security property that a production audit cannot silently bypass forwarding durability.

After commit, the in-process worker is woken so delivery can start immediately; periodic polling remains the recovery path if a wake signal is missed or the process restarts.

## 5. Claim, lease and retry semantics

The worker uses PostgreSQL as the durable source of truth.

### Claim

A work item is eligible when:

- `status = PENDING`;
- `availableAt <= now`;
- no active lease exists, or the previous lease has expired.

The claim is performed with a conditional `updateMany`, which atomically:

- records `leaseOwner`;
- records `leaseUntil`;
- increments `attemptCount`.

Only one worker may successfully claim the same item at a time.

### Retry

A failed attempt clears the lease, retains the item as `PENDING`, records a sanitized `errorCode`, and sets a future `availableAt` using exponential backoff.

Backoff is capped at 15 minutes.

### Terminal failure

When the configured attempt budget is exhausted, the item becomes `FAILED`. It is not silently deleted.

A `FAILED` row is an operational/SOC signal that must be investigated and, after correcting the cause, explicitly redriven by an approved operational procedure.

## 6. At-least-once delivery and idempotency

C9 provides at-least-once export semantics.

A SIEM may accept a request immediately before CarePoint loses connectivity or fails to persist `SENT`. After the lease expires, CarePoint can send the same event again.

To make this safe, the gateway sends the same PHI-neutral stable event reference as:

```text
Idempotency-Key: EVT-<12 hex characters>
X-CarePoint-Event-Ref: EVT-<12 hex characters>
```

The SIEM integration should deduplicate on this value where the vendor supports idempotency/deduplication.

No raw `AuditEvent.id` is used as the external idempotency key.

## 7. PHI-neutral export contract

C9 intentionally does **not** serialize the database `AuditEvent` object directly.

The payload schema is:

```json
{
  "schemaVersion": 1,
  "source": "carepoint-api",
  "eventRef": "EVT-...",
  "action": "AUTHORIZATION_DENIED",
  "result": "DENIED",
  "severity": "MEDIUM",
  "actorRef": "ADMIN-...",
  "actorRole": "ADMIN",
  "objectType": "API_ROUTE",
  "targetRef": "API-...",
  "purpose": "SYSTEM_ACCESS",
  "indicators": {
    "method": "GET"
  },
  "occurredAt": "2026-09-09T00:00:00.000Z"
}
```

### Exported identifiers

Identifiers are pseudonymized with the same SHA-256 namespace convention used by Admin B7:

```text
carepoint-admin-security:<raw-id>
```

Only the first 12 uppercase hexadecimal characters are exposed as the external reference suffix.

### Metadata whitelist

The original `AuditEvent.metadata` object is never exported.

Only these indicators may be copied when they have the expected type/value:

- `lockoutApplied` (boolean)
- `concurrentReplay` (boolean)
- `replaced` (boolean)
- `mfa` (boolean)
- `role` (known CarePoint role only)
- `method` (`GET`, `POST`, `PUT`, `PATCH`, `DELETE` only)

### Explicitly excluded

The SIEM event body excludes:

- raw account/user identifiers;
- raw object identifiers;
- patient identifiers;
- clinical record/document/message identifiers unless represented by a non-reversible supported reference;
- clinical text or message bodies;
- arbitrary audit metadata;
- raw IP addresses;
- raw User-Agent values;
- access/refresh tokens;
- authorization headers;
- API keys;
- request bodies and query strings;
- provider response bodies.

Unknown object types receive no external target reference.

## 8. Severity mapping

C9 follows the same security semantics used by Admin B7:

| Condition | Severity |
| --- | --- |
| `ACCOUNT_SUSPENDED` | `CRITICAL` |
| replay signal with `concurrentReplay=true` | `CRITICAL` |
| replay signal | `HIGH` |
| failed login with lockout | `HIGH` |
| `DENIED` / `FAILED` audit result | `MEDIUM` |
| otherwise | `INFO` |

This keeps the SOC feed aligned with the existing Security Operations workspace.

## 9. HTTPS gateway hardening

Production requires:

```text
SIEM_EXPORT_ENABLED=true
SIEM_EXPORT_URL=https://...
SIEM_EXPORT_API_KEY=<runtime secret>
```

The gateway rejects in production:

- non-HTTPS URLs;
- loopback targets;
- URL-embedded credentials;
- URL fragments;
- missing/invalid API keys;
- invalid timeout configuration.

Requests use:

- `POST`;
- `Content-Type: application/json`;
- `Authorization: Bearer <secret>`;
- stable pseudonymous idempotency headers;
- redirect mode `error`;
- a bounded abort timeout.

The gateway does not parse or persist the SIEM response body. HTTP failures are reduced to status-based error classes/codes.

## 10. Startup fail-closed gate

`assertProductionSiemReady()` executes before `NestFactory.create()`.

Production startup fails if:

- SIEM export is disabled;
- the SIEM endpoint is missing or insecure;
- the SIEM API key is missing/invalid;
- the SIEM worker is disabled;
- timeout/worker configuration is invalid;
- the worker lease does not provide sufficient margin over the HTTP timeout.

The preflight verifies configuration only. It deliberately does not require a successful network call to the SIEM at startup; transient SIEM/network outages are handled by the durable outbox and retry path rather than preventing the CarePoint API from recovering.

## 11. Environment reference

Development defaults:

```dotenv
SIEM_EXPORT_ENABLED=false
SIEM_EXPORT_URL=
SIEM_EXPORT_API_KEY=
SIEM_EXPORT_TIMEOUT_MS=10000
SIEM_WORKER_ENABLED=true
SIEM_WORKER_POLL_MS=1000
SIEM_WORKER_LEASE_SECONDS=60
SIEM_WORKER_BATCH_SIZE=50
SIEM_MAX_ATTEMPTS=10
SIEM_RETRY_BASE_SECONDS=5
```

Production example:

```dotenv
SIEM_EXPORT_ENABLED=true
SIEM_EXPORT_URL=https://private-siem-ingest.example.internal/v1/events
SIEM_EXPORT_API_KEY=<secret-manager-reference-at-runtime>
SIEM_EXPORT_TIMEOUT_MS=10000
SIEM_WORKER_ENABLED=true
SIEM_WORKER_POLL_MS=1000
SIEM_WORKER_LEASE_SECONDS=60
SIEM_WORKER_BATCH_SIZE=50
SIEM_MAX_ATTEMPTS=10
SIEM_RETRY_BASE_SECONDS=5
```

The real API key must be injected by the deployment secret manager and must never be committed.

The default 60-second lease exceeds the maximum accepted gateway timeout (30 seconds), preventing normal in-flight requests from being reclaimed by a second worker.

## 12. SIEM integration contract for operations

Before production cutover, the SIEM/SOC team should confirm:

1. the HTTPS ingestion endpoint is reachable from the CarePoint private network;
2. TLS validation succeeds with the deployed trust chain;
3. the API key has only ingest permissions;
4. the SIEM accepts the C9 JSON schema;
5. deduplication uses `eventRef` / `Idempotency-Key` where supported;
6. the SIEM indexes `action`, `result`, `severity`, `actorRef`, `objectType`, `purpose`, `indicators` and `occurredAt`;
7. no pipeline enrichment attempts to recover or append PHI from external systems without a separately approved data-flow design;
8. SOC alert rules exist for `CRITICAL` and selected `HIGH` events;
9. retention matches the applicable security/compliance policy;
10. access to SIEM security events is restricted and audited.

## 13. Operational monitoring

Recommended metrics/alerts:

- count of `SiemAuditDelivery` by status;
- oldest `PENDING.availableAt` age;
- `FAILED` row count;
- attempt-count distribution;
- export latency from `AuditEvent.occurredAt` to `exportedAt`;
- SIEM HTTP error-rate by status class;
- repeated lease expiry/recovery.

A growing pending queue should be treated as degraded security telemetry even when business APIs remain available.

## 14. Recovery and redrive

When `FAILED` rows exist:

1. identify the external/network/configuration cause without reading or exporting PHI;
2. correct SIEM connectivity/authentication/configuration;
3. confirm the production preflight passes;
4. use an approved administrative database procedure or future dedicated redrive command to reset selected rows from `FAILED` to `PENDING`, clear lease/error state and set `availableAt=now`;
5. confirm the worker exports the records;
6. verify SIEM deduplication prevents duplicate alert inflation;
7. record the incident/remediation in the operational change/audit process.

C9 intentionally does not expose a public HTTP redrive endpoint.

## 15. Deterministic acceptance test

C9 is chained into API `npm test`:

```bash
npm run c9:siem-audit-export
```

The acceptance test validates:

- production fail-closed configuration;
- HTTPS/loopback/credential checks;
- worker configuration bounds;
- PHI-neutral payload construction;
- stable pseudonymous references;
- metadata whitelist behavior;
- absence of raw IDs, IP, permissions and PHI markers;
- real local HTTP delivery in test mode;
- Bearer and idempotency headers;
- API key absence from the JSON body;
- successful worker terminal state;
- retry/backoff behavior;
- terminal failure after the attempt budget;
- provider error-text sanitization;
- transaction coupling in `DatabaseAuditService`;
- durable Prisma model/index presence;
- C9 preflight ordering before Nest application creation.

Expected marker:

```text
Phase C9 durable SIEM audit export acceptance passed
```

## 16. CI acceptance criteria

C9 is complete only when the exact final branch head passes:

- C2 canonical npm graph/hash unchanged;
- high-severity dependency audit with zero vulnerabilities;
- production build;
- C1 and C3–C9 acceptance chain;
- all Prisma migrations including `20260908212000_durable_siem_audit_outbox`;
- bootstrap and IAM persistence;
- Admin B1–B9;
- application Slice 2–9;
- Flutter shared/mobile tests and analyses;
- FHIR Slice 10.0–10.13.

As with previous phases, the temporary validation PR must be closed without merge after the stacked branch itself has been proven green.
