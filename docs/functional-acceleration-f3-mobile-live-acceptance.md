# F3.2 - Headless Flutter journeys against the live API

Continuation of issue #143 and draft PR #141. Baseline: `e45d2a406baab43c8e3ba275c7627bcf60f72fd9`, independently observed with all 17 workflows successful, including the six Android/iOS compatibility jobs. No merge or production deployment.

## Evidence gap addressed

The existing Flutter tests supply controlled HTTP responses; the separate Node HTTP suite runs the actual API. F3.2 joins these layers: production Flutter request, availability-centre, professional-menu/demand and booking widgets use the production `CarePointApi` and a real `IOClient` against the already running isolated CI API and PostgreSQL. The live suite is outside the ordinary `test/` directory and is invoked explicitly. No unit test, release gate, dependency version, lock or application permission is removed or bypassed.

The harness disables Flutter's normal fake-HTTP binding only for this opt-in suite. Real asynchronous I/O runs inside `runAsync`; widget progress has bounded waits. The transport permits only the fixture's loopback origin and API prefix, does not follow redirects, and uses no network proxy. It never synthesises successful responses. One deliberately adversarial case consumes a real successful booking reply and drops it before the application receives it, then uses the actual UI retry to verify that the committed booking is not duplicated.

## Four scenarios

1. English patient UI: initially unchecked request opt-in, no request without consent, public service data, owned request persistence, on-demand availability observation, acknowledgement and read state after reopening, Doctor menu/demand, fresh contextual review, explicit booking and disappearance of fulfilled demand.
2. Ambiguous booking: the API commits before a simulated response loss. The screen retries the exact immutable request-bound command; the actual appointment, invoice and slot count remain singular.
3. Arabic patient and Other Provider UI: real request/notice/demand responses, RTL, cancelling the withdrawal confirmation preserves WAITING; confirming withdrawal persists WITHDRAWN and removes professional demand without creating a booking.
4. Production Dart client security integration: anonymous rejection, real refresh-token rotation after invalid access, cross-patient reads/mutations denied, provider ownership/role isolation, session revocation and local credential clearing. This fourth case exercises the client, not an additional full-screen journey.

After Flutter completes, an independent Node verifier reads PostgreSQL directly for each isolated actor: exact request/service/provider scope and opt-in version; fulfilled/withdrawn/waiting state; notice closure; appointment/invoice linkage; and slot booked count. A receipt bound to the fixture run tag and checked-out commit must cover all four scenarios. Counts are four scenarios, not the number of individual assertions.

## Fixture and operational safety

The setup refuses non-test environments, missing explicit flags, non-CI execution, non-loopback addresses, a different database name and non-mock clinical/financial/notification gateways. Providers and services are provisioned as synthetic fixtures, with VERIFIED current credentials; this is not provider-onboarding UAT. Freshly generated test users receive an ephemeral test password. Credentials and opaque test IDs are written only to a mode-0600 file in RUNNER_TEMP, never committed, printed or uploaded. The shell cleanup removes the fixture and result files on success or failure. Database records remain confined to the disposable CI service; constraints are never disabled and no destructive database cleanup is used.

The existing CI Node job adds Flutter with the already pinned repository version/action, checks the unchanged mobile lock hashes, runs this suite and then the independent database verifier. Missing setup is a failure, not a silently skipped suite. Exact candidate/run IDs and observed results belong in PR #141/#143 after execution; committed test source alone is not success evidence.

## What this does not prove

This is headless widget-to-live-API integration, not physical-device UAT, a signed native release, platform secure-storage/keyboard/plugin acceptance, camera/audio/media quality, a production gateway test, independent security certification or go-live approval. Memory token storage is used only by the test client; the application's secure-store default is unchanged. English and Arabic live journeys complement, but do not replace, existing four-language tests and native compatibility builds. Full deployed-device E2E, approved scheduling-data retention and external/environment/human acceptance remain open.

Framework references: Flutter TestWidgetsFlutterBinding.overrideHttpClient and WidgetTester.runAsync API documentation; Dart dart:io and package:http IOClient. These are harness mechanics, not runtime application changes.
