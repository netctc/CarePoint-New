import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/financial_workspace.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('patient financial hub renders invoice without CarePoint card fields', (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/billing/me')) {
        return http.Response(jsonEncode({
          'patientId': 'p1',
          'invoices': [
            {
              'id': 'inv1',
              'number': 'INV-TEST',
              'status': 'OPEN',
              'currency': 'USD',
              'totalMinor': 7500,
              'patientResponsibilityMinor': 2250,
              'insurerResponsibilityMinor': 5250,
              'amountPaidMinor': 0,
              'balanceDueMinor': 2250,
            }
          ],
          'paymentIntents': [],
          'receipts': [],
        }), 200);
      }
      if (request.url.path.endsWith('/insurance/me/coverages')) return http.Response('[]', 200);
      if (request.url.path.endsWith('/insurance/me/activity')) return http.Response(jsonEncode({'patientId': 'p1', 'eligibility': [], 'priorAuthorizations': []}), 200);
      if (request.url.path.endsWith('/bookings/me')) return http.Response('[]', 200);
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'patient-access'
      ..refreshToken = 'patient-refresh';
    final session = CarePointSession(account: {'id': 'u1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: PatientFinancialWorkspace(session: session, locale: CarePointLocale.en))));
    await tester.pumpAndSettle();

    expect(find.text('INV-TEST'), findsOneWidget);
    expect(find.text('Pay securely'), findsOneWidget);
    expect(find.textContaining('Card number'), findsNothing);
    expect(find.textContaining('CVV'), findsNothing);
  });

  testWidgets('provider financial workspace renders currency balance and ledger boundary', (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/provider/finance/summary')) {
        return http.Response(jsonEncode({'providerId': 'pr1', 'availableBalanceMinorByCurrency': {'USD': 2250}, 'pendingPayouts': []}), 200);
      }
      if (request.url.path.endsWith('/provider/finance/ledger')) {
        return http.Response(jsonEncode([
          {'id': 'l1', 'type': 'CHARGE', 'amountMinor': 2250, 'currency': 'USD', 'paymentIntentId': 'pi1', 'reference': 'RCT-TEST', 'createdAt': '2026-09-07T00:00:00.000Z'}
        ]), 200);
      }
      if (request.url.path.endsWith('/provider/appointments')) return http.Response('[]', 200);
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'provider-access'
      ..refreshToken = 'provider-refresh';
    final session = CarePointSession(account: {'id': 'u2', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ProviderFinancialWorkspace(session: session, locale: CarePointLocale.en, accent: Colors.cyan))));
    await tester.pumpAndSettle();

    expect(find.text('Financial summary'), findsOneWidget);
    expect(find.text('22.50 USD'), findsAtLeastNWidgets(1));
    expect(find.text('CHARGE'), findsOneWidget);
    expect(find.text('Refund charge'), findsOneWidget);
  });
}
