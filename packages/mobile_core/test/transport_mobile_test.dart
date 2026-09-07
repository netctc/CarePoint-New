import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/transport_workspace.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
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
        return http.Response(jsonEncode({'request': {'id': 'tr1', 'status': 'REQUESTED'}}), 201, headers: {'content-type': 'application/json'});
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

  testWidgets('Other Provider transport workspace renders eligible scheduled transport queue', (tester) async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer workspace-transport-access');
      final path = request.url.path;
      if (path.endsWith('/provider/emergency/ambulance')) {
        return http.Response(jsonEncode({'message': 'Forbidden'}), 403, headers: {'content-type': 'application/json'});
      }
      if (path.endsWith('/provider/medical-transport/available')) {
        return http.Response(jsonEncode([
          {'id': 'tr1', 'mode': 'GROUND', 'status': 'REQUESTED', 'scheduledFor': '2031-01-15T10:00:00Z', 'pickupAddress': 'Pickup', 'destinationAddress': 'Destination', 'patient': {'firstName': 'CI', 'lastName': 'Patient'}}
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
    expect(find.text('Accept job'), findsOneWidget);
  });
}
