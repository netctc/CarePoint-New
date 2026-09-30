# CarePoint Next

Greenfield implementation of the CarePoint Next healthcare platform, based on the approved functional/technical specification and the **Clinical Aurora / Adaptive Clinical Future** design package.

## Product boundaries implemented from day one

- **Doctors** are a dedicated domain and application covering **all doctors, all medical specialties and all sub-specialties**.
- **Other Providers** covers every non-doctor healthcare branch plus medical transport by ground and air, including emergency ambulance providers. Doctors are explicitly excluded from this taxonomy.
- Every provider is an **independent entity**. Multi-user healthcare centers and shared provider accounts are not part of the initial scope.
- Patient visits support **clinic**, **telemedicine**, and **home visit** modalities.
- **Emergency ambulance** is a first-class patient flow, launched directly from the patient home screen without provider search or ordinary booking.

## Target architecture

- TypeScript + NestJS modular monolith for the transactional backend.
- PostgreSQL as the system of record; Redis for cache/rate limit/ephemeral coordination.
- Next.js + React + TypeScript for the administration and operations portal.
- Flutter + Dart for Patient, Doctor, and Other Provider mobile apps.
- English is the engineering/source language; all user interfaces support EN/AR/FR/ES with full RTL behavior for Arabic.
- Envelope encryption for selected PHI fields, with a production KMS/HSM adapter.
- Telemedicine behind a `TelehealthProvider` abstraction, targeting LiveKit first and keeping Twilio Video as an adapter option.
- Event outbox and asynchronous workers added as workflows mature; microservices extracted only for measured hot spots.

## Repository layout

```text
apps/
  admin/                 Next.js operations/admin portal
  patient-mobile/        Flutter patient app
  doctor-mobile/         Flutter app for all doctors/specialties
  provider-mobile/       Flutter app for non-doctor healthcare/transport providers
packages/
  contracts/             Shared domain/API contracts
  security/              PHI envelope-encryption primitives
  mobile_core/           Shared Flutter localization and mobile foundations
services/
  api/                   NestJS modular monolith + Prisma schema
docs/
  architecture.md
  implementation-plan.md
  design-source.md
  internationalization.md
```

## Current implementation slice

1. Shared domain vocabulary and hard separation between Doctor and Other Provider.
2. Medical specialty catalog distinct from the flexible non-doctor provider taxonomy.
3. Emergency ambulance request contract and API endpoint that bypasses normal booking.
4. PostgreSQL/Prisma domain model including encrypted clinical payload storage.
5. Clinical Aurora admin shell with command-center, Doctors, Other Providers and appointments views.
6. Flutter patient home with a prominent emergency ambulance action; Doctor and Other Provider mobile shells.
7. EN/AR/FR/ES localization baseline, including RTL layout for Arabic and localized provider taxonomy labels.

## Local development

Node workspaces target the repository-declared `npm@10.9.2`. CI resolves dependency locks without package scripts, verifies the approved canonical dependency graph, and only then performs `npm ci`. High/critical npm advisories fail the CI gate.

```bash
npm install --global npm@10.9.2
npm install
npm run dev:api
npm run dev:admin
```

Dependency changes are intentional release changes: review the resolved graph and full regression suite before updating `.ci/npm-package-lock.canonical.sha256` or the Flutter lock digests. See `docs/phase-c2-dependency-supply-chain-hardening.md` for the acceptance procedure.

API default: `http://localhost:4000`  
Admin default: `http://localhost:3000`

Mobile CI is pinned to Flutter `3.47.2` and verifies the generated lock digests for the shared mobile package and all three apps before analyzer/test acceptance.
