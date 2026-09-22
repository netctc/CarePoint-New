part of 'carepoint_api.dart';

extension PatientHealthSummaryExportApi on CarePointApi {
  Future<Map<String, dynamic>> createPatientHealthSummaryExport({
    required String format,
    required List<String> scopes,
    required String clientRequestId,
  }) async => _asMap(await _send(
        'POST',
        '/patient/exports/health-summary',
        body: {
          'format': format,
          'scopes': scopes,
          'confirmed': true,
          'clientRequestId': clientRequestId,
        },
      ));

  Future<Map<String, dynamic>> patientClinicalExport(String jobId) async =>
      _asMap(await _send('GET', '/patient/exports/${Uri.encodeComponent(jobId)}'));

  Future<Map<String, dynamic>> patientClinicalExportDownloadGrant(String jobId) async =>
      _asMap(await _send('POST', '/patient/exports/${Uri.encodeComponent(jobId)}/download-token', body: const {}));

  Future<Map<String, dynamic>> downloadPatientClinicalExportBytes(String jobId) async {
    final grant = await patientClinicalExportDownloadGrant(jobId);
    final signedUrl = grant['signedUrl']?.toString() ?? '';
    final token = Uri.tryParse(signedUrl)?.queryParameters['token'];
    if (token == null || token.isEmpty) {
      throw const CarePointApiException('Export download grant did not contain a valid token.');
    }
    final path = '/patient/exports/${Uri.encodeComponent(jobId)}/download';
    var response = await _raw('GET', path, query: {'token': token});
    if (response.statusCode == 401 && refreshToken != null && await _refresh()) {
      response = await _raw('GET', path, query: {'token': token});
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _decode(response);
    }
    final disposition = response.headers['content-disposition'] ?? '';
    final fileNameMatch = RegExp(r'filename="([^"]+)"').firstMatch(disposition);
    return {
      'bytes': response.bodyBytes.toList(growable: false),
      'byteLength': response.bodyBytes.length,
      'mediaType': response.headers['content-type'] ?? 'application/octet-stream',
      'fileName': fileNameMatch?.group(1) ?? 'carepoint-export',
      'grantExpiresAt': grant['expiresAt'],
    };
  }
}
