import 'carepoint_api.dart';

extension CarePointEmergencyContactsApi on CarePointApi {
  Future<List<Map<String, dynamic>>> emergencyContacts() async =>
      _asList(await _send('GET', '/patient/emergency-contacts'));

  Future<Map<String, dynamic>> createEmergencyContact({
    required String displayName,
    required String relationship,
    required String phone,
    required int priority,
  }) async =>
      _asMap(await _send('POST', '/patient/emergency-contacts', body: {
        'displayName': displayName.trim(),
        'relationship': relationship.trim(),
        'phone': phone.trim(),
        'priority': priority,
      }));

  Future<Map<String, dynamic>> updateEmergencyContact({
    required String contactId,
    required String displayName,
    required String relationship,
    required String phone,
    required int priority,
    required String expectedUpdatedAt,
  }) async =>
      _asMap(await _send('PATCH', '/patient/emergency-contacts/${Uri.encodeComponent(contactId)}', body: {
        'displayName': displayName.trim(),
        'relationship': relationship.trim(),
        'phone': phone.trim(),
        'priority': priority,
        'expectedUpdatedAt': expectedUpdatedAt,
      }));

  Future<Map<String, dynamic>> revokeEmergencyContact(String contactId) async =>
      _asMap(await _send('POST', '/patient/emergency-contacts/${Uri.encodeComponent(contactId)}/revoke', body: const {}));
}
