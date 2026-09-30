import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/transport_workspace.dart';
import 'package:carepoint_mobile_core/transport_location.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('phase 5 transport location wire values preserve saved and healthcare sources', () {
    final saved = const TransportLocation(
      address: 'Saved home',
      source: TransportLocationSource.savedLocation,
    );
    final healthcare = const TransportLocation(
      address: 'Clinic entrance',
      source: TransportLocationSource.healthcareCenter,
    );

    expect(saved.toJson()['source'], 'SAVED_LOCATION');
    expect(healthcare.toJson()['source'], 'HEALTHCARE_CENTER');
    expect(
      TransportLocation.fromJson(saved.toJson()).source,
      TransportLocationSource.savedLocation,
    );
    expect(
      TransportLocation.fromJson(healthcare.toJson()).source,
      TransportLocationSource.healthcareCenter,
    );
  });

  test('phase 5 route preview supports address-only pickup and destination', () async {
    late Map<String, dynamic> body;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer phase5-route');
      expect(request.method, 'POST');
      expect(request.url.path, '/api/v1/transport/location/route-preview');
      body = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response(
        jsonEncode({
          'available': true,
          'mode': 'GROUND',
          'distanceMeters': 4200,
          'durationSeconds': 720,
          'etaMinutes': 12,
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'phase5-route'
      ..refreshToken = 'phase5-route-refresh';

    final response = await api.previewTransportRoute(
      mode: 'GROUND',
      pickup: const {'address': 'Patient home'},
      destination: const {'address': 'CarePoint clinic'},
      languageCode: 'en',
    );

    expect(response['etaMinutes'], 12);
    expect((body['pickup'] as Map)['address'], 'Patient home');
    expect((body['destination'] as Map)['address'], 'CarePoint clinic');
    expect((body['pickup'] as Map).containsKey('latitude'), false);
    expect((body['pickup'] as Map).containsKey('longitude'), false);
    expect((body['destination'] as Map).containsKey('latitude'), false);
    expect((body['destination'] as Map).containsKey('longitude'), false);
  });

  test('phase 6 provider ETA recalculation sends only the idempotency key', () async {
    late Map<String, dynamic> body;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer phase6-route');
      expect(request.method, 'POST');
      expect(
        request.url.path,
        '/api/v1/provider/medical-transport/tr-phase6/recalculate-eta',
      );
      body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body.length, 1);
      expect(body['idempotencyKey'], 'provider-eta-tr-phase6-test-0001');
      return http.Response(
        jsonEncode({
          'requestId': 'tr-phase6',
          'persisted': true,
          'replayed': false,
          'etaMinutes': 14,
          'preview': {
            'available': true,
            'mode': 'GROUND',
            'etaMinutes': 14,
          },
        }),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = CarePointApi(
      baseUrl: 'https://carepoint.test/api/v1',
      client: client,
    )
      ..accessToken = 'phase6-route'
      ..refreshToken = 'phase6-route-refresh';

    final response = await api.recalculateProviderMedicalTransportEta(
      'tr-phase6',
      idempotencyKey: 'provider-eta-tr-phase6-test-0001',
    );

    expect(response['persisted'], true);
    expect(response['etaMinutes'], 14);
  });

  test('patient emergency and transport requests never send authoritative patient identity', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      expect(request.headers['authorization'], 'Bearer transport-access');
      final body = request.body.isEmpty ? <String, dynamic>{} : jsonDecode(request.body) as Map<String, dynamic>;
      expect(body.containsKey('patientId'), false);
      expect(body.containsKey('providerId'), false);
      if (request.url.path.endsWith('/emergency/ambulance')) {
        expect(body['clientRequestId'], 'mobile-emergency-test-0001');
        expect(body['latitude'], 33.89);
        expect(body['longitude'], 35.50);
        return http.Response(jsonEncode({'emergencyFlow': true, 'request': {'id': 'em1', 'status': 'REQUESTED'}}), 201, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/medical-transport')) {
        expect(body['mode'], 'GROUND');
        expect(body['assistance'], 'WHEELCHAIR');
        expect(body['companionCount'], 2);
        expect(body['equipment'], ['OXYGEN', 'MONITORING']);
        return http.Response(jsonEncode({'request': {'id': 'tr1', 'status': 'REQUESTED', 'companionCount': 2, 'equipment': ['OXYGEN', 'MONITORING']}}), 201, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'transport-access'
      ..refreshToken = 'transport-refresh';

    final emergency = await api.requestEmergencyAmbulance(clientRequestId: 'mobile-emergency-test-0001', latitude: 33.89, longitude: 35.50);
    expect(emergency['emergencyFlow'], true);
    final transport = await api.createMedicalTransport(
      clientRequestId: 'mobile-transport-test-0001',
      mode: 'GROUND',
      scheduledFor: DateTime.utc(2031, 1, 15, 10),
      pickupLatitude: 33.89,
      pickupLongitude: 35.50,
      destinationLatitude: 33.88,
      destinationLongitude: 35.52,
      assistance: 'WHEELCHAIR',
      companionCount: 2,
      equipment: const ['OXYGEN', 'MONITORING'],
    );
    expect((transport['request'] as Map)['id'], 'tr1');
    expect(requests.length, 2);
  });

  test('provider transport acceptance and status derive provider identity server-side', () async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer provider-transport-access');
      final body = request.body.isEmpty ? <String, dynamic>{} : jsonDecode(request.body) as Map<String, dynamic>;
      expect(body.containsKey('providerId'), false);
      if (request.url.path.endsWith('/provider/medical-transport/tr1/accept')) {
        expect(body, isEmpty);
        return http.Response(jsonEncode({'id': 'tr1', 'status': 'ASSIGNED', 'assignedProviderId': 'server-derived'}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/provider/medical-transport/tr1/status')) {
        expect(body['status'], 'EN_ROUTE');
        return http.Response(jsonEncode({'id': 'tr1', 'status': 'EN_ROUTE'}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'provider-transport-access'
      ..refreshToken = 'provider-transport-refresh';

    expect((await api.acceptMedicalTransport('tr1'))['assignedProviderId'], 'server-derived');
    expect((await api.updateProviderMedicalTransportStatus('tr1', status: 'EN_ROUTE'))['status'], 'EN_ROUTE');
  });

  testWidgets('Other Provider transport workspace renders eligible scheduled transport queue and logistics', (tester) async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer workspace-transport-access');
      final path = request.url.path;
      if (path.endsWith('/provider/emergency/ambulance')) {
        return http.Response(jsonEncode({'message': 'Forbidden'}), 403, headers: {'content-type': 'application/json'});
      }
      if (path.endsWith('/provider/medical-transport/available')) {
        return http.Response(jsonEncode([
          {
            'id': 'tr1',
            'mode': 'GROUND',
            'status': 'REQUESTED',
            'scheduledFor': '2031-01-15T10:00:00Z',
            'pickupAddress': 'Pickup',
            'destinationAddress': 'Destination',
            'companionCount': 2,
            'equipment': ['OXYGEN', 'MONITORING'],
            'patient': {'firstName': 'CI', 'lastName': 'Patient'}
          }
        ]), 200, headers: {'content-type': 'application/json'});
      }
      if (path.endsWith('/provider/medical-transport')) {
        return http.Response('[]', 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'workspace-transport-access'
      ..refreshToken = 'workspace-transport-refresh';
    final session = CarePointSession(account: const {'id': 'provider1', 'role': 'OTHER_PROVIDER'}, api: api);

    await tester.pumpWidget(MaterialApp(home: ProviderTransportWorkspace(session: session, locale: CarePointLocale.en, accent: Colors.green)));
    await tester.pumpAndSettle();
    expect(find.text('Transport operations'), findsOneWidget);
    expect(find.text('Available requests'), findsOneWidget);
    expect(find.text('CI Patient'), findsOneWidget);
    expect(find.text('Companions: 2'), findsOneWidget);
    expect(find.text('Requested equipment: Oxygen, Monitoring'), findsOneWidget);
    expect(find.text('Accept job'), findsOneWidget);
  });
}