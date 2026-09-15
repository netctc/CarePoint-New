# Slice 10.1 — FHIR Clinical Encounters and Vital Observations

## Objective

Slice 10.1 extends the read-only CarePoint FHIR R4 facade introduced in Slice 10 with authorized clinical encounter interoperability.

The implementation deliberately reuses the existing clinical authorization service rather than introducing a second access-control path. FHIR reads therefore inherit the same patient-self, authorship, treatment-relationship, and explicit-consent rules that protect decrypted clinical records inside CarePoint.

## FHIR endpoints

All routes are served below `/api/v1/fhir/R4` and return `application/fhir+json`.

| Endpoint | Protection | Behavior |
| --- | --- | --- |
| `GET /metadata` | Public | FHIR R4 CapabilityStatement advertising Patient, Practitioner, Appointment, Encounter, and Observation support. |
| `GET /Encounter/:appointmentId` | Bearer session | Returns an Encounter only after clinical documentation exists and the caller passes the clinical access policy. |
| `GET /Observation?encounter=Encounter/:appointmentId` | Bearer session | Returns a searchset Bundle containing vital-sign Observations from the latest authorized clinical record revision. |

The Observation search also accepts the raw CarePoint appointment identifier for compatibility with the internal facade, although the canonical returned reference is `Encounter/{appointmentId}`.

## Authorization model

`FhirService` delegates clinical authorization to `ClinicalService.getEncounter()` before resolving patient identity or mapping clinical data.

Permitted access bases are therefore unchanged from Slice 3.1:

- `PATIENT_SELF`
- `OWN_AUTHORSHIP`
- `TREATMENT_RELATIONSHIP`
- `PATIENT_CONSENT`

A caller without a valid access basis receives a FHIR `OperationOutcome` with HTTP 403. The FHIR layer does not bypass or broaden clinical-record access.

## Encounter mapping

The CarePoint appointment identifier is the stable FHIR Encounter identifier for this facade.

Key mappings:

- CarePoint appointment -> `Encounter.id`
- active documented encounter -> `Encounter.status = in-progress`
- finalized CarePoint encounter -> `Encounter.status = finished`
- patient profile -> `Encounter.subject = Patient/{patientId}`
- assigned provider -> `Encounter.participant.individual = Practitioner/{providerId}`
- source appointment -> `Encounter.appointment = Appointment/{appointmentId}`
- appointment modality -> CarePoint modality coding in `Encounter.type`
- service -> `Encounter.serviceType`
- scheduled start/end -> `Encounter.period`

The patient identifier is resolved from the appointment only after `ClinicalService` has authorized the read. It is not inferred from, or injected into, the encrypted clinical payload.

## Vital Observation mapping

The latest clinical record revision is decrypted through the existing clinical envelope service. Supported vitals are mapped to separate FHIR Observation resources:

- body temperature
- heart rate
- systolic blood pressure
- diastolic blood pressure
- respiratory rate
- oxygen saturation
- body weight
- body height

Each resource includes:

- `status = preliminary` while the encounter is open
- `status = final` after clinical finalization
- `category = vital-signs`
- CarePoint vital code and display text
- `subject = Patient/{patientId}`
- `encounter = Encounter/{appointmentId}`
- `effectiveDateTime` from the clinical record authored time
- UCUM-backed `valueQuantity` when the value is numeric

## Audit trail

FHIR clinical access adds explicit interoperability audit events in addition to the underlying clinical-record read audit:

- `FHIR_ENCOUNTER_READ`
- `FHIR_OBSERVATION_SEARCH`

The audit metadata includes the clinical authorization basis and FHIR version. This intentional double-layer audit makes both PHI access and the interoperability channel independently traceable.

## Error behavior

FHIR HTTP exceptions are represented as `OperationOutcome` resources.

Important cases covered by the acceptance flow:

- undocumented encounter -> HTTP 404
- unauthorized patient/provider -> HTTP 403
- Observation search without `encounter` -> HTTP 400
- unknown resource -> HTTP 404

## Acceptance coverage

`services/api/scripts/slice10-smoke.mjs` now validates the original Slice 10 facade plus Slice 10.1 clinical behavior:

1. CapabilityStatement advertises the five implemented resource types.
2. Patient and Practitioner identity mappings remain protected as designed.
3. Appointment read/search authorization remains intact.
4. An Encounter is unavailable before clinical documentation exists.
5. The assigned provider writes an encrypted clinical record with four vital signs.
6. The patient and assigned provider can read the FHIR Encounter.
7. A different patient is denied Encounter access.
8. Encounter patient, provider, and Appointment references are exact and do not substitute the appointment id for the patient id.
9. Observation search returns four vital-sign resources linked to the correct Patient and Encounter.
10. A different patient is denied Observation access.
11. Missing `encounter` produces a FHIR 400 OperationOutcome.
12. After clinical finalization the Encounter becomes `finished` and its Observations become `final`.

## Non-goals for Slice 10.1

This slice does not yet implement:

- FHIR write operations
- external SMART-on-FHIR/OAuth authorization
- Condition, MedicationRequest, DiagnosticReport, DocumentReference, Claim, or ExplanationOfBenefit mappings
- terminology-server validation
- profile-specific national implementation guides
- bulk export or subscriptions

Those capabilities should be introduced in later interoperability slices without weakening the clinical authorization and audit controls established here.
