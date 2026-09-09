import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_api.dart';

/// Release 1 scheduling/discovery client for FR-SRC-001, FR-SCH-001,
/// FR-CLN-001 and FR-HOM-001. Native UI adoption remains an R5/R7 gate.
class Release1SchedulingApi {
  Release1SchedulingApi(this.api, {http.Client? client}) : _client = client ?? http.Client();

  final CarePointApi api;
  final http.Client _client;

  Future<Map<String, dynamic>> discovery({
    String? query,
    String? specialty,
    String? providerClass,
    String? providerCategory,
    String? service,
    String? modality,
    String? location,
    int page = 1,
    int limit = 20,
  }) async {
    return _map(await _send('GET', '/services/discovery', authenticated: false, query: {
      if (query?.trim().isNotEmpty == true) 'q': query!.trim(),
      if (specialty?.trim().isNotEmpty == true) 'specialty': specialty!.trim(),
      if (providerClass?.trim().isNotEmpty == true) 'providerClass': providerClass!.trim(),
      if (providerCategory?.trim().isNotEmpty == true) 'providerCategory': providerCategory!.trim(),
      if (service?.trim().isNotEmpty == true) 'service': service!.trim(),
      if (modality?.trim().isNotEmpty == true) 'modality': modality!.trim(),
      if (location?.trim().isNotEmpty == true) 'location': location!.trim(),
      'page': '$page',
      'limit': '$limit',
    }));
  }

  Future<Map<String, dynamic>> createProviderLocation({
    required String label,
    required String addressLine1,
    required String city,
    required String countryCode,
    required double latitude,
    required double longitude,
    String? addressLine2,
    String? region,
    String? postalCode,
    String? arrivalInstructions,
    required bool addressValidated,
  }) async {
    return _map(await _send('POST', '/provider/locations', body: {
      'label': label,
      'addressLine1': addressLine1,
      if (addressLine2?.trim().isNotEmpty == true) 'addressLine2': addressLine2!.trim(),
      'city': city,
      if (region?.trim().isNotEmpty == true) 'region': region!.trim(),
      if (postalCode?.trim().isNotEmpty == true) 'postalCode': postalCode!.trim(),
      'countryCode': countryCode,
      'latitude': latitude,
      'longitude': longitude,
      if (arrivalInstructions?.trim().isNotEmpty == true) 'arrivalInstructions': arrivalInstructions!.trim(),
      'addressValidated': addressValidated,
    }));
  }

  Future<Map<String, dynamic>> configureClinicContext({required String serviceId, required String locationId, String? arrivalInstructions}) async {
    return _map(await _send('PATCH', '/provider/services/$serviceId/delivery-context/CLINIC', body: {
      'clinicLocationId': locationId,
      if (arrivalInstructions?.trim().isNotEmpty == true) 'clinicArrivalInstructions': arrivalInstructions!.trim(),
    }));
  }

  Future<Map<String, dynamic>> configureHomeVisitCoverage({required String serviceId, required double centerLatitude, required double centerLongitude, required double radiusKm}) async {
    return _map(await _send('PATCH', '/provider/services/$serviceId/delivery-context/HOME_VISIT', body: {
      'homeVisitCoverage': {
        'centerLatitude': centerLatitude,
        'centerLongitude': centerLongitude,
        'radiusKm': radiusKm,
      },
    }));
  }

  Future<Map<String, dynamic>> createAvailabilityException({
    String? serviceId,
    String? modality,
    required String kind,
    required DateTime startsAt,
    required DateTime endsAt,
    String? reason,
  }) async {
    return _map(await _send('POST', '/provider/availability/exceptions', body: {
      if (serviceId?.trim().isNotEmpty == true) 'serviceId': serviceId!.trim(),
      if (modality?.trim().isNotEmpty == true) 'modality': modality!.trim(),
      'kind': kind,
      'startsAt': startsAt.toUtc().toIso8601String(),
      'endsAt': endsAt.toUtc().toIso8601String(),
      if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
    }));
  }

  Future<Map<String, dynamic>> book({required String slotId, required String idempotencyKey, Map<String, dynamic>? homeVisit}) async {
    return _map(await _send('POST', '/bookings', body: {
      'slotId': slotId,
      'idempotencyKey': idempotencyKey,
      if (homeVisit != null) 'homeVisit': homeVisit,
    }));
  }

  Future<dynamic> _send(String method, String path, {Map<String, String>? query, Map<String, dynamic>? body, bool authenticated = true}) async {
    final uri = Uri.parse('${api.baseUrl}$path').replace(queryParameters: query?.isEmpty == true ? null : query);
    final headers = <String, String>{'accept': 'application/json', if (body != null) 'content-type': 'application/json'};
    if (authenticated) {
      final token = api.accessToken;
      if (token == null || token.isEmpty) throw const CarePointApiException('Authenticated Release 1 scheduling operation requires an active session.');
      headers['authorization'] = 'Bearer $token';
    }
    final encoded = body == null ? null : jsonEncode(body);
    final response = switch (method) {
      'GET' => await _client.get(uri, headers: headers),
      'POST' => await _client.post(uri, headers: headers, body: encoded),
      'PATCH' => await _client.patch(uri, headers: headers, body: encoded),
      _ => throw CarePointApiException('Unsupported Release 1 scheduling HTTP method: $method'),
    };
    dynamic payload;
    if (response.body.isNotEmpty) {
      try {
        payload = jsonDecode(response.body);
      } catch (_) {
        payload = response.body;
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null ? payload['message'].toString() : 'Request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    return payload;
  }

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
    throw const CarePointApiException('Unexpected Release 1 scheduling response shape.');
  }
}
