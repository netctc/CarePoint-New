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

  Future<Map<String, dynamic>> startDoctorOnboarding(String specialtyId) async =>
      _asMap(await _send('POST', '/onboarding/doctors', body: {'specialtyId': specialtyId}));

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
