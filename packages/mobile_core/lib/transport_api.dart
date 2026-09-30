part of 'carepoint_api.dart';

extension CarePointTransportApi on CarePointApi {
  Future<Map<String, dynamic>> transportLocationConfig() async =>
      _asMap(await _send('GET', '/transport/location/config'));

  Future<Map<String, dynamic>> reverseGeocodeTransportLocation({
    required double latitude,
    required double longitude,
    String? languageCode,
  }) async =>
      _asMap(await _send('POST', '/transport/location/reverse-geocode', body: {
        'latitude': latitude,
        'longitude': longitude,
        if (languageCode?.trim().isNotEmpty == true) 'languageCode': languageCode!.trim(),
      }));

  Future<Map<String, dynamic>> searchTransportLocations({
    required String query,
    String? languageCode,
    double? biasLatitude,
    double? biasLongitude,
  }) async =>
      _asMap(await _send('POST', '/transport/location/search', body: {
        'query': query.trim(),
        if (languageCode?.trim().isNotEmpty == true) 'languageCode': languageCode!.trim(),
        if (biasLatitude != null) 'biasLatitude': biasLatitude,
        if (biasLongitude != null) 'biasLongitude': biasLongitude,
      }));

  Future<Map<String, dynamic>> transportLocationCapabilities() async =>
      _asMap(await _send('GET', '/transport/location/capabilities'));

  Future<List<Map<String, dynamic>>> savedTransportLocations() async =>
      _asList(await _send('GET', '/transport/location/saved'));

  Future<Map<String, dynamic>> createSavedTransportLocation({
    required String label,
    required String kind,
    String? address,
    double? latitude,
    double? longitude,
    String? placeId,
    String? source,
  }) async =>
      _asMap(await _send('POST', '/transport/location/saved', body: {
        'label': label.trim(),
        'kind': kind.trim().toUpperCase(),
        if (address?.trim().isNotEmpty == true) 'address': address!.trim(),
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (placeId?.trim().isNotEmpty == true) 'placeId': placeId!.trim(),
        if (source?.trim().isNotEmpty == true) 'source': source!.trim(),
      }));

  Future<Map<String, dynamic>> updateSavedTransportLocation(
    String locationId, {
    required String label,
    required String kind,
    String? address,
    double? latitude,
    double? longitude,
    String? placeId,
    String? source,
  }) async =>
      _asMap(await _send('PATCH', '/transport/location/saved/$locationId', body: {
        'label': label.trim(),
        'kind': kind.trim().toUpperCase(),
        if (address?.trim().isNotEmpty == true) 'address': address!.trim(),
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (placeId?.trim().isNotEmpty == true) 'placeId': placeId!.trim(),
        if (source?.trim().isNotEmpty == true) 'source': source!.trim(),
      }));

  Future<Map<String, dynamic>> deleteSavedTransportLocation(String locationId) async =>
      _asMap(await _send('DELETE', '/transport/location/saved/$locationId'));

  Future<List<Map<String, dynamic>>> transportHealthcareCenters({String? query}) async {
    final suffix = query?.trim().isNotEmpty == true
        ? '?q=${Uri.encodeQueryComponent(query!.trim())}'
        : '';
    final payload = _asMap(await _send('GET', '/transport/location/healthcare-centers$suffix'));
    return _asList(payload['items']);
  }

  Future<Map<String, dynamic>> previewTransportRoute({
    required String mode,
    required Map<String, dynamic> pickup,
    required Map<String, dynamic> destination,
    String? languageCode,
  }) async =>
      _asMap(await _send('POST', '/transport/location/route-preview', body: {
        'mode': mode.trim().toUpperCase(),
        'pickup': pickup,
        'destination': destination,
        if (languageCode?.trim().isNotEmpty == true) 'languageCode': languageCode!.trim(),
      }));

  Future<Map<String, dynamic>> requestEmergencyAmbulance({
    required String clientRequestId,
    double? latitude,
    double? longitude,
    String? pickupAddress,
    String? callbackPhone,
  }) async =>
      _asMap(await _send('POST', '/emergency/ambulance', body: {
        'clientRequestId': clientRequestId,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
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

  Future<Map<String, dynamic>> providerEmergencyAmbulanceResources(String requestId) async =>
      _asMap(await _send('GET', '/provider/emergency/ambulance/$requestId/resources'));

  Future<Map<String, dynamic>> updateProviderEmergencyAmbulanceResources(
    String requestId, {
    required String transportUnitId,
    required List<String> crewProviderIds,
    required String idempotencyKey,
  }) async =>
      _asMap(await _send('PATCH', '/provider/emergency/ambulance/$requestId/resources', body: {
        'transportUnitId': transportUnitId,
        'crewProviderIds': crewProviderIds,
        'idempotencyKey': idempotencyKey,
      }));

  Future<Map<String, dynamic>> createMedicalTransport({
    required String clientRequestId,
    required String mode,
    required DateTime scheduledFor,
    double? pickupLatitude,
    double? pickupLongitude,
    String? pickupAddress,
    double? destinationLatitude,
    double? destinationLongitude,
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
        if (pickupLatitude != null) 'pickupLatitude': pickupLatitude,
        if (pickupLongitude != null) 'pickupLongitude': pickupLongitude,
        if (pickupAddress?.trim().isNotEmpty == true) 'pickupAddress': pickupAddress!.trim(),
        if (destinationLatitude != null) 'destinationLatitude': destinationLatitude,
        if (destinationLongitude != null) 'destinationLongitude': destinationLongitude,
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

  Future<Map<String, dynamic>> providerTransportCompanyContext() async =>
      _asMap(await _send('GET', '/provider/medical-transport/company-context'));

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
  Future<Map<String, dynamic>> recalculateProviderMedicalTransportEta(
    String requestId, {
    required String idempotencyKey,
  }) async =>
      _asMap(await _send('POST', '/provider/medical-transport/$requestId/recalculate-eta', body: {
        'idempotencyKey': idempotencyKey,
      }));

  Future<Map<String, dynamic>> changeProviderTransportDestination(
    String requestId, {
    double? destinationLatitude,
    double? destinationLongitude,
    String? destinationAddress,
    required String reasonCode,
    required String idempotencyKey,
  }) async => _asMap(await _send('POST', '/provider/transport/jobs/$requestId/destination-change', body: {
    if (destinationLatitude != null) 'destinationLatitude': destinationLatitude,
    if (destinationLongitude != null) 'destinationLongitude': destinationLongitude,
    if (destinationAddress?.trim().isNotEmpty == true) 'destinationAddress': destinationAddress!.trim(),
    'reasonCode': reasonCode,
    'idempotencyKey': idempotencyKey,
  }));


  Future<Map<String, dynamic>> medicalTransportTracking(String requestId) async =>
      _asMap(await _send('GET', '/medical-transport/$requestId/tracking'));

  Future<Map<String, dynamic>> providerMedicalTransportTracking(String requestId) async =>
      _asMap(await _send('GET', '/provider/medical-transport/$requestId/tracking'));

  Future<Map<String, dynamic>> startProviderMedicalTransportTracking(
    String requestId, {
    required bool shareWithPatient,
  }) async =>
      _asMap(await _send('POST', '/provider/medical-transport/$requestId/tracking/start', body: {
        'shareWithPatient': shareWithPatient,
      }));

  Future<Map<String, dynamic>> sendProviderMedicalTransportHeartbeat(
    String requestId, {
    required String clientEventId,
    required double latitude,
    required double longitude,
    double? accuracyMeters,
    double? headingDegrees,
    double? speedKph,
    required DateTime capturedAt,
  }) async =>
      _asMap(await _send('POST', '/provider/medical-transport/$requestId/tracking/heartbeat', body: {
        'clientEventId': clientEventId,
        'latitude': latitude,
        'longitude': longitude,
        if (accuracyMeters != null) 'accuracyMeters': accuracyMeters,
        if (headingDegrees != null) 'headingDegrees': headingDegrees,
        if (speedKph != null) 'speedKph': speedKph,
        'capturedAt': capturedAt.toUtc().toIso8601String(),
      }));

  Future<Map<String, dynamic>> stopProviderMedicalTransportTracking(
    String requestId, {
    String reason = 'PROVIDER_STOPPED',
  }) async =>
      _asMap(await _send('POST', '/provider/medical-transport/$requestId/tracking/stop', body: {
        'reason': reason,
      }));


}
