# CarePoint Rich Synthetic Test Dataset

This fixture is intended only for non-production CarePoint databases. It performs a full reset of application data, preserves Prisma migration history, rebuilds master/reference catalogs, and creates a broad synthetic dataset for Admin, Patient, Doctor and Other Provider testing.

## Safety

The command refuses to run unless:

- `DATABASE_URL` points to a database whose name contains `test`, `pilot`, `staging`, `uat`, `demo` or `sandbox`.
- `CAREPOINT_RICH_TEST_DATA_CONFIRM=RESET_AND_CREATE_RICH_SYNTHETIC_DATA`.
- `CAREPOINT_TEST_FIXTURE_PASSWORD` contains at least 16 characters.
- `CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN` is an explicit valid test domain.

It truncates application tables with `RESTART IDENTITY CASCADE`, excluding `_prisma_migrations` and `spatial_ref_sys`.

## Default dataset

- 300 patients.
- 74 medical specialties and subspecialties, including Cardiology, Dermatology, Psychiatry, Pediatrics, neonatal and pediatric subspecialties, maternal-fetal medicine, critical care, interventional disciplines, surgical specialties, rehabilitation, palliative medicine, sleep medicine, genetics, dental medicine and others.
- 2 active doctors per specialty.
- 70 extensible Other Provider categories, including Special Education and learning-support roles, broad Psychology and behavioral-health branches, Nutrition subspecialties, therapies, laboratory and phlebotomy, pharmacy, diagnostic technology, home health, rehabilitation, non-emergency and wheelchair transport, ground/air medical transport and emergency ambulance.
- 2 active providers per provider category.
- Pending Doctor and Other Provider credentialing/onboarding cases.
- 24 measurement units with clinically relevant conversions for temperature, glucose, mass, length, pressure, volume and time.
- 30 versioned clinical observation/metric types spanning vitals, metabolic, body composition, respiratory, sleep/activity, nutrition, renal and behavioral-health measurements.
- 330 days of historical activity.
- Completed, no-show and cancelled historical appointments.
- Requested and confirmed appointments for the next 30 days.
- Availability rules and slots for the next 42 days.
- Encrypted patient health profiles and longitudinal observations.
- Hospitalization and immunization history plus four encrypted longitudinal clinical encounters per patient, including synthetic diagnosis, allergy, medication, procedure, lab-review and care-plan context.
- Patient consent records.
- Pending availability requests.
- Air and ground medical transport requests in multiple states.
- Emergency ambulance workflows and transport units.
- Transport fixture consistency checks ensure completed transport requests always have an assigned provider.

## Login naming

All generated fixture users use the password supplied in `CAREPOINT_TEST_FIXTURE_PASSWORD`.

Examples:

- Patient: `pac001`, `pac002`, ...
- Cardiology: `dr001.CAR`, `dr002.CAR`, ...
- Dermatology: `dr001.DER`, `dr002.DER`, ...
- Nutrition: `pr001.NUT`, `pr002.NUT`, ...
- Psychology: `pr001.PSI`, `pr002.PSI`, ...

The email address is the lowercase username plus `@${CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN}`.

## Required variables

Set these manually. Do not commit an `.env` file.

```text
DATABASE_URL
CAREPOINT_RICH_TEST_DATA_CONFIRM=RESET_AND_CREATE_RICH_SYNTHETIC_DATA
CAREPOINT_TEST_FIXTURE_PASSWORD
CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN
CAREPOINT_TEST_FIXTURE_TIMEZONE
CLINICAL_KEY_PROVIDER
CLINICAL_ENVELOPE_KEY_ID
CLINICAL_ENVELOPE_KEY_BASE64
```

The clinical key variables must match the non-production environment because the fixture creates encrypted clinical test data.

Optional scale controls:

```text
CAREPOINT_RICH_TEST_PATIENT_COUNT
CAREPOINT_RICH_TEST_DOCTORS_PER_SPECIALTY
CAREPOINT_RICH_TEST_PROVIDERS_PER_CATEGORY
```

Defaults are 300 patients, 2 doctors per specialty and 2 Other Providers per category. With the expanded catalogs this produces 148 active doctors and 140 active Other Providers before pending onboarding cases. The patient count remains configurable up to 2,000 so larger load-test datasets can be generated without changing source code.

## Run

After migrations are current:

```bash
npm run build --workspace @carepoint/api
npm run db:test-rich-reset --workspace @carepoint/api
```

The script prints a final JSON summary with generated counts and representative usernames. It never prints the configured password value.
