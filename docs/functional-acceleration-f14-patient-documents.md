# F14 — Patient clinical document centre and one-time secure downloads

F14 extends the functional-development lane on `feature/functional-expansion-care-journeys`. It does not authorise promotion, merge or production deployment.

## Functional scope

The Patient clinical record now opens a dedicated document centre backed by a patient-only endpoint. The centre shows released, available documents for the authenticated patient; supports local search and type filtering; presents dates as `dd/mm/yyyy`; and has EN/AR/FR/ES copy with RTL support for Arabic.

The patient DTO is deliberately narrower than the internal `ClinicalDocument` persistence model. It exposes the document id, kind, media type, byte length, release/creation timestamps, source classification, downloadability and allowlisted decrypted metadata (`fileName`, `title`, `description`). It does not expose `storageProvider`, `objectKey`, content digest, blob/metadata key ids, wrapped keys, IVs, ciphertext, provider/patient internal linkage or external imaging reference material.

## One-time download grant

For an encrypted binary document, the authenticated patient first requests a short-lived download grant. The server generates a 256-bit opaque token, persists only its SHA-256 hash, and binds the grant to the authenticated account and exact document for five minutes. The raw token is returned only to the caller that created the grant.

The secure download endpoint is also authenticated and accepts the grant in a POST body, keeping it out of the URL. Consumption is atomic: an `updateMany` claim requires matching token hash, document, account, an unconsumed state and a future expiry. A successful claim stamps `consumedAt`; a replay, expired token, wrong token or wrong account fails closed. A claimed grant is intentionally burned before object-storage decryption so two concurrent consumers cannot both read the same grant.

The existing encrypted-object integrity check is preserved. The service reads the existing encrypted blob, decrypts it through `DocumentsEnvelopeService`, recomputes SHA-256 and rejects digest mismatch. Responses keep `Cache-Control: private, no-store`, `Pragma: no-cache` and `X-Content-Type-Options: nosniff`.

The historical authenticated download/content routes are left in place for backward compatibility. F14 Patient UI uses only the one-time grant route for binary/text content; it does not weaken current Doctor/Other Provider access rules.

## Mobile behavior

The new Patient centre is reachable from Health Record. Text files are rendered after the secure one-time download. JPEG/PNG content can be previewed from in-memory bytes. Other binary types such as PDF are securely retrieved and identified, but this increment does not add a native filesystem/file-opener dependency or export clinical bytes to shared device storage. This is intentional to avoid introducing an unreviewed platform storage surface.

Although the backend already supports patient document upload with malware scanning and server-side 8 MB/media-type validation, F14 does not add a mobile file picker because the current mobile dependency set has no reviewed picker/storage dependency. Malware scanning remains authoritative on the backend.

## Persistence

Migration `20260912093000_f14_patient_document_download_grants` adds `ClinicalDocumentDownloadGrant` with token hash, document id, account id, expiry, consumption timestamp and creation timestamp. No raw grant token or clinical content is stored in the grant table.

## Verification contract

Permanent backend smoke coverage verifies the safe patient DTO, absence of storage/encryption material, hashed token persistence, successful secure read, one-time replay rejection, invalid-token rejection and wrong-role fail-closed behavior. Flutter widget coverage verifies safe centre loading, search, type filtering, `dd/mm/yyyy`, one-time-grant client routing without the legacy content endpoint, secure text rendering and Arabic RTL/localization.

External/human blockers remain deferred: physical-device UAT, signed store builds, external PACS/laboratory activation, production object-storage/KMS acceptance, regulator/clinical-safety approval, human operational UAT and production rollout.
