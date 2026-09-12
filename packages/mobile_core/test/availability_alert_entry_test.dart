import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/availability_alert_entry.dart';
import 'package:carepoint_mobile_core/availability_centre.dart';
import 'package:carepoint_mobile_core/availability_requests_localization.dart';

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
CarePointSession session(Future<http.Response> Function(http.Request) handle, {String role = 'PATIENT'}) {
  final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: MockClient(handle), tokenStore: MemoryCarePointTokenStore())..accessToken = 'synthetic';
  return CarePointSession(account: {'role': role}, api: api);
}
Map<String, dynamic> request(String id, {String status = 'WAITING', bool available = true}) => {
  'id': id, 'serviceId': 'service-a', 'serviceName': 'Synthetic service', 'providerName': 'Synthetic provider', 'modality': 'CLINIC', 'status': status,
  'fromAt': '2026-09-12T00:00:00Z', 'toAt': '2026-09-20T00:00:00Z',
  'notice': available ? {'id': 'notice-$id', 'version': 2, 'active': true, 'matchCount': 1, 'checkedAt': '2026-09-11T18:00:00Z', 'readAt': null} : null,
};
Future<void> pump(WidgetTester tester, Widget child) async {
  await tester.binding.setSurfaceSize(const Size(800, 1000)); addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: child))); await tester.pumpAndSettle();
}
void main() {
  test('F5 new availability localization exists in all supported languages', () {
    for (final key in ['newAlerts', 'openedFromAlert', 'showAll', 'alertOlder', 'onDemand']) {
      for (final locale in CarePointLocale.values) expect(availabilityText(locale, key), isNot(key));
    }
  });
  testWidgets('F5 home entry counts only unread availability events and opens the newest request', (tester) async {
    final calls = <http.Request>[]; String? opened;
    final s = session((r) async {
      calls.add(r);
      if (r.method == 'GET') return json([
        {'id':'event-a','entityType':'AVAILABILITY_REQUEST','entityId':'request-a','readAt':null},
        {'id':'event-b','entityType':'AVAILABILITY_REQUEST','entityId':'request-b','readAt':null},
        {'id':'event-read','entityType':'AVAILABILITY_REQUEST','entityId':'old','readAt':'2026-09-11T10:00:00Z'},
        {'id':'other','entityType':'APPOINTMENT','entityId':'appointment-a','readAt':null},
      ]);
      return json({'id':'event-a','readAt':'2026-09-11T18:10:00Z'});
    });
    await pump(tester, AvailabilityAlertEntryButton(session: s, locale: CarePointLocale.en, onOpen: (id) async { opened = id; }));
    expect(find.textContaining('2 new availability alerts'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('availability-alert-entry'))); await tester.pumpAndSettle();
    expect(opened, 'request-a');
    expect(calls.any((r) => r.method == 'POST' && r.url.path.endsWith('/notifications/event-a/read')), true);
  });
  testWidgets('F5 notification-list failure never removes the normal Availability Centre entry', (tester) async {
    var opened = false;
    final s = session((r) async => json({}, 503));
    await pump(tester, AvailabilityAlertEntryButton(session: s, locale: CarePointLocale.es, onOpen: (_) async { opened = true; }));
    expect(find.text(availabilityText(CarePointLocale.es, 'centre')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('availability-alert-entry'))); await tester.pumpAndSettle(); expect(opened, true);
  });
  testWidgets('F5 focused centre starts from notices and places the referenced owned request first', (tester) async {
    final calls = <http.Request>[];
    final s = session((r) async {
      calls.add(r);
      return json({'items':[request('other'), request('target')], 'nextPage':null});
    });
    await pump(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en, focusRequestId: 'target'));
    expect(calls.single.url.queryParameters['view'], 'notices');
    expect(find.byKey(const ValueKey('availability-alert-context')), findsOneWidget);
    expect(find.byKey(const ValueKey('availability-focused-target')), findsOneWidget);
    expect(find.text(availabilityText(CarePointLocale.en, 'openedFromAlert')), findsWidgets);
    expect(find.byType(SegmentedButton<String>), findsNothing);
  });
  testWidgets('F5 stale alert falls back to owned request history without fabricating current availability', (tester) async {
    final views = <String>[];
    final s = session((r) async {
      views.add(r.url.queryParameters['view'] ?? '');
      if (views.length == 1) return json({'items':[], 'nextPage':null});
      return json({'items':[request('target', status:'FULFILLED', available:false)], 'nextPage':null});
    });
    await pump(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en, focusRequestId: 'target'));
    expect(views, ['notices','requests']);
    expect(find.byKey(const ValueKey('availability-focused-target')), findsOneWidget);
    expect(find.text(availabilityText(CarePointLocale.en, 'FULFILLED')), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, availabilityText(CarePointLocale.en, 'view')), findsNothing);
  });
  testWidgets('F5 unresolved old alert degrades to an explicit history message and all-requests action', (tester) async {
    final s = session((r) async => json({'items':[], 'nextPage':null}));
    await pump(tester, CareAvailabilityCentrePage(session: s, locale: CarePointLocale.en, focusRequestId: 'missing'));
    expect(find.text(availabilityText(CarePointLocale.en, 'alertOlder')), findsWidgets);
    expect(find.widgetWithText(TextButton, availabilityText(CarePointLocale.en, 'showAll')), findsOneWidget);
  });
}
