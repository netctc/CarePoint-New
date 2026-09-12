import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_journeys_localization.dart';
import 'package:carepoint_mobile_core/care_booking.dart';
import 'package:carepoint_mobile_core/care_provider_actions.dart';
import 'package:carepoint_mobile_core/availability_centre.dart';
import 'package:carepoint_mobile_core/availability_request_form.dart';
import 'package:carepoint_mobile_core/availability_requests_localization.dart';
import 'package:carepoint_mobile_core/availability_demand_localization.dart';
import 'package:carepoint_mobile_core/provider_availability_demand.dart';
import 'live_api_harness.dart';

String a(CarePointLocale locale, String key) => availabilityText(locale, key);
String j(CarePointLocale locale, String key) => journeyText(locale, key);
Future<JsonMap> ownedRequest(LiveActor patient) async => asRows((await patient.api.availabilityRequests())['items']).single;

Future<String> requestThroughUi(WidgetTester tester, LiveActor patient, JsonMap scenario, CarePointLocale locale) async {
  // The display model comes from the public API, not a hand-written UI fixture.
  final service = (await patient.api.searchServices(query: scenario['serviceName'] as String)).singleWhere((row) => row['id'] == scenario['serviceId']);
  await tester.pumpWidget(MaterialApp(key: UniqueKey(), home: Builder(builder: (context) => Scaffold(body: TextButton(
    key: const ValueKey('new-live-request'),
    onPressed: () => askAvailabilityRequest(context, session: patient.session, locale: locale, service: service, modality: 'CLINIC'),
    child: const Text('New synthetic request'),
  )))));
  await pressLive(tester, find.byKey(const ValueKey('new-live-request')));
  await waitForLive(tester, () => find.byType(AvailabilityRequestDialog).evaluate().isNotEmpty, 'request dialog');
  expect(tester.widget<CheckboxListTile>(find.byKey(const ValueKey('availability-consent'))).value, false);
  final before = patient.client.calls.where((value) => value == 'POST /api/v1/availability-requests').length;
  await pressLive(tester, find.widgetWithText(FilledButton, a(locale, 'join')));
  expect(find.text(a(locale, 'invalid')), findsOneWidget);
  expect(patient.client.calls.where((value) => value == 'POST /api/v1/availability-requests').length, before);
  await pressLive(tester, find.byKey(const ValueKey('availability-consent')));
  await pressLive(tester, find.widgetWithText(FilledButton, a(locale, 'join')));
  await waitForLive(tester, () => find.byType(AvailabilityRequestDialog).evaluate().isEmpty, 'request persisted and dialog closed');
  final row = await ownedRequest(patient);
  expect(row['status'], 'WAITING'); expect(row['serviceId'], scenario['serviceId']);
  expect(row['notice'], isNull); expect(await patient.api.myAppointments(), isEmpty);
  expect(patient.client.bookingBodies, isEmpty);
  return row['id'] as String;
}
Future<void> openCentre(WidgetTester tester, LiveActor patient, String requestId, CarePointLocale locale) async {
  await openLivePage(tester, CareAvailabilityCentrePage(session: patient.session, locale: locale));
  await waitForLive(tester, () => find.byKey(ValueKey('availability-$requestId')).evaluate().isNotEmpty, 'owned request card');
}
Future<void> observeThroughUi(WidgetTester tester, LiveActor patient, String requestId, CarePointLocale locale) async {
  await openCentre(tester, patient, requestId, locale);
  await pressLive(tester, find.widgetWithText(OutlinedButton, a(locale, 'check')));
  await waitForLive(tester, () => find.widgetWithText(TextButton, a(locale, 'markRead')).evaluate().isNotEmpty, 'persisted unread notice');
  final notice = asMap((await ownedRequest(patient))['notice']);
  expect(notice['active'], true); expect(notice['matchCount'], 1); expect(notice['readAt'], isNull);
}
Future<void> providerScreen(WidgetTester tester, LiveActor owner, JsonMap scenario, CarePointLocale locale, {required bool empty}) async {
  final before = owner.client.calls.length;
  await tester.pumpWidget(MaterialApp(key: UniqueKey(), home: Scaffold(body: CareProviderActions(
    session: owner.session, locale: locale, allowedModalities: const ['CLINIC'], onSignOut: () {}, accent: Colors.blue, child: const SizedBox.expand(),
  ))));
  await pressLive(tester, find.byType(PopupMenuButton<String>));
  await pressLive(tester, find.text(availabilityDemandText(locale, 'title')));
  final card = find.byKey(ValueKey('demand-${scenario['serviceId']}-CLINIC'));
  await waitForLive(tester, () => empty ? find.text(availabilityDemandText(locale, 'empty')).evaluate().isNotEmpty : card.evaluate().isNotEmpty, 'live professional demand');
  expect(find.byType(ProviderAvailabilityDemandPage), findsOneWidget);
  if (!empty) expect(find.text('${availabilityDemandText(locale, 'count')}: 1'), findsOneWidget);
  expect(owner.client.calls.sublist(before), ['GET /api/v1/provider/availability-demand']);
  final response = await owner.api.providerAvailabilityDemand(); assertSafeDemand(response);
  expect(asRows(response['items']).length, empty ? 0 : 1);
  if (locale == CarePointLocale.ar) expect(Directionality.of(tester.element(find.text(availabilityDemandText(locale, 'title')))), TextDirection.rtl);
}
Future<String> bookThroughUi(WidgetTester tester, LiveActor patient, String requestId, {required bool loseReply}) async {
  const locale = CarePointLocale.en;
  await openCentre(tester, patient, requestId, locale);
  await pressLive(tester, find.widgetWithText(OutlinedButton, a(locale, 'view')));
  await waitForLive(tester, () => find.widgetWithText(FilledButton, j(locale, 'book')).evaluate().isNotEmpty, 'live request-bound slots');
  expect(find.byType(CareSlotsPage), findsOneWidget);
  await pressLive(tester, find.widgetWithText(FilledButton, j(locale, 'book')));
  await waitForLive(tester, () => find.byType(AlertDialog).evaluate().isNotEmpty, 'fresh contextual booking review');
  expect(patient.client.bookingBodies, isEmpty);
  expect(await patient.api.myAppointments(), isEmpty);
  patient.client.loseNextBookingReply = loseReply;
  await pressLive(tester, find.widgetWithText(FilledButton, j(locale, 'confirm')));
  if (loseReply) {
    // The disabled retry widget is already built while the first HTTP request
    // is pending. Wait for the real committed reply loss and enabled action.
    final retry = find.widgetWithText(FilledButton, j(locale, 'retry'));
    await waitForLive(tester, () => patient.client.committedRepliesLost == 1 &&
      retry.evaluate().length == 1 && tester.widget<FilledButton>(retry).onPressed != null,
      'ambiguous successful booking reply');
    expect(patient.client.committedRepliesLost, 1);
    expect(patient.client.bookingBodies.length, 1);
    expect((await patient.api.myAppointments()).length, 1);
    await pressLive(tester, retry);
  }
  await waitForLive(tester, () => find.byType(CareAvailabilityCentrePage).evaluate().isEmpty && find.byType(CareSlotsPage).evaluate().isEmpty, 'booking navigation completed');
  expect(patient.client.bookingBodies.length, loseReply ? 2 : 1);
  if (loseReply) expect(patient.client.bookingBodies[0] == patient.client.bookingBodies[1], true, reason: 'Retry must preserve the exact immutable command.');
  final visit = (await patient.api.myAppointments()).single;
  final request = await ownedRequest(patient);
  expect(request['status'], 'FULFILLED'); expect(request['bookedAppointmentId'], visit['id']);
  expect(asMap(request['notice'])['active'], false);
  return visit['id'] as String;
}

void main() {
  LocalLiveApiBinding();
  WidgetController.hitTestWarningShouldBeFatal = true;
  late LiveFixture fixture;
  setUpAll(() async { fixture = await LiveFixture.read(); });
  tearDownAll(() async { await fixture.writeResults(); });

  testWidgets('F3.2 live EN request, notice, persisted read state, Doctor demand and explicit booking', (tester) async {
    await runLive(tester, fixture, () async {
      final scenario = fixture.scenario('book');
      final patient = await fixture.login(asMap(scenario['patient']), 'PATIENT');
      final owner = await fixture.login(asMap(scenario['owner']), 'DOCTOR');
      final requestId = await requestThroughUi(tester, patient, scenario, CarePointLocale.en);
      await observeThroughUi(tester, patient, requestId, CarePointLocale.en);
      await pressLive(tester, find.widgetWithText(TextButton, a(CarePointLocale.en, 'markRead')));
      await waitForLive(tester, () => find.widgetWithText(TextButton, a(CarePointLocale.en, 'markRead')).evaluate().isEmpty, 'notice acknowledged');
      final notice = asMap((await ownedRequest(patient))['notice']);
      expect(notice['readAt'], isNotNull);
      final writesBefore = patient.client.calls.where((value) => value.startsWith('POST ')).length;
      await openCentre(tester, patient, requestId, CarePointLocale.en);
      expect(find.widgetWithText(TextButton, a(CarePointLocale.en, 'markRead')), findsNothing);
      expect(patient.client.calls.where((value) => value.startsWith('POST ')).length, writesBefore);
      expect(asMap((await ownedRequest(patient))['notice'])['readAt'], notice['readAt']);
      await providerScreen(tester, owner, scenario, CarePointLocale.en, empty: false);
      final appointmentId = await bookThroughUi(tester, patient, requestId, loseReply: false);
      await providerScreen(tester, owner, scenario, CarePointLocale.en, empty: true);
      fixture.record('book', requestId, appointmentId);
    });
  });
  testWidgets('F3.2 live booking committed before reply loss replays the same UI intent without duplication', (tester) async {
    await runLive(tester, fixture, () async {
      final scenario = fixture.scenario('retry');
      final patient = await fixture.login(asMap(scenario['patient']), 'PATIENT');
      final requestId = await requestThroughUi(tester, patient, scenario, CarePointLocale.en);
      await observeThroughUi(tester, patient, requestId, CarePointLocale.en);
      final appointmentId = await bookThroughUi(tester, patient, requestId, loseReply: true);
      fixture.record('retry', requestId, appointmentId);
    });
  });
  testWidgets('F3.2 live Arabic request and Other Provider demand disappear only after confirmed withdrawal', (tester) async {
    await runLive(tester, fixture, () async {
      const locale = CarePointLocale.ar;
      final scenario = fixture.scenario('withdraw');
      final patient = await fixture.login(asMap(scenario['patient']), 'PATIENT');
      final owner = await fixture.login(asMap(scenario['owner']), 'OTHER_PROVIDER');
      final requestId = await requestThroughUi(tester, patient, scenario, locale);
      await observeThroughUi(tester, patient, requestId, locale);
      expect(Directionality.of(tester.element(find.text(a(locale, 'centre')))), TextDirection.rtl);
      await providerScreen(tester, owner, scenario, locale, empty: false);
      await openCentre(tester, patient, requestId, locale);
      await pressLive(tester, find.widgetWithText(TextButton, a(locale, 'withdraw')));
      await waitForLive(tester, () => find.byType(AlertDialog).evaluate().isNotEmpty, 'withdrawal review');
      await pressLive(tester, find.widgetWithText(TextButton, j(locale, 'cancel')));
      await waitForLive(tester, () => find.byType(AlertDialog).evaluate().isEmpty, 'cancel withdrawal');
      expect((await ownedRequest(patient))['status'], 'WAITING');
      await pressLive(tester, find.widgetWithText(TextButton, a(locale, 'withdraw')));
      await waitForLive(tester, () => find.byType(AlertDialog).evaluate().isNotEmpty, 'second withdrawal review');
      await pressLive(tester, find.widgetWithText(FilledButton, j(locale, 'confirm')));
      await waitForLive(tester, () => find.text(a(locale, 'WITHDRAWN')).evaluate().isNotEmpty, 'withdrawal persisted');
      expect((await ownedRequest(patient))['status'], 'WITHDRAWN');
      expect(await patient.api.myAppointments(), isEmpty); expect(patient.client.bookingBodies, isEmpty);
      await providerScreen(tester, owner, scenario, locale, empty: true);
      fixture.record('withdraw', requestId, null);
    });
  });
  testWidgets('F3.2 production Dart client rotates a real session, denies other owners and clears revoked tokens', (tester) async {
    await runLive(tester, fixture, () async {
      final scenario = fixture.scenario('isolation');
      final anonymous = fixture.anonymous();
      await expectStatus(anonymous.api.availabilityRequests(), 401);
      final patient = await fixture.login(asMap(scenario['patient']), 'PATIENT');
      final other = await fixture.login(asMap(scenario['outsider']), 'PATIENT');
      final owner = await fixture.login(asMap(scenario['owner']), 'DOCTOR');
      final otherOwner = await fixture.login(asMap(scenario['otherOwner']), 'DOCTOR');
      final request = await patient.api.joinAvailabilityRequest(asMap(scenario['input']));
      final requestId = request['id'] as String;
      final oldRefresh = patient.api.refreshToken;
      patient.api.accessToken = 'synthetic-expired-access';
      expect((await ownedRequest(patient))['id'], requestId);
      expect(patient.api.refreshToken != oldRefresh, true, reason: 'The real refresh endpoint must rotate the token.');
      expect(patient.client.calls.where((value) => value == 'POST /api/v1/iam/sessions/refresh').length, 1);
      await expectStatus(other.api.availabilityRequestMatches(requestId), 404);
      await expectStatus(other.api.checkAvailabilityRequest(requestId), 404);
      await expectStatus(other.api.markAvailabilityNoticeRead(requestId, 1), 404);
      await expectStatus(other.api.withdrawAvailabilityRequest(requestId), 404);
      expect(asRows((await other.api.availabilityRequests())['items']), isEmpty);
      await expectStatus(patient.api.providerAvailabilityDemand(), 403);
      await expectStatus(owner.api.availabilityRequests(), 403);
      final aggregate = await owner.api.providerAvailabilityDemand(); assertSafeDemand(aggregate);
      expect(asRows(aggregate['items']).single['serviceId'], scenario['serviceId']);
      expect(asRows((await otherOwner.api.providerAvailabilityDemand())['items']), isEmpty);
      final current = (await patient.api.accountSessions()).singleWhere((row) => row['current'] == true);
      await patient.api.revokeAccountSession(current['id'] as String);
      await expectStatus(patient.api.availabilityRequests(), 401);
      expect(patient.api.isAuthenticated, false); expect(patient.api.refreshToken == null, true);
      expect(await patient.store.readAccessToken() == null, true);
      expect(await patient.store.readRefreshToken() == null, true);
      fixture.record('isolation', requestId, null);
    });
  });
}
