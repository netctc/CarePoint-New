# CarePoint Next - Architecture Baseline

## 1. Architecture style

CarePoint Next begins as a **modular monolith with strict domain boundaries**. This keeps the transactional core maintainable while allowing horizontal scale. Search, notifications, payment orchestration, media orchestration and reporting can later be extracted as independent services when production metrics justify that change.

## 2. Primary domains

- Identity & Access
- Patients & Consent
- Doctors & Medical Specialties
- Other Providers & Provider Taxonomy
- Services & Modalities
- Scheduling & Availability
- Booking & Appointments
- Emergency Ambulance & Medical Transport
- Telemedicine
- Clinical Encounters & Records
- Messaging & Notifications
- Payments & Billing
- Administration, Compliance & Audit

### Doctor boundary

The Doctor domain includes every doctor regardless of specialty or sub-specialty. A doctor can never be classified by the Other Provider taxonomy.

### Other Provider boundary

The Other Provider domain includes all non-doctor healthcare professionals and services, including nursing/ATS, physiotherapy, nutrition, allied health, emergency ambulance, ground medical transport and air medical transport. The taxonomy is data-driven so new non-doctor categories can be added without a database schema migration.

## 3. Data platform

PostgreSQL is the system of record. The initial schema is designed around independent providers, explicit consent, appointment concurrency and auditable clinical access.

Redis is reserved for rate limiting, ephemeral sessions and short-lived challenges, distributed locks when needed, cache, and worker coordination.

## 4. PHI encryption

Selected clinical values are encrypted at the application layer using AES-256-GCM and envelope encryption.

1. Generate a random 256-bit Data Encryption Key (DEK).
2. Encrypt the PHI payload with the DEK and a unique IV.
3. Wrap the DEK with a Key Encryption Key managed by cloud KMS/HSM.
4. Store ciphertext, IV, wrapped DEK, key id and algorithm metadata.
5. Audit clinical reads/decryption by actor, object, purpose and result.

The repository contains the provider-neutral primitive. Production deployments must supply a KMS adapter; no production master key belongs in application source or database.

## 5. Telemedicine

Business logic depends on a `TelehealthProvider` interface rather than a vendor SDK. The target adapter is LiveKit with ephemeral server-issued room tokens and E2EE where supported. Recording is off by default.

## 6. Scale and reliability

- Stateless API replicas behind a gateway/load balancer.
- Managed PostgreSQL HA, PITR, read replicas when required, and PgBouncer.
- Transactional outbox before event-driven side effects become business-critical.
- Object storage for documents; database stores metadata and encrypted references.
- OpenTelemetry traces, structured logs with correlation IDs, RED/USE metrics, SLOs and alerting.
- WAF, DDoS protection, secrets rotation, image scanning and SIEM integration.

## 7. Security invariants

- Providers never inherit another provider's data or authorization.
- Clinical access is relationship/consent based, not merely role based.
- Support users have no blanket clinical read permission.
- Logs and traces must be PHI-redacted by allowlist.
- Payment card data is tokenized by the payment provider and never persisted by CarePoint.

## 8. Internationalization

English is the canonical engineering language for code, API contracts, enum values, audit events and technical documentation. Presentation clients support EN/AR/FR/ES from the first slice. Arabic is a first-class RTL locale rather than a translated LTR screen. Dynamic catalog records such as medical specialties and Other Provider categories store stable identifiers plus localized labels for the four supported locales.
