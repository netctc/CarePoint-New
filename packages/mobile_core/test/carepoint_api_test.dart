import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('login captures tokens and authenticates account lookup', () async {
    final requests = <http.Request>[];
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
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client);
    final session = await api.login('patient@example.test', 'Secret#123');
    expect(session.role, 'PATIENT');
    expect(api.accessToken, 'access-1');
    expect(api.refreshToken, 'refresh-1');
    expect(requests.length, 2);
  });

  test('401 rotates refresh token and retries the authenticated request once', () async {
    var appointmentCalls = 0;
    var refreshCalls = 0;
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
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'expired-access'..refreshToken = 'refresh-old';
    final appointments = await api.myAppointments();
    expect(appointments, isEmpty);
    expect(appointmentCalls, 2);
    expect(refreshCalls, 1);
    expect(api.refreshToken, 'refresh-new');
  });

  test('MFA challenge is surfaced without storing incomplete session tokens', () async {
    final client = MockClient((request) async => http.Response(jsonEncode({'requiresMfa': true, 'challengeId': 'mfa-1', 'expiresAt': '2026-09-06T20:00:00.000Z'}), 200, headers: {'content-type': 'application/json'}));
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client);
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
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'tele-access'..refreshToken = 'tele-refresh';
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
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'clinical-access'..refreshToken = 'clinical-refresh';
    final timeline = await api.patientClinicalTimeline();
    expect(timeline['accessBasis'], 'PATIENT_SELF');
    final record = await api.writeClinicalRecord('appt1', {'assessment': 'Stable'});
    expect(record['revision'], 1);
    final finalized = await api.finalizeClinicalEncounter('appt1');
    expect(finalized['finalized'], true);
    expect(paths, containsAll(['/api/v1/clinical/timeline', '/api/v1/clinical/appointments/appt1/records', '/api/v1/clinical/appointments/appt1/finalize']));
  });
}
