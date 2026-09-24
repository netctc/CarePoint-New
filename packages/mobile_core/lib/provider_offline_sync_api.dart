import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_api.dart';

extension ProviderOfflineSyncCarePointApi on CarePointApi {
  Future<Map<String, dynamic>> syncOfflineFieldDraft(Map<String, dynamic> body) =>
      _offlineRequest('POST', '/provider/offline-sync', body: body, allowConflict: true);

  Future<List<Map<String, dynamic>>> offlineFieldSyncConflicts() async {
    final payload = await _offlineRequest('GET', '/provider/offline-sync/conflicts');
    final value = payload['items'];
    if (value is! List) return const [];
    return value.map(_offlineMap).toList(growable: false);
  }

  Future<Map<String, dynamic>> offlineFieldSyncConflict(String conflictId) =>
      _offlineRequest('GET', '/provider/offline-sync/conflicts/${Uri.encodeComponent(conflictId)}');

  Future<Map<String, dynamic>> resolveOfflineFieldSyncConflict(
    String conflictId, {
    required String resolution,
  }) =>
      _offlineRequest(
        'POST',
        '/provider/offline-sync/conflicts/${Uri.encodeComponent(conflictId)}/resolve',
        body: {'resolution': resolution},
      );

  Future<Map<String, dynamic>> syncDoctorOfflineClinicalDraft(Map<String, dynamic> body) =>
      _offlineRequest('POST', '/doctor/offline-sync', body: body, allowConflict: true);

  Future<List<Map<String, dynamic>>> doctorOfflineClinicalConflicts() async {
    final payload = await _offlineRequest('GET', '/doctor/offline-sync/conflicts');
    final value = payload['items'];
    if (value is! List) return const [];
    return value.map(_offlineMap).toList(growable: false);
  }

  Future<Map<String, dynamic>> doctorOfflineClinicalConflict(String conflictId) =>
      _offlineRequest('GET', '/doctor/offline-sync/conflicts/${Uri.encodeComponent(conflictId)}');

  Future<Map<String, dynamic>> resolveDoctorOfflineClinicalConflict(
    String conflictId, {
    required String resolution,
  }) =>
      _offlineRequest(
        'POST',
        '/doctor/offline-sync/conflicts/${Uri.encodeComponent(conflictId)}/resolve',
        body: {'resolution': resolution},
      );

  Future<Map<String, dynamic>> _offlineRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool allowConflict = false,
  }) async {
    Future<http.Response> send() {
      final token = accessToken;
      if (token == null || token.isEmpty) {
        throw const CarePointApiException('An authenticated provider session is required.');
      }
      final headers = <String, String>{
        'accept': 'application/json',
        'authorization': 'Bearer $token',
        if (body != null) 'content-type': 'application/json',
      };
      final uri = Uri.parse('$baseUrl$path');
      final encoded = body == null ? null : jsonEncode(body);
      return switch (method) {
        'GET' => http.get(uri, headers: headers),
        'POST' => http.post(uri, headers: headers, body: encoded),
        _ => throw CarePointApiException('Unsupported offline sync HTTP method: $method'),
      };
    }

    var response = await send();
    if (response.statusCode == 401) {
      // CarePointApi.me() uses the canonical refresh-token rotation path. Once it
      // succeeds, accessToken has been replaced and the offline request can retry.
      await me();
      response = await send();
    }

    dynamic decoded;
    if (response.body.isNotEmpty) {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = response.body;
      }
    }
    final payload = decoded is Map ? _offlineMap(decoded) : <String, dynamic>{};
    if (allowConflict && response.statusCode == 409 && payload['outcome'] == 'CONFLICT') {
      return payload;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload['message']?.toString() ?? 'Offline sync request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: decoded);
    }
    return payload;
  }
}

Map<String, dynamic> _offlineMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}
