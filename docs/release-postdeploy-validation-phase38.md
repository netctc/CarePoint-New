# Release Phase 38 — Post-Deploy Validation Contract

Phase 38 defines the mandatory validation performed after an explicitly authorized deployment.

It contains **10 post-deploy checks** covering live health/readiness, migrations, authentication, critical patient/provider/admin journeys, workers, observability, and rollback-trigger assessment.

A PASSED record requires every check to be PASS with a non-secret evidence reference.

A failed check makes rollback assessment mandatory.

Phase 38 **does not close the release**, does not set production acceptance, and does not execute rollback.

- `productionAcceptance=false`
- `releaseClosed=false`

Commands:
- `npm run v2:release-phase38`
- `npm run v2:release-phase38-postdeploy -- <record.json>`

No new production environment variables.

No .env file is added.

No database migration.
