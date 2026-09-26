# Release 1 final Go/No-Go readiness aggregator

This contract is the final fail-closed aggregation layer for CarePoint Release 1.

It does **not** replace R3-R10 evidence contracts, human approvals, production-equivalent execution, signed mobile release evidence, penetration testing, or regulatory/clinical acceptance. Its purpose is to prevent a final `GO` decision from being assembled from inconsistent or stale evidence.

## Accepted bundle requirements

A real bundle can validate only when all of the following are true:

- one exact full Git SHA is used by the release and every R3-R10 gate;
- R3, R4, R5, R6, R7, R8, R9 and R10 are all `PASS`;
- each gate has both repository contract evidence and external/live acceptance evidence;
- independent GitHub Advanced Security CodeQL is `PASS`;
- unresolved Critical/High security findings are zero;
- Security Owner disposition is explicitly approved;
- the external penetration/adversarial assessment is `PASS`;
- Patient, Doctor and Other Provider Android/iOS artifacts are signed, digest-bound and device-accepted;
- promotion is explicitly authorized from the protected Release 1 branch to `main`;
- Release Authority, Operations, SRE, Security, Database, Privacy/Compliance, Clinical Safety and Product/Market all approve;
- the final acceptance timestamp is not earlier than any required gate or approval.

The validator rejects placeholder evidence, secret/credential-like material and PHI-like keys.

## Commands

Contract self-test:

```bash
node .ci/release-final-go-live-readiness-contract.mjs --self-test
```

Validate the deliberately blocked example:

```bash
node .ci/release-final-go-live-readiness-contract.mjs \
  --validate-template ops/release-1/final-go-live-readiness.example.json
```

Validate a real restricted-evidence manifest copied into an approved execution environment:

```bash
node .ci/release-final-go-live-readiness-contract.mjs \
  --validate /path/to/final-go-live-readiness.json \
  --out /path/to/final-go-live-validation.json
```

Do not commit the real evidence manifest when it contains restricted environment references. The public repository should retain only sanitized hashes/status and approved non-sensitive references.

## CI boundary

The GitHub workflow validates the **contract and blocked template only**. Its own success is not production acceptance and explicitly records `productionAcceptance=false`.
