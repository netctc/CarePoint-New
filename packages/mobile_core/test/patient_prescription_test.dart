import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/clinical_orders.dart';
import 'package:carepoint_mobile_core/patient_clinical_order.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F13 prescription labels are available in every supported locale', () {
    for (final locale in CarePointLocale.values) {
      for (final key in [
        'prescriptionTitle',
        'prescriptionReady',
        'form',
        'route',
        'frequency',
        'duration',
        'refills',
        'additionalInstructions',
        'statusSigned',
        'statusCancelled',
        'prescriptionAuthorizedHint',
      ]) {
        final value = patientClinicalOrderText(locale, key);
        expect(value, isNotEmpty);
        expect(value, isNot(key));
      }
      for (final key in ['form', 'route', 'frequency', 'duration', 'refills', 'additionalInstructions']) {
        final value = orderText(locale, key);
        expect(value, isNotEmpty);
        expect(value, isNot(key));
      }
    }
  });

  testWidgets('F13 patient can securely read a complete signed prescription without mutation controls', (tester) async {
    const token = 'test-f13-prescription';
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer $token');
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical-orders/rx-1') {
        return http.Response(jsonEncode({
          'id': 'rx-1',
          'type': 'PRESCRIPTION',
          'status': 'SIGNED',
          'signedAt': '2026-09-12T09:30:00Z',
          'data': {
            'medication': {'name': 'Synthetic medicine', 'strength': '10 mg', 'form': 'Tablet'},
            'dosageInstruction': 'Take one tablet with water',
            'route': 'Oral',
            'frequency': 'Twice daily',
            'duration': '7 days',
            'quantity': 14,
            'refills': 1,
            'reason': 'Synthetic indication',
            'instructions': 'Do not double a missed dose',
          },
          'labResult': null,
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = token
      ..refreshToken = 'refresh-f13-prescription';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientClinicalOrderResultPage(session: session, locale: CarePointLocale.en, orderId: 'rx-1')));
    await tester.pumpAndSettle();

    expect(calls, ['GET /api/v1/clinical-orders/rx-1']);
    expect(find.byKey(const ValueKey('patient-prescription-result')), findsOneWidget);
    expect(find.text('Synthetic medicine'), findsOneWidget);
    expect(find.text('10 mg'), findsOneWidget);
    expect(find.text('Tablet'), findsOneWidget);
    expect(find.text('Take one tablet with water'), findsOneWidget);
    expect(find.text('Oral'), findsOneWidget);
    expect(find.text('Twice daily'), findsOneWidget);
    expect(find.text('7 days'), findsOneWidget);
    expect(find.text('14'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    expect(find.text('Synthetic indication'), findsOneWidget);
    expect(find.text('Do not double a missed dose'), findsOneWidget);
    expect(find.text('Active signed prescription'), findsOneWidget);
    expect(find.textContaining('rx-1'), findsNothing);
    expect(find.text(orderText(CarePointLocale.en, 'cancel')), findsNothing);
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('F13 cancelled prescription is visibly non-active and remains read-only', (tester) async {
    final client = MockClient((request) async => http.Response(jsonEncode({
      'id': 'rx-cancelled',
      'type': 'PRESCRIPTION',
      'status': 'CANCELLED',
      'signedAt': '2026-09-11T09:30:00Z',
      'cancelledAt': '2026-09-12T10:00:00Z',
      'data': {
        'medication': {'name': 'Synthetic cancelled medicine'},
        'dosageInstruction': 'Synthetic instruction',
      },
      'labResult': null,
    }), 200, headers: {'content-type': 'application/json'}));
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'test-f13-cancelled'
      ..refreshToken = 'refresh-f13-cancelled';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientClinicalOrderResultPage(session: session, locale: CarePointLocale.en, orderId: 'rx-cancelled')));
    await tester.pumpAndSettle();

    expect(find.text('Cancelled prescription'), findsOneWidget);
    expect(find.textContaining('Do not rely on it as an active prescription.'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
  });

  testWidgets('F13 clinical-order page fails closed for non-patient roles before any HTTP request', (tester) async {
    var requests = 0;
    final client = MockClient((request) async {
      requests += 1;
      return http.Response('{}', 500);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'provider-token'
      ..refreshToken = 'provider-refresh';
    final session = CarePointSession(account: const {'id': 'provider1', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientClinicalOrderResultPage(session: session, locale: CarePointLocale.en, orderId: 'rx-1')));
    await tester.pumpAndSettle();

    expect(requests, 0);
    expect(find.byKey(const ValueKey('patient-clinical-order-unavailable')), findsOneWidget);
    expect(find.text('Clinical orders are available only to the Patient app.'), findsOneWidget);
  });

  testWidgets('F13 keeps F11 released laboratory deep-link behaviour intact', (tester) async {
    final client = MockClient((request) async => http.Response(jsonEncode({
      'id': 'lab-order-1',
      'type': 'LABORATORY',
      'status': 'FULFILLED',
      'data': {'tests': [{'display': 'Synthetic test'}]},
      'labResult': {
        'status': 'RELEASED',
        'released': true,
        'releasedAt': '2026-09-12T08:00:00Z',
        'data': {
          'observations': [{'display': 'Synthetic observation', 'value': '42', 'unit': 'unit'}],
          'conclusion': 'Synthetic released conclusion',
        },
      },
    }), 200, headers: {'content-type': 'application/json'}));
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'test-f13-lab-regression'
      ..refreshToken = 'refresh-f13-lab-regression';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientClinicalOrderResultPage(session: session, locale: CarePointLocale.en, orderId: 'lab-order-1')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('patient-clinical-order-result')), findsOneWidget);
    expect(find.text('42 unit'), findsOneWidget);
    expect(find.text('Synthetic released conclusion'), findsOneWidget);
  });
}
