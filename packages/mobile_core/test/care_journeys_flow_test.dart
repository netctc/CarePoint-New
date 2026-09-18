import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_booking.dart';
import 'package:carepoint_mobile_core/care_visits.dart';
import 'package:carepoint_mobile_core/patient_care_journeys.dart';

CarePointSession session(Future<http.Response> Function(http.Request) handler) => CarePointSession(
  account: const {'role': 'PATIENT'},
  api: CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: MockClient(handler), tokenStore: MemoryCarePointTokenStore())..accessToken = 'synthetic-patient-token',
);
Map<String, dynamic> service(String name) => {
  'id': name, 'name': name, 'currency': 'SAR', 'provider': {'displayName': 'Synthetic Doctor'},
  'modalities': [{'modality': 'CLINIC', 'priceMinor': 20000, 'durationMinutes': 30, 'active': true}],
};
const slot = {'id': 'synthetic-slot', 'startsAt': '2099-09-11T10:00:00Z', 'endsAt': '2099-09-11T10:30:00Z', 'remainingCapacity': 1};
Future<void> openBooking(WidgetTester tester, CarePointSession active, void Function(bool?) result) async {
  await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => Scaffold(body: FilledButton(
    onPressed: () async { result(await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => CareSlotsPage(session: active, locale: CarePointLocale.en, service: service('Synthetic consultation'), modality: 'CLINIC')))); },
    child: const Text('Open journey'),
  )))));
  await tester.tap(find.text('Open journey')); await tester.pumpAndSettle();
}
Future<void> confirmBooking(WidgetTester tester) async {
  await tester.tap(find.widgetWithText(FilledButton, 'Book appointment'));
  // The confirmation intentionally keeps its underlying submission busy.
  await tester.pump(); await tester.pump(const Duration(milliseconds: 350));
  expect(find.byType(AlertDialog), findsOneWidget);
  await tester.tap(find.widgetWithText(FilledButton, 'Confirm'));
  await tester.pumpAndSettle();
}
void main() {
  testWidgets('F1 booking is not sent until the explicit contextual confirmation', (tester) async {
    var posts = 0; bool? result;
    final active = session((request) async {
      if (request.url.path.endsWith('/availability')) return http.Response(jsonEncode([slot]), 200);
      if (request.url.path.endsWith('/bookings')) { posts++; return http.Response('{"id":"synthetic-appointment"}', 201); }
      throw StateError('Unexpected test route');
    });
    await openBooking(tester, active, (value) => result = value);
    expect(posts, 0);
    await tester.tap(find.widgetWithText(FilledButton, 'Book appointment'));
    await tester.pump(); await tester.pump(const Duration(milliseconds: 350));
    expect(posts, 0);
    expect(find.textContaining('Synthetic Doctor'), findsWidgets);
    expect(find.textContaining('200.00 SAR'), findsWidgets);
    await tester.tap(find.widgetWithText(FilledButton, 'Confirm')); await tester.pumpAndSettle();
    expect(posts, 1); expect(result, true); expect(find.byType(CareSlotsPage), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('F1 ambiguous booking retries identical body and cannot silently open another booking', (tester) async {
    final bodies = <String>[]; bool? result;
    final active = session((request) async {
      if (request.url.path.endsWith('/availability')) return http.Response(jsonEncode([slot]), 200);
      if (request.url.path.endsWith('/bookings')) {
        bodies.add(request.body);
        return http.Response(bodies.length == 1 ? '{}' : '{"id":"synthetic-appointment"}', bodies.length == 1 ? 503 : 201);
      }
      throw StateError('Unexpected test route');
    });
    await openBooking(tester, active, (value) => result = value);
    await confirmBooking(tester);
    expect(result, isNull); expect(bodies.length, 1);
    expect(find.textContaining('outcome is not yet known'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Book appointment'), findsNothing);
    await tester.binding.handlePopRoute(); await tester.pump();
    expect(find.byType(CareSlotsPage), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Retry')); await tester.pumpAndSettle();
    expect(bodies.length, 2); expect(bodies[0], bodies[1]); expect(result, true);
    expect(jsonDecode(bodies[0])['slotId'], 'synthetic-slot');
    expect(tester.takeException(), isNull);
  });

  testWidgets('F1 an older HTTP search response cannot replace newer patient filters', (tester) async {
    tester.view.physicalSize = const Size(1000, 2000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final old = Completer<http.Response>();
    final active = session((request) async {
      if (request.url.path.endsWith('/specialties') || request.url.path.endsWith('/other-provider-categories')) return http.Response('{"items":[]}', 200);
      if (request.url.path.endsWith('/discovery')) {
        if (request.url.queryParameters['q'] == 'new') return http.Response(jsonEncode({'items': [service('New result')], 'nextPage': null}), 200);
        return old.future;
      }
      throw StateError('Unexpected test route');
    });
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CareDiscoveryPage(session: active, locale: CarePointLocale.en, onBooked: () {}))));
    await tester.pump();
    await tester.enterText(find.byKey(const ValueKey('care-query')), 'new');
    await tester.testTextInput.receiveAction(TextInputAction.search); await tester.pumpAndSettle();
    expect(find.text('New result'), findsOneWidget);
    old.complete(http.Response(jsonEncode({'items': [service('Old result')], 'nextPage': null}), 200));
    await tester.pumpAndSettle();
    expect(find.text('New result'), findsOneWidget); expect(find.text('Old result'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('F1 visit tabs separate appointments and retain the persisted clinic context', (tester) async {
    final rows = [
      {'id': 'future', 'status': 'CONFIRMED', 'modality': 'CLINIC', 'startsAt': '2099-01-01T10:00:00Z', 'endsAt': '2099-01-01T11:00:00Z', 'service': {'name': 'Upcoming consultation'}, 'provider': {'displayName': 'Synthetic Doctor'}, 'visitContext': {'addressLine1': 'Synthetic Clinic Address', 'city': 'Synthetic City', 'instructions': 'Use synthetic reception'}},
      {'id': 'past', 'status': 'COMPLETED', 'modality': 'CLINIC', 'startsAt': '2020-01-01T10:00:00Z', 'endsAt': '2020-01-01T11:00:00Z', 'service': {'name': 'Historical consultation'}},
      {'id': 'cancelled', 'status': 'CANCELLED', 'modality': 'CLINIC', 'startsAt': '2099-01-01T10:00:00Z', 'endsAt': '2099-01-01T11:00:00Z', 'service': {'name': 'Cancelled consultation'}},
    ];
    final active = session((request) async => http.Response(jsonEncode(rows), 200));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CareVisitsPage(session: active, locale: CarePointLocale.en))));
    await tester.pumpAndSettle();
    expect(find.text('Upcoming consultation'), findsOneWidget); expect(find.textContaining('Synthetic Clinic Address'), findsOneWidget);
    expect(find.text('Historical consultation'), findsNothing);
    await tester.tap(find.widgetWithText(ChoiceChip, 'History')); await tester.pumpAndSettle();
    expect(find.text('Historical consultation'), findsOneWidget); expect(find.text('Upcoming consultation'), findsNothing);
    await tester.tap(find.widgetWithText(ChoiceChip, 'Cancelled')); await tester.pumpAndSettle();
    expect(find.text('Cancelled consultation'), findsOneWidget); expect(find.widgetWithText(OutlinedButton, 'Cancel this appointment'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
