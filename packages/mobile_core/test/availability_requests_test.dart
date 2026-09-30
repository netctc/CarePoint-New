import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_journeys_models.dart';
import 'package:carepoint_mobile_core/care_journeys_localization.dart';
import 'package:carepoint_mobile_core/care_booking.dart';
import 'package:carepoint_mobile_core/availability_requests_models.dart';
import 'package:carepoint_mobile_core/availability_requests_localization.dart';
import 'package:carepoint_mobile_core/availability_request_form.dart';
import 'package:carepoint_mobile_core/availability_centre.dart';

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
CarePointSession session(Future<http.Response> Function(http.Request) handle, {String role = 'PATIENT'}) {
  final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: MockClient(handle), tokenStore: MemoryCarePointTokenStore())..accessToken = 'synthetic-access';
  return CarePointSession(account: {'role': role}, api: api);
}
Map<String, dynamic> service() => {'id': 'service-a', 'name': 'Synthetic service', 'currency': 'SAR', 'provider': {'displayName': 'Synthetic provider'}, 'modalities': [{'modality': 'TELEMEDICINE', 'priceMinor': 5000}]};
Map<String, dynamic> matches({bool empty = false}) => {'service': service(), 'items': empty ? [] : [{'id': 'slot-a', 'startsAt': DateTime.now().add(const Duration(days: 2)).toUtc().toIso8601String(), 'endsAt': DateTime.now().add(const Duration(days: 2, minutes: 30)).toUtc().toIso8601String()}], 'truncated': false};
Map<String, dynamic> entry({String name = 'Synthetic service', String status = 'WAITING'}) => {
  'id': 'request-a', 'serviceId': 'service-a', 'serviceName': name, 'providerName': 'Synthetic provider', 'modality': 'TELEMEDICINE', 'status': status,
  'fromAt': '2026-09-12T00:00:00.000Z', 'toAt': '2026-09-20T00:00:00.000Z',
  'notice': {'id': 'notice-a', 'version': 7, 'active': true, 'matchCount': 1, 'readAt': null, 'checkedAt': '2026-09-11T10:00:00.000Z'},
};
Future<void> openPage(WidgetTester tester, Widget page) async {
  await tester.binding.setSurfaceSize(const Size(1100, 1200));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => Scaffold(body: TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => page)), child: const Text('Open'))))));
  await tester.tap(find.text('Open')); await tester.pumpAndSettle();
}
Future<void> openDialog(WidgetTester tester, CarePointSession s, {CarePointLocale locale = CarePointLocale.en}) async {
  await tester.binding.setSurfaceSize(const Size(1100, 1200));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => Scaffold(body: TextButton(onPressed: () => askAvailabilityRequest(context, session: s, locale: locale, service: service(), modality: 'TELEMEDICINE'), child: const Text('Open'))))));
  await tester.tap(find.text('Open')); await tester.pumpAndSettle();
}
Future<void> selectSlot(WidgetTester tester) async {
  await tester.tap(find.widgetWithText(FilledButton, journeyText(CarePointLocale.en, 'book')));
  await tester.pump(); await tester.pump(const Duration(milliseconds: 350));
}
String t(String key) => availabilityText(CarePointLocale.en, key);
void main() {
  test('F3 ordinary booking intents retain their original request shape', () {
    expect(CareBookingIntent(slotId: 's', key: 'synthetic-key').body, {'slotId': 's', 'idempotencyKey': 'synthetic-key'});
  });
  test('F3 availability booking retries retain a deeply immutable body and request identity', () {
    final home = <String, dynamic>{'addressLine1': 'Synthetic address', 'contactConfirmed': true};
    final intent = AvailabilityBookingIntent(slotId: 's', requestId: 'r', homeVisit: home);
    final before = jsonEncode(intent.body);
    home['addressLine1'] = 'changed'; intent.body['availabilityRequestId'] = 'changed';
    (intent.body['homeVisit'] as Map)['contactConfirmed'] = false;
    expect(jsonEncode(intent.body), before); expect(intent.body['availabilityRequestId'], 'r');
  });
  test('F3 empty availability booking references are rejected', () {
    expect(() => AvailabilityBookingIntent(slotId: 's', requestId: ''), throwsArgumentError);
  });
  test('F3 date interval labels use inclusive dd/mm/yyyy end dates', () {
    final from = DateTime(2026, 9, 12), to = DateTime(2026, 9, 20);
    expect(availabilityWindowLabel({'fromAt': from.toUtc().toIso8601String(), 'toAt': to.toUtc().toIso8601String()}), '12/09/2026 - 19/09/2026');
    expect(availabilityWindowLabel({}), '-');
  });
  test('F3 all availability labels have all four supported languages', () {
    for (final row in availabilityLabels.values) { for (final language in ['en', 'ar', 'fr', 'es']) { expect(row[language], isNotEmpty); } }
  });
  test('F3 request API preserves bearer transport and encoded ownership-scoped paths', () async {
    final calls = <http.Request>[];
    final s = session((r) async { calls.add(r); return json({'items': []}); });
    await s.api.availabilityRequests(); await s.api.joinAvailabilityRequest({'serviceId': 's', 'inAppNotices': true});
    await s.api.checkAvailabilityRequest('r/a'); await s.api.availabilityRequestMatches('r/a');
    await s.api.withdrawAvailabilityRequest('r/a'); await s.api.markAvailabilityNoticeRead('r/a', 7);
    expect(calls.length, 6);
    for (final r in calls) { expect(r.headers['authorization'], 'Bearer synthetic-access'); expect(r.body.contains('patientId'), false); }
    expect(calls[2].url.toString(), contains('r%2Fa')); expect(jsonDecode(calls.last.body), {'version': 7});
  });
  test('F3 invalid page and view never issue requests', () async {
    var calls = 0; final s = session((r) async { calls++; return json({}); });
    await expectLater(s.api.availabilityRequests(page: 0), throwsA(isA<CarePointApiException>()));
    await expectLater(s.api.availabilityRequests(view: 'all-patients'), throwsA(isA<CarePointApiException>())); expect(calls, 0);
  });
  testWidgets('F3 request consent starts unchecked and no write occurs without it', (tester) async {
    var writes = 0; final s = session((r) async { writes++; return json({}); });
    await openDialog(tester, s);
    expect(tester.widget<CheckboxListTile>(find.byKey(const ValueKey('availability-consent'))).value, false);
    await tester.tap(find.widgetWithText(FilledButton, t('join'))); await tester.pumpAndSettle();
    expect(writes, 0); expect(find.text(t('invalid')), findsOneWidget);
  });
  testWidgets('F3 request dialog rejects impossible dates even with consent', (tester) async {
    var writes = 0; final s = session((r) async { writes++; return json({}); }); await openDialog(tester, s);
    await tester.tap(find.byKey(const ValueKey('availability-consent')));
    await tester.enterText(find.byKey(const ValueKey('availability-from')), '30/02/2026');
    await tester.tap(find.widgetWithText(FilledButton, t('join'))); await tester.pumpAndSettle();
    expect(writes, 0); expect(find.text(t('invalid')), findsOneWidget);
  });
  testWidgets('F3 confirmed request saves only a request and safely closes its date dialog', (tester) async {
    final calls = <http.Request>[]; final s = session((r) async { calls.add(r); return json({'id': 'r'}); }); await openDialog(tester, s);
    await tester.tap(find.byKey(const ValueKey('availability-consent'))); await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, t('join'))); await tester.pumpAndSettle();
    expect(calls.length, 1); expect(calls.single.url.path, endsWith('/availability-requests')); expect(jsonDecode(calls.single.body)['inAppNotices'], true);
    expect(find.byType(AvailabilityRequestDialog), findsNothing); expect(tester.takeException(), isNull);
  });
  testWidgets('F3 ambiguous request save retries an identical body without accepting form edits', (tester) async {
    final bodies = <String>[]; final s = session((r) async { bodies.add(r.body); return json(bodies.length == 1 ? {} : {'id': 'r'}, bodies.length == 1 ? 503 : 200); }); await openDialog(tester, s);
    await tester.tap(find.byKey(const ValueKey('availability-consent'))); await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, t('join'))); await tester.pumpAndSettle();
    expect(find.text(t('uncertain')), findsOneWidget); expect(tester.widget<TextField>(find.byKey(const ValueKey('availability-from'))).enabled, false);
    await tester.tap(find.widgetWithText(FilledButton, journeyText(CarePointLocale.en, 'retry'))); await tester.pumpAndSettle();
    expect(bodies.length, 2); expect(bodies[1], bodies[0]);
  });
  testWidgets('F3 an empty ordinary slot search offers the request entry point', (tester) async {
    final s = session((r) async => json([]));
    await openPage(tester, CareSlotsPage(session: s, locale: CarePointLocale.en, service: service(), modality: 'TELEMEDICINE'));
    expect(find.widgetWithText(OutlinedButton, t('join')), findsOneWidget);
  });
  testWidgets('F3 booking refreshes availability and still requires explicit final confirmation', (tester) async {
    var reads = 0; final writes = <http.Request>[];
    final s = session((r) async { if (r.method == 'POST') { writes.add(r); return json({'id': 'visit-a'}); } reads++; return json(matches()); });
    await openPage(tester, CareSlotsPage(session: s, locale: CarePointLocale.en, service: service(), modality: 'TELEMEDICINE', availabilityRequestId: 'request-a'));
    expect(find.widgetWithText(OutlinedButton, t('join')), findsNothing); await selectSlot(tester); expect(reads, 2); expect(writes, isEmpty);
    await tester.tap(find.widgetWithText(FilledButton, journeyText(CarePointLocale.en, 'confirm'))); await tester.pumpAndSettle();
    expect(writes.length, 1); expect(jsonDecode(writes.single.body)['availabilityRequestId'], 'request-a');
  });
  testWidgets('F3 ambiguous booking retries the same request-bound body', (tester) async {
    final bodies = <String>[]; final s = session((r) async { if (r.method == 'POST') { bodies.add(r.body); return json({}, bodies.length == 1 ? 503 : 200); } return json(matches()); });
    await openPage(tester, CareSlotsPage(session: s, locale: CarePointLocale.en, service: service(), modality: 'TELEMEDICINE', availabilityRequestId: 'request-a')); await selectSlot(tester);
    await tester.tap(find.widgetWithText(FilledButton, journeyText(CarePointLocale.en, 'confirm'))); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, journeyText(CarePointLocale.en, 'retry'))); await tester.pumpAndSettle();
    expect(bodies.length, 2); expect(bodies[1], bodies[0]);
  });
  testWidgets('F3 an opening lost before review cannot lead to a booking', (tester) async {
    var reads = 0, writes = 0; final s = session((r) async { if (r.method == 'POST') writes++; reads++; return json(matches(empty: reads > 1)); });
    await openPage(tester, CareSlotsPage(session: s, locale: CarePointLocale.en, service: service(), modality: 'TELEMEDICINE', availabilityRequestId: 'request-a')); await selectSlot(tester); await tester.pumpAndSettle();
    expect(writes, 0); expect(find.byType(AlertDialog), findsNothing); expect(find.text(t('none')), findsOneWidget);
  });
  testWidgets('F3 centre reads persisted notice state without automatically checking or booking', (tester) async {
    var writes = 0; final s = session((r) async { if (r.method != 'GET') writes++; return json({'items': [entry()]}); });
    await openPage(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en));
    expect(writes, 0); expect(find.textContaining(t('unread')), findsOneWidget); expect(find.text(t('onDemand')), findsOneWidget);
  });
  testWidgets('F3 withdrawing a request requires confirmation and never cancels a booking', (tester) async {
    final posts = <http.Request>[]; final s = session((r) async { if (r.method == 'POST') { posts.add(r); return json({}); } return json({'items': [entry(status: posts.isEmpty ? 'WAITING' : 'WITHDRAWN')]}); });
    await openPage(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en));
    await tester.tap(find.widgetWithText(TextButton, t('withdraw'))); await tester.pump(); await tester.pump(const Duration(milliseconds: 350)); expect(posts, isEmpty);
    await tester.tap(find.widgetWithText(FilledButton, journeyText(CarePointLocale.en, 'confirm'))); await tester.pumpAndSettle();
    expect(posts.length, 1); expect(posts.single.url.path, endsWith('/availability-requests/request-a/withdraw'));
  });
  testWidgets('F3 marking a notice read submits its displayed version', (tester) async {
    final posts = <http.Request>[]; final s = session((r) async { if (r.method == 'POST') { posts.add(r); return json({}); } return json({'items': [entry()]}); });
    await openPage(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en));
    await tester.tap(find.widgetWithText(TextButton, t('markRead'))); await tester.pumpAndSettle();
    expect(posts.length, 1); expect(jsonDecode(posts.single.body), {'version': 7});
  });
  testWidgets('F3 stale request-list responses cannot replace a newer view', (tester) async {
    final delayed = Completer<http.Response>(); var calls = 0;
    final s = session((r) async { calls++; if (calls == 2) return delayed.future; return json({'items': [entry(name: calls == 1 ? 'Initial' : 'New notice')]}); });
    await openPage(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en));
    await tester.tap(find.text(t('notices'))); await tester.pump(); await tester.tap(find.text(t('requests'))); await tester.pumpAndSettle();
    expect(find.text('New notice'), findsOneWidget); delayed.complete(json({'items': [entry(name: 'Old notice')]})); await tester.pumpAndSettle();
    expect(find.text('Old notice'), findsNothing); expect(find.text('New notice'), findsOneWidget);
  });
  testWidgets('F3 Arabic centre retains RTL and translated request state', (tester) async {
    final s = session((r) async => json({'items': [entry()]})); await openPage(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.ar));
    final label = find.text(availabilityText(CarePointLocale.ar, 'WAITING')); expect(label, findsOneWidget); expect(Directionality.of(tester.element(label)), TextDirection.rtl);
  });
  testWidgets('F3 a non-patient cannot load the availability centre', (tester) async {
    var calls = 0; final s = session((r) async { calls++; return json({}); }, role: 'DOCTOR');
    await openPage(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en)); expect(calls, 0); expect(find.text(journeyText(CarePointLocale.en, 'denied')), findsOneWidget);
  });
}
