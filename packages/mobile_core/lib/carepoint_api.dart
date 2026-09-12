import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_token_store.dart';

part 'financial_api.dart';
part 'transport_api.dart';
part 'patient_self_service_api.dart';
part 'clinical_documents_api.dart';

class CarePointApiException implements Exception {
  const CarePointApiException(this.message, {this.statusCode, this.payload});
  final String message;
  final int? statusCode;
  final dynamic payload;
  @override
  String toString() => message;
}

class CarePointMfaRequired implements Exception {
  const CarePointMfaRequired(this.challengeId, this.expiresAt);
  final String challengeId;
  final String expiresAt;
}

class CarePointSession {
  const CarePointSession({required this.account, required this.api});
  final Map<String, dynamic> account;
  final CarePointApi api;
  String get role => account['role']?.toString() ?? '';
}

class CarePointApi {
  CarePointApi({String? baseUrl, http.Client? client, CarePointTokenStore? tokenStore})
      : baseUrl = (baseUrl ?? const String.fromEnvironment('CAREPOINT_API_BASE', defaultValue: 'http://10.0.2.2:4000/api/v1')).replaceAll(RegExp(r'/+$'), ''),
        _client = client ?? http.Client(),
        _tokenStore = tokenStore ?? SecureCarePointTokenStore();

  final String baseUrl;
  final http.Client _client;
  final CarePointTokenStore _tokenStore;
  String? accessToken;
  String? refreshToken;

  bool get isAuthenticated => accessToken != null;

  Future<CarePointSession?> restoreSession() async {
    accessToken = await _tokenStore.readAccessToken();
    refreshToken = await _tokenStore.readRefreshToken();
    if (refreshToken == null || refreshToken!.isEmpty) {
      await logout();
      return null;
    }
    try {
      return CarePointSession(account: await me(), api: this);
    } catch (_) {
      await logout();
      return null;
    }
  }

  Future<CarePointSession> login(String email, String password) async {
    final result = await _send('POST', '/iam/login', body: {'email': email.trim(), 'password': password}, authenticated: false, retryAuth: false);
    final map = _asMap(result);
    if (map['requiresMfa'] == true) throw CarePointMfaRequired(map['challengeId'].toString(), map['expiresAt'].toString());
    await _captureTokens(map);
    return CarePointSession(account: await me(), api: this);
  }

  Future<CarePointSession> completeMfa(String challengeId, String code) async {
    final result = await _send('POST', '/iam/mfa/verify', body: {'challengeId': challengeId, 'code': code.trim()}, authenticated: false, retryAuth: false);
    await _captureTokens(_asMap(result));
    return CarePointSession(account: await me(), api: this);
  }

  Future<Map<String, dynamic>> me() async => _asMap(await _send('GET', '/iam/accounts/me'));

  Future<List<Map<String, dynamic>>> searchServices({String query = '', String? modality}) async {
    final result = await _send('GET', '/services/search', query: {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      if (modality != null && modality.isNotEmpty) 'modality': modality,
    }, authenticated: false);
    return _asList(result);
  }

  Future<List<Map<String, dynamic>>> availability({required String serviceId, required String modality, DateTime? from, DateTime? to}) async {
    final result = await _send('GET', '/availability', query: {
      'serviceId': serviceId,
      'modality': modality,
      if (from != null) 'from': from.toUtc().toIso8601String(),
      if (to != null) 'to': to.toUtc().toIso8601String(),
    }, authenticated: false);
    return _asList(result);
  }

  Future<Map<String, dynamic>> book({required String slotId, required String idempotencyKey}) async => _asMap(await _send('POST', '/bookings', body: {'slotId': slotId, 'idempotencyKey': idempotencyKey}));
  Future<List<Map<String, dynamic>>> myAppointments() async => _asList(await _send('GET', '/bookings/me'));
  Future<Map<String, dynamic>> cancelAppointment(String appointmentId, {String? reason}) async => _asMap(await _send('POST', '/bookings/$appointmentId/cancel', body: {if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim()}));

  Future<List<Map<String, dynamic>>> providerServices() async => _asList(await _send('GET', '/provider/services'));
  Future<Map<String, dynamic>> createProviderService({required String name, required String modality, required int durationMinutes, required int priceMinor, String currency = 'USD'}) async {
    final labels = {'en': name, 'ar': name, 'fr': name, 'es': name};
    return _asMap(await _send('POST', '/provider/services', body: {'labels': labels, 'currency': currency, 'modalities': [{'modality': modality, 'durationMinutes': durationMinutes, 'priceMinor': priceMinor}]}));
  }
  Future<List<Map<String, dynamic>>> providerAppointments({DateTime? from, DateTime? to}) async => _asList(await _send('GET', '/provider/appointments', query: {if (from != null) 'from': from.toUtc().toIso8601String(), if (to != null) 'to': to.toUtc().toIso8601String()}));
  Future<List<Map<String, dynamic>>> availabilityRules() async => _asList(await _send('GET', '/provider/availability/rules'));
  Future<Map<String, dynamic>> createAvailabilityRule({required String serviceId, required String modality, required String timezone, required int weekday, required int startMinute, required int endMinute, required int intervalMinutes, int slotCapacity = 1, required String effectiveFrom, String? effectiveUntil}) async => _asMap(await _send('POST', '/provider/availability/rules', body: {'serviceId': serviceId, 'modality': modality, 'timezone': timezone, 'weekday': weekday, 'startMinute': startMinute, 'endMinute': endMinute, 'intervalMinutes': intervalMinutes, 'slotCapacity': slotCapacity, 'effectiveFrom': effectiveFrom, if (effectiveUntil != null) 'effectiveUntil': effectiveUntil}));
  Future<Map<String, dynamic>> generateAvailability({required String fromDate, required String toDate, String? ruleId}) async => _asMap(await _send('POST', '/provider/availability/generate', body: {'fromDate': fromDate, 'toDate': toDate, if (ruleId != null) 'ruleId': ruleId}));

  Future<Map<String, dynamic>> telehealthStatus(String appointmentId) async => _asMap(await _send('GET', '/telehealth/appointments/$appointmentId'));
  Future<Map<String, dynamic>> confirmTelehealthConsent(String appointmentId, {String version = 'telemedicine-v1'}) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/consent', body: {'version': version}));
  Future<Map<String, dynamic>> updateTelehealthReadiness(String appointmentId, {required bool camera, required bool microphone, required bool network}) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/readiness', body: {'camera': camera, 'microphone': microphone, 'network': network}));
  Future<Map<String, dynamic>> telehealthJoin(String appointmentId) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/join', body: const {}));
  Future<Map<String, dynamic>> endTelehealth(String appointmentId) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/end', body: const {}));

  Future<Map<String, dynamic>> patientClinicalTimeline() async => _asMap(await _send('GET', '/clinical/timeline'));
  Future<Map<String, dynamic>> providerClinicalTimeline(String patientId) async => _asMap(await _send('GET', '/clinical/patients/$patientId/timeline'));
  Future<Map<String, dynamic>> clinicalEncounter(String appointmentId) async => _asMap(await _send('GET', '/clinical/appointments/$appointmentId'));
  Future<Map<String, dynamic>> writeClinicalRecord(String appointmentId, Map<String, dynamic> record) async => _asMap(await _send('POST', '/clinical/appointments/$appointmentId/records', body: record));
  Future<Map<String, dynamic>> finalizeClinicalEncounter(String appointmentId) async => _asMap(await _send('POST', '/clinical/appointments/$appointmentId/finalize', body: const {}));

  Future<Map<String, dynamic>> patientClinicalOrders() async => _asMap(await _send('GET', '/clinical-orders/me'));
  Future<Map<String, dynamic>> providerClinicalOrders(String patientId) async => _asMap(await _send('GET', '/clinical-orders/patients/$patientId'));
  Future<Map<String, dynamic>> clinicalOrder(String orderId) async => _asMap(await _send('GET', '/clinical-orders/$orderId'));
  Future<Map<String, dynamic>> createPrescription(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-orders/appointments/$appointmentId/prescriptions', body: body));
  Future<Map<String, dynamic>> createLaboratoryOrder(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-orders/appointments/$appointmentId/laboratory', body: body));
  Future<Map<String, dynamic>> cancelClinicalOrder(String orderId) async => _asMap(await _send('POST', '/clinical-orders/$orderId/cancel', body: const {}));
  Future<Map<String, dynamic>> enterLaboratoryResult(String orderId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-orders/$orderId/lab-result', body: body));
  Future<Map<String, dynamic>> validateLaboratoryResult(String orderId) async => _asMap(await _send('POST', '/clinical-orders/$orderId/lab-result/validate', body: const {}));
  Future<Map<String, dynamic>> releaseLaboratoryResult(String orderId) async => _asMap(await _send('POST', '/clinical-orders/$orderId/lab-result/release', body: const {}));

  Future<Map<String, dynamic>> patientClinicalDocuments() async => _asMap(await _send('GET', '/clinical-documents/me'));
  Future<Map<String, dynamic>> providerClinicalDocuments(String patientId) async => _asMap(await _send('GET', '/clinical-documents/patients/$patientId'));
  Future<Map<String, dynamic>> clinicalDocumentContent(String documentId) async => _asMap(await _send('GET', '/clinical-documents/$documentId/content'));
  Future<Map<String, dynamic>> uploadEncounterDocument(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-documents/appointments/$appointmentId/upload', body: body));
  Future<Map<String, dynamic>> createEncounterDocumentReference(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-documents/appointments/$appointmentId/reference', body: body));
  Future<Map<String, dynamic>> uploadPatientDocument(Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-documents/me/upload', body: body));
  Future<Map<String, dynamic>> releaseClinicalDocument(String documentId) async => _asMap(await _send('POST', '/clinical-documents/$documentId/release', body: const {}));
  Future<Map<String, dynamic>> removeClinicalDocument(String documentId) async => _asMap(await _send('POST', '/clinical-documents/$documentId/remove', body: const {}));

  Future<Map<String, dynamic>> patientDiagnosticReports() async => _asMap(await _send('GET', '/diagnostic-reports/me'));
  Future<Map<String, dynamic>> providerDiagnosticReports(String patientId) async => _asMap(await _send('GET', '/diagnostic-reports/patients/$patientId'));
  Future<Map<String, dynamic>> diagnosticReport(String reportId) async => _asMap(await _send('GET', '/diagnostic-reports/$reportId'));
  Future<Map<String, dynamic>> createDiagnosticReport(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/diagnostic-reports/appointments/$appointmentId', body: body));
  Future<Map<String, dynamic>> finalizeDiagnosticReport(String reportId) async => _asMap(await _send('POST', '/diagnostic-reports/$reportId/finalize', body: const {}));
  Future<Map<String, dynamic>> releaseDiagnosticReport(String reportId) async => _asMap(await _send('POST', '/diagnostic-reports/$reportId/release', body: const {}));

  Future<void> logout() async {
    accessToken = null;
    refreshToken = null;
    await _tokenStore.clear();
  }

  Future<dynamic> _send(String method, String path, {Map<String, String>? query, Map<String, dynamic>? body, bool authenticated = true, bool retryAuth = true}) async {
    final response = await _raw(method, path, query: query, body: body, authenticated: authenticated);
    if (response.statusCode == 401 && authenticated && retryAuth && refreshToken != null) {
      final refreshed = await _refresh();
      if (refreshed) return _send(method, path, query: query, body: body, authenticated: authenticated, retryAuth: false);
    }
    return _decode(response);
  }

  Future<http.Response> _raw(String method, String path, {Map<String, String>? query, Map<String, dynamic>? body, bool authenticated = true}) {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query?.isEmpty == true ? null : query);
    final headers = <String, String>{'accept': 'application/json', if (body != null) 'content-type': 'application/json'};
    if (authenticated && accessToken != null) headers['authorization'] = 'Bearer $accessToken';
    final encoded = body == null ? null : jsonEncode(body);
    return switch (method) {
      'GET' => _client.get(uri, headers: headers),
      'POST' => _client.post(uri, headers: headers, body: encoded),
      'PATCH' => _client.patch(uri, headers: headers, body: encoded),
      'DELETE' => _client.delete(uri, headers: headers, body: encoded),
      _ => throw CarePointApiException('Unsupported HTTP method: $method'),
    };
  }

  dynamic _decode(http.Response response) {
    dynamic payload;
    if (response.body.isNotEmpty) {
      try { payload = jsonDecode(response.body); } catch (_) { payload = response.body; }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null ? payload['message'].toString() : 'Request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    return payload;
  }

  Future<bool> _refresh() async {
    final token = refreshToken;
    if (token == null) return false;
    try {
      final result = _decode(await _raw('POST', '/iam/sessions/refresh', body: {'refreshToken': token}, authenticated: false));
      await _captureTokens(_asMap(result));
      return true;
    } catch (_) {
      accessToken = null;
      refreshToken = null;
      await _tokenStore.clear();
      return false;
    }
  }

  Future<void> _captureTokens(Map<String, dynamic> value) async {
    final access = value['accessToken']?.toString();
    final refresh = value['refreshToken']?.toString();
    if (access == null || access.isEmpty || refresh == null || refresh.isEmpty) throw const CarePointApiException('Authentication response did not contain session tokens.');
    await _tokenStore.writeTokens(accessToken: access, refreshToken: refresh);
    accessToken = access;
    refreshToken = refresh;
  }

  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
    throw const CarePointApiException('Unexpected API response shape.');
  }

  List<Map<String, dynamic>> _asList(dynamic value) {
    if (value is! List) throw const CarePointApiException('Unexpected API response shape.');
    return value.map((item) => _asMap(item)).toList(growable: false);
  }
}
