import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'transport_localization.dart';

const patientEmergencyActiveStatuses = <String>{
  'REQUESTED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'TRANSPORTING',
};

const patientEmergencyCancellableStatuses = <String>{
  'REQUESTED',
  'DISPATCHING',
  'ASSIGNED',
};

bool patientEmergencyIsActive(dynamic status) => patientEmergencyActiveStatuses.contains(status?.toString());

Map<String, dynamic>? patientNewestActiveEmergency(List<Map<String, dynamic>> rows) {
  final active = rows.where((row) => patientEmergencyIsActive(row['status'])).toList(growable: false);
  if (active.isEmpty) return null;
  final sorted = [...active];
  sorted.sort((a, b) {
    final left = DateTime.tryParse(a['requestedAt']?.toString() ?? '');
    final right = DateTime.tryParse(b['requestedAt']?.toString() ?? '');
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return right.compareTo(left);
  });
  return sorted.first;
}

String patientEmergencyText(CarePointLocale locale, String key) =>
    _patientEmergencyCopy[locale.name]?[key] ?? _patientEmergencyCopy['en']?[key] ?? key;

String patientEmergencyStatusText(CarePointLocale locale, dynamic rawStatus) {
  final status = rawStatus?.toString() ?? '';
  return patientEmergencyText(locale, 'status.$status');
}

class PatientActiveEmergencyEntryButton extends StatefulWidget {
  const PatientActiveEmergencyEntryButton({super.key, required this.session, required this.locale});

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientActiveEmergencyEntryButton> createState() => _PatientActiveEmergencyEntryButtonState();
}

class _PatientActiveEmergencyEntryButtonState extends State<PatientActiveEmergencyEntryButton> {
  Map<String, dynamic>? active;
  bool loading = true;
  bool opening = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PatientActiveEmergencyEntryButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) _load();
  }

  Future<void> _load() async {
    if (widget.session.account['role'] != 'PATIENT') {
      if (mounted) setState(() { active = null; loading = false; });
      return;
    }
    try {
      final rows = await widget.session.api.emergencyAmbulanceRequests().timeout(const Duration(seconds: 30));
      if (mounted) setState(() { active = patientNewestActiveEmergency(rows); loading = false; });
    } catch (_) {
      // Continuity is additive. Failure to recover an active request must never
      // remove or disable the separate emergency-request action on Patient Home.
      if (mounted) setState(() { active = null; loading = false; });
    }
  }

  Future<void> _open() async {
    final id = active?['id']?.toString() ?? '';
    if (opening || id.isEmpty || widget.session.account['role'] != 'PATIENT') return;
    setState(() => opening = true);
    try {
      await Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => PatientEmergencyStatusPage(
          session: widget.session,
          locale: widget.locale,
          requestId: id,
        )),
      );
    } finally {
      if (mounted) {
        setState(() => opening = false);
        await _load();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.session.account['role'] != 'PATIENT' || loading || active == null) return const SizedBox.shrink();
    final status = patientEmergencyStatusText(widget.locale, active!['status']);
    final eta = active!['etaMinutes'];
    final suffix = eta == null ? status : '$status · ${transportText(widget.locale, 'eta')}: $eta ${transportText(widget.locale, 'minutes')}';
    return FilledButton.icon(
      key: const ValueKey('patient-active-emergency-entry'),
      style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE11D48), foregroundColor: Colors.white),
      onPressed: opening ? null : _open,
      icon: opening
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
          : const Icon(Icons.emergency_share_outlined),
      label: Text('${patientEmergencyText(widget.locale, 'resume')} · $suffix'),
    );
  }
}

class PatientEmergencyStatusPage extends StatefulWidget {
  const PatientEmergencyStatusPage({
    super.key,
    required this.session,
    required this.locale,
    required this.requestId,
    this.initial,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String requestId;
  final Map<String, dynamic>? initial;

  @override
  State<PatientEmergencyStatusPage> createState() => _PatientEmergencyStatusPageState();
}

class _PatientEmergencyStatusPageState extends State<PatientEmergencyStatusPage> {
  Map<String, dynamic>? value;
  bool busy = true;
  String? error;

  Map<String, dynamic> get request => _map(value?['request']);
  String get requestId => widget.requestId.trim();

  @override
  void initState() {
    super.initState();
    value = widget.initial;
    if (widget.session.account['role'] != 'PATIENT') {
      busy = false;
      error = patientEmergencyText(widget.locale, 'denied');
    } else {
      refresh();
    }
  }

  Future<void> refresh() async {
    if (widget.session.account['role'] != 'PATIENT' || requestId.isEmpty) return;
    if (mounted) setState(() { busy = true; error = null; });
    try {
      // Every recovery/notification path re-authorizes through the owned-detail
      // endpoint before relying on request data shown to the Patient.
      final next = await widget.session.api.emergencyAmbulanceRequest(requestId).timeout(const Duration(seconds: 30));
      if (mounted) setState(() => value = next);
    } catch (_) {
      if (mounted) setState(() {
        value = null;
        error = patientEmergencyText(widget.locale, 'loadFailed');
      });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> cancel() async {
    final status = request['status']?.toString() ?? '';
    if (!patientEmergencyCancellableStatuses.contains(status) || requestId.isEmpty || busy) return;
    setState(() => busy = true);
    try {
      final next = await widget.session.api.cancelEmergencyAmbulance(
        requestId,
        reason: 'Cancelled by Patient from mobile app',
      ).timeout(const Duration(seconds: 30));
      if (mounted) setState(() { value = next; error = null; });
    } catch (_) {
      if (mounted) setState(() => error = patientEmergencyText(widget.locale, 'changeFailed'));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final roleAllowed = widget.session.account['role'] == 'PATIENT';
    final status = request['status']?.toString() ?? '';
    final provider = _map(request['assignedProvider']);
    final history = _list(value?['history']);
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        appBar: AppBar(title: Text(transportText(widget.locale, 'emergency'))),
        body: !roleAllowed
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(patientEmergencyText(widget.locale, 'denied'), textAlign: TextAlign.center)))
            : value == null && busy
                ? const Center(child: CircularProgressIndicator())
                : value == null
                    ? Center(child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.warning_amber_outlined, size: 42),
                          const SizedBox(height: 10),
                          Text(error ?? patientEmergencyText(widget.locale, 'loadFailed'), textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton.icon(onPressed: refresh, icon: const Icon(Icons.refresh), label: Text(patientEmergencyText(widget.locale, 'retry'))),
                        ]),
                      ))
                    : RefreshIndicator(
                        onRefresh: refresh,
                        child: ListView(
                          padding: const EdgeInsets.all(20),
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: [
                            const Center(child: CircleAvatar(radius: 36, backgroundColor: Color(0xFFE11D48), child: Icon(Icons.emergency_share_outlined, size: 38, color: Colors.white))),
                            const SizedBox(height: 16),
                            Text(patientEmergencyText(widget.locale, 'tracking'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
                            const SizedBox(height: 8),
                            Center(child: Semantics(
                              liveRegion: true,
                              label: '${transportText(widget.locale, 'status')}: ${patientEmergencyStatusText(widget.locale, status)}',
                              child: Chip(label: Text(patientEmergencyStatusText(widget.locale, status), style: const TextStyle(fontWeight: FontWeight.w800))),
                            )),
                            if (request['requestedAt'] != null) Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text('${patientEmergencyText(widget.locale, 'requestedAt')}: ${patientEmergencyDateTime(request['requestedAt'])}', textAlign: TextAlign.center),
                            ),
                            if (request['etaMinutes'] != null) Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text('${transportText(widget.locale, 'eta')}: ${request['etaMinutes']} ${transportText(widget.locale, 'minutes')}', textAlign: TextAlign.center),
                            ),
                            if (provider['displayName'] != null) Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(provider['displayName'].toString(), textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
                            ),
                            if (error != null) Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Semantics(liveRegion: true, child: Text(error!, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                            ),
                            const SizedBox(height: 20),
                            FilledButton.icon(onPressed: busy ? null : refresh, icon: const Icon(Icons.refresh_rounded), label: Text(transportText(widget.locale, 'refresh'))),
                            if (patientEmergencyCancellableStatuses.contains(status)) ...[
                              const SizedBox(height: 8),
                              OutlinedButton.icon(onPressed: busy ? null : cancel, icon: const Icon(Icons.cancel_outlined), label: Text(transportText(widget.locale, 'cancel'))),
                            ],
                            if (history.isNotEmpty) ...[
                              const SizedBox(height: 24),
                              Text(patientEmergencyText(widget.locale, 'history'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                              ...history.map((event) => ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: const Icon(Icons.radio_button_checked, size: 18),
                                title: Text(patientEmergencyStatusText(widget.locale, event['toStatus'])),
                                subtitle: Text(patientEmergencyDateTime(event['occurredAt'])),
                              )),
                            ],
                          ],
                        ),
                      ),
      ),
    );
  }
}

String patientEmergencyDateTime(dynamic raw) {
  final parsed = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(parsed.day)}/${two(parsed.month)}/${parsed.year.toString().padLeft(4, '0')} ${two(parsed.hour)}:${two(parsed.minute)}';
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

const Map<String, Map<String, String>> _patientEmergencyCopy = {
  'en': {
    'resume': 'Resume active emergency', 'tracking': 'Emergency ambulance tracking', 'requestedAt': 'Requested', 'history': 'Status history',
    'retry': 'Retry', 'loadFailed': 'This emergency request is not available. Refresh and try again.', 'changeFailed': 'The emergency request changed. Refresh before trying again.',
    'denied': 'Emergency tracking is available only to the Patient app.',
    'status.REQUESTED': 'Requested', 'status.DISPATCHING': 'Dispatching', 'status.ASSIGNED': 'Ambulance assigned', 'status.EN_ROUTE': 'En route',
    'status.ARRIVED': 'Arrived', 'status.TRANSPORTING': 'Transporting', 'status.COMPLETED': 'Completed', 'status.CANCELLED': 'Cancelled',
  },
  'ar': {
    'resume': 'متابعة حالة الإسعاف النشطة', 'tracking': 'متابعة سيارة الإسعاف الطارئة', 'requestedAt': 'وقت الطلب', 'history': 'سجل الحالة',
    'retry': 'إعادة المحاولة', 'loadFailed': 'طلب الإسعاف هذا غير متاح. حدّث وحاول مرة أخرى.', 'changeFailed': 'تغيّرت حالة طلب الإسعاف. حدّث قبل المحاولة مرة أخرى.',
    'denied': 'متابعة الإسعاف متاحة فقط في تطبيق المريض.',
    'status.REQUESTED': 'تم الطلب', 'status.DISPATCHING': 'جارٍ التوجيه', 'status.ASSIGNED': 'تم تعيين سيارة إسعاف', 'status.EN_ROUTE': 'في الطريق',
    'status.ARRIVED': 'وصلت', 'status.TRANSPORTING': 'جارٍ النقل', 'status.COMPLETED': 'مكتمل', 'status.CANCELLED': 'ملغى',
  },
  'fr': {
    'resume': 'Reprendre le suivi d’urgence', 'tracking': 'Suivi de l’ambulance d’urgence', 'requestedAt': 'Demandée le', 'history': 'Historique du statut',
    'retry': 'Réessayer', 'loadFailed': 'Cette demande d’ambulance n’est pas disponible. Actualisez et réessayez.', 'changeFailed': 'La demande d’urgence a changé. Actualisez avant de réessayer.',
    'denied': 'Le suivi d’urgence est réservé à l’application Patient.',
    'status.REQUESTED': 'Demandée', 'status.DISPATCHING': 'En cours de dispatch', 'status.ASSIGNED': 'Ambulance attribuée', 'status.EN_ROUTE': 'En route',
    'status.ARRIVED': 'Arrivée', 'status.TRANSPORTING': 'Transport en cours', 'status.COMPLETED': 'Terminée', 'status.CANCELLED': 'Annulée',
  },
  'es': {
    'resume': 'Retomar emergencia activa', 'tracking': 'Seguimiento de ambulancia de emergencia', 'requestedAt': 'Solicitada', 'history': 'Historial de estado',
    'retry': 'Reintentar', 'loadFailed': 'Esta solicitud de ambulancia no está disponible. Actualiza e inténtalo de nuevo.', 'changeFailed': 'La solicitud de emergencia ha cambiado. Actualiza antes de volver a intentarlo.',
    'denied': 'El seguimiento de emergencia solo está disponible en la aplicación del paciente.',
    'status.REQUESTED': 'Solicitada', 'status.DISPATCHING': 'En despacho', 'status.ASSIGNED': 'Ambulancia asignada', 'status.EN_ROUTE': 'En camino',
    'status.ARRIVED': 'Ha llegado', 'status.TRANSPORTING': 'En traslado', 'status.COMPLETED': 'Completada', 'status.CANCELLED': 'Cancelada',
  },
};