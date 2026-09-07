import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/communications_workspace.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('communications client never sends authoritative patient or provider identity fields', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      expect(request.headers['authorization'], 'Bearer communications-access');
      if (request.url.path.endsWith('/communications/conversations') && request.method == 'POST') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['appointmentId'], 'appt1');
        expect(body['subject'], 'Follow-up');
        expect(body.containsKey('patientId'), false);
        expect(body.containsKey('providerId'), false);
        return http.Response(jsonEncode({'id': 'conversation1', 'status': 'OPEN', 'subject': 'Follow-up'}), 201, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/communications/conversations/conversation1/messages')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['body'], 'Secure reply');
        expect(body.containsKey('patientId'), false);
        expect(body.containsKey('providerId'), false);
        return http.Response(jsonEncode({'id': 'message1', 'body': 'Secure reply'}), 201, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'communications-access'
      ..refreshToken = 'communications-refresh';

    final conversation = await api.createCareConversation(appointmentId: 'appt1', subject: 'Follow-up', clientConversationId: 'mobile-conversation-0001');
    expect(conversation['id'], 'conversation1');
    final message = await api.sendCareMessage('conversation1', body: 'Secure reply', clientMessageId: 'mobile-message-0001');
    expect(message['id'], 'message1');
    expect(requests.length, 2);
  });

  test('notification client registers opaque endpoint references and manages preferences', () async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer notification-access');
      if (request.url.path.endsWith('/notifications/preferences') && request.method == 'PATCH') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['locale'], 'ar');
        expect(body['pushEnabled'], true);
        return http.Response(jsonEncode({'locale': 'ar', 'inAppEnabled': true, 'pushEnabled': true, 'emailEnabled': false, 'smsEnabled': false}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/notifications/endpoints') && request.method == 'POST') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['externalEndpointRef'], 'opaque-mobile-provider-ref');
        expect(body.containsKey('phone'), false);
        expect(body.containsKey('deviceToken'), false);
        return http.Response(jsonEncode({'id': 'endpoint1', 'channel': 'PUSH', 'active': true, 'externalEndpointReferenceStoredExternally': true}), 201, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'notification-access'
      ..refreshToken = 'notification-refresh';

    expect((await api.updateNotificationPreferences(locale: 'ar', pushEnabled: true))['pushEnabled'], true);
    final endpoint = await api.registerNotificationEndpoint(channel: 'PUSH', externalEndpointRef: 'opaque-mobile-provider-ref');
    expect(endpoint['externalEndpointReferenceStoredExternally'], true);
    expect(endpoint.containsKey('externalEndpointRef'), false);
  });

  testWidgets('communications workspace renders live conversation and safe notification surfaces', (tester) async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer workspace-access');
      final path = request.url.path;
      if (path.endsWith('/communications/conversations')) {
        return http.Response(jsonEncode([
          {'id': 'conversation1', 'status': 'OPEN', 'subject': 'Care follow-up', 'unreadCount': 2, 'participants': [{'displayName': 'Dr Example'}]}
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (path.endsWith('/notifications/preferences')) {
        return http.Response(jsonEncode({'locale': 'en', 'inAppEnabled': true, 'pushEnabled': false, 'emailEnabled': false, 'smsEnabled': false}), 200, headers: {'content-type': 'application/json'});
      }
      if (path.endsWith('/notifications')) {
        return http.Response(jsonEncode([
          {'id': 'notification1', 'type': 'SECURE_MESSAGE', 'entityId': 'conversation1', 'safeTitleKey': 'notification.message.title', 'safeBodyKey': 'notification.message.body', 'createdAt': '2026-09-07T04:00:00Z', 'deliveries': []}
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (path.endsWith('/bookings/me')) {
        return http.Response(jsonEncode([
          {'id': 'appt1', 'status': 'CONFIRMED', 'startsAt': '2026-09-08T09:00:00Z', 'modality': 'CLINIC', 'service': {'name': 'Follow-up'}}
        ]), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'workspace-access'
      ..refreshToken = 'workspace-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: CommunicationsWorkspace(session: session, locale: CarePointLocale.en, accent: Colors.blue, isProvider: false)));
    await tester.pumpAndSettle();
    expect(find.text('Care follow-up'), findsOneWidget);
    expect(find.text('Messages & notifications'), findsOneWidget);
    expect(find.text('Notification preferences'), findsNothing);
    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();
    expect(find.text('Notification preferences'), findsOneWidget);
    expect(find.text('Secure messages'), findsAtLeast(1));
  });
}
