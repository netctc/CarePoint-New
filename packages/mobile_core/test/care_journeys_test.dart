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
import 'package:carepoint_mobile_core/care_journeys_form.dart';
import 'package:carepoint_mobile_core/care_provider_schedule.dart';

CarePointApi client(Future<http.Response> Function(http.Request) handler) => CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: MockClient(handler), tokenStore: MemoryCarePointTokenStore());
void main() {
  test('F1 dates reject normalised impossible calendar values', () {
    expect(parseJourneyDate('31/02/2026'), isNull); expect(parseJourneyDate('29/02/2025'), isNull);
    expect(parseJourneyDate('29/02/2024'), DateTime(2024, 2, 29)); expect(parseJourneyDate('2026-09-11'), isNull);
  });
  test('F1 dates display dd/mm/yyyy but API date-only values remain ISO', () {
    expect(journeyDate(DateTime(2026, 9, 11)), '11/09/2026'); expect(journeyIsoDate(DateTime(2026, 9, 11)), '2026-09-11');
  });
  test('F1 times reject invalid hours/minutes', () {
    expect(parseJourneyMinute('24:00'), isNull); expect(parseJourneyMinute('09:99'), isNull); expect(parseJourneyMinute('09:30'), 570);
  });
  test('F1 local time conversion preserves selected civil time', () {
    expect(parseJourneyLocalTime('11/09/2026', '09:30'), DateTime(2026, 9, 11, 9, 30));
  });
  test('F1 cancelled visits never enter upcoming', () {
    expect(journeyVisitBucket({'status': 'CANCELLED', 'endsAt': '2030-01-01T00:00:00Z'}, DateTime.utc(2026)), 'cancelled');
  });
  test('F1 ongoing confirmed visits remain upcoming until their end', () {
    expect(journeyVisitBucket({'status': 'CONFIRMED', 'endsAt': '2026-09-11T11:00:00Z'}, DateTime.utc(2026, 9, 11, 10)), 'upcoming');
  });
  test('F1 completed and past visits enter history', () {
    expect(journeyVisitBucket({'status': 'COMPLETED', 'endsAt': '2030-01-01T00:00:00Z'}, DateTime.utc(2026)), 'history');
    expect(journeyVisitBucket({'status': 'CONFIRMED', 'endsAt': '2025-01-01T00:00:00Z'}, DateTime.utc(2026)), 'history');
  });
  test('F1 booking snapshots cannot be changed by later form edits', () {
    final home = <String, dynamic>{'city': 'Synthetic city'};
    final intent = CareBookingIntent(slotId: 'slot-a', homeVisit: home, key: 'fixed-key');
    home['city'] = 'Changed'; intent.body['homeVisit']['city'] = 'Also changed';
    expect(intent.body['homeVisit']['city'], 'Synthetic city'); expect(intent.body['idempotencyKey'], 'fixed-key');
  });
  test('F1 distinct booking intents use distinct non-PHI keys', () {
    final a = CareBookingIntent(slotId: 'slot-a'), b = CareBookingIntent(slotId: 'slot-a');
    expect(a.idempotencyKey, isNot(b.idempotencyKey)); expect(a.idempotencyKey.contains('slot-a'), isFalse);
  });
  test('F1 stale search results are rejected by request epoch', () {
    final epoch = JourneyRequestEpoch(); final old = epoch.begin(), fresh = epoch.begin();
    expect(epoch.isCurrent(old), isFalse); expect(epoch.isCurrent(fresh), isTrue); epoch.invalidate(); expect(epoch.isCurrent(fresh), isFalse);
  });
  test('F1 all functional labels have EN AR FR ES translations', () {
    for (final entry in journeyLabels.entries) { expect(entry.value.length, 4, reason: entry.key); expect(entry.value.every((v) => v.trim().isNotEmpty), isTrue); }
    expect(journeyText(CarePointLocale.es, 'book'), 'Reservar cita');
  });
  test('F1 discovery forwards structured filters without bearer token', () async {
    final api = client((r) async {
      expect(r.url.path, '/api/v1/services/discovery'); expect(r.headers['authorization'], isNull);
      expect(r.url.queryParameters, {'q': 'heart', 'specialty': 'CARDIOLOGY', 'modality': 'CLINIC', 'location': 'Riyadh', 'page': '2', 'limit': '20'});
      return http.Response('{"items":[],"nextPage":null}', 200);
    })..accessToken = 'synthetic-token';
    await api.discoverCare({'q': ' heart ', 'specialty': 'CARDIOLOGY', 'modality': 'CLINIC', 'location': 'Riyadh', 'providerId': 'must-not-forward'}, page: 2);
  });
  test('F1 invalid pagination is rejected locally', () async {
    final api = client((_) async => throw StateError('must not send'));
    await expectLater(api.discoverCare({}, page: 0), throwsA(isA<CarePointApiException>()));
  });
  test('F1 contextual booking includes confirmations and stable retry key', () async {
    final bodies = <String>[];
    final api = client((r) async { bodies.add(r.body); expect(r.headers['authorization'], 'Bearer synthetic-token'); return http.Response('{"id":"visit-a"}', 201); })..accessToken = 'synthetic-token';
    final intent = CareBookingIntent(slotId: 'slot-a', homeVisit: {'addressValidated': true, 'contactConfirmed': true, 'latitude': 0.0, 'longitude': 0.0}, key: 'stable');
    await api.bookCare(intent.body); await api.bookCare(intent.body);
    expect(bodies[0], bodies[1]); expect(jsonDecode(bodies[0])['homeVisit']['contactConfirmed'], true);
  });
  test('F1 journey requests preserve shared session refresh', () async {
    var calls = 0;
    final api = client((r) async {
      if (r.url.path.endsWith('/iam/sessions/refresh')) return http.Response('{"accessToken":"new-access","refreshToken":"new-refresh"}', 200);
      calls++;
      if (calls == 1) return http.Response('{}', 401);
      expect(r.headers['authorization'], 'Bearer new-access'); return http.Response('[]', 200);
    })..accessToken = 'old-access'..refreshToken = 'old-refresh';
    await api.careLocations(); expect(calls, 2); expect(api.refreshToken, 'new-refresh');
  });
  test('F1 provider operations use authenticated scoped routes', () async {
    final paths = <String>[];
    final api = client((r) async { paths.add(r.url.path); expect(r.headers['authorization'], 'Bearer provider-token'); return http.Response('{}', 200); })..accessToken = 'provider-token';
    await api.setCareLocationActive('location-a', false);
    await api.setCareExceptionActive('exception-a', false);
    await api.setCareSlotBlocked('slot-a', false);
    await api.setCareDelivery('service-a', 'HOME_VISIT', {'homeVisitCoverage': {'radiusKm': 5}});
    expect(paths, ['/api/v1/provider/locations/location-a/status', '/api/v1/provider/availability/exceptions/exception-a/status', '/api/v1/provider/availability/slots/slot-a/unblock', '/api/v1/provider/services/service-a/delivery-context/HOME_VISIT']);
  });
  testWidgets('F1 provider schedule denies patient before calling APIs', (tester) async {
    final api = client((_) async => throw StateError('must not call'));
    await tester.pumpWidget(MaterialApp(home: CareProviderSchedule(session: CarePointSession(account: {'role': 'PATIENT'}, api: api), locale: CarePointLocale.en, allowedModalities: const [])));
    expect(find.text(journeyText(CarePointLocale.en, 'denied')), findsOneWidget);
  });
  testWidgets('F1 confirmation checkbox is never pre-approved', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: JourneyForm(locale: CarePointLocale.en, title: 'Test', fields: [JourneyField('addressValidated', 'addressConfirmed', kind: JourneyInput.confirmation)])));
    expect(tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value, false);
    await tester.tap(find.text('Review before confirming')); await tester.pump();
    expect(find.text('Required'), findsOneWidget);
  });
  testWidgets('F1 Arabic form preserves translated labels and RTL', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Directionality(textDirection: TextDirection.rtl, child: JourneyForm(locale: CarePointLocale.ar, title: 'Test', fields: journeyAddressFields(home: true)))));
    expect(find.text(journeyText(CarePointLocale.ar, 'address')), findsOneWidget);
    expect(Directionality.of(tester.element(find.byType(JourneyForm))), TextDirection.rtl);
  });
}
