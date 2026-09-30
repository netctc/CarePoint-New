# Slice 10 - FHIR R4 Interoperability Foundation

## Purpose

Slice 10 introduces CarePoint's first post-MVP interoperability boundary as a read-only HL7 FHIR facade.

CarePoint remains the system of record. The FHIR layer maps authorized CarePoint data into exchange resources; it does not create a parallel patient, provider, appointment or authorization domain.

## Why FHIR R4

The current HL7 FHIR release is R5 (5.0.0), while FHIR R4 4.0.1 remains a permanently published specification and an important compatibility baseline across deployed healthcare ecosystems.

CarePoint therefore exposes this first facade under an explicit versioned path:

```text
/api/v1/fhir/R4
```

The mapping code is isolated in the FHIR module so later R5 or national implementation-guide adapters do not require changing CarePoint's canonical domain identifiers.

## Supported resources

### CapabilityStatement

```text
GET /api/v1/fhir/R4/metadata
```

Public endpoint describing the currently implemented read-only capabilities.

Reported FHIR version:

```text
4.0.1
```

### Patient

```text
GET /api/v1/fhir/R4/Patient/:patientId
```

Current authorization boundary:

- Patient may read their own FHIR Patient resource;
- existing IAM account operators may read it when their CarePoint permission allows account administration;
- Doctor and Other Provider accounts do not receive direct Patient access through this initial FHIR endpoint.

The last restriction is intentional. Provider clinical access will be added only by reusing the existing CarePoint treatment/consent authorization model rather than bypassing it through interoperability routes.

Current Patient mapping includes:

- resource id;
- active state;
- official name;
- authenticated patient's email;
- phone when present.

### Practitioner

```text
GET /api/v1/fhir/R4/Practitioner/:providerId
```

Only active CarePoint Providers can be represented.

The public representation is deliberately minimal:

- provider resource id;
- active state;
- display name.

Account email, password material, private credentials and license documents/numbers are not exposed by this facade.

Both CarePoint Doctor and Other Provider entities can be represented as FHIR Practitioner resources. CarePoint's internal Doctor/Other Provider domain separation remains unchanged.

### Appointment read

```text
GET /api/v1/fhir/R4/Appointment/:appointmentId
```

Readable by:

- the Patient participant;
- the assigned Provider account;
- an existing CarePoint role with `APPOINTMENT_OPERATE`.

The mapping includes:

- FHIR appointment status;
- service text;
- CarePoint modality as a coded `appointmentType` using `urn:carepoint:appointment-modality`;
- UTC start/end instants;
- Patient participant reference;
- Practitioner participant reference;
- cancellation reason when present.

CarePoint to FHIR status mapping:

| CarePoint | FHIR R4 Appointment |
| --- | --- |
| `REQUESTED` | `pending` |
| `CONFIRMED` | `booked` |
| `CANCELLED` | `cancelled` |
| `COMPLETED` | `fulfilled` |
| `NO_SHOW` | `noshow` |

### Appointment search

```text
GET /api/v1/fhir/R4/Appointment?patient=Patient/:patientId
GET /api/v1/fhir/R4/Appointment?patient=:patientId
```

Returns a FHIR `Bundle` with:

```text
type = searchset
```

The initial search boundary is Patient self or existing IAM account operators. Cross-patient searches are denied.

## FHIR errors

Protected facade endpoints convert CarePoint HTTP errors into FHIR `OperationOutcome` resources with `application/fhir+json` content type.

Examples include:

- invalid search arguments;
- authorization denial;
- resource not found;
- conflict/processing failures.

No request body, bearer credential or PHI payload is added to error diagnostics by this module.

## Authorization model

FHIR does not replace CarePoint authorization.

The facade derives identity from the authenticated CarePoint principal and never trusts request-body Patient or Provider identities.

Protected reads are audited with dedicated FHIR actions, including denied attempts.

This preserves the existing principles:

- global Patient identity;
- independent Provider entities;
- Doctor and Other Provider domain separation;
- consent/treatment/legal basis before provider clinical access;
- Emergency Ambulance remains a separate dispatch workflow.

## Acceptance workflow

`.github/workflows/slice10-fhir.yml` provides an isolated Slice 10 gate with PostgreSQL and Redis.

The smoke test creates its own temporary fixtures and verifies:

1. public FHIR CapabilityStatement;
2. `application/fhir+json` response type;
3. Patient self read;
4. cross-patient Patient denial with `OperationOutcome`;
5. limited public Practitioner representation;
6. Patient participant Appointment read;
7. assigned Provider Appointment read;
8. cross-patient Appointment denial;
9. `Appointment?patient=` search returning a FHIR `searchset` Bundle;
10. cross-patient search denial.

The ordinary CarePoint CI workflow continues to run independently to detect regressions across Slices 1-9 and all Flutter applications.

## Explicit non-goals of this foundation

Slice 10 does not yet claim:

- a full general-purpose FHIR server;
- FHIR create/update/delete operations;
- SMART on FHIR authorization;
- R5 support;
- national implementation-guide conformance;
- NPHIES certification or transaction support;
- terminology-server integration;
- `$everything`;
- bulk-data export;
- provider FHIR access to clinical PHI before consent/treatment authorization is wired to this facade;
- deep mapping of encounters, observations, conditions, prescriptions, laboratory results, diagnostic reports or clinical documents.

Those capabilities should be introduced incrementally with profile validation and authorization tests rather than by exposing encrypted CarePoint payloads generically.

## Next interoperability increment

The recommended follow-on is to map released/authorized clinical data into a narrow set of FHIR R4 resources:

- `Encounter`;
- `Observation` for released laboratory results;
- `MedicationRequest` for prescriptions;
- `ServiceRequest` for laboratory orders;
- `DiagnosticReport`;
- `DocumentReference`.

Provider-side access must reuse CarePoint's existing clinical access-basis checks before any of those resources are returned.
