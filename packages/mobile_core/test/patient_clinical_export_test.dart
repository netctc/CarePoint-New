import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_clinical_export.dart';
import 'package:carepoint_mobile_core/patient_clinical_export_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('patient clinical export uses authenticated job and one-time download flow', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      expect(request.headers['authorization'], 'Bearer export-access');
      if (request.method == 'POST' && request.url.path.endsWith('/patient/exports')) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['format'], 'PDF');
        expect(body['clientRequestId'], 'mobile-request-1');
        return http.Response(jsonEncode({
          'id': 'job-1',
          'format': 'PDF',
          'scope': 'PATIENT_CLINICAL_PORTABILITY',
          'status': 'PENDING',
          'createdAt': '2026-09-22T10:00:00Z',
          'expiresAt': '2026-09-23T10:00:00Z',
        }), 201, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path.endsWith('/patient/exports/job-1') && !request.url.path.endsWith('/download')) {
        return http.Response(jsonEncode({
          'id': 'job-1',
          'format': 'PDF',
          'scope': 'PATIENT_CLINICAL_PORTABILITY',
          'status': 'READY',
          'mediaType': 'application/pdf',
          'byteLength': 7,
          'createdAt': '2026-09-22T10:00:00Z',
          'expiresAt': '2026-09-23T10:00:00Z',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path.endsWith('/patient/exports/job-1/download-token')) {
        return http.Response(jsonEncode({
          'jobId': 'job-1',
          'expiresAt': '2026-09-22T10:05:00Z',
          'signedUrl': '/api/v1/patient/exports/job-1/download?token=one_time_export_token_12345678901234567890',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path.endsWith('/patient/exports/job-1/download')) {
        expect(request.url.queryParameters['token'], 'one_time_export_token_12345678901234567890');
        return http.Response.bytes(
          const [37, 80, 68, 70, 45, 49, 46],
          200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="carepoint-export.pdf"',
          },
        );
      }
      return http.Response('{}', 404);
    });

    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1')
      ..accessToken = 'export-access'
      ..refreshToken = 'export-refresh';
    final exports = PatientClinicalExportApi(api, client: client);

    final created = await exports.create(format: 'pdf', clientRequestId: 'mobile-request-1');
    expect(created['status'], 'PENDING');
    final ready = await exports.status('job-1');
    expect(ready['status'], 'READY');
    final downloaded = await exports.download('job-1');
    expect(downloaded.mediaType, 'application/pdf');
    expect(downloaded.fileName, 'carepoint-export.pdf');
    expect(downloaded.bytes, isNotEmpty);

    expect(requests.where((request) => request.url.path.endsWith('/download-token')), hasLength(1));
    expect(requests.where((request) => request.url.path.endsWith('/download')), hasLength(1));
  });

  test('patient clinical export copy is available in all supported locales', () {
    for (final locale in CarePointLocale.values) {
      expect(patientClinicalExportText(locale, 'title'), isNotEmpty);
      expect(patientClinicalExportText(locale, 'confirmBody'), isNotEmpty);
      expect(patientClinicalExportText(locale, 'downloadHint'), isNotEmpty);
    }
  });
}
