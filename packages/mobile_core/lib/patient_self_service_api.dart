part of 'carepoint_api.dart';

extension CarePointSelfServiceApi on CarePointApi {
  Future<List<Map<String, dynamic>>> accountSessions() async =>
      _asList(await _send('GET', '/iam/sessions'));

  Future<void> revokeAccountSession(String sessionId) async {
    await _send('DELETE', '/iam/sessions/$sessionId');
  }

  Future<void> revokeAllAccountSessions() async {
    await _send('POST', '/iam/sessions/revoke-all', body: const {});
  }

  Future<Map<String, dynamic>> mfaStatus() async =>
      _asMap(await _send('GET', '/iam/mfa/status'));

  Future<Map<String, dynamic>> beginMfaEnrollment() async =>
      _asMap(await _send('POST', '/iam/mfa/enroll', body: const {}));

  Future<Map<String, dynamic>> confirmMfaEnrollment(String code) async =>
      _asMap(await _send('POST', '/iam/mfa/confirm', body: {'code': code.trim()}));

  Future<List<Map<String, dynamic>>> patientConsents() async =>
      _asList(await _send('GET', '/consents/me'));

  Future<Map<String, dynamic>> revokePatientConsent(String consentId) async =>
      _asMap(await _send('POST', '/consents/$consentId/revoke', body: const {}));

  /// Revokes the current server-side session whenever possible and always
  /// removes local session material. Network/auth failures never prevent a
  /// local sign-out from completing.
  Future<void> signOutCurrentSession() async {
    try {
      if (accessToken != null) {
        final sessions = await accountSessions();
        String? currentId;
        for (final session in sessions) {
          if (session['current'] == true) {
            currentId = session['id']?.toString();
            break;
          }
        }
        if (currentId != null && currentId.isNotEmpty) {
          await revokeAccountSession(currentId);
        }
      }
    } catch (_) {
      // Best effort: local credentials must still be cleared below.
    } finally {
      await logout();
    }
  }
}

extension CarePointProviderOnboardingApi on CarePointApi {
  Future<Map<String, dynamic>> providerOnboardingState() async =>
      _asMap(await _send('GET', '/onboarding/me'));

  Future<List<Map<String, dynamic>>> doctorSpecialties() async {
    final response = _asMap(await _send('GET', '/doctors/specialties', authenticated: false));
    return _asList(response['items']);
  }

  Future<List<Map<String, dynamic>>> otherProviderCategories() async {
    final response = _asMap(await _send('GET', '/other-provider-categories', authenticated: false));
    return _asList(response['items']);
  }

  Future<Map<String, dynamic>> startDoctorOnboarding(String specialtyId) async =>
      _asMap(await _send('POST', '/onboarding/doctors', body: {'specialtyId': specialtyId}));

  Future<Map<String, dynamic>> startOtherProviderOnboarding(String providerCategoryId) async =>
      _asMap(await _send('POST', '/onboarding/other-providers', body: {'providerCategoryId': providerCategoryId}));

  Future<Map<String, dynamic>> addProviderOnboardingCredential(
    String onboardingId, {
    required String type,
    String? number,
    String? issuer,
    String? validUntil,
    String? documentId,
  }) async =>
      _asMap(await _send('POST', '/onboarding/$onboardingId/credentials', body: {
        'type': type.trim(),
        if (number?.trim().isNotEmpty == true) 'number': number!.trim(),
        if (issuer?.trim().isNotEmpty == true) 'issuer': issuer!.trim(),
        if (validUntil?.trim().isNotEmpty == true) 'validUntil': validUntil!.trim(),
        if (documentId?.trim().isNotEmpty == true) 'documentId': documentId!.trim(),
      }));

  Future<Map<String, dynamic>> submitProviderOnboarding(String onboardingId) async =>
      _asMap(await _send('POST', '/onboarding/$onboardingId/submit', body: const {}));
}

/// F1 journey adapters reuse the session-aware transport, including its bounded
/// one-refresh retry. They never create a second unauthenticated HTTP client.
extension CarePointJourneyApi on CarePointApi {
  Future<Map<String, dynamic>> discoverCare(Map<String, String> filters, {int page = 1}) async {
    if (page < 1 || page > 1000) throw const CarePointApiException('Invalid discovery page.');
    const allowed = {'q', 'specialty', 'providerClass', 'providerCategory', 'service', 'modality', 'location'};
    return _asMap(await _send('GET', '/services/discovery', authenticated: false, query: {
      for (final entry in filters.entries)
        if (allowed.contains(entry.key) && entry.value.trim().isNotEmpty) entry.key: entry.value.trim(),
      'page': '$page', 'limit': '20',
    }));
  }

  Future<Map<String, dynamic>> bookCare(Map<String, dynamic> immutableIntent) async =>
      _asMap(await _send('POST', '/bookings', body: immutableIntent));

  Future<List<Map<String, dynamic>>> careLocations() async =>
      _asList(await _send('GET', '/provider/locations'));
  Future<Map<String, dynamic>> addCareLocation(Map<String, dynamic> input) async =>
      _asMap(await _send('POST', '/provider/locations', body: input));
  Future<Map<String, dynamic>> setCareLocationActive(String id, bool active) async =>
      _asMap(await _send('PATCH', '/provider/locations/${Uri.encodeComponent(id)}/status', body: {'active': active}));
  Future<Map<String, dynamic>> setCareDelivery(String serviceId, String modality, Map<String, dynamic> input) async {
    if (modality != 'CLINIC' && modality != 'HOME_VISIT') throw const CarePointApiException('Unsupported delivery context.');
    return _asMap(await _send('PATCH', '/provider/services/${Uri.encodeComponent(serviceId)}/delivery-context/$modality', body: input));
  }
  Future<List<Map<String, dynamic>>> careExceptions() async =>
      _asList(await _send('GET', '/provider/availability/exceptions'));
  Future<Map<String, dynamic>> addCareException(Map<String, dynamic> input) async =>
      _asMap(await _send('POST', '/provider/availability/exceptions', body: input));
  Future<Map<String, dynamic>> setCareExceptionActive(String id, bool active) async =>
      _asMap(await _send('PATCH', '/provider/availability/exceptions/${Uri.encodeComponent(id)}/status', body: {'active': active}));
  Future<Map<String, dynamic>> addBufferedCareRule(Map<String, dynamic> input) async =>
      _asMap(await _send('POST', '/provider/availability/rules', body: input));
  Future<Map<String, dynamic>> careSlotInventory({required DateTime from, required DateTime to, int page = 1}) async =>
      _asMap(await _send('GET', '/provider/availability/inventory', query: {
        'from': from.toUtc().toIso8601String(), 'to': to.toUtc().toIso8601String(), 'page': '$page',
      }));
  Future<Map<String, dynamic>> setCareSlotBlocked(String slotId, bool blocked) async =>
      _asMap(await _send('POST', '/provider/availability/slots/${Uri.encodeComponent(slotId)}/${blocked ? 'block' : 'unblock'}', body: const {}));
}
