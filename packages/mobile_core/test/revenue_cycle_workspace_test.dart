import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/revenue_cycle_workspace.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('patient claims page shows normalized claim and EOB without internal gateway reference', (tester) async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer patient-claims');
      if (request.url.path.endsWith('/revenue-cycle/me')) {
        return http.Response(jsonEncode({
          'patientId': 'p1',
          'claims': [
            {
              'id': 'clm1',
              'version': 1,
              'status': 'ADJUDICATED',
              'reconciliationStatus': 'RECONCILED',
              'submittedAmountMinor': 10000,
              'allowedMinor': 10000,
              'insurerPaidMinor': 7000,
              'patientResponsibilityMinor': 3000,
              'adjustmentMinor': 0,
              'currency': 'USD',
            }
          ],
          'eobs': [
            {
              'claimId': 'clm1',
              'payerCode': 'PAY',
              'billedMinor': 10000,
              'allowedMinor': 10000,
              'insurerPaidMinor': 7000,
              'patientResponsibilityMinor': 3000,
              'adjustmentMinor': 0,
              'currency': 'USD',
              'releasedAt': '2026-09-07T00:00:00.000Z',
            }
          ],
        }), 200);
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'patient-claims'
      ..refreshToken = 'patient-refresh';
    final session = CarePointSession(account: {'id': 'u1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientRevenueCyclePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();

    expect(find.text('Claims & EOB'), findsOneWidget);
    expect(find.text('ADJUDICATED'), findsOneWidget);
    expect(find.text('70.00 USD'), findsAtLeastNWidgets(1));
    expect(find.textContaining('gateway'), findsNothing);
  });

  testWidgets('provider claims page exposes denied claim rework action', (tester) async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer provider-claims');
      if (request.url.path.endsWith('/provider/revenue-cycle/claims')) {
        return http.Response(jsonEncode({
          'providerId': 'pr1',
          'claims': [
            {
              'id': 'clm1',
              'version': 1,
              'status': 'DENIED',
              'reconciliationStatus': 'REVIEW_REQUIRED',
              'submittedAmountMinor': 150000,
              'allowedMinor': 0,
              'insurerPaidMinor': 0,
              'patientResponsibilityMinor': 0,
              'adjustmentMinor': 150000,
              'currency': 'USD',
              'denialPublicMessage': 'Corrected claim required.',
            }
          ],
          'eobs': [],
          'remittances': [],
        }), 200);
      }
      if (request.url.path.endsWith('/provider/appointments')) return http.Response('[]', 200);
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'provider-claims'
      ..refreshToken = 'provider-refresh';
    final session = CarePointSession(account: {'id': 'u2', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: ProviderRevenueCyclePage(session: session, locale: CarePointLocale.en, accent: Colors.cyan)));
    await tester.pumpAndSettle();

    expect(find.text('DENIED'), findsOneWidget);
    expect(find.text('Correct and resubmit'), findsOneWidget);
    expect(find.textContaining('Corrected claim required.'), findsOneWidget);
  });
}
