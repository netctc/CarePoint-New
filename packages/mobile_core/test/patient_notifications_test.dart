import 'dart:convert';

import 'package:carepoint_mobile_core/care_visits.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_notifications.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F8-F12 routing is allowlisted only for verified entity contracts', () {
    expect(patientNotificationRoutableEntityTypes, {
      'APPOINTMENT',
      'AVAILABILITY_REQUEST',
      'CARE_CONVERSATION',
      'CLINICAL_ORDER',
      'DIAGNOSTIC_REPORT',
      'EMERGENCY_AMBULANCE_REQUEST',
      'MEDICAL_TRANSPORT_REQUEST',
    });
    expect(patientNotificationDestination({'entityType': 'APPOINTMENT'}), PatientNotificationDestination.appointment);
    expect(patientNotificationDestination({'entityType': 'AVAILABILITY_REQUEST'}), PatientNotificationDestination.availability);
    expect(patientNotificationDestination({'entityType': 'CARE_CONVERSATION'}), PatientNotificationDestination.conversation);
    expect(patientNotificationDestination({'entityType': 'CLINICAL_ORDER'}), PatientNotificationDestination.clinicalOrder);
    expect(patientNotificationDestination({'entityType': 'DIAGNOSTIC_REPORT'}), PatientNotificationDestination.diagnosticReport);
    expect(patientNotificationDestination({'entityType': 'EMERGENCY_AMBULANCE_REQUEST'}), PatientNotificationDestination.emergency);
    expect(patientNotificationDestination({'entityType': 'MEDICAL_TRANSPORT_REQUEST'}), PatientNotificationDestination.transport);
    expect(patientNotificationDestination({'entityType': 'CLINICAL_RECORD'}), PatientNotificationDestination.generic);
    expect(patientNotificationDestination({'entityType': '../../unsafe'}), PatientNotificationDestination.generic);
  });

  test('F8-F12 safe titles are localized and unknown template keys are never rendered', () {
    for (final locale in CarePointLocale.values) {
      expect(patientNotificationText(locale, 'centre'), isNotEmpty);
      expect(patientNotificationText(locale, 'openSecurely'), isNotEmpty);
      expect(patientNotificationTitle(locale, {
        'type': 'APPOINTMENT_UPDATE',
        'safeTitleKey': 'notification.appointment.confirmed.title',
      }), isNotEmpty);
      final clinical = patientNotificationTitle(locale, {
        'type': 'CLINICAL_UPDATE',
        'safeTitleKey': 'notification.clinical.lab-result.title',
      });
      expect(clinical, isNotEmpty);
      expect(clinical, isNot(contains('notification.clinical.lab-result.title')));
    }
    const unknownTemplate = 'unknown.template.key';
    final title = patientNotificationTitle(CarePointLocale.en, {
      'type': 'UNKNOWN_FUTURE_TYPE',
      'safeTitleKey': unknownTemplate,
    });
    expect(title, 'CarePoint notification');
    expect(title, isNot(contains(unknownTemplate)));
  });

  testWidgets('F8 home entry counts all unread events without exposing event content', (tester) async {
    const token = 'test-f8-count';
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/v1/notifications');
      expect(request.headers['authorization'], 'Bearer $token');
      return http.Response(jsonEncode([
        {'id': 'n1', 'type': 'APPOINTMENT_UPDATE', 'entityType': 'APPOINTMENT', 'entityId': 'a1', 'readAt': null},
        {'id': 'n2', 'type': 'CARE_COORDINATION', 'entityType': 'AVAILABILITY_REQUEST', 'entityId': 'r1', 'readAt': null},
        {'id': 'n3', 'type': 'SECURE_MESSAGE', 'entityType': 'CARE_CONVERSATION', 'entityId': 'c1', 'readAt': '2026-09-11T19:00:00Z'},
      ]), 200, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = token
      ..refreshToken = 'test-refresh-f8-count';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PatientNotificationCentreEntryButton(session: session, locale: CarePointLocale.en))));
    await tester.pumpAndSettle();
    expect(find.text('Notifications · 2 unread'), findsOneWidget);
    expect(find.textContaining('a1'), findsNothing);
    expect(find.textContaining('r1'), findsNothing);
    expect(find.textContaining('c1'), findsNothing);
  });

  testWidgets('F8 unknown entity remains generic, hides raw IDs and acknowledges only the selected event', (tester) async {
    const token = 'test-f8-generic';
    var read = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer $token');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'generic1',
            'type': 'UNKNOWN_FUTURE_TYPE',
            'entityType': 'FUTURE_ENTITY',
            'entityId': 'internal-id-must-not-render',
            'safeTitleKey': 'unknown.template.key',
            'readAt': read ? '2026-09-11T19:10:00Z' : null,
            'createdAt': '2026-09-11T19:00:00Z',
            'deliveries': [],
          },
          {
            'id': 'generic2',
            'type': 'CLINICAL_UPDATE',
            'entityType': 'CLINICAL_RECORD',
            'entityId': 'other-id',
            'safeTitleKey': 'future.template.key',
            'readAt': '2026-09-11T18:00:00Z',
            'createdAt': '2026-09-11T18:00:00Z',
            'deliveries': [],
          },
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/generic1/read') {
        read = true;
        return http.Response(jsonEncode({'id': 'generic1', 'readAt': '2026-09-11T19:10:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = token
      ..refreshToken = 'test-refresh-f8-generic';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('CarePoint notification'), findsOneWidget);
    expect(find.textContaining('internal-id-must-not-render'), findsNothing);
    expect(find.textContaining('unknown.template.key'), findsNothing);
    expect(find.text('Clinical update'), findsNothing, reason: 'read item is excluded from the default unread view');

    await tester.tap(find.byKey(const ValueKey('notification-generic1')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(calls.where((call) => call == 'POST /api/v1/notifications/generic1/read').length, 1);
    expect(calls.any((call) => call.contains('FUTURE_ENTITY')), false);
  });

  testWidgets('F8 care-conversation event opens through the existing membership-authorized conversation endpoint', (tester) async {
    const token = 'test-f8-conversation';
    var notificationRead = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer $token');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'message-event',
            'type': 'SECURE_MESSAGE',
            'entityType': 'CARE_CONVERSATION',
            'entityId': 'conversation-safe',
            'safeTitleKey': 'notification.message.title',
            'readAt': notificationRead ? '2026-09-11T19:10:00Z' : null,
            'createdAt': '2026-09-11T19:00:00Z',
            'deliveries': [],
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/message-event/read') {
        notificationRead = true;
        return http.Response(jsonEncode({'id': 'message-event', 'readAt': '2026-09-11T19:10:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/communications/conversations/conversation-safe') {
        return http.Response(jsonEncode({
          'id': 'conversation-safe', 'appointmentId': 'appt1', 'status': 'OPEN', 'subject': 'Secure care follow-up', 'messages': []
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/communications/conversations/conversation-safe/read') {
        return http.Response(jsonEncode({'conversationId': 'conversation-safe', 'unreadCount': 0}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = token
      ..refreshToken = 'test-refresh-f8-conversation';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('New secure message'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('notification-message-event')));
    await tester.pumpAndSettle();
    expect(find.text('Secure care follow-up'), findsOneWidget);
    expect(calls, contains('POST /api/v1/notifications/message-event/read'));
    expect(calls, contains('GET /api/v1/communications/conversations/conversation-safe'));
    expect(calls, contains('POST /api/v1/communications/conversations/conversation-safe/read'));
  });

  testWidgets('F11 released laboratory notification opens only after clinical-order re-authorization', (tester) async {
    const token = 'test-f11-clinical';
    var notificationRead = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer $token');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'lab-event',
            'type': 'CLINICAL_UPDATE',
            'entityType': 'CLINICAL_ORDER',
            'entityId': 'lab-order-1',
            'safeTitleKey': 'notification.clinical.lab-result.title',
            'safeBodyKey': 'notification.clinical.lab-result.body',
            'readAt': notificationRead ? '2026-09-11T22:00:00Z' : null,
            'createdAt': '2026-09-11T21:55:00Z',
            'deliveries': [],
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/lab-event/read') {
        notificationRead = true;
        return http.Response(jsonEncode({'id': 'lab-event', 'readAt': '2026-09-11T22:00:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical-orders/lab-order-1') {
        return http.Response(jsonEncode({
          'id': 'lab-order-1',
          'type': 'LABORATORY',
          'status': 'FULFILLED',
          'data': {'tests': [{'display': 'Complete blood count'}]},
          'labResult': {
            'status': 'RELEASED',
            'released': true,
            'releasedAt': '2026-09-11T21:50:00Z',
            'data': {
              'observations': [{'display': 'Haemoglobin', 'value': '13.8', 'unit': 'g/dL'}],
              'conclusion': 'Released synthetic result',
            },
          },
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = token
      ..refreshToken = 'test-refresh-f11-clinical';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('Laboratory result ready'), findsOneWidget);
    expect(find.textContaining('lab-order-1'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('notification-lab-event')));
    await tester.pumpAndSettle();
    expect(calls, contains('POST /api/v1/notifications/lab-event/read'));
    expect(calls, contains('GET /api/v1/clinical-orders/lab-order-1'));
    expect(find.byKey(const ValueKey('patient-clinical-order-result')), findsOneWidget);
    expect(find.text('Released synthetic result'), findsOneWidget);
    expect(find.text('13.8 g/dL'), findsOneWidget);
    expect(find.textContaining('lab-order-1'), findsNothing);
  });

  testWidgets('F11 denied clinical-order detail fails closed without rendering notification IDs or server text', (tester) async {
    const token = 'test-f11-denied';
    var notificationRead = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer $token');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'denied-lab-event',
            'type': 'CLINICAL_UPDATE',
            'entityType': 'CLINICAL_ORDER',
            'entityId': 'unowned-order-id',
            'safeTitleKey': 'notification.clinical.lab-result.title',
            'readAt': notificationRead ? '2026-09-11T22:00:00Z' : null,
            'createdAt': '2026-09-11T21:55:00Z',
            'deliveries': [],
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/denied-lab-event/read') {
        notificationRead = true;
        return http.Response(jsonEncode({'id': 'denied-lab-event', 'readAt': '2026-09-11T22:00:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical-orders/unowned-order-id') {
        return http.Response(jsonEncode({'message': 'Clinical order access denied'}), 403, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = token
      ..refreshToken = 'test-refresh-f11-denied';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('notification-denied-lab-event')));
    await tester.pumpAndSettle();
    expect(calls, contains('GET /api/v1/clinical-orders/unowned-order-id'));
    expect(find.byKey(const ValueKey('patient-clinical-order-unavailable')), findsOneWidget);
    expect(find.text('This laboratory result is not available to this account.'), findsOneWidget);
    expect(find.textContaining('unowned-order-id'), findsNothing);
    expect(find.textContaining('Clinical order access denied'), findsNothing);
  });

  testWidgets('F8 appointment focus selects the owned cancelled bucket and places the requested appointment first', (tester) async {
    const token = 'test-f8-visits';
    final now = DateTime.now().toUtc();
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/v1/bookings/me');
      expect(request.headers['authorization'], 'Bearer $token');
      return http.Response(jsonEncode([
        {
          'id': 'upcoming-other', 'status': 'CONFIRMED', 'modality': 'CLINIC',
          'startsAt': now.add(const Duration(days: 2)).toIso8601String(), 'endsAt': now.add(const Duration(days: 2, hours: 1)).toIso8601String(),
          'service': {'name': 'Future service'}, 'provider': {'displayName': 'Provider Future'}, 'visitContext': {}
        },
        {
          'id': 'focus-cancelled', 'status': 'CANCELLED', 'modality': 'CLINIC',
          'startsAt': now.subtract(const Duration(days: 1)).toIso8601String(), 'endsAt': now.subtract(const Duration(days: 1)).add(const Duration(hours: 1)).toIso8601String(),
          'service': {'name': 'Focused service'}, 'provider': {'displayName': 'Provider Focus'}, 'visitContext': {}
        },
        {
          'id': 'cancelled-other', 'status': 'CANCELLED', 'modality': 'CLINIC',
          'startsAt': now.toIso8601String(), 'endsAt': now.add(const Duration(hours: 1)).toIso8601String(),
          'service': {'name': 'Other cancelled'}, 'provider': {'displayName': 'Provider Other'}, 'visitContext': {}
        },
      ]), 200, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = token
      ..refreshToken = 'test-refresh-f8-visits';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: CareVisitsPage(
      session: session,
      locale: CarePointLocale.en,
      focusAppointmentId: 'focus-cancelled',
    ))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('visit-focus-cancelled')), findsOneWidget);
    expect(find.text('Focused service'), findsOneWidget);
    expect(find.text('Future service'), findsNothing, reason: 'focus moves the view to the cancelled bucket');
    final cards = tester.widgetList<Card>(find.byType(Card)).toList();
    expect(cards.first.key, const ValueKey('visit-focus-cancelled'));
  });

  testWidgets('F8 non-patient cannot load the notification centre', (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'test-f8-doctor'
      ..refreshToken = 'test-refresh-f8-doctor';
    final session = CarePointSession(account: const {'id': 'doctor1', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Notifications are available only to the Patient app.'), findsOneWidget);
  });
}
