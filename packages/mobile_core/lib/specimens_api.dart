part of 'carepoint_api.dart';

extension SpecimenCustodyApi on CarePointApi {
  Future<Map<String, dynamic>> collectSpecimen({
    required String orderId,
    required String specimenTypeCode,
    required DateTime collectedAt,
    String conditionCode = 'ACCEPTABLE',
    String? barcode,
    String? collectionLocation,
  }) async {
    return _asMap(await _send('POST', '/provider/specimens', body: {
      'orderId': orderId,
      'specimenTypeCode': specimenTypeCode.trim().toUpperCase(),
      'collectedAt': collectedAt.toUtc().toIso8601String(),
      'conditionCode': conditionCode,
      if (barcode?.trim().isNotEmpty == true) 'barcode': barcode!.trim(),
      if (collectionLocation?.trim().isNotEmpty == true)
        'collectionLocation': collectionLocation!.trim(),
    }));
  }

  Future<Map<String, dynamic>> orderSpecimens(String orderId) async {
    return _asMap(await _send('GET', '/provider/specimens/order/$orderId'));
  }

  Future<Map<String, dynamic>> appendSpecimenCustody({
    required String specimenId,
    required String eventType,
    required DateTime occurredAt,
    required String conditionCode,
    String? receiverRef,
    String? location,
  }) async {
    return _asMap(await _send(
      'POST',
      '/provider/specimens/$specimenId/custody-events',
      body: {
        'eventType': eventType,
        'occurredAt': occurredAt.toUtc().toIso8601String(),
        'conditionCode': conditionCode,
        if (receiverRef?.trim().isNotEmpty == true)
          'receiverRef': receiverRef!.trim(),
        if (location?.trim().isNotEmpty == true) 'location': location!.trim(),
      },
    ));
  }

  Future<Map<String, dynamic>> specimenCustodyHistory(String specimenId) async {
    return _asMap(
      await _send('GET', '/provider/specimens/$specimenId/custody-events'),
    );
  }
}
