import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_journeys_localization.dart';
import 'package:carepoint_mobile_core/care_provider_actions.dart';
import 'package:carepoint_mobile_core/care_planning_localization.dart';
import 'package:carepoint_mobile_core/availability_demand_localization.dart';
import 'package:carepoint_mobile_core/provider_availability_demand.dart';

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
CarePointSession session(Future<http.Response> Function(http.Request) handle, {String role = 'DOCTOR'}) {
  final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: MockClient(handle), tokenStore: MemoryCarePointTokenStore())..accessToken = 'synthetic-token';
  return CarePointSession(account: {'role': role}, api: api);
}
Map<String, dynamic> row(String name, {String id = 'service-a', String modality = 'CLINIC', bool active = true}) => {
  'serviceId': id, 'serviceName': name, 'modality': modality, 'requestCount': 3,
  'earliestRequestedAt': DateTime(2026, 9, 12).toUtc().toIso8601String(),
  'latestRequestedAt': DateTime(2026, 9, 20).toUtc().toIso8601String(),
  'serviceActive': active, 'modalityActive': true,
};
Map<String, dynamic> page(List<Map<String, dynamic>> rows, {int? next}) => {'items': rows, 'nextPage': next, 'checkedAt': '2026-09-11T12:00:00Z'};
String t(String key) => availabilityDemandText(CarePointLocale.en, key);
Future<void> open(WidgetTester tester, CarePointSession s, {CarePointLocale locale = CarePointLocale.en}) async {
  await tester.binding.setSurfaceSize(const Size(430, 900));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: ProviderAvailabilityDemandPage(session: s, locale: locale)));
  await tester.pumpAndSettle();
}
void main() {
  test('F3.1 demand labels cover EN AR FR ES', () {
    for (final label in availabilityDemandLabels.values) { for (final locale in ['en', 'ar', 'fr', 'es']) { expect(label[locale], isNotEmpty); } }
  });
  test('F3.1 demand API retains bearer authentication and never supplies an owner', () async {
    final calls = <http.Request>[];
    final s = session((r) async { calls.add(r); return json(page([])); });
    await s.api.providerAvailabilityDemand(page: 2);
    expect(calls.single.method, 'GET'); expect(calls.single.headers['authorization'], 'Bearer synthetic-token');
    expect(calls.single.url.path, '/api/v1/provider/availability-demand'); expect(calls.single.url.queryParameters, {'page': '2'}); expect(calls.single.body, '');
  });
  test('F3.1 invalid demand pagination is rejected without HTTP', () async {
    var calls = 0; final s = session((r) async { calls++; return json({}); });
    for (final value in [0, -1, 1001]) { await expectLater(s.api.providerAvailabilityDemand(page: value), throwsA(isA<CarePointApiException>())); }
    expect(calls, 0);
  });
  testWidgets('F3.1 provider sees counts, translated modality and inclusive dates with no writes', (tester) async {
    final calls = <http.Request>[]; final s = session((r) async { calls.add(r); return json(page([row('Synthetic demand')])); });
    await open(tester, s);
    expect(find.text('Synthetic demand'), findsOneWidget); expect(find.text('${t('count')}: 3'), findsOneWidget);
    expect(find.textContaining('12/09/2026 - 19/09/2026'), findsOneWidget);
    expect(find.text(journeyText(CarePointLocale.en, 'CLINIC')), findsOneWidget);
    expect(find.text(t('policy')), findsOneWidget); expect(calls.length, 1); expect(calls.single.method, 'GET'); expect(tester.takeException(), isNull);
  });
  for (final role in ['PATIENT', 'ADMIN', 'SUPPORT']) {
    testWidgets('F3.1 $role cannot fetch provider demand from the page', (tester) async {
      var calls = 0; final s = session((r) async { calls++; return json({}); }, role: role);
      await open(tester, s); expect(calls, 0); expect(find.text(journeyText(CarePointLocale.en, 'denied')), findsOneWidget);
    });
  }
  testWidgets('F3.1 empty demand does not suggest any guaranteed appointment', (tester) async {
    await open(tester, session((r) async => json(page([]))));
    expect(find.text(t('empty')), findsOneWidget); expect(find.text(t('policy')), findsOneWidget);
  });
  testWidgets('F3.1 inactive service is labelled without hiding its requests', (tester) async {
    await open(tester, session((r) async => json(page([row('Inactive service', active: false)]))));
    expect(find.text('Inactive service'), findsOneWidget); expect(find.text(t('inactive')), findsOneWidget);
  });
  testWidgets('F3.1 refresh replaces old groups and does not duplicate them', (tester) async {
    var calls = 0; final s = session((r) async { calls++; return json(page([row(calls == 1 ? 'Before refresh' : 'After refresh')])); });
    await open(tester, s);
    await tester.tap(find.widgetWithText(TextButton, t('refresh'))); await tester.pumpAndSettle();
    expect(find.text('Before refresh'), findsNothing); expect(find.text('After refresh'), findsOneWidget); expect(calls, 2);
  });
  testWidgets('F3.1 pagination keeps separate modalities and deduplicates repeated service groups', (tester) async {
    final s = session((r) async => json(r.url.queryParameters['page'] == '1' ? page([row('Clinic')], next: 2) : page([row('Clinic'), row('Remote', modality: 'TELEMEDICINE')])));
    await open(tester, s);
    await tester.ensureVisible(find.widgetWithText(OutlinedButton, t('more')));
    await tester.tap(find.widgetWithText(OutlinedButton, t('more'))); await tester.pumpAndSettle();
    expect(find.text('Clinic'), findsOneWidget); expect(find.text('Remote'), findsOneWidget); expect(find.text(t('more')), findsNothing);
  });
  testWidgets('F3.1 credential denial clears previously displayed demand', (tester) async {
    var calls = 0; final s = session((r) async { calls++; return calls == 1 ? json(page([row('Old demand')])) : json({'message': 'Denied'}, 403); });
    await open(tester, s); await tester.tap(find.widgetWithText(TextButton, t('refresh'))); await tester.pumpAndSettle();
    expect(find.text('Old demand'), findsNothing); expect(find.text(journeyText(CarePointLocale.en, 'denied')), findsOneWidget);
  });
  testWidgets('F3.1 network failure has a working retry', (tester) async {
    var calls = 0; final s = session((r) async { calls++; return calls == 1 ? json({}, 503) : json(page([row('Recovered')])); });
    await open(tester, s);
    await tester.tap(find.text(journeyText(CarePointLocale.en, 'retry'))); await tester.pumpAndSettle();
    expect(find.text('Recovered'), findsOneWidget); expect(calls, 2);
  });
  testWidgets('F3.1 an old pagination response cannot overwrite a newer refresh', (tester) async {
    var calls = 0; final delayed = Completer<http.Response>();
    final s = session((r) async { calls++; if (calls == 2) return delayed.future; return json(page([row(calls == 1 ? 'Initial' : 'Fresh')], next: calls == 1 ? 2 : null)); });
    await open(tester, s);
    await tester.ensureVisible(find.text(t('more'))); await tester.tap(find.text(t('more'))); await tester.pump();
    final refreshing = tester.state<RefreshIndicatorState>(find.byType(RefreshIndicator)).show();
    await tester.pumpAndSettle(); await refreshing;
    delayed.complete(json(page([row('Stale page', id: 'stale')]))); await tester.pumpAndSettle();
    expect(find.text('Fresh'), findsOneWidget); expect(find.text('Stale page'), findsNothing); expect(find.text('Initial'), findsNothing);
  });
  testWidgets('F3.1 Arabic demand page preserves RTL and narrow-screen layout', (tester) async {
    await open(tester, session((r) async => json(page([row('Synthetic Arabic service')]))), locale: CarePointLocale.ar);
    final label = find.text(availabilityDemandText(CarePointLocale.ar, 'title'));
    expect(Directionality.of(tester.element(label)), TextDirection.rtl); expect(tester.takeException(), isNull);
  });
  for (final role in ['DOCTOR', 'OTHER_PROVIDER']) {
    testWidgets('F3.1 $role menu opens new demand and retains the F2 entry', (tester) async {
      final calls = <http.Request>[];
      final s = session((r) async { calls.add(r); return json(page([])); }, role: role);
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: CareProviderActions(
        session: s, locale: CarePointLocale.en, allowedModalities: const ['CLINIC'], onSignOut: () {}, accent: Colors.blue, child: const SizedBox.expand(),
      ))));
      await tester.tap(find.byType(PopupMenuButton<String>)); await tester.pumpAndSettle();
      expect(find.text(planningText(CarePointLocale.en, 'demand')), findsOneWidget);
      await tester.tap(find.text(t('title'))); await tester.pumpAndSettle();
      expect(find.byType(ProviderAvailabilityDemandPage), findsOneWidget);
      expect(calls.single.url.path, '/api/v1/provider/availability-demand');
    });
  }
}
