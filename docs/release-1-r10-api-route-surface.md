# Release 1 API route-surface evidence

This R10 source-side control inventories the NestJS HTTP route surface for an exact Release 1 Git SHA and compares it with an explicit base SHA. It provides auditable API route-change evidence without starting CarePoint, connecting to a database or contacting any external provider.

It supports #96/#97/#135. It is intentionally **not** a full OpenAPI request/response schema contract.

## Why this control exists

The Release 1 process requires API change review, but the current repository does not expose a Swagger/OpenAPI generator or an `@nestjs/swagger` runtime dependency. Introducing a production documentation endpoint only for release evidence would unnecessarily change the runtime attack surface.

Instead, `.ci/generate-api-route-surface.mjs` uses the TypeScript compiler API already present in the build toolchain to parse repository source offline.

## Exact Git range

The generator requires:

- `CAREPOINT_RELEASE_BASE_SHA` — exact 40-hex comparison baseline;
- `CAREPOINT_RELEASE_SHA` — exact 40-hex candidate SHA;
- `CAREPOINT_RELEASE_VERSION` — the release/candidate version label.

The base must exist and be an ancestor of the candidate. The candidate must equal the checked-out `HEAD`.

The Release Candidate Evidence workflow already uses the exact pull-request base SHA and exact pull-request head SHA for validation. Manual candidate generation requires an explicit base SHA input; engineering does not guess which deployed release is authoritative.

## Route extraction

The generator reads Git objects for both SHAs and parses TypeScript under `services/api/src`.

It derives the global API prefix from the static `app.setGlobalPrefix(...)` call and recognizes Nest decorators imported from `@nestjs/common`:

- `@Controller`
- `@Get`
- `@Post`
- `@Put`
- `@Patch`
- `@Delete`
- `@Options`
- `@Head`
- `@All`
- `@Sse` (represented as GET route surface)

Named import aliases are supported. Controller and handler paths may be string literals, no-substitution template literals, or arrays of static string literals. `@Controller({ path: ... })` is also supported.

A path expression that cannot be represented deterministically is rejected rather than guessed. This means dynamic route construction becomes visible as a release-evidence failure until the generator can model it safely or the route is expressed statically.

## Route identity

Each candidate route records:

- HTTP method;
- normalized route path including the global prefix;
- repository source file;
- controller class;
- handler method.

The compatibility identity is `HTTP_METHOD + normalized path`.

Duplicate method/path identities fail the generator. This prevents the evidence package from silently representing an ambiguous route surface.

## Generated evidence

The generator writes:

### `api-route-surface.json`
Schema:

`carepoint.api-route-surface/v1`

Contains the exact candidate route surface, global prefix, route count and repository traceability metadata.

### `api-route-surface-diff.json`
Schema:

`carepoint.api-route-surface-diff/v1`

Contains:

- exact base SHA;
- exact candidate SHA;
- base/candidate route counts;
- added route identities;
- removed route identities;
- `hasRemovedRoutes`.

A removed route is reported for explicit release review. Removal is not automatically considered either acceptable or unacceptable because deprecation/retirement decisions require product/API ownership context.

### `api-route-surface-summary.md`
Human-readable summary of route counts and additions/removals. It repeats the evidence boundary that this is not a full schema compatibility assessment.

## Evidence boundary

The manifest explicitly records that generation is:

- offline from TypeScript AST;
- performed without starting the application;
- performed without database/provider access;
- route-identity focused;
- not a request-body schema inventory;
- not a query schema inventory;
- not a response schema inventory;
- not a full OpenAPI document or OpenAPI schema diff.

Therefore a green route-surface gate means CarePoint can deterministically identify endpoint additions/removals between two exact source SHAs. It does **not** prove semantic compatibility of payload schemas.

If schema-level OpenAPI compatibility becomes a mandatory release requirement, it should be implemented as a separately reviewed API contract capability rather than misrepresenting this route inventory as OpenAPI.

## Release Candidate Evidence integration

`Release Candidate Evidence`:

1. checks out the exact candidate with full Git history;
2. validates dependency and container supply-chain contracts;
3. generates the deterministic source-change inventory;
4. installs the verified Node dependency graph;
5. runs the API route-surface self-test;
6. generates base/candidate route evidence offline;
7. builds the Node workspaces and normal RC artifacts;
8. validates route evidence schema, SHA alignment, counts and fail-closed boundaries in `.ci/generate-rc-evidence.mjs`;
9. fingerprints `.ci/generate-api-route-surface.mjs` as an RC source contract;
10. adds the three route-surface artifacts to `rc-manifest.json` and `SHA256SUMS`.

## Self-test coverage

The generator self-test verifies:

- static global-prefix extraction;
- controller and handler path joining;
- controller path arrays;
- handler path arrays;
- decorators without explicit paths;
- aliased Nest decorator imports;
- rejection of a dynamic controller path;
- rejection of a dynamic handler path.

The exact repository run then provides the real-world validation over the complete API tree.

## Release interpretation

This control is repository-owned source evidence and may be completed before production infrastructure, providers, mobile signing, human UAT or regulatory approval.

It does not close those external release gates and does not authorize promotion to `main` or production deployment.
