import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_messages.dart';
import 'package:carepoint_mobile_core/patient_messages_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F6 appointment messaging eligibility is limited to confirmed and completed visits', () {
    expect(patientCareConversationEligibleStatus('CONFIRMED'), true);
    expect(patientCareConversationEligibleStatus('COMPLETED'), true);
    expect(patientCareConversationEligibleStatus('REQUESTED'), false);
    expect(patientCareConversationEligibleStatus('CANCELLED'), false);
    expect(patientCareConversationEligibleStatus(null), false);
  });

  test('F6 patient messaging labels cover all supported languages', () {
    for (final locale in CarePointLocale.values) {
      expect(patientMessagesText(locale, 'messageCareTeam'), isNotEmpty);
      expect(patientMessagesText(locale, 'appointmentConversation'), isNotEmpty);
      expect(patientMessagesText(locale, 'notEligible'), isNotEmpty);
    }
  });

  testWidgets('F6 patient home counts only unread secure conversation events and opens the conversation', (tester) async {
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f6-entry');
      if (request.url.path.endsWith('/notifications') && request.method == 'GET') {
        return http.Response(jsonEncode([
          {'id': 'secure1', 'type': 'SECURE_MESSAGE', 'entityType': 'CARE_CONVERSATION', 'entityId': 'conversation1', 'readAt': null, 'createdAt': '2026-09-11T18:00:00Z', 'deliveries': []},
          {'id': 'availability1', 'type': 'CARE_COORDINATION', 'entityType': 'AVAILABILITY_REQUEST', 'entityId': 'request1', 'readAt': null, 'createdAt': '2026-09-11T17:00:00Z', 'deliveries': []},
          {'id': 'secure-read', 'type': 'SECURE_MESSAGE', 'entityType': 'CARE_CONVERSATION', 'entityId': 'conversation-old', 'readAt': '2026-09-11T16:30:00Z', 'createdAt': '2026-09-11T16:00:00Z', 'deliveries': []},
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/notifications/secure1/read') && request.method == 'POST') {
        return http.Response(jsonEncode({'id': 'secure1', 'readAt': '2026-09-11T18:05:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations/conversation1') && request.method == 'GET') {
        return http.Response(jsonEncode({'id': 'conversation1', 'appointmentId': 'appt1', 'status': 'OPEN', 'subject': 'Secure follow-up', 'messages': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations/conversation1/read') && request.method == 'POST') {
        return http.Response(jsonEncode({'conversationId': 'conversation1', 'unreadCount': 0}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f6-entry'
      ..refreshToken = 'f6-entry-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PatientMessagesEntryButton(session: session, locale: CarePointLocale.en))));
    await tester.pumpAndSettle();
    expect(find.text('Secure messages · 1 new'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('patient-messages-entry')));
    await tester.pumpAndSettle();
    expect(find.text('Secure follow-up'), findsOneWidget);
    expect(calls, contains('POST /api/v1/notifications/secure1/read'));
    expect(calls, contains('POST /api/v1/communications/conversations/conversation1/read'));
  });

  testWidgets('F6 appointment focus opens an existing conversation and never creates a duplicate', (tester) async {
    var createCalls = 0;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer f6-existing');
      if (request.url.path.endsWith('/communications/conversations') && request.method == 'GET') {
        return http.Response(jsonEncode([
          {'id': 'conversation-existing', 'appointmentId': 'appt-existing', 'status': 'OPEN', 'subject': 'Existing conversation', 'unreadCount': 1, 'participants': []}
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations') && request.method == 'POST') {
        createCalls++;
        return http.Response('{}', 500, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations/conversation-existing') && request.method == 'GET') {
        return http.Response(jsonEncode({'id': 'conversation-existing', 'appointmentId': 'appt-existing', 'status': 'OPEN', 'subject': 'Existing conversation', 'messages': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations/conversation-existing/read') && request.method == 'POST') {
        return http.Response(jsonEncode({'conversationId': 'conversation-existing', 'unreadCount': 0}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f6-existing'
      ..refreshToken = 'f6-existing-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: AppointmentCommunicationsPage(
      session: session,
      locale: CarePointLocale.en,
      appointmentId: 'appt-existing',
      appointmentStatus: 'CONFIRMED',
    )));
    await tester.pumpAndSettle();
    expect(find.text('Existing conversation'), findsOneWidget);
    expect(createCalls, 0);
  });

  testWidgets('F6 new appointment conversation remains appointment-bound and sends no authority identity fields', (tester) async {
    Map<String, dynamic>? createdBody;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer f6-create');
      if (request.url.path.endsWith('/communications/conversations') && request.method == 'GET') {
        return http.Response('[]', 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations') && request.method == 'POST') {
        createdBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'id': 'conversation-created', 'appointmentId': 'appt-create', 'status': 'OPEN', 'subject': 'Question about visit'}), 201, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations/conversation-created') && request.method == 'GET') {
        return http.Response(jsonEncode({'id': 'conversation-created', 'appointmentId': 'appt-create', 'status': 'OPEN', 'subject': 'Question about visit', 'messages': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations/conversation-created/read') && request.method == 'POST') {
        return http.Response(jsonEncode({'conversationId': 'conversation-created', 'unreadCount': 0}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f6-create'
      ..refreshToken = 'f6-create-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: AppointmentCommunicationsPage(
      session: session,
      locale: CarePointLocale.en,
      appointmentId: 'appt-create',
      appointmentStatus: 'COMPLETED',
      appointmentLabel: 'Follow-up · Dr Example',
    )));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('appointment-message-subject')), 'Question about visit');
    await tester.enterText(find.byKey(const ValueKey('appointment-message-initial')), 'Please clarify the follow-up instructions.');
    await tester.tap(find.byKey(const ValueKey('appointment-message-create')));
    await tester.pumpAndSettle();

    expect(createdBody, isNotNull);
    expect(createdBody!['appointmentId'], 'appt-create');
    expect(createdBody!['subject'], 'Question about visit');
    expect(createdBody!['initialMessage'], 'Please clarify the follow-up instructions.');
    expect(createdBody!['clientConversationId'].toString(), startsWith('patient-appointment-'));
    expect(createdBody!.containsKey('patientId'), false);
    expect(createdBody!.containsKey('providerId'), false);
    expect(find.text('Question about visit'), findsOneWidget);
  });

  testWidgets('F6 ineligible appointment is rejected before any network call', (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f6-ineligible'
      ..refreshToken = 'f6-ineligible-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: AppointmentCommunicationsPage(
      session: session,
      locale: CarePointLocale.es,
      appointmentId: 'appt-requested',
      appointmentStatus: 'REQUESTED',
    )));
    await tester.pumpAndSettle();
    expect(find.text('La mensajería segura está disponible para citas confirmadas o completadas.'), findsOneWidget);
    expect(calls, 0);
  });
}
