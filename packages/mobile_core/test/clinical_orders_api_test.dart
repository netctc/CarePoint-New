import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('clinical orders client covers prescription and laboratory release lifecycle', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer orders-access');
      final body = request.body.isEmpty ? <String, dynamic>{} : jsonDecode(request.body) as Map<String, dynamic>;

      if (request.url.path.endsWith('/clinical-orders/appointments/appt1/prescriptions')) {
        expect(body['idempotencyKey'], 'idem-prescription');
        return http.Response(jsonEncode({'id': 'rx1', 'type': 'PRESCRIPTION', 'status': 'SIGNED'}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-orders/appointments/appt1/laboratory')) {
        expect(body['idempotencyKey'], 'idem-lab');
        return http.Response(jsonEncode({'id': 'lab1', 'type': 'LABORATORY', 'status': 'SIGNED'}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-orders/lab1/lab-result') && !request.url.path.endsWith('/validate') && !request.url.path.endsWith('/release')) {
        return http.Response(jsonEncode({'id': 'lab1', 'labResult': {'status': 'ENTERED'}}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-orders/lab1/lab-result/validate')) {
        return http.Response(jsonEncode({'id': 'lab1', 'labResult': {'status': 'VALIDATED'}}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-orders/lab1/lab-result/release')) {
        return http.Response(jsonEncode({'id': 'lab1', 'status': 'FULFILLED', 'labResult': {'status': 'RELEASED', 'released': true}}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-orders/me')) {
        return http.Response(jsonEncode({'patientId': 'p1', 'accessBasis': 'PATIENT_SELF', 'items': []}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });

    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'orders-access'
      ..refreshToken = 'orders-refresh';

    final prescription = await api.createPrescription('appt1', {
      'idempotencyKey': 'idem-prescription',
      'medication': {'name': 'TEST-MEDICATION'},
      'dosageInstruction': 'TEST-INSTRUCTION',
    });
    expect(prescription['status'], 'SIGNED');

    final laboratory = await api.createLaboratoryOrder('appt1', {
      'idempotencyKey': 'idem-lab',
      'tests': [
        {'display': 'TEST-OBSERVATION'}
      ],
    });
    expect(laboratory['type'], 'LABORATORY');

    final entered = await api.enterLaboratoryResult('lab1', {
      'observations': [
        {'display': 'TEST-OBSERVATION', 'value': 'TEST-VALUE'}
      ],
    });
    expect((entered['labResult'] as Map)['status'], 'ENTERED');

    final validated = await api.validateLaboratoryResult('lab1');
    expect((validated['labResult'] as Map)['status'], 'VALIDATED');

    final released = await api.releaseLaboratoryResult('lab1');
    expect(released['status'], 'FULFILLED');

    final patientOrders = await api.patientClinicalOrders();
    expect(patientOrders['accessBasis'], 'PATIENT_SELF');
    expect(paths, containsAll([
      '/api/v1/clinical-orders/appointments/appt1/prescriptions',
      '/api/v1/clinical-orders/appointments/appt1/laboratory',
      '/api/v1/clinical-orders/lab1/lab-result',
      '/api/v1/clinical-orders/lab1/lab-result/validate',
      '/api/v1/clinical-orders/lab1/lab-result/release',
      '/api/v1/clinical-orders/me',
    ]));
  });
}
