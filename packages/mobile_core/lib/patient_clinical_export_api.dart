part of 'carepoint_api.dart';

class CarePointDownloadedClinicalExport {
  const CarePointDownloadedClinicalExport({
    required this.bytes,
    required this.mediaType,
    required this.fileName,
  });

  final List<int> bytes;
  final String mediaType;
  final String fileName;
}

extension PatientClinicalExportApi on CarePointApi {
  Future<Map<String, dynamic>> createPatientClinicalExport({
    required String format,
    required String clientRequestId,
  }) async {
    return _asMap(await _send('POST', '/patient/exports', body: {
      'format': format.trim().toUpperCase(),
      'clientRequestId': clientRequestId.trim(),
    }));
  }

  Future<Map<String, dynamic>> patientClinicalExportStatus(String jobId) async {
    return _asMap(await _send('GET', '/patient/exports/${Uri.encodeComponent(jobId)}'));
  }

  Future<Map<String, dynamic>> issuePatientClinicalExportDownloadGrant(String jobId) async {
    return _asMap(await _send(
      'POST',
      '/patient/exports/${Uri.encodeComponent(jobId)}/download-token',
      body: const {},
    ));
  }

  Future<CarePointDownloadedClinicalExport> downloadPatientClinicalExport(String jobId) async {
    final grant = await issuePatientClinicalExportDownloadGrant(jobId);
    final signedUrl = grant['signedUrl']?.toString();
    if (signedUrl == null || signedUrl.isEmpty) {
      throw const CarePointApiException('Clinical export grant did not contain a signed URL.');
    }
    final parsed = Uri.parse(signedUrl);
    final token = parsed.queryParameters['token'];
    if (token == null || token.isEmpty) {
      throw const CarePointApiException('Clinical export grant did not contain a download token.');
    }

    final response = await _raw(
      'GET',
      '/patient/exports/${Uri.encodeComponent(jobId)}/download',
      query: {'token': token},
    );
    if (response.statusCode < 200 || response.statusCode >= 300) _decode(response);

    final mediaType = (response.headers['content-type'] ?? 'application/octet-stream')
        .split(';')
        .first
        .trim();
    final disposition = response.headers['content-disposition'] ?? '';
    final match = RegExp(r'filename="([^"]+)"', caseSensitive: false).firstMatch(disposition);
    final fileName = match?.group(1)?.trim();
    return CarePointDownloadedClinicalExport(
      bytes: response.bodyBytes,
      mediaType: mediaType.isEmpty ? 'application/octet-stream' : mediaType,
      fileName: fileName == null || fileName.isEmpty
          ? 'carepoint-clinical-export-$jobId'
          : fileName,
    );
  }
}
