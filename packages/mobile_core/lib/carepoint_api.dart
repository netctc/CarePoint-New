import 'dart:convert';

import 'package:http/http.dart' as http;

import 'carepoint_token_store.dart';

part 'financial_api.dart';
part 'transport_api.dart';
part 'patient_self_service_api.dart';
part 'clinical_documents_api.dart';
part 'specimens_api.dart';

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
  CarePointApi({String? baseUrl, http.Client? client, CarePointTokenStore? tokenStore})
      : baseUrl = (baseUrl ?? const String.fromEnvironment('CAREPOINT_API_BASE', defaultValue: 'http://10.0.2.2:4000/api/v1')).replaceAll(RegExp(r'/+$'), ''),
        _client = client ?? http.Client(),
        _tokenStore = tokenStore ?? SecureCarePointTokenStore();

  final String baseUrl;
  final http.Client _client;
  final CarePointTokenStore _tokenStore;
  String? accessToken;
  String? refreshToken;

  bool get isAuthenticated => accessToken != null;

  Future<CarePointSession?> restoreSession() async {
    accessToken = await _tokenStore.readAccessToken();
    refreshToken = await _tokenStore.readRefreshToken();
    if (refreshToken == null || refreshToken!.isEmpty) {
      await logout();
      return null;
    }
    try {
      return CarePointSession(account: await me(), api: this);
    } catch (_) {
      await logout();
      return null;
    }
  }

  Future<CarePointSession> login(String email, String password) async {
    final result = await _send('POST', '/iam/login', body: {'email': email.trim(), 'password': password}, authenticated: false, retryAuth: false);
    final map = _asMap(result);
    if (map['requiresMfa'] == true) throw CarePointMfaRequired(map['challengeId'].toString(), map['expiresAt'].toString());
    await _captureTokens(map);
    return CarePointSession(account: await me(), api: this);
  }

  Future<CarePointSession> completeMfa(String challengeId, String code) async {
    final result = await _send('POST', '/iam/mfa/verify', body: {'challengeId': challengeId, 'code': code.trim()}, authenticated: false, retryAuth: false);
    await _captureTokens(_asMap(result));
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

  Future<Map<String, dynamic>> book({required String slotId, required String idempotencyKey}) async => _asMap(await _send('POST', '/bookings', body: {'slotId': slotId, 'idempotencyKey': idempotencyKey}));
  Future<List<Map<String, dynamic>>> myAppointments() async => _asList(await _send('GET', '/bookings/me'));
  Future<Map<String, dynamic>> cancelAppointment(String appointmentId, {String? reason}) async => _asMap(await _send('POST', '/bookings/$appointmentId/cancel', body: {if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim()}));

  Future<List<Map<String, dynamic>>> providerServices() async => _asList(await _send('GET', '/provider/services'));
  Future<Map<String, dynamic>> createProviderService({required String name, required String modality, required int durationMinutes, required int priceMinor, String currency = 'USD'}) async {
    final labels = {'en': name, 'ar': name, 'fr': name, 'es': name};
    return _asMap(await _send('POST', '/provider/services', body: {'labels': labels, 'currency': currency, 'modalities': [{'modality': modality, 'durationMinutes': durationMinutes, 'priceMinor': priceMinor}]}));
  }
  Future<List<Map<String, dynamic>>> providerAppointments({DateTime? from, DateTime? to}) async => _asList(await _send('GET', '/provider/appointments', query: {if (from != null) 'from': from.toUtc().toIso8601String(), if (to != null) 'to': to.toUtc().toIso8601String()}));
  Future<Map<String, dynamic>> doctorWorkQueue() async => _asMap(await _send('GET', '/provider/work-queue'));
  Future<List<Map<String, dynamic>>> availabilityRules() async => _asList(await _send('GET', '/provider/availability/rules'));
  Future<Map<String, dynamic>> createAvailabilityRule({required String serviceId, required String modality, required String timezone, required int weekday, required int startMinute, required int endMinute, required int intervalMinutes, int slotCapacity = 1, required String effectiveFrom, String? effectiveUntil}) async => _asMap(await _send('POST', '/provider/availability/rules', body: {'serviceId': serviceId, 'modality': modality, 'timezone': timezone, 'weekday': weekday, 'startMinute': startMinute, 'endMinute': endMinute, 'intervalMinutes': intervalMinutes, 'slotCapacity': slotCapacity, 'effectiveFrom': effectiveFrom, if (effectiveUntil != null) 'effectiveUntil': effectiveUntil}));
  Future<Map<String, dynamic>> generateAvailability({required String fromDate, required String toDate, String? ruleId}) async => _asMap(await _send('POST', '/provider/availability/generate', body: {'fromDate': fromDate, 'toDate': toDate, if (ruleId != null) 'ruleId': ruleId}));

  Future<Map<String, dynamic>> telehealthStatus(String appointmentId) async => _asMap(await _send('GET', '/telehealth/appointments/$appointmentId'));
  Future<Map<String, dynamic>> confirmTelehealthConsent(String appointmentId, {String version = 'telemedicine-v1'}) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/consent', body: {'version': version}));
  Future<Map<String, dynamic>> updateTelehealthReadiness(String appointmentId, {required bool camera, required bool microphone, required bool network}) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/readiness', body: {'camera': camera, 'microphone': microphone, 'network': network}));
  Future<Map<String, dynamic>> telehealthJoin(String appointmentId) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/join', body: const {}));
  Future<Map<String, dynamic>> endTelehealth(String appointmentId) async => _asMap(await _send('POST', '/telehealth/appointments/$appointmentId/end', body: const {}));

  Future<Map<String, dynamic>> patientClinicalTimeline() async => _asMap(await _send('GET', '/clinical/timeline'));
  Future<Map<String, dynamic>> providerClinicalTimeline(String patientId) async => _asMap(await _send('GET', '/clinical/patients/$patientId/timeline'));
  Future<Map<String, dynamic>> clinicalEncounter(String appointmentId) async => _asMap(await _send('GET', '/clinical/appointments/$appointmentId'));
  Future<Map<String, dynamic>> doctorEncounterTemplates(String appointmentId) async =>
      _asMap(await _send('GET', '/provider/encounter-templates', query: {'appointmentId': appointmentId}));
  Future<Map<String, dynamic>> writeClinicalRecord(String appointmentId, Map<String, dynamic> record) async => _asMap(await _send('POST', '/clinical/appointments/$appointmentId/records', body: record));
  Future<Map<String, dynamic>> signClinicalEncounter(String appointmentId) async =>
      _asMap(await _send('POST', '/provider/encounters/' + appointmentId + '/sign', body: const {}));
  Future<Map<String, dynamic>> finalizeClinicalEncounter(String appointmentId) async => _asMap(await _send('POST', '/clinical/appointments/$appointmentId/finalize', body: const {}));
  Future<Map<String, dynamic>> createEncounterAddendum(String appointmentId, {required String reason, required String text}) async =>
      _asMap(await _send('POST', '/provider/encounters/' + appointmentId + '/addenda', body: {'reason': reason, 'text': text}));

  // DOC-067 — Doctor longitudinal procedure history over governed ClinicalProfileEntry(PROCEDURE).
  Future<Map<String, dynamic>> doctorPatientProcedures(String patientId) async =>
      _asMap(await _send('GET', '/doctor/patients/$patientId/clinical-profile/entries', query: {'kind': 'PROCEDURE'}));
  Future<Map<String, dynamic>> createDoctorPatientProcedure(
    String patientId, {
    required String display,
    String? performedDate,
    String? facility,
  }) async => _asMap(await _send('POST', '/doctor/patients/$patientId/clinical-profile/entries', body: {
    'kind': 'PROCEDURE',
    'status': 'ACTIVE',
    'data': {
      'display': display,
      if (performedDate?.isNotEmpty == true) 'performedDate': performedDate,
      if (facility?.isNotEmpty == true) 'facility': facility,
    },
  }));
  Future<Map<String, dynamic>> updateDoctorPatientProcedure(
    String patientId,
    String entryId, {
    required int expectedVersion,
    required String display,
    String? performedDate,
    String? facility,
  }) async => _asMap(await _send('PATCH', '/doctor/patients/$patientId/clinical-profile/entries/$entryId', body: {
    'expectedVersion': expectedVersion,
    'data': {
      'display': display,
      if (performedDate?.isNotEmpty == true) 'performedDate': performedDate,
      if (facility?.isNotEmpty == true) 'facility': facility,
    },
  }));

  // DOC-068 — Doctor longitudinal immunization history over governed BE-006.
  Future<Map<String, dynamic>> doctorPatientImmunizations(String patientId) async =>
      _asMap(await _send('GET', '/doctor/patients/$patientId/clinical-history/immunizations'));
  Future<Map<String, dynamic>> createDoctorPatientImmunization(
    String patientId, {
    required String idempotencyKey,
    required String occurredOn,
    String? vaccineCodeSystem,
    String? vaccineCode,
    String? vaccineDisplay,
    String? doseNumber,
    String? lotNumber,
    String? manufacturer,
    String? route,
    String? site,
  }) async => _asMap(await _send('POST', '/doctor/patients/$patientId/clinical-history/immunizations', body: {
    'idempotencyKey': idempotencyKey,
    'occurredOn': occurredOn,
    if (vaccineCodeSystem?.isNotEmpty == true) 'vaccineCodeSystem': vaccineCodeSystem,
    if (vaccineCode?.isNotEmpty == true) 'vaccineCode': vaccineCode,
    if (vaccineDisplay?.isNotEmpty == true) 'vaccineDisplay': vaccineDisplay,
    if (doseNumber?.isNotEmpty == true) 'doseNumber': doseNumber,
    if (lotNumber?.isNotEmpty == true) 'lotNumber': lotNumber,
    if (manufacturer?.isNotEmpty == true) 'manufacturer': manufacturer,
    if (route?.isNotEmpty == true) 'route': route,
    if (site?.isNotEmpty == true) 'site': site,
  }));
  Future<Map<String, dynamic>> updateDoctorPatientImmunization(
    String patientId,
    String immunizationId, {
    required int expectedVersion,
    required String occurredOn,
    String? vaccineCodeSystem,
    String? vaccineCode,
    String? vaccineDisplay,
    String? doseNumber,
    String? lotNumber,
    String? manufacturer,
    String? route,
    String? site,
  }) async => _asMap(await _send('PATCH', '/doctor/patients/$patientId/clinical-history/immunizations/$immunizationId', body: {
    'expectedVersion': expectedVersion,
    'occurredOn': occurredOn,
    if (vaccineCodeSystem?.isNotEmpty == true) 'vaccineCodeSystem': vaccineCodeSystem,
    if (vaccineCode?.isNotEmpty == true) 'vaccineCode': vaccineCode,
    if (vaccineDisplay?.isNotEmpty == true) 'vaccineDisplay': vaccineDisplay,
    if (doseNumber?.isNotEmpty == true) 'doseNumber': doseNumber,
    if (lotNumber?.isNotEmpty == true) 'lotNumber': lotNumber,
    if (manufacturer?.isNotEmpty == true) 'manufacturer': manufacturer,
    if (route?.isNotEmpty == true) 'route': route,
    if (site?.isNotEmpty == true) 'site': site,
  }));

  // PAT-117 — append-only patient-reported symptom journal.
  Future<Map<String, dynamic>> patientSymptoms({DateTime? from, DateTime? to, int limit = 50}) async =>
      _asMap(await _send('GET', '/patient/symptoms', query: {
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
        'limit': limit.toString(),
      }));
  Future<Map<String, dynamic>> createPatientSymptom({
    required String idempotencyKey,
    required String symptom,
    required int severity,
    required num durationValue,
    required String durationUnit,
    required String context,
    required DateTime occurredAt,
    String? notes,
  }) async => _asMap(await _send('POST', '/patient/symptoms', body: {
    'idempotencyKey': idempotencyKey,
    'symptom': symptom,
    'severity': severity,
    'duration': {'value': durationValue, 'unit': durationUnit},
    'context': context,
    'occurredAt': occurredAt.toUtc().toIso8601String(),
    if (notes?.trim().isNotEmpty == true) 'notes': notes!.trim(),
  }));

  // PAT-089 / PAT-093 — governed longitudinal patient clinical history.
  Future<Map<String, dynamic>> patientHospitalizations() async =>
      _asMap(await _send('GET', '/patient/clinical-history/hospitalizations'));
  Future<Map<String, dynamic>> createPatientHospitalization({
    required String idempotencyKey,
    required String admittedOn,
    String? dischargedOn,
    String? facility,
    String? reason,
  }) async => _asMap(await _send('POST', '/patient/clinical-history/hospitalizations', body: {
    'idempotencyKey': idempotencyKey,
    'admittedOn': admittedOn,
    if (dischargedOn?.isNotEmpty == true) 'dischargedOn': dischargedOn,
    if (facility?.isNotEmpty == true) 'facility': facility,
    if (reason?.isNotEmpty == true) 'reason': reason,
  }));
  Future<Map<String, dynamic>> updatePatientHospitalization(
    String hospitalizationId, {
    required int expectedVersion,
    required String admittedOn,
    String? dischargedOn,
    String? facility,
    String? reason,
  }) async => _asMap(await _send('PATCH', '/patient/clinical-history/hospitalizations/$hospitalizationId', body: {
    'expectedVersion': expectedVersion,
    'admittedOn': admittedOn,
    if (dischargedOn?.isNotEmpty == true) 'dischargedOn': dischargedOn,
    if (facility?.isNotEmpty == true) 'facility': facility,
    if (reason?.isNotEmpty == true) 'reason': reason,
  }));

  Future<Map<String, dynamic>> patientImmunizations() async =>
      _asMap(await _send('GET', '/patient/clinical-history/immunizations'));
  Future<Map<String, dynamic>> createPatientImmunization({
    required String idempotencyKey,
    required String occurredOn,
    String? vaccineCodeSystem,
    String? vaccineCode,
    String? vaccineDisplay,
    String? doseNumber,
    String? lotNumber,
    String? manufacturer,
  }) async => _asMap(await _send('POST', '/patient/clinical-history/immunizations', body: {
    'idempotencyKey': idempotencyKey,
    'occurredOn': occurredOn,
    if (vaccineCodeSystem?.isNotEmpty == true) 'vaccineCodeSystem': vaccineCodeSystem,
    if (vaccineCode?.isNotEmpty == true) 'vaccineCode': vaccineCode,
    if (vaccineDisplay?.isNotEmpty == true) 'vaccineDisplay': vaccineDisplay,
    if (doseNumber?.isNotEmpty == true) 'doseNumber': doseNumber,
    if (lotNumber?.isNotEmpty == true) 'lotNumber': lotNumber,
    if (manufacturer?.isNotEmpty == true) 'manufacturer': manufacturer,
  }));
  Future<Map<String, dynamic>> updatePatientImmunization(
    String immunizationId, {
    required int expectedVersion,
    required String occurredOn,
    String? vaccineCodeSystem,
    String? vaccineCode,
    String? vaccineDisplay,
    String? doseNumber,
    String? lotNumber,
    String? manufacturer,
  }) async => _asMap(await _send('PATCH', '/patient/clinical-history/immunizations/$immunizationId', body: {
    'expectedVersion': expectedVersion,
    'occurredOn': occurredOn,
    if (vaccineCodeSystem?.isNotEmpty == true) 'vaccineCodeSystem': vaccineCodeSystem,
    if (vaccineCode?.isNotEmpty == true) 'vaccineCode': vaccineCode,
    if (vaccineDisplay?.isNotEmpty == true) 'vaccineDisplay': vaccineDisplay,
    if (doseNumber?.isNotEmpty == true) 'doseNumber': doseNumber,
    if (lotNumber?.isNotEmpty == true) 'lotNumber': lotNumber,
    if (manufacturer?.isNotEmpty == true) 'manufacturer': manufacturer,
  }));

  // PAT-125..127 — Patient Care Plan workspace.
  Future<Map<String, dynamic>> patientCarePlans() async =>
      _asMap(await _send('GET', '/patient/care-plans'));
  Future<Map<String, dynamic>> patientCarePlanGoals(String carePlanId) async =>
      _asMap(await _send('GET', '/patient/care-plans/$carePlanId/goals'));
  Future<Map<String, dynamic>> patientCarePlanTasks(String carePlanId) async =>
      _asMap(await _send('GET', '/patient/care-plans/$carePlanId/tasks'));
  Future<Map<String, dynamic>> completePatientCareTask(
    String taskId, {
    required String occurrenceKey,
    required String outcome,
    String? reasonCode,
  }) async => _asMap(await _send('POST', '/patient/care-tasks/$taskId/completions', body: {
    'occurrenceKey': occurrenceKey,
    'outcome': outcome,
    if (reasonCode?.trim().isNotEmpty == true) 'reasonCode': reasonCode!.trim().toUpperCase(),
  }));

  // DOC-069..075 — Doctor Care Plan and deterministic RPM workspace.
  Future<Map<String, dynamic>> doctorPatientCarePlans(String patientId) async =>
      _asMap(await _send('GET', '/provider/patients/$patientId/care-plans'));
  Future<Map<String, dynamic>> createDoctorCarePlan(String patientId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/provider/patients/$patientId/care-plans', body: body));
  Future<Map<String, dynamic>> doctorCarePlanGoals(String carePlanId) async =>
      _asMap(await _send('GET', '/provider/care-plans/$carePlanId/goals'));
  Future<Map<String, dynamic>> doctorCarePlanTasks(String carePlanId) async =>
      _asMap(await _send('GET', '/provider/care-plans/$carePlanId/tasks'));
  Future<Map<String, dynamic>> addDoctorCarePlanGoal(String carePlanId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/provider/care-plans/$carePlanId/goals', body: body));
  Future<Map<String, dynamic>> addDoctorCarePlanTask(String carePlanId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/provider/care-plans/$carePlanId/tasks', body: body));
  Future<Map<String, dynamic>> doctorCarePlanProgress(String carePlanId) async =>
      _asMap(await _send('GET', '/provider/care-plans/$carePlanId/progress'));
  Future<Map<String, dynamic>> doctorRpmPolicies() async =>
      _asMap(await _send('GET', '/provider/rpm/policies'));
  Future<Map<String, dynamic>> doctorCarePlanAlertRules(String carePlanId) async =>
      _asMap(await _send('GET', '/provider/care-plans/$carePlanId/alert-rules'));
  Future<Map<String, dynamic>> createDoctorCarePlanAlertRule(String carePlanId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/provider/care-plans/$carePlanId/alert-rules', body: body));
  Future<Map<String, dynamic>> updateDoctorCarePlanAlertRule(String carePlanId, String ruleId, Map<String, dynamic> body) async =>
      _asMap(await _send('PATCH', '/provider/care-plans/$carePlanId/alert-rules/$ruleId', body: body));
  Future<Map<String, dynamic>> doctorMonitoringQueue({String? severity}) async =>
      _asMap(await _send('GET', '/provider/monitoring-queue', query: {if (severity?.isNotEmpty == true) 'severity': severity!}));
  Future<Map<String, dynamic>> patientClinicalAlerts() async =>
      _asMap(await _send('GET', '/patient/clinical-alerts'));
  Future<Map<String, dynamic>> markPatientClinicalAlertViewed(String alertId) async =>
      _asMap(await _send('POST', '/patient/clinical-alerts/$alertId/viewed', body: const {}));

  Future<Map<String, dynamic>> doctorClinicalAlertAction(String alertId, String action, {String? reasonCode}) async =>
      _asMap(await _send('POST', '/provider/clinical-alerts/$alertId/actions', body: {
        'action': action,
        if (reasonCode?.trim().isNotEmpty == true) 'reasonCode': reasonCode!.trim().toUpperCase(),
      }));

  // PAT-132 — Patient refill requests.
  Future<Map<String, dynamic>> patientRefillRequests() async =>
      _asMap(await _send('GET', '/patient/refill-requests'));
  Future<Map<String, dynamic>> requestPatientRefill(String prescriptionId, {String? reason}) async =>
      _asMap(await _send('POST', '/patient/prescriptions/$prescriptionId/refill-requests', body: {
        if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
      }));

  // DOC-076..078 — Doctor refill, imaging and referral coordination.
  Future<Map<String, dynamic>> doctorRefillRequests() async =>
      _asMap(await _send('GET', '/provider/refill-requests'));
  Future<Map<String, dynamic>> reviewDoctorRefillRequest(
    String requestId, {
    required String action,
    required int expectedVersion,
    bool confirm = false,
    String? reason,
  }) async => _asMap(await _send('POST', '/provider/refill-requests/$requestId/actions', body: {
    'action': action,
    'expectedVersion': expectedVersion,
    if (confirm) 'confirm': true,
    if (reason?.trim().isNotEmpty == true) 'reason': reason!.trim(),
  }));

  Future<Map<String, dynamic>> doctorImagingOrders(String patientId) async =>
      _asMap(await _send('GET', '/provider/patients/$patientId/imaging-orders'));
  Future<Map<String, dynamic>> createDoctorImagingOrder(String patientId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/provider/patients/$patientId/imaging-orders', body: body));
  Future<Map<String, dynamic>> updateDoctorImagingOrder(String orderId, Map<String, dynamic> body) async =>
      _asMap(await _send('PATCH', '/provider/imaging-orders/$orderId', body: body));

  Future<Map<String, dynamic>> doctorPatientReferrals(String patientId) async =>
      _asMap(await _send('GET', '/provider/patients/$patientId/referrals'));
  Future<Map<String, dynamic>> doctorReferralInbox() async =>
      _asMap(await _send('GET', '/provider/referrals/inbox'));
  Future<Map<String, dynamic>> doctorReferralDestinations({String? specialtyCode}) async =>
      _asMap(await _send('GET', '/provider/referrals/destinations', query: {
        if (specialtyCode?.trim().isNotEmpty == true) 'specialtyCode': specialtyCode!.trim().toUpperCase(),
      }));
  Future<Map<String, dynamic>> createDoctorReferral(String patientId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/provider/patients/$patientId/referrals', body: body));
  Future<Map<String, dynamic>> actDoctorReferral(String referralId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/provider/referrals/$referralId/actions', body: body));

  // DOC-084 — exact-version Doctor questionnaire requests.
  Future<Map<String, dynamic>> doctorQuestionnaireRequestOptions(String patientId, String appointmentId) async =>
      _asMap(await _send('GET', '/doctor/patients/$patientId/questionnaire-requests/available', query: {'appointmentId': appointmentId}));
  Future<Map<String, dynamic>> doctorQuestionnaireRequests(String patientId) async =>
      _asMap(await _send('GET', '/doctor/patients/$patientId/questionnaire-requests'));
  Future<Map<String, dynamic>> createDoctorQuestionnaireRequest(String patientId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/doctor/patients/$patientId/questionnaire-requests', body: body));
  Future<Map<String, dynamic>> patientQuestionnaireRequests() async =>
      _asMap(await _send('GET', '/patient/questionnaire-requests'));
  Future<Map<String, dynamic>> submitPatientQuestionnaireRequest(String requestId, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/patient/questionnaire-requests/$requestId/responses', body: body));
  Future<Map<String, dynamic>> patientQuestionnaireStatus() async =>
      _asMap(await _send('GET', '/patient/questionnaires/status'));
  Future<Map<String, dynamic>> patientDueQuestionnaires() async =>
      _asMap(await _send('GET', '/patient/questionnaires/due'));
  Future<Map<String, dynamic>> submitPatientQuestionnaire(String code, Map<String, dynamic> body) async =>
      _asMap(await _send('POST', '/patient/questionnaires/$code/responses', body: body));
  Future<Map<String, dynamic>> confirmPatientQuestionnaireNoChanges(
    String code, {
    required int expectedLatestSequence,
    required String expectedQuestionnaireVersionId,
  }) async => _asMap(await _send('POST', '/patient/questionnaires/$code/confirm-no-changes', body: {
    'expectedLatestSequence': expectedLatestSequence,
    'expectedQuestionnaireVersionId': expectedQuestionnaireVersionId,
  }));

  Future<Map<String, dynamic>> patientObservationCatalog() async =>
      _asMap(await _send('GET', '/patient/observations/catalog'));
  Future<Map<String, dynamic>> patientObservationStats(
    String code, {
    String? from,
    String? to,
  }) async => _asMap(await _send('GET', '/patient/observations/stats', query: {
    'code': code,
    if (from != null) 'from': from,
    if (to != null) 'to': to,
  }));
  Future<Map<String, dynamic>> patientObservationHistory(
    String code, {
    String? from,
    String? to,
    int limit = 100,
  }) async => _asMap(await _send('GET', '/patient/observations/history', query: {
    'code': code,
    if (from != null) 'from': from,
    if (to != null) 'to': to,
    'limit': limit.toString(),
  }));
  Future<Map<String, dynamic>> patientObservationContext(String observationId) async =>
      _asMap(await _send('GET', '/patient/observations/$observationId/context'));
  Future<Map<String, dynamic>> updatePatientObservationContext(
    String observationId, {
    required int expectedSequence,
    String? context,
    String? note,
  }) async => _asMap(await _send('PATCH', '/patient/observations/$observationId/context', body: {
    'expectedSequence': expectedSequence,
    'context': context,
    'note': note,
  }));
  Future<Map<String, dynamic>> patientObservationCorrections(String observationId) async =>
      _asMap(await _send('GET', '/patient/observations/$observationId/corrections'));
  Future<Map<String, dynamic>> correctPatientObservation(
    String observationId, {
    required int expectedSequence,
    required num value,
    required String unitCode,
    required String reason,
  }) async => _asMap(await _send('POST', '/patient/observations/$observationId/corrections', body: {
    'expectedSequence': expectedSequence,
    'value': value,
    'unitCode': unitCode,
    'reason': reason,
  }));

  Future<Map<String, dynamic>> patientClinicalProfileEntries({String? kind}) async =>
      _asMap(await _send('GET', '/patient/clinical-profile/entries', query: {
        if (kind?.isNotEmpty == true) 'kind': kind!,
      }));
  Future<Map<String, dynamic>> createPatientClinicalProfileEntry({
    required String kind,
    required Map<String, dynamic> data,
    String status = 'ACTIVE',
  }) async => _asMap(await _send('POST', '/patient/clinical-profile/entries', body: {
    'kind': kind, 'status': status, 'data': data,
  }));
  Future<Map<String, dynamic>> updatePatientClinicalProfileEntry(
    String entryId, {
    required int expectedVersion,
    required Map<String, dynamic> data,
    String? status,
  }) async => _asMap(await _send('PATCH', '/patient/clinical-profile/entries/$entryId', body: {
    'expectedVersion': expectedVersion,
    if (status != null) 'status': status,
    'data': data,
  }));

  Future<Map<String, dynamic>> patientEmergencyCard() async =>
      _asMap(await _send('GET', '/patient/emergency-card'));
  Future<Map<String, dynamic>> patientEmergencyCardSettings() async =>
      _asMap(await _send('GET', '/patient/emergency-card/settings'));
  Future<Map<String, dynamic>> updatePatientEmergencyCardSettings({
    required int expectedVersion,
    required bool includeSevereAllergies,
    required bool includeActiveMedications,
    required bool includeActiveConditions,
    String? emergencyContactId,
  }) async => _asMap(await _send('PATCH', '/patient/emergency-card/settings', body: {
    'expectedVersion': expectedVersion,
    'includeSevereAllergies': includeSevereAllergies,
    'includeActiveMedications': includeActiveMedications,
    'includeActiveConditions': includeActiveConditions,
    'emergencyContactId': emergencyContactId,
  }));

  Future<Map<String, dynamic>> patientClinicalOrders() async => _asMap(await _send('GET', '/clinical-orders/me'));
  Future<Map<String, dynamic>> providerClinicalOrders(String patientId) async => _asMap(await _send('GET', '/clinical-orders/patients/$patientId'));
  Future<Map<String, dynamic>> doctorLabSeries(String patientId) async =>
      _asMap(await _send('GET', '/provider/patients/$patientId/lab-series'));
  Future<Map<String, dynamic>> clinicalOrder(String orderId) async => _asMap(await _send('GET', '/clinical-orders/$orderId'));
  Future<Map<String, dynamic>> createPrescription(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-orders/appointments/$appointmentId/prescriptions', body: body));
  Future<Map<String, dynamic>> createLaboratoryOrder(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-orders/appointments/$appointmentId/laboratory', body: body));
  Future<Map<String, dynamic>> cancelClinicalOrder(String orderId) async => _asMap(await _send('POST', '/clinical-orders/$orderId/cancel', body: const {}));
  Future<Map<String, dynamic>> enterLaboratoryResult(String orderId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-orders/$orderId/lab-result', body: body));
  Future<Map<String, dynamic>> validateLaboratoryResult(String orderId) async => _asMap(await _send('POST', '/clinical-orders/$orderId/lab-result/validate', body: const {}));
  Future<Map<String, dynamic>> releaseLaboratoryResult(String orderId) async => _asMap(await _send('POST', '/clinical-orders/$orderId/lab-result/release', body: const {}));

  Future<Map<String, dynamic>> patientClinicalDocuments() async => _asMap(await _send('GET', '/clinical-documents/me'));
  Future<Map<String, dynamic>> providerClinicalDocuments(String patientId) async => _asMap(await _send('GET', '/clinical-documents/patients/$patientId'));
  Future<Map<String, dynamic>> clinicalDocumentContent(String documentId) async => _asMap(await _send('GET', '/clinical-documents/$documentId/content'));
  Future<Map<String, dynamic>> uploadEncounterDocument(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-documents/appointments/$appointmentId/upload', body: body));
  Future<Map<String, dynamic>> createEncounterDocumentReference(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-documents/appointments/$appointmentId/reference', body: body));
  Future<Map<String, dynamic>> uploadPatientDocument(Map<String, dynamic> body) async => _asMap(await _send('POST', '/clinical-documents/me/upload', body: body));
  Future<Map<String, dynamic>> releaseClinicalDocument(String documentId) async => _asMap(await _send('POST', '/clinical-documents/$documentId/release', body: const {}));
  Future<Map<String, dynamic>> removeClinicalDocument(String documentId) async => _asMap(await _send('POST', '/clinical-documents/$documentId/remove', body: const {}));

  Future<Map<String, dynamic>> patientDiagnosticReports() async => _asMap(await _send('GET', '/diagnostic-reports/me'));
  Future<Map<String, dynamic>> providerDiagnosticReports(String patientId) async => _asMap(await _send('GET', '/diagnostic-reports/patients/$patientId'));
  Future<Map<String, dynamic>> diagnosticReport(String reportId) async => _asMap(await _send('GET', '/diagnostic-reports/$reportId'));
  Future<Map<String, dynamic>> createDiagnosticReport(String appointmentId, Map<String, dynamic> body) async => _asMap(await _send('POST', '/diagnostic-reports/appointments/$appointmentId', body: body));
  Future<Map<String, dynamic>> finalizeDiagnosticReport(String reportId) async => _asMap(await _send('POST', '/diagnostic-reports/$reportId/finalize', body: const {}));
  Future<Map<String, dynamic>> releaseDiagnosticReport(String reportId) async => _asMap(await _send('POST', '/diagnostic-reports/$reportId/release', body: const {}));

  Future<Map<String, dynamic>> providerEmergencyAccess() async =>
      _asMap(await _send('GET', '/provider/emergency-access'));
  Future<Map<String, dynamic>> createEmergencyAccess({
    required String patientId,
    required String scope,
    required String reasonCode,
    required int ttlMinutes,
    required String idempotencyKey,
  }) async => _asMap(await _send('POST', '/provider/emergency-access', body: {
    'patientId': patientId,
    'scope': scope,
    'reasonCode': reasonCode,
    'ttlMinutes': ttlMinutes,
    'idempotencyKey': idempotencyKey,
  }));
  Future<Map<String, dynamic>> revokeEmergencyAccess(String grantId) async =>
      _asMap(await _send('POST', '/provider/emergency-access/' + grantId + '/revoke', body: const {}));
  Future<Map<String, dynamic>> emergencyClinicalProfile(String grantId) async =>
      _asMap(await _send('GET', '/provider/emergency-access/' + grantId + '/clinical-profile'));

  Future<void> logout() async {
    accessToken = null;
    refreshToken = null;
    await _tokenStore.clear();
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
      await _captureTokens(_asMap(result));
      return true;
    } catch (_) {
      accessToken = null;
      refreshToken = null;
      await _tokenStore.clear();
      return false;
    }
  }

  Future<void> _captureTokens(Map<String, dynamic> value) async {
    final access = value['accessToken']?.toString();
    final refresh = value['refreshToken']?.toString();
    if (access == null || access.isEmpty || refresh == null || refresh.isEmpty) throw const CarePointApiException('Authentication response did not contain session tokens.');
    await _tokenStore.writeTokens(accessToken: access, refreshToken: refresh);
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
