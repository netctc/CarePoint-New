# CarePoint V2 Baseline Manifest

| Item | Value |
| --- | --- |
| Repository | `netctc/CarePoint-New` |
| Recovery tag | `Inicio_V2` |
| Baseline commit | `604f522412c8da6668ee2df42ce58ec3994798c5` |
| Baseline tree | `d61f1ced0654f53d97ba955444c5436f1f3a69be` |
| Prisma schema blob | `50690e8d4d88f379f1f87b33812f4d38f69fde40` |
| Baseline SQL migrations | 24 |
| Main observed during Phase 0 | `61a7f8d03a9dc68469b83695c826b0f898ab6d7b` |

The initial comparison between `Inicio_V2` and `v2/development` was **identical: 0 commits ahead, 0 behind**.

## Baseline repository surfaces
- `apps/admin`
- `apps/patient-mobile`
- `apps/doctor-mobile`
- `apps/provider-mobile`
- `services/api`
- `packages/contracts`
- `packages/identity`
- `packages/mobile_core`
- `packages/security`

## Toolchain authority
- Node.js: `>=22.11.0 <25`
- npm: `10.9.2`
- Admin: Next.js 16 / React 19 / TypeScript
- API: NestJS modular monolith / Prisma / PostgreSQL / Redis
- Mobile CI: Flutter 3.47.2
- Engineering/source language: English

The tag, baseline commit and existing migrations below that boundary are immutable.
