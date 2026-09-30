import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_diagnostic_report.dart';
import 'package:carepoint_mobile_core/patient_notifications.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F12 diagnostic reports are explicitly allowlisted with localized safe semantics', () {
    expect(patientNotificationRoutableEntityTypes, contains('DIAGNOSTIC_REPORT'));
    expect(
      patientNotificationDestination({'entityType': 'DIAGNOSTIC_REPORT'}),
      PatientNotificationDestination.diagnosticReport,
    );
    expect(
      patientNotificationDestination({'entityType': 'DIAGNOSTIC_STUDY'}),
      PatientNotificationDestination.generic,
    );
    for (final locale in CarePointLocale.values) {
      final title = patientNotificationTitle(locale, {
        'type': 'CLINICAL_UPDATE',
        'safeTitleKey': 'notification.clinical.diagnostic-report.title',
      });
      expect(title, isNotEmpty);
      expect(title, isNot(contains('notification.clinical.diagnostic-report.title')));
    }
  });

  testWidgets('F12 notification re-authorizes the released diagnostic report before rendering clinical details', (tester) async {
    var read = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f12-report');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'f12-event',
            'type': 'CLINICAL_UPDATE',
            'entityType': 'DIAGNOSTIC_REPORT',
            'entityId': 'f12-report-secret-id',
            'safeTitleKey': 'notification.clinical.diagnostic-report.title',
            'safeBodyKey': 'notification.clinical.diagnostic-report.body',
            'readAt': read ? '2026-09-11T22:30:00Z' : null,
            'createdAt': '2026-09-11T22:25:00Z',
            'deliveries': [],
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/f12-event/read') {
        read = true;
        return http.Response(jsonEncode({'id': 'f12-event', 'readAt': '2026-09-11T22:30:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/diagnostic-reports/f12-report-secret-id') {
        return http.Response(jsonEncode({
          'id': 'f12-report-secret-id',
          'type': 'IMAGING',
          'status': 'RELEASED',
          'releasedAt': '2026-09-11T22:20:00Z',
          'data': {
            'findings': 'F12 authorized synthetic findings',
            'impression': 'F12 authorized synthetic impression',
            'recommendation': 'F12 authorized synthetic recommendation',
          },
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f12-report'
      ..refreshToken = 'f12-report-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('Diagnostic report ready'), findsOneWidget);
    expect(find.textContaining('f12-report-secret-id'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('notification-f12-event')));
    await tester.pumpAndSettle();

    expect(calls, contains('POST /api/v1/notifications/f12-event/read'));
    expect(calls, contains('GET /api/v1/diagnostic-reports/f12-report-secret-id'));
    expect(find.byKey(const ValueKey('patient-diagnostic-report-result')), findsOneWidget);
    expect(find.text('F12 authorized synthetic findings'), findsOneWidget);
    expect(find.text('F12 authorized synthetic impression'), findsOneWidget);
    expect(find.text('F12 authorized synthetic recommendation'), findsOneWidget);
    expect(find.textContaining('f12-report-secret-id'), findsNothing);
  });

  testWidgets('F12 denied diagnostic report fails closed without exposing server text or report id', (tester) async {
    var read = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f12-denied');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([
          {
            'id': 'f12-denied-event',
            'type': 'CLINICAL_UPDATE',
            'entityType': 'DIAGNOSTIC_REPORT',
            'entityId': 'other-patient-report-secret',
            'safeTitleKey': 'notification.clinical.diagnostic-report.title',
            'readAt': read ? '2026-09-11T22:30:00Z' : null,
            'createdAt': '2026-09-11T22:25:00Z',
            'deliveries': [],
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/f12-denied-event/read') {
        read = true;
        return http.Response(jsonEncode({'id': 'f12-denied-event', 'readAt': '2026-09-11T22:30:00Z', 'deliveries': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/diagnostic-reports/other-patient-report-secret') {
        return http.Response(jsonEncode({'message': 'Diagnostic report access denied for other-patient-report-secret'}), 403, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f12-denied'
      ..refreshToken = 'f12-denied-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('notification-f12-denied-event')));
    await tester.pumpAndSettle();

    expect(calls, contains('GET /api/v1/diagnostic-reports/other-patient-report-secret'));
    expect(find.byKey(const ValueKey('patient-diagnostic-report-unavailable')), findsOneWidget);
    expect(find.text('This diagnostic report is not available to this account.'), findsOneWidget);
    expect(find.textContaining('other-patient-report-secret'), findsNothing);
    expect(find.textContaining('Diagnostic report access denied'), findsNothing);
  });

  testWidgets('F12 direct diagnostic report page refuses non-patient roles without network access', (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls += 1;
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f12-doctor'
      ..refreshToken = 'f12-doctor-refresh';
    final session = CarePointSession(account: const {'id': 'doctor1', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientDiagnosticReportPage(
      session: session,
      locale: CarePointLocale.en,
      reportId: 'must-not-be-requested',
    )));
    await tester.pumpAndSettle();

    expect(calls, 0);
    expect(find.byKey(const ValueKey('patient-diagnostic-report-unavailable')), findsOneWidget);
    expect(find.text('Diagnostic reports are available only to the Patient app.'), findsOneWidget);
    expect(find.textContaining('must-not-be-requested'), findsNothing);
  });
}
