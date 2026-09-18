import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/financial_workspace.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('patient billing creates and refreshes payment intent with bearer auth', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      expect(request.headers['authorization'], 'Bearer finance-access');
      if (request.url.path.endsWith('/billing/me')) {
        return http.Response(jsonEncode({'patientId': 'p1', 'invoices': [], 'paymentIntents': [], 'receipts': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/billing/invoices/inv1/payment-intents')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['idempotencyKey'], 'mobile-payment-test-0001');
        expect(body['amountMinor'], 2250);
        expect(body.containsKey('paymentMethodToken'), false);
        return http.Response(jsonEncode({'id': 'pi1', 'invoiceId': 'inv1', 'status': 'REQUIRES_ACTION', 'actionUrl': 'https://pay.example.test/session/1'}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/billing/payment-intents/pi1/refresh')) {
        return http.Response(jsonEncode({'id': 'pi1', 'invoiceId': 'inv1', 'status': 'SUCCEEDED'}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'finance-access'
      ..refreshToken = 'finance-refresh';

    expect((await api.patientBilling())['patientId'], 'p1');
    final intent = await api.createPaymentIntent('inv1', idempotencyKey: 'mobile-payment-test-0001', amountMinor: 2250);
    expect(intent['status'], 'REQUIRES_ACTION');
    expect(secureHostedPaymentUri(intent['actionUrl'])?.host, 'pay.example.test');
    expect((await api.refreshPaymentIntent('pi1'))['status'], 'SUCCEEDED');
    expect(requests.length, 3);
  });

  test('insurance mobile client manages coverage and eligibility without trusting patient identity input', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer insurance-access');
      if (request.url.path.endsWith('/insurance/me/coverages') && request.method == 'POST') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['externalPolicyRef'], 'opaque-member-reference');
        expect(body.containsKey('patientId'), false);
        return http.Response(jsonEncode({'id': 'cov1', 'payerCode': 'PAY', 'payerName': 'Payer', 'status': 'ACTIVE', 'policyReferenceStoredExternally': true}), 200);
      }
      if (request.url.path.endsWith('/insurance/me/coverages')) {
        return http.Response(jsonEncode([{'id': 'cov1', 'payerCode': 'PAY', 'payerName': 'Payer', 'status': 'ACTIVE', 'policyReferenceStoredExternally': true}]), 200);
      }
      if (request.url.path.endsWith('/insurance/appointments/appt1/eligibility')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['coverageId'], 'cov1');
        expect(body.containsKey('patientId'), false);
        return http.Response(jsonEncode({'id': 'elig1', 'coverageId': 'cov1', 'status': 'ELIGIBLE'}), 200);
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'insurance-access'
      ..refreshToken = 'insurance-refresh';

    final coverage = await api.createInsuranceCoverage(payerCode: 'PAY', payerName: 'Payer', externalPolicyRef: 'opaque-member-reference');
    expect(coverage['policyReferenceStoredExternally'], true);
    expect((await api.patientInsuranceCoverages()).single['id'], 'cov1');
    expect((await api.checkInsuranceEligibility('appt1', coverageId: 'cov1', idempotencyKey: 'eligibility-test-0001'))['status'], 'ELIGIBLE');
    expect(paths, contains('/api/v1/insurance/appointments/appt1/eligibility'));
  });

  test('provider financial client supports appointment finance, prior authorization and refund', () async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer provider-finance');
      if (request.url.path.endsWith('/provider/finance/appointments/appt1') && request.method == 'GET') {
        return http.Response(jsonEncode({'appointmentId': 'appt1', 'invoice': {'id': 'inv1'}, 'eligibility': [{'id': 'elig1', 'coverageId': 'cov1'}], 'priorAuthorizations': []}), 200);
      }
      if (request.url.path.endsWith('/insurance/appointments/appt1/prior-authorization')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['coverageId'], 'cov1');
        expect(body['eligibilityCheckId'], 'elig1');
        return http.Response(jsonEncode({'id': 'pa1', 'status': 'PENDING'}), 200);
      }
      if (request.url.path.endsWith('/provider/finance/payment-intents/pi1/refunds')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['amountMinor'], 1000);
        return http.Response(jsonEncode({'id': 'refund1', 'status': 'SUCCEEDED'}), 200);
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'provider-finance'
      ..refreshToken = 'provider-refresh';

    expect((await api.providerAppointmentFinance('appt1'))['invoice']['id'], 'inv1');
    expect((await api.requestPriorAuthorization('appt1', coverageId: 'cov1', eligibilityCheckId: 'elig1', idempotencyKey: 'prior-auth-test-0001'))['status'], 'PENDING');
    expect((await api.refundProviderPayment('pi1', amountMinor: 1000, idempotencyKey: 'refund-test-0001', reason: 'Adjustment'))['status'], 'SUCCEEDED');
  });

  test('claims mobile client preserves ownership boundaries and rework lifecycle', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer claims-access');
      if (request.url.path.endsWith('/revenue-cycle/me')) {
        return http.Response(jsonEncode({'patientId': 'p1', 'claims': [{'id': 'clm1', 'status': 'ADJUDICATED'}], 'eobs': []}), 200);
      }
      if (request.url.path.endsWith('/provider/revenue-cycle/claims') && request.method == 'GET') {
        return http.Response(jsonEncode({'providerId': 'pr1', 'claims': [{'id': 'clm1', 'status': 'DENIED'}], 'eobs': [], 'remittances': []}), 200);
      }
      if (request.url.path.endsWith('/provider/revenue-cycle/appointments/appt1/claims')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['coverageId'], 'cov1');
        expect(body['idempotencyKey'], 'claim-mobile-test-0001');
        expect(body.containsKey('patientId'), false);
        expect(body.containsKey('providerId'), false);
        return http.Response(jsonEncode({'id': 'clm1', 'appointmentId': 'appt1', 'version': 1, 'status': 'SUBMITTED'}), 200);
      }
      if (request.url.path.endsWith('/provider/revenue-cycle/claims/clm1/refresh')) {
        return http.Response(jsonEncode({'claim': {'id': 'clm1', 'status': 'DENIED'}, 'eob': {'denialCode': 'TEST'}}), 200);
      }
      if (request.url.path.endsWith('/provider/revenue-cycle/claims/clm1/rework')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['reasonCode'], 'CORRECTED_CLAIM');
        expect(body.containsKey('patientId'), false);
        return http.Response(jsonEncode({'id': 'clm2', 'previousClaimId': 'clm1', 'version': 2, 'status': 'SUBMITTED'}), 200);
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'claims-access'
      ..refreshToken = 'claims-refresh';

    expect((await api.patientRevenueCycle())['patientId'], 'p1');
    expect((await api.providerRevenueCycle())['providerId'], 'pr1');
    expect((await api.submitInsuranceClaim('appt1', coverageId: 'cov1', idempotencyKey: 'claim-mobile-test-0001'))['status'], 'SUBMITTED');
    expect((await api.refreshProviderClaim('clm1'))['claim']['status'], 'DENIED');
    expect((await api.reworkProviderClaim('clm1', idempotencyKey: 'claim-rework-mobile-0001', reasonCode: 'CORRECTED_CLAIM'))['version'], 2);
    expect(paths, containsAll([
      '/api/v1/revenue-cycle/me',
      '/api/v1/provider/revenue-cycle/claims',
      '/api/v1/provider/revenue-cycle/appointments/appt1/claims',
      '/api/v1/provider/revenue-cycle/claims/clm1/refresh',
      '/api/v1/provider/revenue-cycle/claims/clm1/rework',
    ]));
  });

  test('hosted payment boundary accepts HTTPS only', () {
    expect(secureHostedPaymentUri('https://payments.example.test/pay/1'), isNotNull);
    expect(secureHostedPaymentUri('http://payments.example.test/pay/1'), isNull);
    expect(secureHostedPaymentUri('javascript:alert(1)'), isNull);
    expect(secureHostedPaymentUri('not-a-url'), isNull);
  });
}
