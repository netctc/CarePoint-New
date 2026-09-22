import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_api.dart';

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

class PatientClinicalExportApi {
  PatientClinicalExportApi(this.api, {http.Client? client}) : _client = client ?? http.Client();

  final CarePointApi api;
  final http.Client _client;

  Future<Map<String, dynamic>> create({
    required String format,
    required String clientRequestId,
  }) async {
    return _jsonRequest(
      'POST',
      '/patient/exports',
      body: {
        'format': format.trim().toUpperCase(),
        'clientRequestId': clientRequestId.trim(),
      },
    );
  }

  Future<Map<String, dynamic>> status(String jobId) {
    return _jsonRequest('GET', '/patient/exports/${Uri.encodeComponent(jobId)}');
  }

  Future<Map<String, dynamic>> issueDownloadGrant(String jobId) {
    return _jsonRequest(
      'POST',
      '/patient/exports/${Uri.encodeComponent(jobId)}/download-token',
      body: const {},
    );
  }

  Future<CarePointDownloadedClinicalExport> download(String jobId) async {
    final grant = await issueDownloadGrant(jobId);
    final signedUrl = grant['signedUrl']?.toString();
    if (signedUrl == null || signedUrl.isEmpty) {
      throw const CarePointApiException('Clinical export grant did not contain a signed URL.');
    }
    final parsed = Uri.parse(signedUrl);
    final token = parsed.queryParameters['token'];
    if (token == null || token.isEmpty) {
      throw const CarePointApiException('Clinical export grant did not contain a download token.');
    }

    final response = await _request(
      'GET',
      '/patient/exports/${Uri.encodeComponent(jobId)}/download',
      query: {'token': token},
      retryAuth: true,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _throwResponse(response);
    }

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

  Future<Map<String, dynamic>> _jsonRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final response = await _request(method, path, body: body, retryAuth: true);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _throwResponse(response);
    }
    if (response.body.isEmpty) return <String, dynamic>{};
    final decoded = jsonDecode(response.body);
    if (decoded is Map<String, dynamic>) return decoded;
    if (decoded is Map) return decoded.map((key, value) => MapEntry(key.toString(), value));
    throw const CarePointApiException('Unexpected clinical export API response shape.');
  }

  Future<http.Response> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
    required bool retryAuth,
  }) async {
    final uri = Uri.parse('${api.baseUrl}$path').replace(queryParameters: query);
    final headers = <String, String>{
      'accept': 'application/json',
      if (body != null) 'content-type': 'application/json',
      if (api.accessToken != null) 'authorization': 'Bearer ${api.accessToken}',
    };
    final encoded = body == null ? null : jsonEncode(body);
    final response = switch (method) {
      'GET' => await _client.get(uri, headers: headers),
      'POST' => await _client.post(uri, headers: headers, body: encoded),
      _ => throw CarePointApiException('Unsupported clinical export HTTP method: $method'),
    };
    if (response.statusCode == 401 && retryAuth) {
      final restored = await api.restoreSession();
      if (restored != null) {
        return _request(method, path, query: query, body: body, retryAuth: false);
      }
    }
    return response;
  }

  Never _throwResponse(http.Response response) {
    dynamic payload;
    if (response.body.isNotEmpty) {
      try {
        payload = jsonDecode(response.body);
      } catch (_) {
        payload = response.body;
      }
    }
    final message = payload is Map && payload['message'] != null
        ? payload['message'].toString()
        : 'Clinical export request failed (${response.statusCode}).';
    throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
  }
}
