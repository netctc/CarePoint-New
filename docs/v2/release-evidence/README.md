# V2 Release Evidence

Every V2 delivery slice leaves reproducible evidence tied to an immutable source SHA.

Required fields:
- source SHA and branch;
- functional IDs;
- build/typecheck/analyzer results;
- automated test results;
- migration state and recovery notes;
- security/privacy checks;
- API/contract compatibility;
- mobile/web compatibility where affected;
- known exceptions and external/manual gates;
- rollback/compensation procedure.

Evidence must never contain credentials, access tokens, encryption keys, raw PHI, private clinical payloads or production secrets.
