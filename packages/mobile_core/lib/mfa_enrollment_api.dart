import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_api.dart';

extension CarePointRequiredMfaEnrollmentApi on CarePointApi {
  Future<Map<String, String>> beginRequiredMfaEnrollment(String challengeId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/iam/mfa/enrollment/start'),
      headers: const {'accept': 'application/json', 'content-type': 'application/json'},
      body: jsonEncode({'challengeId': challengeId}),
    );
    dynamic payload;
    if (response.body.isNotEmpty) {
      try { payload = jsonDecode(response.body); } catch (_) { payload = response.body; }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null ? payload['message'].toString() : 'MFA enrollment could not be started.';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    if (payload is! Map) throw const CarePointApiException('Unexpected MFA enrollment response.');
    final secret = payload['secret']?.toString() ?? '';
    final uri = payload['otpauthUri']?.toString() ?? '';
    if (secret.length < 16 || !uri.startsWith('otpauth://')) throw const CarePointApiException('Unexpected MFA enrollment response.');
    return {'secret': secret, 'otpauthUri': uri};
  }
}
