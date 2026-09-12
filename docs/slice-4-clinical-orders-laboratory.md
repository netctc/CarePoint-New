# Slice 4 — Clinical Orders, Prescriptions & Laboratory

## Purpose

Slice 4 extends the encrypted CarePoint encounter model with signed clinical orders and laboratory-result release controls. It is designed to remain neutral across countries and professional scopes of practice.

## Order model

`ClinicalOrder` supports:

- `PRESCRIPTION`
- `LABORATORY`

Every order is linked to:

- patient
- ordering provider
- encounter (`Appointment.id`)

The complete clinical payload is encrypted before persistence using AES-256-GCM envelope encryption. Plaintext medication/test/reason/result data is not stored in order database columns or audit metadata.

## Clinical attestation

Development/test uses an application-level HMAC-SHA256 clinical attestation over the encrypted order envelope. This provides integrity evidence inside the platform but is deliberately **not** described as a legally qualified electronic signature or certified e-prescription.

Production rejects the local signing provider. Country-specific deployment must connect an approved signing/KMS/HSM provider and satisfy local e-prescribing requirements before electronic prescriptions are treated as legally certified documents.

## Provider authorization

Doctors receive the base order permissions.

Other Healthcare Providers remain capability-gated. Their category may declare:

- `PRESCRIPTION`
- `LABORATORY`
- `LAB_RESULT_ENTRY`
- `LAB_RESULT_VALIDATE`

RBAC grants access to the orders domain while ABAC/capability checks determine whether the specific provider can perform each clinical action.

Admin and Support roles do not receive clinical-order PHI permissions.

## Patient and cross-provider access

Patients can read only their own orders.

Cross-provider read access requires one of:

- own authorship
- active treatment relationship
- patient consent with scope `CLINICAL_ORDER_READ` and version `clinical-orders-v1`

## Laboratory lifecycle

```text
SIGNED LABORATORY ORDER
        ↓
     ENTERED
        ↓
    VALIDATED
        ↓
     RELEASED
        ↓
ORDER = FULFILLED
```

Patient visibility is intentionally asymmetric:

- order metadata and encrypted/decrypted order details can be shown after signing
- entered result payload is hidden
- validated result payload is still hidden
- released result payload is visible to the patient

Only the ordering provider can release a validated result to the patient in this slice.

## API

Create:

- `POST /api/v1/clinical-orders/appointments/:appointmentId/prescriptions`
- `POST /api/v1/clinical-orders/appointments/:appointmentId/laboratory`

Read:

- `GET /api/v1/clinical-orders/me`
- `GET /api/v1/clinical-orders/patients/:patientId`
- `GET /api/v1/clinical-orders/:orderId`

Lifecycle:

- `POST /api/v1/clinical-orders/:orderId/cancel`
- `POST /api/v1/clinical-orders/:orderId/lab-result`
- `POST /api/v1/clinical-orders/:orderId/lab-result/validate`
- `POST /api/v1/clinical-orders/:orderId/lab-result/release`

## Mobile

Patient Health Record includes orders and released results.

Doctor/Other Provider Clinical Chart includes Clinical Orders with:

- new prescription
- new laboratory order
- result entry
- result validation
- patient release
- cancellation of eligible signed orders

New UI follows the existing EN/AR/FR/ES locale model with Arabic RTL.

## CI acceptance

Slice 4 CI verifies:

- order PHI is not present in plaintext persistence
- laboratory result PHI is not present in plaintext persistence
- order attestation exists
- validated result attestation exists
- Admin is denied PHI order access
- Patient cannot see ENTERED result data
- Patient cannot see VALIDATED result data
- Patient can decrypt RELEASED result data
- the released laboratory order becomes `FULFILLED`

## Production gates

Before real PHI or legal prescribing use:

- external KMS/HSM encryption adapter
- external approved signing adapter
- country-specific prescriber authorization rules
- medication terminology/formulary integration
- lab/provider identity and routing integration
- key rotation and disaster-recovery policy
- legal retention policy
- clinical safety validation

## Deliberate exclusions

- pharmacy dispensing/claim integration
- controlled-substance e-prescribing certification
- national prescription network integration
- external laboratory messaging (HL7/FHIR/LIS)
- specimen logistics and chain of custody
- corrected/amended laboratory result revisions
- medication interaction and allergy decision support

These should extend this signed/encrypted order foundation rather than bypass it.
