import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_api.dart';

class ProviderNursingApi {
  ProviderNursingApi(this.session, {http.Client? client}) : _client = client ?? http.Client();

  final CarePointSession session;
  final http.Client _client;

  Future<Map<String, dynamic>> eligiblePrescriptions(String appointmentId) =>
      _request('GET', '/provider/medication-administrations/appointments/${Uri.encodeComponent(appointmentId)}/eligible-prescriptions');

  Future<Map<String, dynamic>> recordMedicationAdministration({
    required String appointmentId,
    required String prescriptionOrderId,
    required String status,
    required DateTime administeredAt,
    required String idempotencyKey,
    String? dose,
    String? route,
    String? omissionReason,
    String? note,
  }) =>
      _request('POST', '/provider/medication-administrations', body: {
        'appointmentId': appointmentId,
        'prescriptionOrderId': prescriptionOrderId,
        'status': status,
        'administeredAt': administeredAt.toUtc().toIso8601String(),
        'idempotencyKey': idempotencyKey,
        if (dose?.trim().isNotEmpty == true) 'dose': dose!.trim(),
        if (route?.trim().isNotEmpty == true) 'route': route!.trim(),
        if (omissionReason?.trim().isNotEmpty == true) 'omissionReason': omissionReason!.trim(),
        if (note?.trim().isNotEmpty == true) 'note': note!.trim(),
      });

  Future<Map<String, dynamic>> medicationHistory(String patientId) =>
      _request('GET', '/provider/medication-administrations/patients/${Uri.encodeComponent(patientId)}');

  Future<Map<String, dynamic>> recordWoundAssessment({
    required String appointmentId,
    required String siteCode,
    required String woundType,
    required double lengthCm,
    required double widthCm,
    double? depthCm,
    required String exudate,
    required DateTime assessedAt,
    required String idempotencyKey,
    String? clinicalMediaId,
    String? notes,
  }) =>
      _request('POST', '/provider/wound-assessments', body: {
        'appointmentId': appointmentId,
        'siteCode': siteCode,
        'woundType': woundType,
        'dimensionsCm': {
          'length': lengthCm,
          'width': widthCm,
          if (depthCm != null) 'depth': depthCm,
        },
        'exudate': exudate,
        'assessedAt': assessedAt.toUtc().toIso8601String(),
        'idempotencyKey': idempotencyKey,
        if (clinicalMediaId?.trim().isNotEmpty == true) 'clinicalMediaId': clinicalMediaId!.trim(),
        if (notes?.trim().isNotEmpty == true) 'notes': notes!.trim(),
      });

  Future<Map<String, dynamic>> woundHistory(String patientId) =>
      _request('GET', '/provider/wound-assessments/patients/${Uri.encodeComponent(patientId)}');

  Future<Map<String, dynamic>> procedureChecklists() =>
      _request('GET', '/provider/procedure-checklists');

  Future<Map<String, dynamic>> completeProcedureChecklist({
    required String code,
    required String appointmentId,
    required int expectedLatestSequence,
    required Map<String, dynamic> answers,
    required String idempotencyKey,
  }) =>
      _request('POST', '/provider/procedure-checklists', body: {
        'code': code,
        'appointmentId': appointmentId,
        'expectedLatestSequence': expectedLatestSequence,
        'answers': answers,
        'idempotencyKey': idempotencyKey,
      });

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
      'GET' => await _client.get(uri, headers: headers),
      'POST' => await _client.post(uri, headers: headers, body: encoded),
      _ => throw const CarePointApiException('Unsupported provider nursing request method.'),
    };

    if (response.statusCode == 401 && retryAuth) {
      final restored = await session.api.restoreSession();
      if (restored != null) return _request(method, path, body: body, retryAuth: false);
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
          : 'Provider nursing request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    if (payload is Map<String, dynamic>) return payload;
    if (payload is Map) return payload.map((key, value) => MapEntry(key.toString(), value));
    throw const CarePointApiException('Unexpected provider nursing response shape.');
  }
}
