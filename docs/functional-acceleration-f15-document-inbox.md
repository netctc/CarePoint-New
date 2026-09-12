# F15 functional acceleration — Patient document inbox

## Scope
F15 evolves the released-document centre into a Patient-owned document inbox while preserving F14 authorization and one-time-download controls.

Delivered behavior:
- Patient list rows expose opened and acknowledged receipt state without changing clinical-document authorization.
- The first successful one-time secure download records `firstOpenedAt`; explicit acknowledgement records `acknowledgedAt`.
- Patient can create an encrypted UTF-8 personal note through the existing `PATIENT_UPLOAD` malware-scanned/encrypted storage path.
- Patient removal is restricted to a `PATIENT_UPLOAD` created by the same authenticated Patient account. Provider-authored documents remain immutable from Patient inbox actions.
- Generic provider document releases can create a PHI-neutral `CLINICAL_UPDATE` notification against `CLINICAL_DOCUMENT`; laboratory/diagnostic document kinds remain on their dedicated notification lifecycles.
- Notification deep-linking opens the Patient document centre focused on the exact document and does not act as authorization; document access is re-authorized by the clinical-document endpoint.

## Persistence
Migration `20260912121500_f15_patient_document_inbox` adds `PatientClinicalDocumentReceipt` with a unique `(documentId, accountId)` key, `firstOpenedAt`, and `acknowledgedAt`. Receipt rows are interaction state only and are not clinical content or an authorization grant.

## Security boundaries
- F14 one-time download tokens remain random, short-lived, hash-only-at-rest and single-use.
- Binary bytes remain behind an authenticated `no-store` response and the encrypted-object integrity check.
- Notification payloads contain only safe template keys plus opaque entity identifiers; filenames, titles, note bodies, descriptions and other document metadata are not copied to notification payloads.
- Patient note bodies remain encrypted through the existing clinical-document envelope and object-storage pipeline.
- Acknowledgement does not mean clinical acceptance, provider verification, consent, treatment approval or legal signature.

## Explicit non-scope
No public links, external file sharing, arbitrary native file picker/export, PACS/laboratory activation, external push/SMS/email activation, pharmacy/eRx, clinical decision support, human clinical UAT, signed app-store release or production promotion is introduced by F15.

## Validation target
Permanent backend smoke, shared Flutter API/widget regressions, database migration/bootstrap, analyzers, native compatibility and the existing security/evidence workflows must remain green before F15 is marked complete.
