import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_api.dart';

class ProviderFieldMediaApi {
  ProviderFieldMediaApi(this.session);

  final CarePointSession session;

  Future<Map<String, dynamic>> consentStatus(String appointmentId) =>
      _request('GET', '/provider/jobs/${Uri.encodeComponent(appointmentId)}/media/consent');

  Future<Map<String, dynamic>> history(String appointmentId) =>
      _request('GET', '/provider/jobs/${Uri.encodeComponent(appointmentId)}/media');

  Future<Map<String, dynamic>> create(
    String appointmentId, {
    required String idempotencyKey,
    required String mediaType,
    required String contentBase64,
    required DateTime capturedAt,
    String? caption,
    String? bodySiteCode,
  }) =>
      _request(
        'POST',
        '/provider/jobs/${Uri.encodeComponent(appointmentId)}/media',
        body: {
          'idempotencyKey': idempotencyKey,
          'mediaType': mediaType,
          'contentBase64': contentBase64,
          'capturedAt': capturedAt.toUtc().toIso8601String(),
          'metadata': {
            'title': 'Field visit evidence',
            if (caption?.trim().isNotEmpty == true) 'caption': caption!.trim(),
            if (bodySiteCode?.trim().isNotEmpty == true) 'bodySiteCode': bodySiteCode!.trim(),
          },
        },
      );

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool retryAuth = true,
  }) async {
    final uri = Uri.parse('${session.api.baseUrl}$path');
    final token = session.api.accessToken;
    final headers = <String, String>{
      'accept': 'application/json',
      if (body != null) 'content-type': 'application/json',
      if (token != null && token.isNotEmpty) 'authorization': 'Bearer $token',
    };
    final encoded = body == null ? null : jsonEncode(body);
    final response = switch (method) {
      'GET' => await http.get(uri, headers: headers),
      'POST' => await http.post(uri, headers: headers, body: encoded),
      _ => throw const CarePointApiException('Unsupported field-media request method.'),
    };

    if (response.statusCode == 401 && retryAuth && session.api.refreshToken?.isNotEmpty == true) {
      try {
        await session.api.me();
      } catch (_) {
        // The normal session boundary owns logout/redirect behavior.
      }
      return _request(method, path, body: body, retryAuth: false);
    }

    dynamic payload;
    if (response.body.isNotEmpty) {
      try {
        payload = jsonDecode(response.body);
      } catch (_) {
        payload = response.body;
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null
          ? payload['message'].toString()
          : 'Field media request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    if (payload is Map<String, dynamic>) return payload;
    if (payload is Map) return payload.map((key, value) => MapEntry(key.toString(), value));
    throw const CarePointApiException('Unexpected field media response shape.');
  }
}
