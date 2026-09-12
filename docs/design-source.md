# Design Source Mapping

The implementation is based on the supplied `stitch_diseño_gráfico_multiplataforma` package and its **Clinical Aurora** design system.

## Core design tokens

- Primary / Clinical Blue: `#0EA5E9`
- Secondary / Neural Violet: `#8B5CF6`
- Tertiary / Cyan Signal: `#22D3EE`
- Midnight: `#0F172A`
- Care Green: `#10B981`
- Attention: `#F59E0B`
- Safety / Urgent: `#FB7185`
- Patient canvas: `#F8FAFC`
- Main font: Inter
- Large workflow containers: 24-28px radius
- Main CTAs: 54px high

## Screen mapping used in this bootstrap

- `web_01_operations_command_center` -> Admin command center
- `web_02_independent_provider_directory` -> Other Providers directory (doctors excluded)
- `web_03_doctors_medical_specialties` -> Doctors & specialties
- `web_04_unified_appointment_operations` -> Appointment operations
- `pat_01_health_hub_home` -> Patient mobile home
- `pat_02_provider_search` -> Future patient discovery slice
- `pat_03_booking_modality` -> Future booking slice
- `pat_04_secure_telemedicine_room` -> Future telemedicine slice
- `doc_01_today_clinical_queue` -> Doctor mobile shell
- `doc_02_patient_snapshot` -> Future doctor patient context
- `oth_01_service_route_field_job` -> Other Provider mobile shell
- `oth_02_service_completion` -> Future service-completion flow

The Emergency Ambulance action is intentionally separated from ordinary provider search and booking and must remain reachable from Patient Home with one primary action.
