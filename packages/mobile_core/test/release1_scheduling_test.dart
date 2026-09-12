import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:carepoint_mobile_core/release1_scheduling.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('Release 1 discovery sends structured deterministic filters without bearer token', () async {
    late http.Request captured;
    final client = MockClient((request) async {
      captured = request;
      return http.Response(jsonEncode({'page': 2, 'limit': 10, 'nextPage': null, 'items': []}), 200, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', tokenStore: MemoryCarePointTokenStore());
    final scheduling = Release1SchedulingApi(api, client: client);
    final result = await scheduling.discovery(
      query: 'cardio',
      specialty: 'CARDIOLOGY',
      providerClass: 'DOCTOR',
      providerCategory: 'ignored-by-doctor-test',
      service: 'svc-1',
      modality: 'CLINIC',
      location: 'Beirut',
      page: 2,
      limit: 10,
    );
    expect(captured.method, 'GET');
    expect(captured.url.path, '/api/v1/services/discovery');
    expect(captured.headers.containsKey('authorization'), isFalse);
    expect(captured.url.queryParameters, containsPair('specialty', 'CARDIOLOGY'));
    expect(captured.url.queryParameters, containsPair('providerClass', 'DOCTOR'));
    expect(captured.url.queryParameters, containsPair('providerCategory', 'ignored-by-doctor-test'));
    expect(captured.url.queryParameters, containsPair('service', 'svc-1'));
    expect(captured.url.queryParameters, containsPair('modality', 'CLINIC'));
    expect(captured.url.queryParameters, containsPair('location', 'Beirut'));
    expect(captured.url.queryParameters, containsPair('page', '2'));
    expect(captured.url.queryParameters, containsPair('limit', '10'));
    expect(result['page'], 2);
  });

  test('provider location and clinic context requests require bearer token and validation evidence', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      expect(request.headers['authorization'], 'Bearer provider-access');
      if (request.url.path.endsWith('/provider/locations')) return http.Response(jsonEncode({'id': 'loc-1', 'validated': true}), 201, headers: {'content-type': 'application/json'});
      if (request.url.path.endsWith('/provider/services/svc-1/delivery-context/CLINIC')) return http.Response(jsonEncode({'id': 'svc-1'}), 200, headers: {'content-type': 'application/json'});
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', tokenStore: MemoryCarePointTokenStore())..accessToken = 'provider-access';
    final scheduling = Release1SchedulingApi(api, client: client);
    final location = await scheduling.createProviderLocation(
      label: 'Clinic',
      addressLine1: '100 CarePoint Avenue',
      city: 'Beirut',
      countryCode: 'LB',
      latitude: 33.8938,
      longitude: 35.5018,
      arrivalInstructions: 'Main reception',
      addressValidated: true,
    );
    expect(location['validated'], true);
    final locationBody = jsonDecode(requests.first.body) as Map<String, dynamic>;
    expect(locationBody['addressValidated'], true);
    expect(locationBody['latitude'], 33.8938);
    await scheduling.configureClinicContext(serviceId: 'svc-1', locationId: 'loc-1', arrivalInstructions: 'Main reception');
    final contextBody = jsonDecode(requests.last.body) as Map<String, dynamic>;
    expect(contextBody['clinicLocationId'], 'loc-1');
    expect(contextBody['clinicArrivalInstructions'], 'Main reception');
  });

  test('home-visit booking preserves structured address coordinates instructions and contact confirmation', () async {
    late http.Request captured;
    final client = MockClient((request) async {
      captured = request;
      expect(request.headers['authorization'], 'Bearer patient-access');
      return http.Response(jsonEncode({'id': 'appt-1', 'visitContext': {'modality': 'HOME_VISIT'}}), 201, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', tokenStore: MemoryCarePointTokenStore())..accessToken = 'patient-access';
    final scheduling = Release1SchedulingApi(api, client: client);
    final result = await scheduling.book(
      slotId: 'slot-1',
      idempotencyKey: 'mobile-r1-home-0001',
      homeVisit: {
        'addressLine1': '12 Home Care Street',
        'city': 'Beirut',
        'countryCode': 'LB',
        'latitude': 33.89,
        'longitude': 35.50,
        'instructions': 'Call on arrival',
        'contactPhone': '+9611000000',
        'contactConfirmed': true,
        'addressValidated': true,
      },
    );
    expect(captured.url.path, '/api/v1/bookings');
    final body = jsonDecode(captured.body) as Map<String, dynamic>;
    final home = body['homeVisit'] as Map<String, dynamic>;
    expect(home['addressValidated'], true);
    expect(home['contactConfirmed'], true);
    expect(home['latitude'], 33.89);
    expect(home['instructions'], 'Call on arrival');
    expect(result['visitContext']['modality'], 'HOME_VISIT');
  });

  test('availability exception client sends explicit vacation interval', () async {
    late http.Request captured;
    final client = MockClient((request) async {
      captured = request;
      expect(request.headers['authorization'], 'Bearer provider-access');
      return http.Response(jsonEncode({'id': 'ex-1', 'kind': 'VACATION'}), 201, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', tokenStore: MemoryCarePointTokenStore())..accessToken = 'provider-access';
    final scheduling = Release1SchedulingApi(api, client: client);
    await scheduling.createAvailabilityException(
      serviceId: 'svc-1',
      modality: 'CLINIC',
      kind: 'VACATION',
      startsAt: DateTime.utc(2031, 1, 6, 10),
      endsAt: DateTime.utc(2031, 1, 6, 12),
      reason: 'Leave',
    );
    final body = jsonDecode(captured.body) as Map<String, dynamic>;
    expect(body['kind'], 'VACATION');
    expect(body['serviceId'], 'svc-1');
    expect(body['modality'], 'CLINIC');
    expect(body['startsAt'], contains('2031-01-06T10:00:00'));
    expect(body['endsAt'], contains('2031-01-06T12:00:00'));
  });

  test('authenticated Release 1 scheduling operation fails without an active session', () async {
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', tokenStore: MemoryCarePointTokenStore());
    final scheduling = Release1SchedulingApi(api, client: MockClient((_) async => http.Response('{}', 500)));
    expect(
      () => scheduling.book(slotId: 'slot-1', idempotencyKey: 'missing-session-0001'),
      throwsA(isA<CarePointApiException>()),
    );
  });
}
