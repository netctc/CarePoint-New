# Release 1 OCI R3 evidence and telemetry region contract

This document records the non-secret Release 1 contract for OCI/KSA infrastructure evidence and data-bearing observability destinations.

For the live operator procedure, use `ops/release-1/oci-r3-live-acceptance-runbook.md`.

## Scope

The base final infrastructure evidence schema remains `carepoint.release-infrastructure-evidence/v1`. For the OCI Release 1 target, the final evidence record must additionally include the `cloudProvider` and `ociResources` sections described by `.ci/release-infrastructure-oci-evidence-contract.mjs`.

The OCI extension is additive: the base R3 controls, continuity measurements, destination residency records and approval requirements remain mandatory. Passing the contract workflow does not represent production acceptance and does not prove that any OCI resource exists.

## KSA residency

Release 1 OCI evidence is fail-closed to:

- jurisdiction: `SA`;
- primary region: `me-riyadh-1`;
- DR region included in the approved set: `me-jeddah-1`;
- no approved data region outside the two accepted KSA regions.

The final evidence must reference real OCI tenancy/compartment/resource identifiers and separately retained sanitized or restricted evidence. Project policy keeps live infrastructure inventory in the approved restricted evidence location rather than committing it to this repository. Do not commit credentials, private keys, secret values, PHI, database dumps or raw provider responses.

## OCI resource references

The OCI extension requires resource references for the production PostgreSQL, cache, clinical object-storage, FHIR bulk-export, KMS and external-secret domains. OCI resources with OCIDs use an `ocid1.*` reference. Object Storage buckets use the provider-neutral evidence locator `oci-object-storage://<namespace>/<bucket>` plus an explicit approved region.

The example file `ops/release-1/production-infrastructure-oci-extension.example.json` is a template only. Placeholder identifiers are not production evidence.

## Operator draft composition

The base evidence template and OCI extension can be composed into one local DRAFT file without inventing live resources:

```bash
node .ci/compose-release-infrastructure-oci-evidence-template.mjs \
  --compose \
  ops/release-1/production-infrastructure-evidence.example.json \
  ops/release-1/production-infrastructure-oci-extension.example.json \
  /restricted/or/local/path/oci-r3-live-evidence.json
```

The composer fixes only the already-approved contract facts: OCI provider, `SA`, Riyadh primary and the Riyadh/Jeddah approved region set. It keeps `approved=false`, `overallStatus=DRAFT` and `productionAcceptance=false` semantics. Real resource references, immutable artifact digests, control results, recovery measurements and approvals must come from the actual environment.

The `Production Infrastructure Acceptance Contract` workflow self-tests the composer and validates the composed draft against both template validators. The generated CI artifact remains contract-validation-only and is not live evidence.

## Telemetry and SIEM destination regions

When `CAREPOINT_CLOUD_PROVIDER=oci` in production, data-bearing exports must declare an explicit processing destination region:

- `CAREPOINT_OTEL_DESTINATION_REGION` for OTLP traces/metrics;
- `CAREPOINT_SIEM_DESTINATION_REGION` for SIEM audit export.

Both values must be present in `CAREPOINT_APPROVED_DATA_REGIONS`. The canonical cloud contract independently requires the OCI KSA Release 1 topology (`me-riyadh-1` primary, `me-jeddah-1` DR) and rejects regions outside that set.

Outside the OCI production path, the existing OTLP and SIEM behavior is preserved.

## Validation

Contract-only validation can be run without an OCI account or network access:

```bash
node .ci/release-infrastructure-evidence-contract.mjs --self-test
node .ci/release-infrastructure-oci-evidence-contract.mjs --self-test
node .ci/compose-release-infrastructure-oci-evidence-template.mjs --self-test
node .ci/release-infrastructure-oci-evidence-contract.mjs \
  --validate-template ops/release-1/production-infrastructure-oci-extension.example.json
```

For a completed final evidence record that contains both the base v1 fields and the OCI extension fields, validate from the exact frozen RC checkout with:

```bash
node .ci/release-infrastructure-oci-evidence-contract.mjs \
  --validate <final-evidence.json> \
  --out <validated-result.json>
```

This command first executes the base v1 R3 validator and then the OCI/KSA extension validator.

## Acceptance boundary

R3 remains open until real OCI KSA infrastructure has been provisioned and exact Release Candidate evidence demonstrates the required production preflights, HA/TLS/PITR, recovery/failover measurements, approved data residency and required Operations/SRE/Database/Security/Privacy/Product approvals. Contract tests, composed drafts and synthetic references must never be presented as live infrastructure evidence.
