import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_medical_transport.dart';
import 'package:carepoint_mobile_core/patient_notifications.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F10 transport status, assistance and date semantics cover every supported locale', () {
    for (final locale in CarePointLocale.values) {
      for (final status in const ['REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'TRANSPORTING', 'COMPLETED', 'CANCELLED']) {
        final label = patientMedicalTransportStatusText(locale, status);
        expect(label, isNotEmpty);
        expect(label, isNot('status.$status'));
      }
      expect(patientMedicalTransportAssistanceText(locale, 'WHEELCHAIR'), isNotEmpty);
      expect(patientMedicalTransportModeText(locale, 'AIR'), isNotEmpty);
      expect(patientMedicalTransportText(locale, 'detailTitle'), isNotEmpty);
    }
    expect(patientMedicalTransportDateTime('2031-01-15T10:30:00'), '15/01/2031 10:30');
    expect(patientMedicalTransportCanCancel('REQUESTED'), true);
    expect(patientMedicalTransportCanCancel('ASSIGNED'), true);
    expect(patientMedicalTransportCanCancel('EN_ROUTE'), false);
    expect(patientMedicalTransportCanCancel('COMPLETED'), false);
  });

  test('F10 transport notification safe title is localized without rendering raw template keys', () {
    for (final locale in CarePointLocale.values) {
      final title = patientNotificationTitle(locale, {
        'type': 'TRANSPORT_UPDATE',
        'safeTitleKey': 'notification.transport.title',
      });
      expect(title, isNotEmpty);
      expect(title, isNot(contains('notification.transport.title')));
    }
    expect(patientNotificationDestination({'entityType': 'MEDICAL_TRANSPORT_REQUEST'}), PatientNotificationDestination.transport);
  });

  testWidgets('F10 detail re-authorizes through owned endpoint before rendering transport data', (tester) async {
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f10-detail');
      if (request.method == 'GET' && request.url.path == '/api/v1/medical-transport/transport-owned') {
        return http.Response(jsonEncode({
          'request': {
            'id': 'transport-owned',
            'mode': 'GROUND',
            'status': 'EN_ROUTE',
            'assistance': 'WHEELCHAIR',
            'scheduledFor': '2031-01-15T10:30:00',
            'pickupAddress': 'Authorized pickup',
            'destinationAddress': 'Authorized destination',
            'etaMinutes': 12,
            'assignedProvider': {'displayName': 'Authorized Transport Team'}
          },
          'history': [
            {'toStatus': 'REQUESTED', 'occurredAt': '2031-01-14T09:00:00'},
            {'toStatus': 'ASSIGNED', 'occurredAt': '2031-01-14T10:00:00', 'etaMinutes': 20},
            {'toStatus': 'EN_ROUTE', 'occurredAt': '2031-01-15T10:10:00', 'etaMinutes': 12},
          ]
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f10-detail'
      ..refreshToken = 'f10-detail-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientMedicalTransportStatusPage(
      session: session,
      locale: CarePointLocale.en,
      requestId: 'transport-owned',
    )));
    await tester.pumpAndSettle();

    expect(calls, contains('GET /api/v1/medical-transport/transport-owned'));
    expect(find.text('Medical transport status'), findsOneWidget);
    expect(find.text('En route'), findsWidgets);
    expect(find.text('15/01/2031 10:30'), findsOneWidget);
    expect(find.text('Wheelchair'), findsOneWidget);
    expect(find.text('Authorized pickup'), findsOneWidget);
    expect(find.text('Authorized destination'), findsOneWidget);
    expect(find.text('Authorized Transport Team'), findsOneWidget);
    expect(find.textContaining('transport-owned'), findsNothing);
    expect(find.byKey(const ValueKey('patient-medical-transport-cancel')), findsNothing);
  });

  testWidgets('F10 assigned transport can be cancelled and terminal result removes cancellation action', (tester) async {
    final calls = <String>[];
    var cancelled = false;
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f10-cancel');
      if (request.method == 'GET' && request.url.path == '/api/v1/medical-transport/cancellable') {
        return http.Response(jsonEncode({
          'request': {
            'id': 'cancellable', 'mode': 'GROUND', 'status': cancelled ? 'CANCELLED' : 'ASSIGNED', 'assistance': 'STANDARD',
            'scheduledFor': '2031-01-15T10:30:00', 'pickupAddress': 'Pickup', 'destinationAddress': 'Destination'
          },
          'history': []
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/medical-transport/cancellable/cancel') {
        cancelled = true;
        return http.Response(jsonEncode({
          'request': {
            'id': 'cancellable', 'mode': 'GROUND', 'status': 'CANCELLED', 'assistance': 'STANDARD',
            'scheduledFor': '2031-01-15T10:30:00', 'pickupAddress': 'Pickup', 'destinationAddress': 'Destination',
            'cancellationReason': 'Cancelled by Patient from mobile app'
          },
          'history': [{'toStatus': 'CANCELLED', 'occurredAt': '2031-01-14T11:00:00'}]
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f10-cancel'
      ..refreshToken = 'f10-cancel-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientMedicalTransportStatusPage(
      session: session,
      locale: CarePointLocale.en,
      requestId: 'cancellable',
    )));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('patient-medical-transport-cancel')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('patient-medical-transport-cancel')));
    await tester.pumpAndSettle();
    expect(calls, contains('POST /api/v1/medical-transport/cancellable/cancel'));
    expect(find.text('Cancelled'), findsWidgets);
    expect(find.byKey(const ValueKey('patient-medical-transport-cancel')), findsNothing);
  });

  testWidgets('F10 transport notification acknowledges event then opens only through owned detail endpoint', (tester) async {
    var read = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f10-notification');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'transport-event',
            'type': 'TRANSPORT_UPDATE',
            'entityType': 'MEDICAL_TRANSPORT_REQUEST',
            'entityId': 'owned-transport',
            'safeTitleKey': 'notification.transport.title',
            'safeBodyKey': 'notification.transport.body',
            'readAt': read ? '2031-01-14T12:00:00Z' : null,
            'createdAt': '2031-01-14T11:00:00Z',
            'deliveries': [],
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/transport-event/read') {
        read = true;
        return http.Response(jsonEncode({'id': 'transport-event', 'readAt': '2031-01-14T12:00:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/medical-transport/owned-transport') {
        return http.Response(jsonEncode({
          'request': {
            'id': 'owned-transport', 'mode': 'AIR', 'status': 'ASSIGNED', 'assistance': 'STRETCHER',
            'scheduledFor': '2031-01-15T15:30:00', 'pickupAddress': 'Hospital A', 'destinationAddress': 'Hospital B',
            'etaMinutes': 25, 'assignedProvider': {'displayName': 'Air Medical Team'}
          },
          'history': []
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f10-notification'
      ..refreshToken = 'f10-notification-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('Medical transport update'), findsOneWidget);
    expect(find.textContaining('owned-transport'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('notification-transport-event')));
    await tester.pumpAndSettle();
    expect(calls, contains('POST /api/v1/notifications/transport-event/read'));
    expect(calls, contains('GET /api/v1/medical-transport/owned-transport'));
    expect(find.text('Medical transport status'), findsOneWidget);
    expect(find.text('Air Medical Team'), findsOneWidget);
    expect(find.textContaining('owned-transport'), findsNothing);
  });

  testWidgets('F10 non-patient transport detail makes no HTTP request', (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f10-doctor'
      ..refreshToken = 'f10-doctor-refresh';
    final session = CarePointSession(account: const {'id': 'doctor1', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientMedicalTransportStatusPage(
      session: session,
      locale: CarePointLocale.en,
      requestId: 'must-not-fetch',
    )));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Medical transport details are available only to the Patient app.'), findsOneWidget);
  });
}