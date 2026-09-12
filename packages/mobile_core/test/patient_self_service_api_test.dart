import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('patient self-service client covers sessions, MFA, consents and notifications', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      expect(request.headers['authorization'], 'Bearer patient-access');
      final path = request.url.path;
      if (path.endsWith('/iam/sessions')) {
        return http.Response(jsonEncode([{'id': 'ses-current', 'current': true, 'active': true}]), 200);
      }
      if (path.endsWith('/iam/mfa/status')) {
        return http.Response(jsonEncode({'enabled': false, 'enrollmentStarted': false}), 200);
      }
      if (path.endsWith('/iam/mfa/enroll')) {
        return http.Response(jsonEncode({'secret': 'ABCDEF', 'otpauthUri': 'otpauth://totp/CarePoint'}), 201);
      }
      if (path.endsWith('/iam/mfa/confirm')) {
        expect((jsonDecode(request.body) as Map<String, dynamic>)['code'], '123456');
        return http.Response(jsonEncode({'enabled': true}), 201);
      }
      if (path.endsWith('/consents/me')) {
        return http.Response(jsonEncode([{'id': 'con-1', 'scope': 'CARE', 'state': 'GRANTED'}]), 200);
      }
      if (path.endsWith('/consents/con-1/revoke')) {
        return http.Response(jsonEncode({'id': 'con-1', 'scope': 'CARE', 'state': 'REVOKED'}), 201);
      }
      if (path.endsWith('/notifications/preferences') && request.method == 'GET') {
        return http.Response(jsonEncode({'locale': 'en', 'inAppEnabled': true, 'pushEnabled': true, 'emailEnabled': true, 'smsEnabled': false}), 200);
      }
      if (path.endsWith('/notifications/preferences') && request.method == 'PATCH') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['locale'], 'ar');
        expect(body['smsEnabled'], true);
        return http.Response(jsonEncode({...body, 'inAppEnabled': true}), 200);
      }
      if (path.endsWith('/notifications/endpoints') && request.method == 'GET') {
        return http.Response(jsonEncode([{'id': 'ep-1', 'channel': 'PUSH', 'active': true, 'externalEndpointReferenceStoredExternally': true}]), 200);
      }
      if (path.endsWith('/notifications/endpoints') && request.method == 'POST') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['channel'], 'PUSH');
        expect(body['externalEndpointRef'], 'device-token-12345678');
        return http.Response(jsonEncode({'id': 'ep-2', 'channel': 'PUSH', 'active': true, 'externalEndpointReferenceStoredExternally': true}), 201);
      }
      if (path.endsWith('/notifications/endpoints/ep-1/deactivate')) {
        return http.Response(jsonEncode({'id': 'ep-1', 'channel': 'PUSH', 'active': false, 'externalEndpointReferenceStoredExternally': true}), 201);
      }
      if (path.endsWith('/notifications') && request.method == 'GET') {
        return http.Response(jsonEncode([{'id': 'n-1', 'type': 'APPOINTMENT_UPDATE', 'safeTitleKey': 'appointment.updated', 'safeBodyKey': 'appointment.updated.body', 'readAt': null, 'deliveries': []}]), 200);
      }
      if (path.endsWith('/notifications/n-1/read')) {
        return http.Response(jsonEncode({'id': 'n-1', 'readAt': '2026-09-08T15:00:00.000Z', 'deliveries': []}), 201);
      }
      return http.Response('{}', 404);
    });

    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: MemoryCarePointTokenStore())
      ..accessToken = 'patient-access'
      ..refreshToken = 'patient-refresh';

    expect((await api.accountSessions()).single['current'], true);
    expect((await api.mfaStatus())['enabled'], false);
    expect((await api.beginMfaEnrollment())['secret'], 'ABCDEF');
    expect((await api.confirmMfaEnrollment('123456'))['enabled'], true);
    expect((await api.patientConsents()).single['state'], 'GRANTED');
    expect((await api.revokePatientConsent('con-1'))['state'], 'REVOKED');
    expect((await api.notificationPreferences())['locale'], 'en');
    expect((await api.updateNotificationPreferences(locale: 'ar', smsEnabled: true))['smsEnabled'], true);
    expect((await api.notificationEndpoints()).single['externalEndpointReferenceStoredExternally'], true);
    expect((await api.registerNotificationEndpoint(channel: 'PUSH', externalEndpointRef: ' device-token-12345678 '))['active'], true);
    expect((await api.deactivateNotificationEndpoint('ep-1'))['active'], false);
    expect((await api.notifications()).single['id'], 'n-1');
    expect((await api.markNotificationRead('n-1'))['readAt'], isNotNull);
    expect(requests, isNotEmpty);
  });

  test('secure sign-out revokes the current server session and clears local tokens', () async {
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'access', refreshToken: 'refresh');
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add('${request.method} ${request.url.path}');
      if (request.url.path.endsWith('/iam/sessions') && request.method == 'GET') {
        return http.Response(jsonEncode([
          {'id': 'ses-old', 'current': false, 'active': true},
          {'id': 'ses-current', 'current': true, 'active': true},
        ]), 200);
      }
      if (request.url.path.endsWith('/iam/sessions/ses-current') && request.method == 'DELETE') {
        return http.Response(jsonEncode({'revoked': true}), 200);
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store)
      ..accessToken = 'access'
      ..refreshToken = 'refresh';

    await api.signOutCurrentSession();

    expect(paths, containsAllInOrder(['GET /api/v1/iam/sessions', 'DELETE /api/v1/iam/sessions/ses-current']));
    expect(api.isAuthenticated, false);
    expect(store.accessToken, isNull);
    expect(store.refreshToken, isNull);
  });

  test('secure sign-out still clears local tokens when server revocation is unavailable', () async {
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'access', refreshToken: 'refresh');
    final client = MockClient((request) async => http.Response(jsonEncode({'message': 'offline'}), 503));
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store)
      ..accessToken = 'access'
      ..refreshToken = 'refresh';

    await api.signOutCurrentSession();

    expect(api.isAuthenticated, false);
    expect(store.accessToken, isNull);
    expect(store.refreshToken, isNull);
  });
}
