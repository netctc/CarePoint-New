import 'dart:convert';

import 'package:http/http.dart' as http;

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
  CarePointApi({String? baseUrl, http.Client? client})
      : baseUrl = (baseUrl ?? const String.fromEnvironment('CAREPOINT_API_BASE', defaultValue: 'http://10.0.2.2:4000/api/v1')).replaceAll(RegExp(r'/+$'), ''),
        _client = client ?? http.Client();

  final String baseUrl;
  final http.Client _client;
  String? accessToken;
  String? refreshToken;

  bool get isAuthenticated => accessToken != null;

  Future<CarePointSession> login(String email, String password) async {
    final result = await _send('POST', '/iam/login', body: {'email': email.trim(), 'password': password}, authenticated: false, retryAuth: false);
    final map = _asMap(result);
    if (map['requiresMfa'] == true) throw CarePointMfaRequired(map['challengeId'].toString(), map['expiresAt'].toString());
    _captureTokens(map);
    return CarePointSession(account: await me(), api: this);
  }

  Future<CarePointSession> completeMfa(String challengeId, String code) async {
    final result = await _send('POST', '/iam/mfa/verify', body: {'challengeId': challengeId, 'code': code.trim()}, authenticated: false, retryAuth: false);
    _captureTokens(_asMap(result));
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

  Future<Map<String, dynamic>> book({required String slotId, required String idempotencyKey}) async =>
      _asMap(await _send('POST', '/bookings', body: {'slotId': slotId, 'idempotencyKey': idempotencyKey}));

  Future<List<Map<String, dynamic>>> myAppointments() async => _asList(await _send('GET', '/bookings/me'));

  Future<Map<String, dynamic>> cancelAppointment(String appointmentId, {String? reason}) async =>
      _asMap(await _send('POST', '/bookings/$appointmentId/cancel', body: {if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim()}));

  Future<List<Map<String, dynamic>>> providerServices() async => _asList(await _send('GET', '/provider/services'));

  Future<Map<String, dynamic>> createProviderService({required String name, required String modality, required int durationMinutes, required int priceMinor, String currency = 'USD'}) async {
    final labels = {'en': name, 'ar': name, 'fr': name, 'es': name};
    return _asMap(await _send('POST', '/provider/services', body: {
      'labels': labels,
      'currency': currency,
      'modalities': [
        {'modality': modality, 'durationMinutes': durationMinutes, 'priceMinor': priceMinor}
      ],
    }));
  }

  Future<List<Map<String, dynamic>>> providerAppointments({DateTime? from, DateTime? to}) async => _asList(await _send('GET', '/provider/appointments', query: {
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      }));

  Future<List<Map<String, dynamic>>> availabilityRules() async => _asList(await _send('GET', '/provider/availability/rules'));

  Future<Map<String, dynamic>> createAvailabilityRule({
    required String serviceId,
    required String modality,
    required String timezone,
    required int weekday,
    required int startMinute,
    required int endMinute,
    required int intervalMinutes,
    int slotCapacity = 1,
    required String effectiveFrom,
    String? effectiveUntil,
  }) async =>
      _asMap(await _send('POST', '/provider/availability/rules', body: {
        'serviceId': serviceId,
        'modality': modality,
        'timezone': timezone,
        'weekday': weekday,
        'startMinute': startMinute,
        'endMinute': endMinute,
        'intervalMinutes': intervalMinutes,
        'slotCapacity': slotCapacity,
        'effectiveFrom': effectiveFrom,
        if (effectiveUntil != null && effectiveUntil.isNotEmpty) 'effectiveUntil': effectiveUntil,
      }));

  Future<Map<String, dynamic>> generateAvailability({required String fromDate, required String toDate, String? ruleId}) async =>
      _asMap(await _send('POST', '/provider/availability/generate', body: {
        'fromDate': fromDate,
        'toDate': toDate,
        if (ruleId != null) 'ruleId': ruleId,
      }));

  Future<Map<String, dynamic>> telehealthStatus(String appointmentId) async =>
      _asMap(await _send('GET', '/telehealth/appointments/$appointmentId'));

  Future<Map<String, dynamic>> confirmTelehealthConsent(String appointmentId, {String version = 'telemedicine-v1'}) async =>
      _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/consent', body: {'version': version}));

  Future<Map<String, dynamic>> updateTelehealthReadiness(String appointmentId, {required bool camera, required bool microphone, required bool network}) async =>
      _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/readiness', body: {'camera': camera, 'microphone': microphone, 'network': network}));

  Future<Map<String, dynamic>> telehealthJoin(String appointmentId) async =>
      _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/join', body: const {}));

  Future<Map<String, dynamic>> endTelehealth(String appointmentId) async =>
      _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/end', body: const {}));

  Future<void> logout() async {
    accessToken = null;
    refreshToken = null;
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
      _captureTokens(_asMap(result));
      return true;
    } catch (_) {
      accessToken = null;
      refreshToken = null;
      return false;
    }
  }

  void _captureTokens(Map<String, dynamic> value) {
    final access = value['accessToken']?.toString();
    final refresh = value['refreshToken']?.toString();
    if (access == null || access.isEmpty || refresh == null || refresh.isEmpty) throw const CarePointApiException('Authentication response did not contain session tokens.');
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
