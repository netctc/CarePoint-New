import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('clinical documents client preserves bearer auth and release lifecycle', () async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer docs-access');
      if (request.url.path.endsWith('/clinical-documents/me')) {
        return http.Response(jsonEncode({'patientId': 'p1', 'accessBasis': 'PATIENT_SELF', 'items': []}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-documents/appointments/a1/reference')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['externalReference'], 'opaque-ref');
        return http.Response(jsonEncode({'id': 'd1', 'storageMode': 'EXTERNAL_REFERENCE', 'releasedToPatient': false}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-documents/d1/release')) {
        return http.Response(jsonEncode({'id': 'd1', 'releasedToPatient': true}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'docs-access'..refreshToken = 'docs-refresh';
    final patient = await api.patientClinicalDocuments();
    expect(patient['accessBasis'], 'PATIENT_SELF');
    final reference = await api.createEncounterDocumentReference('a1', {'title': 'Imaging', 'externalReference': 'opaque-ref'});
    expect(reference['id'], 'd1');
    final released = await api.releaseClinicalDocument('d1');
    expect(released['releasedToPatient'], true);
    expect(paths, containsAll(['/api/v1/clinical-documents/me', '/api/v1/clinical-documents/appointments/a1/reference', '/api/v1/clinical-documents/d1/release']));
  });

  test('diagnostic report client covers draft finalize and release', () async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer report-access');
      if (request.url.path.endsWith('/diagnostic-reports/appointments/a1')) return http.Response(jsonEncode({'id': 'r1', 'status': 'DRAFT'}), 200);
      if (request.url.path.endsWith('/diagnostic-reports/r1/finalize')) return http.Response(jsonEncode({'id': 'r1', 'status': 'FINAL', 'attestation': {'payloadDigest': 'digest'}}), 200);
      if (request.url.path.endsWith('/diagnostic-reports/r1/release')) return http.Response(jsonEncode({'id': 'r1', 'status': 'RELEASED'}), 200);
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'report-access'..refreshToken = 'report-refresh';
    expect((await api.createDiagnosticReport('a1', {'type': 'IMAGING', 'findings': 'test'}))['status'], 'DRAFT');
    expect((await api.finalizeDiagnosticReport('r1'))['status'], 'FINAL');
    expect((await api.releaseDiagnosticReport('r1'))['status'], 'RELEASED');
  });
}
