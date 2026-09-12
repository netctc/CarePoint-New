import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_encounter_detail.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('F17 patient encounter detail re-fetches exact visit and renders full clinical payload', (tester) async {
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f17-access');
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical/appointments/a1') {
        return http.Response(jsonEncode({
          'appointment': {
            'id': 'a1',
            'modality': 'CLINIC',
            'status': 'COMPLETED',
            'startsAt': '2026-09-12T10:30:00.000Z',
            'endsAt': '2026-09-12T11:00:00.000Z',
            'provider': {'id': 'p1', 'displayName': 'Dr Care'},
            'service': {'id': 's1', 'name': 'Cardiology review'}
          },
          'accessBasis': 'PATIENT_SELF',
          'finalized': true,
          'latestRecord': {
            'id': 'r1',
            'revision': 3,
            'createdAt': '2026-09-12T11:00:00.000Z',
            'data': {
              'chiefComplaint': 'Chest discomfort',
              'subjective': 'Symptoms improved.',
              'objective': 'Comfortable at rest.',
              'assessment': 'Stable angina follow-up.',
              'plan': 'Continue follow-up.',
              'vitals': {
                'temperatureC': 36.8,
                'heartRateBpm': 72,
                'systolicMmHg': 120,
                'diastolicMmHg': 78,
                'oxygenSaturationPct': 98
              },
              'diagnoses': [
                {'codeSystem': 'ICD-10', 'code': 'I20.9', 'display': 'Angina pectoris', 'status': 'ACTIVE'}
              ],
              'treatments': ['Lifestyle counselling'],
              'medications': [
                {'name': 'Example medicine', 'dose': '10 mg', 'route': 'oral', 'frequency': 'daily', 'duration': '30 days'}
              ],
              'attachments': [
                {'documentId': 'd1', 'name': 'Visit summary.pdf', 'mimeType': 'application/pdf', 'kind': 'CLINICAL_ATTACHMENT'}
              ]
            }
          }
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical-documents/me/centre') {
        expect(request.url.queryParameters['focusDocumentId'], 'd1');
        return http.Response(jsonEncode({
          'accessBasis': 'PATIENT_SELF',
          'truncated': false,
          'focusDocumentId': 'd1',
          'items': [
            {
              'id': 'd1',
              'kind': 'CLINICAL_ATTACHMENT',
              'mediaType': 'application/pdf',
              'byteLength': 42,
              'createdAt': '2026-09-12T11:00:00.000Z',
              'releasedAt': '2026-09-12T11:05:00.000Z',
              'source': 'CARE_TEAM',
              'downloadable': true,
              'opened': false,
              'acknowledged': false,
              'patientRemovable': false,
              'metadata': {'title': 'Authorized visit summary'}
            }
          ]
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f17-access'
      ..refreshToken = 'f17-refresh';
    final session = CarePointSession(account: const {'id': 'patient', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientEncounterDetailPage(session: session, locale: CarePointLocale.en, appointmentId: 'a1')));
    await tester.pumpAndSettle();

    expect(calls.first, 'GET /api/v1/clinical/appointments/a1');
    expect(find.textContaining('12/09/2026'), findsOneWidget);

    final listView = find.byType(ListView).first;
    Future<void> reveal(Finder finder) async {
      for (var attempt = 0; attempt < 40 && finder.evaluate().isEmpty; attempt += 1) {
        await tester.drag(listView, const Offset(0, -240));
        await tester.pumpAndSettle();
      }
      expect(finder, findsOneWidget);
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
    }

    await reveal(find.text('Chest discomfort'));
    await reveal(find.text('Symptoms improved.'));
    await reveal(find.text('Comfortable at rest.'));
    await reveal(find.text('Stable angina follow-up.'));
    await reveal(find.text('Continue follow-up.'));
    await reveal(find.textContaining('72'));
    await reveal(find.text('Angina pectoris'));
    await reveal(find.textContaining('Lifestyle counselling'));
    await reveal(find.text('Example medicine'));
    await reveal(find.text('Visit summary.pdf'));

    final attachment = find.byKey(const ValueKey('patient-encounter-document-d1'));
    await reveal(attachment);
    await tester.tap(attachment);
    await tester.pumpAndSettle();
    expect(calls, contains('GET /api/v1/clinical-documents/me/centre'));
    expect(find.text('Authorized visit summary'), findsOneWidget);
    expect(calls.where((call) => call.contains('/content')), isEmpty);
    expect(calls.where((call) => call.contains('/download-token')), isEmpty);
    expect(calls.where((call) => call.endsWith('/download')), isEmpty);
  });

  testWidgets('F17 non-patient access fails closed without any network call', (tester) async {
    var networkCalls = 0;
    final client = MockClient((request) async {
      networkCalls += 1;
      return http.Response('{}', 500);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'provider-access'
      ..refreshToken = 'provider-refresh';
    final session = CarePointSession(account: const {'id': 'provider', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientEncounterDetailPage(session: session, locale: CarePointLocale.en, appointmentId: 'a1')));
    await tester.pumpAndSettle();

    expect(networkCalls, 0);
    expect(find.text('This page is available only to patient accounts.'), findsOneWidget);
  });

  testWidgets('F17 surfaces API failure and retries through the same authorized route', (tester) async {
    var requests = 0;
    final client = MockClient((request) async {
      requests += 1;
      expect(request.url.path, '/api/v1/clinical/appointments/a1');
      if (requests == 1) {
        return http.Response(jsonEncode({'message': 'Temporary clinical read failure'}), 503, headers: {'content-type': 'application/json'});
      }
      return http.Response(jsonEncode({
        'appointment': {
          'id': 'a1', 'modality': 'CLINIC', 'status': 'COMPLETED',
          'startsAt': '2026-09-12T10:30:00.000Z',
          'provider': {'displayName': 'Dr Care'},
          'service': {'name': 'Review'}
        },
        'accessBasis': 'PATIENT_SELF',
        'finalized': true,
        'latestRecord': null
      }), 200, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f17-access'
      ..refreshToken = 'f17-refresh';
    final session = CarePointSession(account: const {'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientEncounterDetailPage(session: session, locale: CarePointLocale.en, appointmentId: 'a1')));
    await tester.pumpAndSettle();
    expect(find.text('Temporary clinical read failure'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('patient-encounter-retry')));
    await tester.pumpAndSettle();
    expect(requests, 2);
    expect(find.text('No clinical record is available for this visit yet.'), findsOneWidget);
  });

  testWidgets('F17 Arabic encounter detail keeps localized RTL presentation', (tester) async {
    final client = MockClient((request) async => http.Response(jsonEncode({
      'appointment': {
        'id': 'a1', 'modality': 'CLINIC', 'status': 'COMPLETED',
        'startsAt': '2026-09-12T10:30:00.000Z',
        'provider': {'displayName': 'طبيب'},
        'service': {'name': 'مراجعة'}
      },
      'accessBasis': 'PATIENT_SELF',
      'finalized': true,
      'latestRecord': null
    }), 200, headers: {'content-type': 'application/json'}));
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f17-ar'
      ..refreshToken = 'f17-refresh';
    final session = CarePointSession(account: const {'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientEncounterDetailPage(session: session, locale: CarePointLocale.ar, appointmentId: 'a1')));
    await tester.pumpAndSettle();

    expect(find.text('تفاصيل الزيارة'), findsOneWidget);
    expect(find.text('لا يوجد سجل سريري متاح لهذه الزيارة بعد.'), findsOneWidget);
    expect(Directionality.of(tester.element(find.byKey(const ValueKey('patient-encounter-detail')))), TextDirection.rtl);
  });
}
