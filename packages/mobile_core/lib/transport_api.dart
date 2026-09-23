part of 'carepoint_api.dart';

extension CarePointTransportApi on CarePointApi {
  Future<Map<String, dynamic>> requestEmergencyAmbulance({
    required String clientRequestId,
    required double latitude,
    required double longitude,
    String? pickupAddress,
    String? callbackPhone,
  }) async =>
      _asMap(await _send('POST', '/emergency/ambulance', body: {
        'clientRequestId': clientRequestId,
        'latitude': latitude,
        'longitude': longitude,
        if (pickupAddress?.trim().isNotEmpty == true) 'pickupAddress': pickupAddress!.trim(),
        if (callbackPhone?.trim().isNotEmpty == true) 'callbackPhone': callbackPhone!.trim(),
      }));

  Future<List<Map<String, dynamic>>> emergencyAmbulanceRequests() async =>
      _asList(await _send('GET', '/emergency/ambulance'));

  Future<Map<String, dynamic>> emergencyAmbulanceRequest(String requestId) async =>
      _asMap(await _send('GET', '/emergency/ambulance/$requestId'));

  Future<Map<String, dynamic>> cancelEmergencyAmbulance(String requestId, {String? reason}) async =>
      _asMap(await _send('POST', '/emergency/ambulance/$requestId/cancel', body: {
        if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
      }));

  Future<List<Map<String, dynamic>>> providerEmergencyAmbulanceJobs() async =>
      _asList(await _send('GET', '/provider/emergency/ambulance'));

  Future<Map<String, dynamic>> updateProviderEmergencyAmbulanceStatus(
    String requestId, {
    required String status,
    int? etaMinutes,
  }) async =>
      _asMap(await _send('POST', '/provider/emergency/ambulance/$requestId/status', body: {
        'status': status,
        if (etaMinutes != null) 'etaMinutes': etaMinutes,
      }));

  Future<Map<String, dynamic>> createMedicalTransport({
    required String clientRequestId,
    required String mode,
    required DateTime scheduledFor,
    required double pickupLatitude,
    required double pickupLongitude,
    String? pickupAddress,
    required double destinationLatitude,
    required double destinationLongitude,
    String? destinationAddress,
    String assistance = 'STANDARD',
    int companionCount = 0,
    List<String> equipment = const [],
    String? callbackPhone,
  }) async =>
      _asMap(await _send('POST', '/medical-transport', body: {
        'clientRequestId': clientRequestId,
        'mode': mode,
        'scheduledFor': scheduledFor.toUtc().toIso8601String(),
        'pickupLatitude': pickupLatitude,
        'pickupLongitude': pickupLongitude,
        if (pickupAddress?.trim().isNotEmpty == true) 'pickupAddress': pickupAddress!.trim(),
        'destinationLatitude': destinationLatitude,
        'destinationLongitude': destinationLongitude,
        if (destinationAddress?.trim().isNotEmpty == true) 'destinationAddress': destinationAddress!.trim(),
        'assistance': assistance,
        'companionCount': companionCount,
        'equipment': equipment,
        if (callbackPhone?.trim().isNotEmpty == true) 'callbackPhone': callbackPhone!.trim(),
      }));

  Future<List<Map<String, dynamic>>> medicalTransportRequests() async =>
      _asList(await _send('GET', '/medical-transport'));

  Future<Map<String, dynamic>> medicalTransportRequest(String requestId) async =>
      _asMap(await _send('GET', '/medical-transport/$requestId'));

  Future<Map<String, dynamic>> cancelMedicalTransport(String requestId, {String? reason}) async =>
      _asMap(await _send('POST', '/medical-transport/$requestId/cancel', body: {
        if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
      }));

  Future<Map<String, dynamic>> providerWorkQueue() async =>
      _asMap(await _send('GET', '/provider/jobs/work-queue'));

  Future<List<Map<String, dynamic>>> providerAvailableMedicalTransport() async =>
      _asList(await _send('GET', '/provider/medical-transport/available'));

  Future<List<Map<String, dynamic>>> providerMedicalTransportJobs() async =>
      _asList(await _send('GET', '/provider/medical-transport'));

  Future<Map<String, dynamic>> providerMedicalTransportResources(String requestId) async =>
      _asMap(await _send('GET', '/provider/medical-transport/$requestId/resources'));

  Future<Map<String, dynamic>> updateProviderMedicalTransportResources(
    String requestId, {
    required String transportUnitId,
    required List<String> crewProviderIds,
    required String idempotencyKey,
  }) async =>
      _asMap(await _send('PATCH', '/provider/medical-transport/$requestId/resources', body: {
        'transportUnitId': transportUnitId,
        'crewProviderIds': crewProviderIds,
        'idempotencyKey': idempotencyKey,
      }));

  Future<Map<String, dynamic>> providerTransportHandoff(String requestId) async =>
      _asMap(await _send('GET', '/provider/transport/jobs/$requestId/handoff'));

  Future<Map<String, dynamic>> recordProviderTransportHandoff(
    String requestId, {
    required String idempotencyKey,
    required String receiverName,
    required String receiverRole,
    String? receiverOrganization,
    required String handoffSummary,
    required DateTime handedOffAt,
    String? signatureMethod,
    String? drawnSignatureData,
  }) async =>
      _asMap(await _send('POST', '/provider/transport/jobs/$requestId/handoff', body: {
        'idempotencyKey': idempotencyKey,
        'receiverName': receiverName.trim(),
        'receiverRole': receiverRole.trim(),
        if (receiverOrganization?.trim().isNotEmpty == true) 'receiverOrganization': receiverOrganization!.trim(),
        'handoffSummary': handoffSummary.trim(),
        'handedOffAt': handedOffAt.toUtc().toIso8601String(),
        'receiverAcceptedHandoff': true,
        if (signatureMethod?.trim().isNotEmpty == true) 'signatureMethod': signatureMethod!.trim(),
        if (drawnSignatureData?.trim().isNotEmpty == true) 'drawnSignatureData': drawnSignatureData!.trim(),
      }));

  Future<List<Map<String, dynamic>>> providerTransportIncidents(String requestId) async {
    final payload = _asMap(await _send('GET', '/provider/transport/jobs/$requestId/incidents'));
    return _asList(payload['items']);
  }

  Future<Map<String, dynamic>> recordProviderTransportIncident(
    String requestId, {
    required String idempotencyKey,
    required String category,
    required String severity,
    required String reasonCode,
    String? detail,
    required DateTime occurredAt,
  }) async =>
      _asMap(await _send('POST', '/provider/transport/jobs/$requestId/incidents', body: {
        'idempotencyKey': idempotencyKey,
        'category': category,
        'severity': severity,
        'reasonCode': reasonCode.trim().toUpperCase(),
        if (detail?.trim().isNotEmpty == true) 'detail': detail!.trim(),
        'occurredAt': occurredAt.toUtc().toIso8601String(),
      }));

  Future<Map<String, dynamic>> acceptMedicalTransport(String requestId) async =>
      _asMap(await _send('POST', '/provider/medical-transport/$requestId/accept', body: const {}));

  Future<Map<String, dynamic>> updateProviderMedicalTransportStatus(
    String requestId, {
    required String status,
    int? etaMinutes,
  }) async =>
      _asMap(await _send('POST', '/provider/medical-transport/$requestId/status', body: {
        'status': status,
        if (etaMinutes != null) 'etaMinutes': etaMinutes,
      }));
}
