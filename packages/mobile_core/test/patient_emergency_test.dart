import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_emergency.dart';
import 'package:carepoint_mobile_core/patient_notifications.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F9 active emergency selection excludes terminal requests and chooses newest active request', () {
    final selected = patientNewestActiveEmergency([
      {'id': 'completed-newer', 'status': 'COMPLETED', 'requestedAt': '2031-01-17T10:00:00Z'},
      {'id': 'active-old', 'status': 'ASSIGNED', 'requestedAt': '2031-01-15T10:00:00Z'},
      {'id': 'cancelled', 'status': 'CANCELLED', 'requestedAt': '2031-01-18T10:00:00Z'},
      {'id': 'active-new', 'status': 'EN_ROUTE', 'requestedAt': '2031-01-16T10:00:00Z'},
    ]);
    expect(selected?['id'], 'active-new');
    expect(patientEmergencyIsActive('TRANSPORTING'), true);
    expect(patientEmergencyIsActive('COMPLETED'), false);
    expect(patientEmergencyIsActive('CANCELLED'), false);
  });

  test('F9 emergency continuity labels and statuses cover every supported locale', () {
    for (final locale in CarePointLocale.values) {
      expect(patientEmergencyText(locale, 'resume'), isNotEmpty);
      expect(patientEmergencyText(locale, 'tracking'), isNotEmpty);
      for (final status in [...patientEmergencyActiveStatuses, 'COMPLETED', 'CANCELLED']) {
        final label = patientEmergencyStatusText(locale, status);
        expect(label, isNotEmpty);
        expect(label, isNot('status.$status'));
      }
    }
    expect(patientEmergencyDateTime('2031-01-15T10:30:00'), '15/01/2031 10:30');
  });

  testWidgets('F9 home recovery shows newest active emergency and re-authorizes detail before display', (tester) async {
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f9-home');
      if (request.method == 'GET' && request.url.path == '/api/v1/emergency/ambulance') {
        return http.Response(jsonEncode([
          {'id': 'terminal', 'status': 'COMPLETED', 'requestedAt': '2031-01-17T10:00:00Z'},
          {'id': 'em-active', 'status': 'EN_ROUTE', 'etaMinutes': 6, 'requestedAt': '2031-01-16T10:00:00Z'},
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/emergency/ambulance/em-active') {
        return http.Response(jsonEncode({
          'emergencyFlow': true,
          'request': {
            'id': 'em-active', 'status': 'EN_ROUTE', 'etaMinutes': 5, 'requestedAt': '2031-01-16T10:00:00Z',
            'assignedProvider': {'displayName': 'Authorized Ambulance Team'}
          },
          'history': [
            {'toStatus': 'REQUESTED', 'occurredAt': '2031-01-16T10:00:00'},
            {'toStatus': 'EN_ROUTE', 'occurredAt': '2031-01-16T10:05:00'},
          ]
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f9-home'
      ..refreshToken = 'f9-home-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PatientActiveEmergencyEntryButton(session: session, locale: CarePointLocale.en))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('patient-active-emergency-entry')), findsOneWidget);
    expect(find.textContaining('Resume active emergency'), findsOneWidget);
    expect(find.textContaining('En route'), findsOneWidget);
    expect(find.textContaining('em-active'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('patient-active-emergency-entry')));
    await tester.pumpAndSettle();
    expect(calls, contains('GET /api/v1/emergency/ambulance/em-active'));
    expect(find.text('Emergency ambulance tracking'), findsOneWidget);
    expect(find.text('Authorized Ambulance Team'), findsOneWidget);
    expect(find.textContaining('ETA: 5 min'), findsOneWidget);
    expect(find.textContaining('em-active'), findsNothing);
  });

  testWidgets('F9 terminal-only history does not create an active emergency Home entry', (tester) async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/v1/emergency/ambulance');
      return http.Response(jsonEncode([
        {'id': 'done', 'status': 'COMPLETED', 'requestedAt': '2031-01-16T10:00:00Z'},
        {'id': 'cancelled', 'status': 'CANCELLED', 'requestedAt': '2031-01-15T10:00:00Z'},
      ]), 200, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f9-terminal'
      ..refreshToken = 'f9-terminal-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PatientActiveEmergencyEntryButton(session: session, locale: CarePointLocale.en))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('patient-active-emergency-entry')), findsNothing);
  });

  testWidgets('F9 emergency notification opens only through patient-owned detail endpoint', (tester) async {
    var notificationRead = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f9-notification');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'em-event',
            'type': 'EMERGENCY_UPDATE',
            'entityType': 'EMERGENCY_AMBULANCE_REQUEST',
            'entityId': 'owned-emergency',
            'safeTitleKey': 'notification.emergency.title',
            'safeBodyKey': 'notification.emergency.body',
            'readAt': notificationRead ? '2031-01-16T10:06:00Z' : null,
            'createdAt': '2031-01-16T10:05:00Z',
            'deliveries': [],
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/em-event/read') {
        notificationRead = true;
        return http.Response(jsonEncode({'id': 'em-event', 'readAt': '2031-01-16T10:06:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/emergency/ambulance/owned-emergency') {
        return http.Response(jsonEncode({
          'emergencyFlow': true,
          'request': {'id': 'owned-emergency', 'status': 'ASSIGNED', 'etaMinutes': 8, 'requestedAt': '2031-01-16T10:00:00Z'},
          'history': []
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f9-notification'
      ..refreshToken = 'f9-notification-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('Emergency update'), findsOneWidget);
    expect(find.textContaining('owned-emergency'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('notification-em-event')));
    await tester.pumpAndSettle();
    expect(calls, contains('POST /api/v1/notifications/em-event/read'));
    expect(calls, contains('GET /api/v1/emergency/ambulance/owned-emergency'));
    expect(find.text('Emergency ambulance tracking'), findsOneWidget);
    expect(find.text('Ambulance assigned'), findsOneWidget);
  });

  testWidgets('F9 non-patient continuity surfaces make no emergency requests', (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f9-doctor'
      ..refreshToken = 'f9-doctor-refresh';
    final session = CarePointSession(account: const {'id': 'doctor1', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Column(children: [
      PatientActiveEmergencyEntryButton(session: session, locale: CarePointLocale.en),
      Expanded(child: PatientEmergencyStatusPage(session: session, locale: CarePointLocale.en, requestId: 'must-not-fetch')),
    ]))));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.byKey(const ValueKey('patient-active-emergency-entry')), findsNothing);
    expect(find.text('Emergency tracking is available only to the Patient app.'), findsOneWidget);
  });
}