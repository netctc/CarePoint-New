import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('login captures tokens, persists them and authenticates account lookup', () async {
    final requests = <http.Request>[];
    final store = MemoryCarePointTokenStore();
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path.endsWith('/iam/login')) {
        return http.Response(jsonEncode({'sessionId': 's1', 'accessToken': 'access-1', 'refreshToken': 'refresh-1', 'expiresAt': '2026-09-06T20:00:00.000Z', 'refreshExpiresAt': '2026-10-06T20:00:00.000Z'}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/iam/accounts/me')) {
        expect(request.headers['authorization'], 'Bearer access-1');
        return http.Response(jsonEncode({'id': 'u1', 'email': 'patient@example.test', 'role': 'PATIENT', 'status': 'ACTIVE'}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store);
    final session = await api.login('patient@example.test', 'Secret#123');
    expect(session.role, 'PATIENT');
    expect(api.accessToken, 'access-1');
    expect(api.refreshToken, 'refresh-1');
    expect(store.accessToken, 'access-1');
    expect(store.refreshToken, 'refresh-1');
    expect(requests.length, 2);
  });

  test('401 rotates refresh token, persists rotation and retries once', () async {
    var appointmentCalls = 0;
    var refreshCalls = 0;
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'expired-access', refreshToken: 'refresh-old');
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/bookings/me')) {
        appointmentCalls += 1;
        if (appointmentCalls == 1) {
          expect(request.headers['authorization'], 'Bearer expired-access');
          return http.Response(jsonEncode({'message': 'expired'}), 401);
        }
        expect(request.headers['authorization'], 'Bearer fresh-access');
        return http.Response(jsonEncode([]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/iam/sessions/refresh')) {
        refreshCalls += 1;
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['refreshToken'], 'refresh-old');
        return http.Response(jsonEncode({'sessionId': 's2', 'accessToken': 'fresh-access', 'refreshToken': 'refresh-new', 'expiresAt': '2026-09-06T20:00:00.000Z', 'refreshExpiresAt': '2026-10-06T20:00:00.000Z'}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store)
      ..accessToken = 'expired-access'
      ..refreshToken = 'refresh-old';
    final appointments = await api.myAppointments();
    expect(appointments, isEmpty);
    expect(appointmentCalls, 2);
    expect(refreshCalls, 1);
    expect(api.refreshToken, 'refresh-new');
    expect(store.accessToken, 'fresh-access');
    expect(store.refreshToken, 'refresh-new');
  });

  test('restoreSession uses persisted tokens and refreshes an expired access token', () async {
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'expired-access', refreshToken: 'stored-refresh');
    var meCalls = 0;
    var refreshCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/iam/accounts/me')) {
        meCalls += 1;
        if (meCalls == 1) {
          expect(request.headers['authorization'], 'Bearer expired-access');
          return http.Response(jsonEncode({'message': 'expired'}), 401);
        }
        expect(request.headers['authorization'], 'Bearer restored-access');
        return http.Response(jsonEncode({'id': 'u1', 'email': 'patient@example.test', 'role': 'PATIENT', 'status': 'ACTIVE'}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/iam/sessions/refresh')) {
        refreshCalls += 1;
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['refreshToken'], 'stored-refresh');
        return http.Response(jsonEncode({'sessionId': 's2', 'accessToken': 'restored-access', 'refreshToken': 'restored-refresh', 'expiresAt': '2026-09-06T20:00:00.000Z', 'refreshExpiresAt': '2026-10-06T20:00:00.000Z'}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store);
    final session = await api.restoreSession();
    expect(session?.role, 'PATIENT');
    expect(refreshCalls, 1);
    expect(store.accessToken, 'restored-access');
    expect(store.refreshToken, 'restored-refresh');
  });

  test('restoreSession clears invalid persisted credentials', () async {
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'invalid-access', refreshToken: 'invalid-refresh');
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/iam/accounts/me')) return http.Response(jsonEncode({'message': 'expired'}), 401);
      if (request.url.path.endsWith('/iam/sessions/refresh')) return http.Response(jsonEncode({'message': 'invalid refresh'}), 401);
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store);
    expect(await api.restoreSession(), isNull);
    expect(api.isAuthenticated, isFalse);
    expect(store.accessToken, isNull);
    expect(store.refreshToken, isNull);
  });

  test('logout clears in-memory and persisted credentials', () async {
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'access', refreshToken: 'refresh');
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', tokenStore: store)
      ..accessToken = 'access'
      ..refreshToken = 'refresh';
    await api.logout();
    expect(api.accessToken, isNull);
    expect(api.refreshToken, isNull);
    expect(store.accessToken, isNull);
    expect(store.refreshToken, isNull);
  });

  test('MFA challenge is surfaced without storing incomplete session tokens', () async {
    final client = MockClient((request) async => http.Response(jsonEncode({'requiresMfa': true, 'challengeId': 'mfa-1', 'expiresAt': '2026-09-06T20:00:00.000Z'}), 200, headers: {'content-type': 'application/json'}));
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: MemoryCarePointTokenStore());
    expect(() => api.login('doctor@example.test', 'Secret#123'), throwsA(isA<CarePointMfaRequired>()));
    expect(api.isAuthenticated, isFalse);
  });

  test('telehealth client sends consent, readiness and join calls with bearer token', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer tele-access');
      if (request.url.path.endsWith('/consent')) return http.Response(jsonEncode({'consentGranted': true}), 200);
      if (request.url.path.endsWith('/readiness')) return http.Response(jsonEncode({'participantReady': true}), 200);
      if (request.url.path.endsWith('/join')) return http.Response(jsonEncode({'sessionId': 'th1', 'serverUrl': 'wss://livekit.test', 'participantToken': 'jwt', 'e2eeKey': 'key', 'expiresAt': '2026-09-06T20:00:00.000Z', 'recordingEnabled': false}), 200);
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: MemoryCarePointTokenStore())..accessToken = 'tele-access'..refreshToken = 'tele-refresh';
    expect((await api.confirmTelehealthConsent('appt1'))['consentGranted'], true);
    expect((await api.updateTelehealthReadiness('appt1', camera: true, microphone: true, network: true))['participantReady'], true);
    final join = await api.telehealthJoin('appt1');
    expect(join['recordingEnabled'], false);
    expect(paths, containsAll(['/api/v1/telehealth/appointments/appt1/consent', '/api/v1/telehealth/appointments/appt1/readiness', '/api/v1/telehealth/appointments/appt1/join']));
  });

  test('clinical client reads timeline and writes/finalizes an encounter with bearer token', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer clinical-access');
      if (request.url.path.endsWith('/clinical/timeline')) {
        return http.Response(jsonEncode({'patientId': 'p1', 'accessBasis': 'PATIENT_SELF', 'items': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical/appointments/appt1/records')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['assessment'], 'Stable');
        return http.Response(jsonEncode({'id': 'cr1', 'appointmentId': 'appt1', 'revision': 1}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical/appointments/appt1/finalize')) {
        return http.Response(jsonEncode({'appointment': {'id': 'appt1', 'status': 'COMPLETED'}, 'finalized': true}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: MemoryCarePointTokenStore())..accessToken = 'clinical-access'..refreshToken = 'clinical-refresh';
    final timeline = await api.patientClinicalTimeline();
    expect(timeline['accessBasis'], 'PATIENT_SELF');
    final record = await api.writeClinicalRecord('appt1', {'assessment': 'Stable'});
    expect(record['revision'], 1);
    final finalized = await api.finalizeClinicalEncounter('appt1');
    expect(finalized['finalized'], true);
    expect(paths, containsAll(['/api/v1/clinical/timeline', '/api/v1/clinical/appointments/appt1/records', '/api/v1/clinical/appointments/appt1/finalize']));
  });
}
