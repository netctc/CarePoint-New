# Phase C16 - Hosted payment action trust boundary

## Purpose

Phase C16 prevents an external payment provider from turning CarePoint into a trusted launcher for an arbitrary HTTPS destination.

Before C16, the PSP response field `actionUrl` was accepted in production when it was syntactically valid HTTPS. The patient mobile financial workspace receives that value from CarePoint and can open it with the operating system's external browser/application launcher. HTTPS alone does not establish that the destination belongs to the contracted PSP: a compromised or defective provider response could otherwise point the user to a phishing or credential-collection origin.

C16 makes the API the authoritative trust boundary. A hosted payment action is returned to the client only when its exact origin is explicitly approved by deployment configuration.

## Production configuration

Production external payments require:

```text
PAYMENT_GATEWAY_ACTION_ORIGINS=https://checkout.psp.example,https://checkout-eu.psp.example
```

The value is a comma-separated list of exact origins. An origin consists of scheme, host and effective port. The PSP API endpoint and hosted checkout endpoint are intentionally configured separately because many providers use different domains for API traffic and customer-facing checkout pages.

Configured origins must satisfy all of the following:

- HTTPS only;
- no embedded username/password;
- no wildcard host;
- no path beyond `/`;
- no query string;
- no fragment;
- no localhost, `.localhost`, IPv4 loopback or IPv6 loopback target.

The policy canonicalizes each entry to `URL.origin`, removes duplicates and performs exact origin comparison. It does not use suffix matching or wildcard matching.

Examples:

- `https://checkout.psp.example` - valid
- `https://checkout.psp.example:443` - canonicalized to the default HTTPS origin
- `https://checkout.psp.example:8443` - a distinct origin and must be explicitly listed if required
- `https://*.psp.example` - invalid
- `https://checkout.psp.example/pay` - invalid as an allowlist entry

## Runtime provider action URL

When the PSP returns an `actionUrl` in production, CarePoint requires:

1. an absolute parseable URL;
2. HTTPS;
3. no embedded credentials;
4. no loopback destination;
5. exact `url.origin` membership in `PAYMENT_GATEWAY_ACTION_ORIGINS`.

Once the origin is trusted, the PSP-provided path, query string and fragment are preserved. Hosted payment products commonly use opaque session identifiers and signed state in these components, so C16 does not attempt to interpret or reconstruct them.

CarePoint returns the canonicalized URL only after the origin check succeeds.

## Error handling

An invalid or untrusted PSP action URL produces a generic sanitized gateway error:

```text
Payment gateway returned an untrusted hosted action URL.
```

The rejected URL, host, credentials, path and query are not copied into the CarePoint exception. Operators should correlate the payment intent and provider telemetry rather than logging a potentially hostile hosted URL.

## Client relationship

The current patient Flutter financial workspace already requires HTTPS before launching a hosted payment URL. That client-side check remains useful defense in depth, but it is not the authorization boundary.

Clients do not receive the PSP origin allowlist and are not expected to decide which provider domain is trusted. The API performs that decision before the `actionUrl` crosses the CarePoint API boundary. This also keeps provider-region/domain changes in deployment configuration rather than requiring a mobile release.

## Relationship to earlier phases

C16 composes with prior controls:

- C12 protects the PSP API credential through KMS-encrypted mounted secrets in production.
- C13 protects outbound PSP API requests with HTTPS endpoint validation, bounded timeout and redirect rejection.
- C14 bounds and validates the PSP JSON response before parsing it.
- C16 validates the browser-facing URL inside the already bounded response before returning it to a CarePoint client.

The API egress host and hosted payment origin are separate trust decisions and neither is inferred from the other.

## Rotation and multi-region providers

When a PSP introduces a new checkout origin:

1. obtain the new origin through the provider's trusted operational/security channel;
2. validate that it is an exact HTTPS origin, not a redirect target discovered dynamically;
3. add the new origin alongside the old one;
4. deploy/restart so the startup preflight validates the configuration;
5. exercise a provider `REQUIRES_ACTION` flow against the new region;
6. observe production traffic until the old checkout origin is no longer used;
7. remove the old origin and redeploy.

Do not use a wildcard to simplify regional rollout. List every contracted origin explicitly.

## Rollout

1. Inventory every legitimate hosted checkout origin used by the production PSP account.
2. Populate `PAYMENT_GATEWAY_ACTION_ORIGINS` with exact HTTPS origins.
3. Keep `PAYMENT_GATEWAY_BASE_URL`, timeout and C12 encrypted credential configuration unchanged.
4. Deploy C16.
5. Confirm startup passes `assertProductionPaymentActionPolicyReady()` before Nest application creation.
6. Exercise at least one payment flow that produces `REQUIRES_ACTION`.
7. Confirm the mobile client opens the expected PSP origin.
8. Verify a non-allowlisted test origin is rejected server-side.

## Rollback

The frozen C15 SHA remains the code rollback point. A provider change should normally be handled by updating the exact origin allowlist rather than removing the trust boundary. Do not work around a rejected hosted action by permitting arbitrary HTTPS destinations or suffix matching.

## Acceptance

After building the API, run:

```text
npm --workspace @carepoint/api run c16:hosted-payment-action-trust
```

The focused acceptance verifies:

- production external payments require a non-empty action-origin allowlist;
- origin entries are canonicalized and deduplicated;
- HTTP, credentials, path, query, fragment, wildcard and loopback allowlist entries are rejected;
- valid path/query/fragment session data is preserved for a trusted runtime action URL;
- exact-origin comparison rejects lookalike and phishing domains;
- embedded runtime URL credentials and loopback destinations are rejected;
- PSP API origin and hosted checkout origin may legitimately differ;
- `PaymentGatewayService` returns a trusted `REQUIRES_ACTION` URL;
- attacker URLs produce a sanitized error that does not reflect the rejected destination;
- the C16 production preflight executes before `NestFactory.create`;
- no hostname-matching dependency is added.

The full phase gate remains the four permanent workflows on the exact C16 candidate SHA: CI, Security Analysis, PostgreSQL Recovery and Slice 10 FHIR.
