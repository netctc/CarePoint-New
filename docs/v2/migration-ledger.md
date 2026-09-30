# CarePoint V2 Baseline Migration Ledger

This ledger freezes the migration surface present at `Inicio_V2` / `604f522412c8da6668ee2df42ce58ec3994798c5`.

The hash is the Git blob object ID of the exact `migration.sql` content at the baseline commit.

| # | Migration file | Baseline Git blob hash |
| ---: | --- | --- |
| 1 | `services/api/prisma/migrations/20260906193000_initial_platform/migration.sql` | `88396de30545cd56d6143c70e13a41b61a3f9560` |
| 2 | `services/api/prisma/migrations/20260906210000_services_scheduling_booking/migration.sql` | `730c3e61933694436ed940cb10cf0efc42497ba1` |
| 3 | `services/api/prisma/migrations/20260906224000_secure_telemedicine/migration.sql` | `74301b42683e22576cc035df0cf716fa27373fb5` |
| 4 | `services/api/prisma/migrations/20260906233000_clinical_orders_laboratory/migration.sql` | `a2ff892db43ae38fe79c0d12b453162197955c5c` |
| 5 | `services/api/prisma/migrations/20260906234500_clinical_documents_diagnostics/migration.sql` | `a18fb1e5ec29a2e763c64374fc7b0e789fe00fd7` |
| 6 | `services/api/prisma/migrations/20260907023000_payments_insurance_financial_operations/migration.sql` | `83a049df2f186b90ccc06fbe43805bdf26924232` |
| 7 | `services/api/prisma/migrations/20260907023100_booking_pricing_snapshot_trigger/migration.sql` | `7a73de15efb8f0e7fd5deb532be99f04e37ed8e6` |
| 8 | `services/api/prisma/migrations/20260907023200_cancelled_appointment_invoice_state/migration.sql` | `b5e2168d22738aa345423018953fccee7723e0ba` |
| 9 | `services/api/prisma/migrations/20260907023300_financial_identifier_and_refund_hardening/migration.sql` | `f4d18c8904a1e90a7a3460042da5551948b8a659` |
| 10 | `services/api/prisma/migrations/20260907033000_claims_eob_revenue_cycle/migration.sql` | `20a01790bc901d2533b9e32c0d5cca458d227768` |
| 11 | `services/api/prisma/migrations/20260907043000_secure_messaging_notifications/migration.sql` | `3f50adcba027f4fff52db1d335a02cb32418b1d4` |
| 12 | `services/api/prisma/migrations/20260907054000_medical_transport_emergency_dispatch/migration.sql` | `caddeeb5edfadc10d2b1ba80efc248c0ac543a55` |
| 13 | `services/api/prisma/migrations/20260908020000_fhir_bulk_export_durable_jobs/migration.sql` | `716b980e44357a25e71a653501c63d45f9ef8eb6` |
| 14 | `services/api/prisma/migrations/20260908204500_durable_notification_outbox/migration.sql` | `9898d99baed6eec6c28754497cd08d98e471a599` |
| 15 | `services/api/prisma/migrations/20260908212000_durable_siem_audit_outbox/migration.sql` | `e67f1931b3ade5f790f940a4c66c9408934b9b9e` |
| 16 | `services/api/prisma/migrations/20260909203000_release1_data_governance/migration.sql` | `aa1ac346ccb5f936779fe0bdd26f7f241ce225bc` |
| 17 | `services/api/prisma/migrations/20260909213000_release1_appointment_notifications/migration.sql` | `ccfdd5a8d10b8ca32b68201697f8bf8b758580d6` |
| 18 | `services/api/prisma/migrations/20260909220000_release1_discovery_visit_context/migration.sql` | `bce69379915338d3f22eded7a6093771f9b8545d` |
| 19 | `services/api/prisma/migrations/20260911143000_f2_patient_rescheduling_waitlist/migration.sql` | `eedec8b346590dd38ac0a156be7d5a31da558228` |
| 20 | `services/api/prisma/migrations/20260911161500_f3_availability_requests/migration.sql` | `86c68edbe57251ee78633366caf51e6fd31c307e` |
| 21 | `services/api/prisma/migrations/20260911185000_f4_automatic_availability_notifications/migration.sql` | `358cf3e5239e106b2a8e9c31c53e93e625bb334e` |
| 22 | `services/api/prisma/migrations/20260912093000_f14_patient_document_download_grants/migration.sql` | `16460466a4191ab4802606d735e78b03c9404603` |
| 23 | `services/api/prisma/migrations/20260912121500_f15_patient_document_inbox/migration.sql` | `d6a6a204c2f6c21f8ba1b48da24dd589a61a68e2` |
| 24 | `services/api/prisma/migrations/20260918024500_transport_companions_equipment/migration.sql` | `104f3c81e7654803f9f5778fb8d9f9e01bef25dd` |

## V2 migration policy
1. New V2 schema changes use new timestamped forward migrations.
2. Every schema-changing PR documents purpose, forward behavior, compatibility, backfill impact, privacy/security impact and rollback/compensation.
3. Destructive migrations require an explicit compatibility window and recovery evidence.
4. Baseline migration files listed above are immutable.
5. The frozen Prisma schema is stored at `docs/v2/baseline/schema.prisma`.
