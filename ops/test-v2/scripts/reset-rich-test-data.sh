#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

required=(
  TEST_POSTGRES_PASSWORD
  CAREPOINT_RICH_TEST_DATA_CONFIRM
  CAREPOINT_TEST_FIXTURE_PASSWORD
  CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN
  CLINICAL_ENVELOPE_KEY_BASE64
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required." >&2
    exit 2
  fi
done

if [[ "$CAREPOINT_RICH_TEST_DATA_CONFIRM" != "RESET_AND_CREATE_RICH_SYNTHETIC_DATA" ]]; then
  echo "ERROR: CAREPOINT_RICH_TEST_DATA_CONFIRM must equal RESET_AND_CREATE_RICH_SYNTHETIC_DATA." >&2
  exit 2
fi
if (( ${#CAREPOINT_TEST_FIXTURE_PASSWORD} < 16 )); then
  echo "ERROR: CAREPOINT_TEST_FIXTURE_PASSWORD must contain at least 16 characters." >&2
  exit 2
fi

PATIENT_COUNT="${CAREPOINT_RICH_TEST_PATIENT_COUNT:-300}"
DOCTORS_PER_SPECIALTY="${CAREPOINT_RICH_TEST_DOCTORS_PER_SPECIALTY:-2}"
PROVIDERS_PER_CATEGORY="${CAREPOINT_RICH_TEST_PROVIDERS_PER_CATEGORY:-2}"

echo "== CarePoint rich synthetic reset =="
echo "Patients: $PATIENT_COUNT"
echo "Doctors/specialty: $DOCTORS_PER_SPECIALTY"
echo "Providers/category: $PROVIDERS_PER_CATEGORY"
echo "Password value: [not displayed]"

echo "Stopping application writers..."
docker compose stop api admin patient-web doctor-web provider-web || true

echo "Starting infrastructure..."
docker compose up -d postgres redis storage-init

echo "Applying Prisma migrations..."
docker compose run --rm migrate

echo "Resetting application data and generating rich synthetic fixtures..."
docker compose --profile rich-test-data run --rm rich-test-data

echo "Starting applications..."
docker compose up -d api admin patient-web doctor-web provider-web

echo "Waiting for API health..."
for attempt in $(seq 1 60); do
  if docker compose exec -T api node -e 'fetch("http://127.0.0.1:4200/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "ERROR: API did not become healthy." >&2
    docker compose logs --no-color --tail=120 api >&2 || true
    exit 1
  fi
  sleep 2
done

sql() {
  docker compose exec -T postgres psql -U carepoint_test -d carepoint_test -Atqc "$1"
}

patients="$(sql 'SELECT count(*) FROM "PatientProfile";')"
specialties="$(sql 'SELECT count(*) FROM "MedicalSpecialty" WHERE active=true;')"
categories="$(sql 'SELECT count(*) FROM "ProviderCategory" WHERE active=true;')"
doctors="$(sql "SELECT count(*) FROM \"Provider\" WHERE class='DOCTOR';")"
providers="$(sql "SELECT count(*) FROM \"Provider\" WHERE class='OTHER_PROVIDER';")"
appointments="$(sql 'SELECT count(*) FROM "Appointment";')"
completed="$(sql "SELECT count(*) FROM \"Appointment\" WHERE status='COMPLETED';")"
future="$(sql 'SELECT count(*) FROM "Appointment" WHERE "startsAt" > now();')"
slots="$(sql 'SELECT count(*) FROM "AvailabilitySlot" WHERE "startsAt" > now();')"
observations="$(sql 'SELECT count(*) FROM "Observation";')"
onboarding="$(sql "SELECT count(*) FROM \"ProviderOnboarding\" WHERE state IN ('PENDING_REVIEW','REQUEST_CHANGES');")"
transport_ground="$(sql "SELECT count(*) FROM \"MedicalTransportRequest\" WHERE mode='GROUND';")"
transport_air="$(sql "SELECT count(*) FROM \"MedicalTransportRequest\" WHERE mode='AIR';")"
ambulance="$(sql 'SELECT count(*) FROM "EmergencyAmbulanceRequest";')"
units="$(sql 'SELECT count(*) FROM "MeasurementUnit" WHERE active=true;')"
metrics="$(sql 'SELECT count(*) FROM "ObservationType" WHERE active=true;')"
login_examples="$(sql "SELECT count(*) FROM \"User\" WHERE username IN ('pac001','dr001.CAR','dr001.DER','pr001.NUT','pr001.PSI');")"

min_doctors=$(( specialties * DOCTORS_PER_SPECIALTY ))
min_providers=$(( categories * PROVIDERS_PER_CATEGORY ))

check_ge() {
  local name="$1" value="$2" minimum="$3"
  if (( value < minimum )); then
    echo "ERROR: $name=$value, expected at least $minimum." >&2
    exit 1
  fi
}

check_ge "patients" "$patients" "$PATIENT_COUNT"
check_ge "specialties" "$specialties" 40
check_ge "provider categories" "$categories" 35
check_ge "doctors" "$doctors" "$min_doctors"
check_ge "other providers" "$providers" "$min_providers"
check_ge "appointments" "$appointments" $(( PATIENT_COUNT * 10 ))
check_ge "completed appointments" "$completed" "$PATIENT_COUNT"
check_ge "future appointments" "$future" "$PATIENT_COUNT"
check_ge "future slots" "$slots" 1000
check_ge "observations" "$observations" $(( PATIENT_COUNT * 30 ))
check_ge "pending onboarding" "$onboarding" 10
check_ge "ground transport requests" "$transport_ground" 5
check_ge "air transport requests" "$transport_air" 5
check_ge "emergency ambulance requests" "$ambulance" 5
check_ge "measurement units" "$units" 12
check_ge "clinical metrics" "$metrics" 10
check_ge "representative login usernames" "$login_examples" 5

cat <<EOF

Rich synthetic dataset verification PASSED
------------------------------------------
Patients:                    $patients
Active medical specialties:  $specialties
Provider categories:         $categories
Doctors:                     $doctors
Other providers:             $providers
Appointments:                $appointments
Completed visits:            $completed
Future appointments:         $future
Future availability slots:   $slots
Clinical observations:       $observations
Pending onboarding cases:    $onboarding
Ground transport requests:   $transport_ground
Air transport requests:      $transport_air
Emergency ambulance:         $ambulance
Measurement units:           $units
Clinical metric types:       $metrics

Representative usernames:
  pac001
  dr001.CAR
  dr001.DER
  pr001.NUT
  pr001.PSI

All fixture users use CAREPOINT_TEST_FIXTURE_PASSWORD.
EOF
