import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_api.dart';

extension PatientHealthSummaryExportApi on CarePointApi {
  Future<Map<String, dynamic>> createPatientHealthSummaryExport({
    required String format,
    required List<String> scopes,
    required String clientRequestId,
  }) => _patientExportJson(
        this,
        'POST',
        '/patient/exports/health-summary',
        body: {
          'format': format,
          'scopes': scopes,
          'confirmed': true,
          'clientRequestId': clientRequestId,
        },
      );

  Future<Map<String, dynamic>> patientClinicalExport(String jobId) =>
      _patientExportJson(this, 'GET', '/patient/exports/${Uri.encodeComponent(jobId)}');

  Future<Map<String, dynamic>> patientClinicalExportDownloadGrant(String jobId) =>
      _patientExportJson(this, 'POST', '/patient/exports/${Uri.encodeComponent(jobId)}/download-token', body: const {});

  Future<Map<String, dynamic>> downloadPatientClinicalExportBytes(String jobId) async {
    final grant = await patientClinicalExportDownloadGrant(jobId);
    final signedUrl = grant['signedUrl']?.toString() ?? '';
    final token = Uri.tryParse(signedUrl)?.queryParameters['token'];
    if (token == null || token.isEmpty) {
      throw const CarePointApiException('Export download grant did not contain a valid token.');
    }
    final response = await _patientExportRequest(
      this,
      'GET',
      '/patient/exports/${Uri.encodeComponent(jobId)}/download',
      query: {'token': token},
    );
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

Future<Map<String, dynamic>> _patientExportJson(
  CarePointApi api,
  String method,
  String path, {
  Map<String, String>? query,
  Map<String, dynamic>? body,
}) async {
  final response = await _patientExportRequest(api, method, path, query: query, body: body);
  dynamic decoded;
  try {
    decoded = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
  } catch (_) {
    throw const CarePointApiException('Unexpected export API response.');
  }
  if (decoded is Map<String, dynamic>) return decoded;
  if (decoded is Map) return decoded.map((key, value) => MapEntry(key.toString(), value));
  throw const CarePointApiException('Unexpected export API response shape.');
}

Future<http.Response> _patientExportRequest(
  CarePointApi api,
  String method,
  String path, {
  Map<String, String>? query,
  Map<String, dynamic>? body,
}) async {
  Future<http.Response> send() {
    final uri = Uri.parse('${api.baseUrl}$path').replace(queryParameters: query?.isEmpty == true ? null : query);
    final headers = <String, String>{
      'accept': 'application/json',
      if (body != null) 'content-type': 'application/json',
      if (api.accessToken != null) 'authorization': 'Bearer ${api.accessToken}',
    };
    final encoded = body == null ? null : jsonEncode(body);
    return switch (method) {
      'GET' => http.get(uri, headers: headers),
      'POST' => http.post(uri, headers: headers, body: encoded),
      _ => throw CarePointApiException('Unsupported export HTTP method: $method'),
    };
  }

  var response = await send();
  if (response.statusCode == 401 && api.refreshToken != null) {
    try {
      await api.me();
      response = await send();
    } catch (_) {
      // Preserve the authenticated failure below.
    }
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    dynamic payload;
    try { payload = response.body.isEmpty ? null : jsonDecode(response.body); } catch (_) { payload = response.body; }
    final message = payload is Map && payload['message'] != null
        ? payload['message'].toString()
        : 'Export request failed (${response.statusCode}).';
    throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
  }
  return response;
}
