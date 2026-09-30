# Slice 10.2 — FHIR Clinical Orders and Released Laboratory Results

## Objective

Slice 10.2 extends the CarePoint FHIR R4 read-only interoperability facade with authorized clinical orders and released laboratory results.

The interoperability layer remains an adapter over the existing CarePoint domain. It does not create a second prescription, laboratory, patient, provider, consent, or access-control model.

All protected reads reuse `OrdersService.getOrder()` before clinical payloads are mapped to FHIR resources. This preserves the same patient-self, authorship, treatment-relationship, and explicit-consent rules already enforced by the encrypted clinical-orders module.

## FHIR endpoints

All endpoints are below `/api/v1/fhir/R4` and return `application/fhir+json`.

| Endpoint | Protection | Behavior |
| --- | --- | --- |
| `GET /MedicationRequest/:orderId` | Bearer session | Maps an authorized CarePoint prescription order to FHIR `MedicationRequest`. |
| `GET /ServiceRequest/:orderId` | Bearer session | Maps an authorized CarePoint laboratory order to FHIR `ServiceRequest`. |
| `GET /Observation?based-on=ServiceRequest/:orderId` | Bearer session | Returns only laboratory observations that have completed the CarePoint validation and patient-release gate. |
| `GET /Observation?encounter=Encounter/:appointmentId` | Bearer session | Existing Slice 10.1 vital-sign search remains supported. |

`Observation` accepts exactly one clinical selector at a time. Supplying neither selector, or both `encounter` and `based-on`, returns a FHIR `OperationOutcome` with HTTP 400.

## Authorization model

FHIR order reads call `OrdersService.getOrder()` before mapping any decrypted clinical order data.

The existing access bases remain unchanged:

- `PATIENT_SELF`
- `OWN_AUTHORSHIP`
- `TREATMENT_RELATIONSHIP`
- `PATIENT_CONSENT`

An unrelated patient or provider therefore cannot use the FHIR facade to bypass the clinical-orders authorization boundary.

FHIR-specific audit events are recorded after the underlying authorization succeeds:

- `FHIR_MEDICATION_REQUEST_READ`
- `FHIR_SERVICE_REQUEST_READ`
- `FHIR_LAB_OBSERVATION_SEARCH`

The audit metadata records the CarePoint access basis and FHIR version.

## MedicationRequest mapping

CarePoint `PRESCRIPTION` orders are exposed as FHIR R4 `MedicationRequest` resources.

Key mappings:

- clinical order id -> `MedicationRequest.id`
- `SIGNED` -> `status = active`
- `CANCELLED` -> `status = cancelled`
- `FULFILLED` -> `status = completed`
- prescription -> `intent = order`
- medication name/code -> `medicationCodeableConcept`
- patient -> `subject = Patient/{patientId}`
- encounter -> `encounter = Encounter/{encounterRef}`
- ordering provider -> `requester = Practitioner/{providerId}`
- signed timestamp -> `authoredOn`
- dosage instruction -> `dosageInstruction.text`
- quantity/refills -> `dispenseRequest` when present

Recognized source coding systems are normalized to canonical FHIR-friendly URIs for LOINC, RxNorm, SNOMED CT, and ICD-10. Unknown local systems are represented under a CarePoint URN rather than being presented as a false standard terminology URI.

## ServiceRequest mapping

CarePoint `LABORATORY` orders are exposed as FHIR R4 `ServiceRequest` resources.

Key mappings:

- clinical order id -> `ServiceRequest.id`
- `SIGNED` -> `status = active`
- `CANCELLED` -> `status = revoked`
- `FULFILLED` -> `status = completed`
- laboratory request -> `intent = order`
- `ROUTINE` / `URGENT` -> FHIR priority
- requested tests -> `orderDetail`
- aggregate test description -> `code.text`
- patient -> `subject = Patient/{patientId}`
- encounter -> `encounter = Encounter/{encounterRef}`
- ordering provider -> `requester = Practitioner/{providerId}`
- signed timestamp -> `authoredOn`
- reason -> `reasonCode`
- collection/fasting instructions -> `patientInstruction`

The mapping deliberately avoids inventing FHIR `Specimen` resources where CarePoint currently stores only free-text specimen instructions.

## Laboratory Observation release gate

Laboratory PHI is not exposed merely because a result has been entered or validated.

FHIR laboratory `Observation` resources are returned only when the CarePoint laboratory result has reached:

```text
RELEASED
```

Before release, an authorized `Observation?based-on=` search returns a valid empty `searchset` Bundle with `total = 0`.

This preserves the CarePoint patient-release rule and prevents the FHIR facade from becoming an alternate path around it.

After release, each CarePoint laboratory observation is mapped separately with:

- `status = final`
- `category = laboratory`
- source code/display -> `Observation.code`
- patient -> `subject`
- encounter -> `encounter`
- source laboratory order -> `basedOn = ServiceRequest/{orderId}`
- release/validation timestamp -> `effectiveDateTime`
- numeric values -> `valueQuantity`
- textual values -> `valueString`
- textual reference range -> `referenceRange.text`
- source flag -> `interpretation.text`

A free-text unit is preserved as `valueQuantity.unit`. Slice 10.2 does not claim UCUM coding unless the source domain supplies a validated standardized unit code.

## Privacy and integrity properties

The FHIR adapter does not read order ciphertext directly.

`OrdersService` continues to:

1. verify the stored clinical-order attestation;
2. decrypt the envelope only after authorization;
3. verify validated laboratory-result integrity before exposing validated/released result content;
4. suppress unreleased result data from Patient views.

The FHIR layer then adds the stricter interoperability rule that laboratory Observations are not returned until release even to an otherwise authorized provider.

## Acceptance coverage

The Slice 10 interoperability smoke test now validates Slices 10, 10.1 and 10.2 together:

1. CapabilityStatement advertises `MedicationRequest` and `ServiceRequest` in addition to the existing resources.
2. A signed prescription maps to an active `MedicationRequest` with correct Patient, Encounter and Practitioner references.
3. The ordering practitioner can read the MedicationRequest.
4. An unrelated patient receives a FHIR 403 `OperationOutcome`.
5. A signed laboratory order maps to an active `ServiceRequest` with test detail and priority.
6. An unrelated patient is denied ServiceRequest access.
7. Laboratory Observation search is empty before result entry.
8. Laboratory Observation search remains empty after entry.
9. Laboratory Observation search remains empty after validation.
10. Release fulfills the CarePoint laboratory order and changes the FHIR ServiceRequest to `completed`.
11. Released laboratory results map to final FHIR Observations.
12. Numeric and textual laboratory values preserve their representation without inventing standardized unit codes.
13. Released Observations link to the correct Patient, Encounter and ServiceRequest.
14. Cross-patient laboratory Observation search is denied.
15. Ambiguous Observation search parameters return HTTP 400 `OperationOutcome`.

## Non-goals for Slice 10.2

This slice does not yet implement:

- FHIR write operations
- medication dispensing or pharmacy fulfillment workflows
- `DiagnosticReport`
- `DocumentReference`
- `Condition`
- FHIR `Specimen` resources
- terminology-server validation
- SMART on FHIR
- national implementation guides or certification
- bulk export or subscriptions

A logical next interoperability increment is to connect released diagnostics and clinical documents through `DiagnosticReport` and `DocumentReference`, while retaining the same CarePoint release, consent and audit controls.
