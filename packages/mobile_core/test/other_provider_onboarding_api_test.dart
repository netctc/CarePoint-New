import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response jsonResponse(Object body, int status) => http.Response(
      jsonEncode(body),
      status,
      headers: const {'content-type': 'application/json; charset=utf-8'},
    );

void main() {
  test('other provider onboarding uses public taxonomy and authenticated self-service', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      final path = request.url.path;
      if (path.endsWith('/other-provider-categories')) {
        expect(request.headers.containsKey('authorization'), false);
        return jsonResponse({
          'excludesDoctors': true,
          'items': [
            {
              'id': 'cat-1',
              'slug': 'physiotherapy',
              'labels': {'en': 'Physiotherapy', 'ar': 'العلاج الطبيعي', 'fr': 'Physiothérapie', 'es': 'Fisioterapia'},
              'family': 'ALLIED_HEALTH',
              'requiredCredentialTypes': ['professional-license'],
              'enabledModalities': ['CLINIC', 'HOME_VISIT']
            }
          ]
        }, 200);
      }
      expect(request.headers['authorization'], 'Bearer provider-access');
      if (path.endsWith('/onboarding/me')) {
        return jsonResponse({'kind': 'OTHER_PROVIDER', 'provider': null, 'onboarding': null, 'accessReady': false}, 200);
      }
      if (path.endsWith('/onboarding/other-providers')) {
        expect((jsonDecode(request.body) as Map<String, dynamic>)['providerCategoryId'], 'cat-1');
        return jsonResponse({'id': 'onb-1', 'kind': 'OTHER_PROVIDER', 'state': 'DRAFT'}, 201);
      }
      if (path.endsWith('/onboarding/onb-1/credentials')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['type'], 'professional-license');
        expect(body['number'], 'PHY-100');
        return jsonResponse({'id': 'cred-1', 'type': 'professional-license', 'state': 'PENDING'}, 201);
      }
      if (path.endsWith('/onboarding/onb-1/submit')) {
        return jsonResponse({'id': 'onb-1', 'kind': 'OTHER_PROVIDER', 'state': 'PENDING_REVIEW'}, 201);
      }
      return jsonResponse(const <String, dynamic>{}, 404);
    });

    final api = CarePointApi(
      baseUrl: 'https://carepoint.test/api/v1',
      client: client,
      tokenStore: MemoryCarePointTokenStore(),
    )
      ..accessToken = 'provider-access'
      ..refreshToken = 'provider-refresh';

    expect((await api.providerOnboardingState())['kind'], 'OTHER_PROVIDER');
    expect((await api.otherProviderCategories()).single['slug'], 'physiotherapy');
    expect((await api.startOtherProviderOnboarding('cat-1'))['state'], 'DRAFT');
    expect((await api.addProviderOnboardingCredential(
      'onb-1',
      type: ' professional-license ',
      number: ' PHY-100 ',
    ))['state'], 'PENDING');
    expect((await api.submitProviderOnboarding('onb-1'))['state'], 'PENDING_REVIEW');
    expect(requests.length, 5);
  });
}
