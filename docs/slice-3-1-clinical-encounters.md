# Slice 3.1 — Clinical Encounter & Encrypted Medical Record

## Purpose

Slice 3.1 turns a confirmed CarePoint appointment into the anchor for a clinical encounter. It deliberately does not create a second encounter identity: `Appointment.id` is referenced by immutable `ClinicalRecord.encounterRef` values.

## Clinical record lifecycle

1. An active Doctor or Other Healthcare Provider owns a confirmed appointment.
2. The provider writes one or more structured clinical record revisions.
3. Every revision is encrypted before persistence with AES-256-GCM and an envelope-wrapped data key.
4. The database stores ciphertext, IV, wrapped DEK and KEK identifier only. PHI is not written to application audit metadata.
5. The patient can read their own timeline.
6. The authoring provider can always read records they authored for the patient.
7. Cross-provider access requires either a valid treatment relationship or a currently granted `CLINICAL_RECORD_READ` consent (`clinical-record-v1`).
8. Finalizing the encounter changes the appointment to `COMPLETED` and makes further clinical revisions immutable.
9. A telemedicine encounter cannot be finalized while its media session is `ACTIVE`; the provider must end the LiveKit session through the telehealth flow first. A waiting/ready room that never became active may be closed during finalization.

## Structured encrypted payload

The encrypted JSON payload supports common fields while remaining specialty-neutral:

- chief complaint
- subjective notes
- objective findings
- assessment
- plan
- vital signs
- diagnoses (including optional coding system/code)
- treatments
- medications
- attachment references

This supports all medical specialties and non-doctor healthcare services without forcing specialty-specific PHI into plaintext database columns.

## API

Provider write/finalize:

- `POST /api/v1/clinical/appointments/:appointmentId/records`
- `POST /api/v1/clinical/appointments/:appointmentId/finalize`

Patient/provider read:

- `GET /api/v1/clinical/appointments/:appointmentId`
- `GET /api/v1/clinical/timeline`
- `GET /api/v1/clinical/patients/:patientId/timeline`

## Authorization model

- Patients can read only their own clinical records.
- Providers can author/finalize only appointments assigned to their own active provider profile.
- A provider reading another provider's record needs a treatment relationship, patient consent, or (future slice) explicitly audited legal/emergency break-glass basis.
- Admin and Support roles do not receive PHI-read permission by default.
- The access basis returned by the API is preserved on timeline items (`PATIENT_SELF`, `OWN_AUTHORSHIP`, `TREATMENT_RELATIONSHIP`, or `PATIENT_CONSENT`) so clients do not misrepresent why a record is visible.

## Mobile surfaces

Patient App:

- adds a `Health record` tab
- lists decrypted encounter summaries returned by the authorized API
- supports EN/AR/FR/ES and Arabic RTL

Doctor / Other Provider Apps:

- add a `Clinical chart` action to confirmed/completed appointments
- allow structured charting while the encounter is open
- save a new encrypted revision rather than overwriting history
- show prior patient history only when the backend confirms a valid access basis
- become read-only after finalization

## Encryption configuration

Development/test:

```text
CLINICAL_KEY_PROVIDER=local
CLINICAL_ENVELOPE_KEY_ID=local-clinical-kek-v1
CLINICAL_ENVELOPE_KEY_BASE64=<32-byte-key-base64>
```

Production rejects the local key provider. Before production, implement the external KMS/HSM adapter selected for the deployment environment and establish key rotation, backup and recovery procedures.

## Deliberate exclusions from this slice

- binary attachment upload/object storage pipeline
- prescriptions and medication ordering
- lab orders/results
- FHIR export/import
- emergency/legal break-glass access
- specialty-specific structured forms
- clinical record correction/addendum workflow after finalization

Those should build on the immutable encrypted record model rather than bypass it.
