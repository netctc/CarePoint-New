import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('doctor onboarding client preserves role boundary and credential normalization', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      final path = request.url.path;
      if (path.endsWith('/doctors/specialties')) {
        expect(request.headers.containsKey('authorization'), false);
        return http.Response(jsonEncode({
          'domain': 'DOCTORS_ALL_SPECIALTIES',
          'items': [
            {'id': 'spec-1', 'code': 'CARD', 'labels': {'en': 'Cardiology', 'ar': 'قلب', 'fr': 'Cardiologie', 'es': 'Cardiología'}, 'active': true}
          ]
        }), 200);
      }
      expect(request.headers['authorization'], 'Bearer doctor-access');
      if (path.endsWith('/onboarding/me')) {
        return http.Response(jsonEncode({
          'kind': 'DOCTOR',
          'provider': {'id': 'provider-1', 'class': 'DOCTOR', 'status': 'DRAFT'},
          'onboarding': null,
          'accessReady': false
        }), 200);
      }
      if (path.endsWith('/onboarding/doctors')) {
        expect((jsonDecode(request.body) as Map<String, dynamic>)['specialtyId'], 'spec-1');
        return http.Response(jsonEncode({'id': 'onb-1', 'kind': 'DOCTOR', 'state': 'DRAFT'}), 201);
      }
      if (path.endsWith('/onboarding/onb-1/credentials')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['type'], 'medical-license');
        expect(body['number'], 'LIC-123');
        expect(body['issuer'], 'MOH');
        expect(body['validUntil'], '2028-12-31');
        expect(body['documentId'], 'doc-1');
        return http.Response(jsonEncode({'id': 'cred-1', 'type': 'medical-license', 'state': 'PENDING'}), 201);
      }
      if (path.endsWith('/onboarding/onb-1/submit')) {
        return http.Response(jsonEncode({'id': 'onb-1', 'kind': 'DOCTOR', 'state': 'PENDING_REVIEW'}), 201);
      }
      return http.Response('{}', 404);
    });

    final api = CarePointApi(
      baseUrl: 'https://carepoint.test/api/v1',
      client: client,
      tokenStore: MemoryCarePointTokenStore(),
    )
      ..accessToken = 'doctor-access'
      ..refreshToken = 'doctor-refresh';

    expect((await api.providerOnboardingState())['kind'], 'DOCTOR');
    expect((await api.doctorSpecialties()).single['code'], 'CARD');
    expect((await api.startDoctorOnboarding('spec-1'))['state'], 'DRAFT');
    expect((await api.addProviderOnboardingCredential(
      'onb-1',
      type: ' medical-license ',
      number: ' LIC-123 ',
      issuer: ' MOH ',
      validUntil: ' 2028-12-31 ',
      documentId: ' doc-1 ',
    ))['state'], 'PENDING');
    expect((await api.submitProviderOnboarding('onb-1'))['state'], 'PENDING_REVIEW');
    expect(requests.length, 5);
  });
}
