part of 'carepoint_api.dart';

extension CarePointFinancialApi on CarePointApi {
  Future<Map<String, dynamic>> patientBilling() async => _asMap(await _send('GET', '/billing/me'));

  Future<Map<String, dynamic>> createPaymentIntent(
    String invoiceId, {
    required String idempotencyKey,
    int? amountMinor,
    String? paymentMethodToken,
  }) async =>
      _asMap(await _send('POST', '/billing/invoices/$invoiceId/payment-intents', body: {
        'idempotencyKey': idempotencyKey,
        if (amountMinor != null) 'amountMinor': amountMinor,
        if (paymentMethodToken?.trim().isNotEmpty == true) 'paymentMethodToken': paymentMethodToken!.trim(),
      }));

  Future<Map<String, dynamic>> refreshPaymentIntent(String intentId) async =>
      _asMap(await _send('POST', '/billing/payment-intents/$intentId/refresh', body: const {}));

  Future<List<Map<String, dynamic>>> patientInsuranceCoverages() async =>
      _asList(await _send('GET', '/insurance/me/coverages'));

  Future<Map<String, dynamic>> createInsuranceCoverage({
    required String payerCode,
    required String payerName,
    required String externalPolicyRef,
    String? displayLabel,
    String? effectiveFrom,
    String? effectiveUntil,
  }) async =>
      _asMap(await _send('POST', '/insurance/me/coverages', body: {
        'payerCode': payerCode,
        'payerName': payerName,
        'externalPolicyRef': externalPolicyRef,
        if (displayLabel?.trim().isNotEmpty == true) 'displayLabel': displayLabel!.trim(),
        if (effectiveFrom?.trim().isNotEmpty == true) 'effectiveFrom': effectiveFrom!.trim(),
        if (effectiveUntil?.trim().isNotEmpty == true) 'effectiveUntil': effectiveUntil!.trim(),
      }));

  Future<Map<String, dynamic>> deactivateInsuranceCoverage(String coverageId) async =>
      _asMap(await _send('POST', '/insurance/me/coverages/$coverageId/deactivate', body: const {}));

  Future<Map<String, dynamic>> insuranceActivity() async =>
      _asMap(await _send('GET', '/insurance/me/activity'));

  Future<Map<String, dynamic>> checkInsuranceEligibility(
    String appointmentId, {
    required String coverageId,
    required String idempotencyKey,
  }) async =>
      _asMap(await _send('POST', '/insurance/appointments/$appointmentId/eligibility', body: {
        'coverageId': coverageId,
        'idempotencyKey': idempotencyKey,
      }));

  Future<Map<String, dynamic>> requestPriorAuthorization(
    String appointmentId, {
    required String coverageId,
    required String idempotencyKey,
    String? eligibilityCheckId,
  }) async =>
      _asMap(await _send('POST', '/insurance/appointments/$appointmentId/prior-authorization', body: {
        'coverageId': coverageId,
        'idempotencyKey': idempotencyKey,
        if (eligibilityCheckId?.trim().isNotEmpty == true) 'eligibilityCheckId': eligibilityCheckId!.trim(),
      }));

  Future<Map<String, dynamic>> patientRevenueCycle() async =>
      _asMap(await _send('GET', '/revenue-cycle/me'));

  Future<Map<String, dynamic>> providerRevenueCycle() async =>
      _asMap(await _send('GET', '/provider/revenue-cycle/claims'));

  Future<Map<String, dynamic>> submitInsuranceClaim(
    String appointmentId, {
    required String coverageId,
    required String idempotencyKey,
  }) async =>
      _asMap(await _send('POST', '/provider/revenue-cycle/appointments/$appointmentId/claims', body: {
        'coverageId': coverageId,
        'idempotencyKey': idempotencyKey,
      }));

  Future<Map<String, dynamic>> refreshProviderClaim(String claimId) async =>
      _asMap(await _send('POST', '/provider/revenue-cycle/claims/$claimId/refresh', body: const {}));

  Future<Map<String, dynamic>> reworkProviderClaim(
    String claimId, {
    required String idempotencyKey,
    required String reasonCode,
  }) async =>
      _asMap(await _send('POST', '/provider/revenue-cycle/claims/$claimId/rework', body: {
        'idempotencyKey': idempotencyKey,
        'reasonCode': reasonCode,
      }));

  Future<Map<String, dynamic>> providerFinanceSummary() async =>
      _asMap(await _send('GET', '/provider/finance/summary'));

  Future<List<Map<String, dynamic>>> providerFinanceLedger() async =>
      _asList(await _send('GET', '/provider/finance/ledger'));

  Future<Map<String, dynamic>> providerAppointmentFinance(String appointmentId) async =>
      _asMap(await _send('GET', '/provider/finance/appointments/$appointmentId'));

  Future<Map<String, dynamic>> refundProviderPayment(
    String paymentIntentId, {
    required int amountMinor,
    required String idempotencyKey,
    String? reason,
  }) async =>
      _asMap(await _send('POST', '/provider/finance/payment-intents/$paymentIntentId/refunds', body: {
        'amountMinor': amountMinor,
        'idempotencyKey': idempotencyKey,
        if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
      }));
}

extension CarePointCommunicationsApi on CarePointApi {
  Future<List<Map<String, dynamic>>> careConversations() async =>
      _asList(await _send('GET', '/communications/conversations'));

  Future<Map<String, dynamic>> createCareConversation({
    required String appointmentId,
    required String subject,
    required String clientConversationId,
    String? initialMessage,
  }) async =>
      _asMap(await _send('POST', '/communications/conversations', body: {
        'appointmentId': appointmentId,
        'subject': subject.trim(),
        'clientConversationId': clientConversationId,
        if (initialMessage?.trim().isNotEmpty == true) 'initialMessage': initialMessage!.trim(),
      }));

  Future<Map<String, dynamic>> careConversation(String conversationId) async =>
      _asMap(await _send('GET', '/communications/conversations/$conversationId'));

  Future<Map<String, dynamic>> sendCareMessage(
    String conversationId, {
    required String body,
    required String clientMessageId,
    List<String> attachmentDocumentIds = const [],
  }) async =>
      _asMap(await _send('POST', '/communications/conversations/$conversationId/messages', body: {
        'body': body.trim(),
        'clientMessageId': clientMessageId,
        if (attachmentDocumentIds.isNotEmpty) 'attachmentDocumentIds': attachmentDocumentIds,
      }));

  Future<Map<String, dynamic>> markCareConversationRead(String conversationId) async =>
      _asMap(await _send('POST', '/communications/conversations/$conversationId/read', body: const {}));

  Future<Map<String, dynamic>> closeCareConversation(String conversationId) async =>
      _asMap(await _send('POST', '/communications/conversations/$conversationId/close', body: const {}));

  Future<Map<String, dynamic>> addCareParticipant(String conversationId, {required String providerId}) async =>
      _asMap(await _send('POST', '/communications/conversations/$conversationId/participants', body: {'providerId': providerId}));

  Future<Map<String, dynamic>> notificationPreferences() async =>
      _asMap(await _send('GET', '/notifications/preferences'));

  Future<Map<String, dynamic>> updateNotificationPreferences({
    String? locale,
    bool? inAppEnabled,
    bool? pushEnabled,
    bool? emailEnabled,
    bool? smsEnabled,
  }) async =>
      _asMap(await _send('PATCH', '/notifications/preferences', body: {
        if (locale?.trim().isNotEmpty == true) 'locale': locale!.trim(),
        if (inAppEnabled != null) 'inAppEnabled': inAppEnabled,
        if (pushEnabled != null) 'pushEnabled': pushEnabled,
        if (emailEnabled != null) 'emailEnabled': emailEnabled,
        if (smsEnabled != null) 'smsEnabled': smsEnabled,
      }));

  Future<List<Map<String, dynamic>>> notificationEndpoints() async =>
      _asList(await _send('GET', '/notifications/endpoints'));

  Future<Map<String, dynamic>> registerNotificationEndpoint({required String channel, required String externalEndpointRef}) async =>
      _asMap(await _send('POST', '/notifications/endpoints', body: {
        'channel': channel,
        'externalEndpointRef': externalEndpointRef,
      }));

  Future<Map<String, dynamic>> deactivateNotificationEndpoint(String endpointId) async =>
      _asMap(await _send('POST', '/notifications/endpoints/$endpointId/deactivate', body: const {}));

  Future<List<Map<String, dynamic>>> notifications() async =>
      _asList(await _send('GET', '/notifications'));

  Future<Map<String, dynamic>> markNotificationRead(String notificationId) async =>
      _asMap(await _send('POST', '/notifications/$notificationId/read', body: const {}));
}
