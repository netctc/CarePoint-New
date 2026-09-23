part of 'carepoint_api.dart';

extension CarePointSelfServiceApi on CarePointApi {
  Future<List<Map<String, dynamic>>> accountSessions() async => _asList(await _send('GET', '/iam/sessions'));
  Future<void> revokeAccountSession(String sessionId) async { await _send('DELETE', '/iam/sessions/$sessionId'); }
  Future<void> revokeAllAccountSessions() async { await _send('POST', '/iam/sessions/revoke-all', body: const {}); }
  Future<Map<String, dynamic>> mfaStatus() async => _asMap(await _send('GET', '/iam/mfa/status'));
  Future<Map<String, dynamic>> beginMfaEnrollment() async => _asMap(await _send('POST', '/iam/mfa/enroll', body: const {}));
  Future<Map<String, dynamic>> confirmMfaEnrollment(String code) async => _asMap(await _send('POST', '/iam/mfa/confirm', body: {'code': code.trim()}));
  Future<Map<String, dynamic>> patientProfile() async => _asMap(await _send('GET', '/iam/patient-profile'));
  Future<Map<String, dynamic>> updatePatientProfile({
    required String firstName,
    required String lastName,
    required String phone,
    required String expectedUpdatedAt,
  }) async => _asMap(await _send('PATCH', '/iam/patient-profile', body: {
    'firstName': firstName.trim(), 'lastName': lastName.trim(), 'phone': phone.trim(), 'expectedUpdatedAt': expectedUpdatedAt,
  }));
  Future<Map<String, dynamic>> patientAccessNeeds() async => _asMap(await _send('GET', '/patient/access-needs'));
  Future<Map<String, dynamic>> updatePatientAccessNeeds({
    required List<String> needs,
    required int expectedVersion,
    String? note,
  }) async => _asMap(await _send('PATCH', '/patient/access-needs', body: {
    'needs': needs,
    'expectedVersion': expectedVersion,
    'note': note?.trim(),
  }));
  Future<List<Map<String, dynamic>>> emergencyContacts() async => _asList(await _send('GET', '/patient/emergency-contacts'));
  Future<Map<String, dynamic>> createEmergencyContact({
    required String displayName,
    required String relationship,
    required String phone,
    required int priority,
  }) async => _asMap(await _send('POST', '/patient/emergency-contacts', body: {
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
  }) async => _asMap(await _send('PATCH', '/patient/emergency-contacts/${Uri.encodeComponent(contactId)}', body: {
    'displayName': displayName.trim(),
    'relationship': relationship.trim(),
    'phone': phone.trim(),
    'priority': priority,
    'expectedUpdatedAt': expectedUpdatedAt,
  }));
  Future<Map<String, dynamic>> revokeEmergencyContact(String contactId) async =>
      _asMap(await _send('POST', '/patient/emergency-contacts/${Uri.encodeComponent(contactId)}/revoke', body: const {}));
  Future<List<Map<String, dynamic>>> patientConsents() async => _asList(await _send('GET', '/consents/me'));
  Future<Map<String, dynamic>> revokePatientConsent(String consentId) async => _asMap(await _send('POST', '/consents/${Uri.encodeComponent(consentId)}/revoke', body: const {}));
  Future<Map<String, dynamic>> regrantPatientConsent(String consentId) async => _asMap(await _send('POST', '/consents/${Uri.encodeComponent(consentId)}/regrant', body: const {}));

  // PAT-133 / PAT-134 / PAT-135 — dependent authority, context and isolated consent.
  Future<Map<String, dynamic>> patientDependents() async =>
      _asMap(await _send('GET', '/patient/dependents'));
  Future<Map<String, dynamic>> patientContext() async =>
      _asMap(await _send('GET', '/patient/context'));
  Future<Map<String, dynamic>> switchPatientContext({String? patientId, required String mode}) async =>
      _asMap(await _send('POST', '/patient/context/switch', body: {
        'mode': mode,
        if (patientId?.trim().isNotEmpty == true) 'patientId': patientId!.trim(),
      }));
  Future<Map<String, dynamic>> requestDependentRelation({
    required String targetPatientId,
    required String relationshipType,
    required List<String> scopes,
    String? validUntil,
    required List<Map<String, dynamic>> evidence,
  }) async => _asMap(await _send('POST', '/patient/dependents', body: {
    'targetPatientId': targetPatientId.trim(),
    'relationshipType': relationshipType,
    'scopes': scopes,
    if (validUntil?.trim().isNotEmpty == true) 'validUntil': validUntil!.trim(),
    'evidence': evidence,
  }));
  Future<Map<String, dynamic>> updateDependentRelation(
    String relationId, {
    required String relationshipType,
    required List<String> scopes,
    String? validUntil,
    List<Map<String, dynamic>>? evidence,
  }) async => _asMap(await _send('PATCH', '/patient/dependents/${Uri.encodeComponent(relationId)}', body: {
    'relationshipType': relationshipType,
    'scopes': scopes,
    'validUntil': validUntil?.trim().isNotEmpty == true ? validUntil!.trim() : null,
    if (evidence != null) 'evidence': evidence,
  }));
  Future<Map<String, dynamic>> revokeDependentRelation(String relationId) async =>
      _asMap(await _send('POST', '/patient/dependents/${Uri.encodeComponent(relationId)}/revoke', body: const {}));
  Future<Map<String, dynamic>> dependentConsents(String patientId) async =>
      _asMap(await _send('GET', '/patient/dependents/patient/${Uri.encodeComponent(patientId)}/consents'));
  Future<Map<String, dynamic>> grantDependentConsent(
    String patientId, {
    String? providerId,
    required String scope,
    required String version,
    String purpose = 'TREATMENT',
    String? expiresAt,
  }) async => _asMap(await _send('POST', '/patient/dependents/patient/${Uri.encodeComponent(patientId)}/consents', body: {
    if (providerId?.trim().isNotEmpty == true) 'providerId': providerId!.trim(),
    'scope': scope,
    'version': version,
    'purpose': purpose,
    if (expiresAt?.trim().isNotEmpty == true) 'expiresAt': expiresAt!.trim(),
  }));
  Future<Map<String, dynamic>> revokeDependentConsent(String patientId, String consentId) async =>
      _asMap(await _send(
        'POST',
        '/patient/dependents/patient/${Uri.encodeComponent(patientId)}/consents/${Uri.encodeComponent(consentId)}/revoke',
        body: const {},
      ));
  /// Server revocation is best effort; local sign-out always clears secrets.
  Future<void> signOutCurrentSession() async {
    try {
      if (accessToken != null) {
        final sessions = await accountSessions();
        String? currentId;
        for (final session in sessions) { if (session['current'] == true) { currentId = session['id']?.toString(); break; } }
        if (currentId != null && currentId.isNotEmpty) await revokeAccountSession(currentId);
      }
    } catch (_) { /* Network failure must not prevent local sign-out. */ }
    finally { await logout(); }
  }
}

extension CarePointProviderOnboardingApi on CarePointApi {
  Future<Map<String, dynamic>> providerOnboardingState() async => _asMap(await _send('GET', '/onboarding/me'));
  Future<List<Map<String, dynamic>>> doctorSpecialties() async {
    final response = _asMap(await _send('GET', '/doctors/specialties', authenticated: false));
    return _asList(response['items']);
  }
  Future<List<Map<String, dynamic>>> otherProviderCategories() async {
    final response = _asMap(await _send('GET', '/other-provider-categories', authenticated: false));
    return _asList(response['items']);
  }
  Future<Map<String, dynamic>> startDoctorOnboarding(String specialtyId) async => _asMap(await _send('POST', '/onboarding/doctors', body: {'specialtyId': specialtyId}));
  Future<Map<String, dynamic>> startOtherProviderOnboarding(String providerCategoryId) async => _asMap(await _send('POST', '/onboarding/other-providers', body: {'providerCategoryId': providerCategoryId}));
  Future<Map<String, dynamic>> addProviderOnboardingCredential(String onboardingId, {required String type, String? number, String? issuer, String? validUntil, String? documentId}) async => _asMap(await _send('POST', '/onboarding/$onboardingId/credentials', body: {
    'type': type.trim(), if (number?.trim().isNotEmpty == true) 'number': number!.trim(), if (issuer?.trim().isNotEmpty == true) 'issuer': issuer!.trim(), if (validUntil?.trim().isNotEmpty == true) 'validUntil': validUntil!.trim(), if (documentId?.trim().isNotEmpty == true) 'documentId': documentId!.trim(),
  }));
  Future<Map<String, dynamic>> submitProviderOnboarding(String onboardingId) async => _asMap(await _send('POST', '/onboarding/$onboardingId/submit', body: const {}));
}

/// F1/F2 adapters share the existing session transport and its one-refresh retry.
extension CarePointJourneyApi on CarePointApi {
  Future<Map<String, dynamic>> discoverCare(Map<String, String> filters, {int page = 1}) async {
    if (page < 1 || page > 1000) throw const CarePointApiException('Invalid discovery page.');
    const allowed = {'q', 'specialty', 'providerClass', 'providerCategory', 'service', 'modality', 'location'};
    return _asMap(await _send('GET', '/services/discovery', authenticated: false, query: {
      for (final entry in filters.entries) if (allowed.contains(entry.key) && entry.value.trim().isNotEmpty) entry.key: entry.value.trim(),
      'page': '$page', 'limit': '20',
    }));
  }
  Future<Map<String, dynamic>> bookCare(Map<String, dynamic> immutableIntent) async => _asMap(await _send('POST', '/bookings', body: immutableIntent));
  Future<List<Map<String, dynamic>>> careLocations() async => _asList(await _send('GET', '/provider/locations'));
  Future<Map<String, dynamic>> addCareLocation(Map<String, dynamic> input) async => _asMap(await _send('POST', '/provider/locations', body: input));
  Future<Map<String, dynamic>> setCareLocationActive(String id, bool active) async => _asMap(await _send('PATCH', '/provider/locations/${Uri.encodeComponent(id)}/status', body: {'active': active}));
  Future<Map<String, dynamic>> setCareDelivery(String serviceId, String modality, Map<String, dynamic> input) async {
    if (modality != 'CLINIC' && modality != 'HOME_VISIT') throw const CarePointApiException('Unsupported delivery context.');
    return _asMap(await _send('PATCH', '/provider/services/${Uri.encodeComponent(serviceId)}/delivery-context/$modality', body: input));
  }
  Future<List<Map<String, dynamic>>> careExceptions() async => _asList(await _send('GET', '/provider/availability/exceptions'));
  Future<Map<String, dynamic>> addCareException(Map<String, dynamic> input) async => _asMap(await _send('POST', '/provider/availability/exceptions', body: input));
  Future<Map<String, dynamic>> setCareExceptionActive(String id, bool active) async => _asMap(await _send('PATCH', '/provider/availability/exceptions/${Uri.encodeComponent(id)}/status', body: {'active': active}));
  Future<Map<String, dynamic>> addBufferedCareRule(Map<String, dynamic> input) async => _asMap(await _send('POST', '/provider/availability/rules', body: input));
  Future<Map<String, dynamic>> careSlotInventory({required DateTime from, required DateTime to, int page = 1}) async => _asMap(await _send('GET', '/provider/availability/inventory', query: {'from': from.toUtc().toIso8601String(), 'to': to.toUtc().toIso8601String(), 'page': '$page'}));
  Future<Map<String, dynamic>> setCareSlotBlocked(String slotId, bool blocked) async => _asMap(await _send('POST', '/provider/availability/slots/${Uri.encodeComponent(slotId)}/${blocked ? 'block' : 'unblock'}', body: const {}));
}

extension CarePointPlanningApi on CarePointApi {
  Future<Map<String, dynamic>> rescheduleOptions(String appointmentId, {Map<String, String>? window}) async => _asMap(await _send('GET', '/patient-journeys/appointments/${Uri.encodeComponent(appointmentId)}/reschedule-options', query: window));
  Future<Map<String, dynamic>> rescheduleCare(String appointmentId, Map<String, dynamic> intent) async => _asMap(await _send('POST', '/patient-journeys/appointments/${Uri.encodeComponent(appointmentId)}/reschedule', body: intent));
  Future<Map<String, dynamic>> rescheduleHistory(String appointmentId) async => _asMap(await _send('GET', '/patient-journeys/appointments/${Uri.encodeComponent(appointmentId)}/history'));
  Future<Map<String, dynamic>> earlierWaitlist() async => _asMap(await _send('GET', '/patient-journeys/waitlist'));
  Future<Map<String, dynamic>> joinEarlierWaitlist(String appointmentId, Map<String, dynamic> window) async => _asMap(await _send('POST', '/patient-journeys/appointments/${Uri.encodeComponent(appointmentId)}/waitlist', body: window));
  Future<Map<String, dynamic>> withdrawEarlierWaitlist(String entryId) async => _asMap(await _send('POST', '/patient-journeys/waitlist/${Uri.encodeComponent(entryId)}/withdraw', body: const {}));
  Future<Map<String, dynamic>> earlierMatches(String entryId) async => _asMap(await _send('GET', '/patient-journeys/waitlist/${Uri.encodeComponent(entryId)}/matches'));
  Future<Map<String, dynamic>> providerWaitlistDemand() async => _asMap(await _send('GET', '/provider/waitlist'));
}

extension CarePointAvailabilityRequestsApi on CarePointApi {
  Future<Map<String, dynamic>> availabilityRequests({int page = 1, String view = 'requests'}) async {
    if (page < 1 || page > 1000 || !['requests', 'notices'].contains(view)) throw const CarePointApiException('Invalid availability view.');
    return _asMap(await _send('GET', '/availability-requests', query: {'page': '$page', 'view': view}));
  }
  Future<Map<String, dynamic>> joinAvailabilityRequest(Map<String, dynamic> input) async => _asMap(await _send('POST', '/availability-requests', body: input));
  Future<Map<String, dynamic>> checkAvailabilityRequest(String id) async => _asMap(await _send('POST', '/availability-requests/${Uri.encodeComponent(id)}/refresh', body: const {}));
  Future<Map<String, dynamic>> availabilityRequestMatches(String id) async => _asMap(await _send('GET', '/availability-requests/${Uri.encodeComponent(id)}/matches'));
  Future<Map<String, dynamic>> withdrawAvailabilityRequest(String id) async => _asMap(await _send('POST', '/availability-requests/${Uri.encodeComponent(id)}/withdraw', body: const {}));
  Future<Map<String, dynamic>> markAvailabilityNoticeRead(String id, int version) async => _asMap(await _send('POST', '/availability-requests/${Uri.encodeComponent(id)}/read', body: {'version': version}));
  Future<Map<String, dynamic>> providerAvailabilityDemand({int page = 1}) async {
    if (page < 1 || page > 1000) throw const CarePointApiException('Invalid demand page.');
    return _asMap(await _send('GET', '/provider/availability-demand', query: {'page': '$page'}));
  }
}
