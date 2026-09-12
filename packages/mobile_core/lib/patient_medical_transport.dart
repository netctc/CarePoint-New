import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'transport_localization.dart';

const patientMedicalTransportCancellableStatuses = <String>{'REQUESTED', 'ASSIGNED'};

bool patientMedicalTransportCanCancel(dynamic status) =>
    patientMedicalTransportCancellableStatuses.contains(status?.toString());

String patientMedicalTransportText(CarePointLocale locale, String key) =>
    _patientMedicalTransportCopy[locale.name]?[key] ??
    _patientMedicalTransportCopy['en']?[key] ??
    key;

String patientMedicalTransportStatusText(CarePointLocale locale, dynamic rawStatus) {
  final status = rawStatus?.toString() ?? '';
  return patientMedicalTransportText(locale, 'status.$status');
}

String patientMedicalTransportAssistanceText(CarePointLocale locale, dynamic raw) => switch (raw?.toString()) {
      'WHEELCHAIR' => transportText(locale, 'wheelchair'),
      'STRETCHER' => transportText(locale, 'stretcher'),
      _ => transportText(locale, 'standard'),
    };

String patientMedicalTransportModeText(CarePointLocale locale, dynamic raw) =>
    raw?.toString() == 'AIR' ? transportText(locale, 'air') : transportText(locale, 'ground');

String patientMedicalTransportDateTime(dynamic raw) {
  final parsed = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(parsed.day)}/${two(parsed.month)}/${parsed.year.toString().padLeft(4, '0')} ${two(parsed.hour)}:${two(parsed.minute)}';
}

class PatientMedicalTransportStatusPage extends StatefulWidget {
  const PatientMedicalTransportStatusPage({
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
  State<PatientMedicalTransportStatusPage> createState() => _PatientMedicalTransportStatusPageState();
}

class _PatientMedicalTransportStatusPageState extends State<PatientMedicalTransportStatusPage> {
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
      error = patientMedicalTransportText(widget.locale, 'denied');
    } else if (requestId.isEmpty) {
      busy = false;
      value = null;
      error = patientMedicalTransportText(widget.locale, 'loadFailed');
    } else {
      refresh();
    }
  }

  Future<void> refresh() async {
    if (widget.session.account['role'] != 'PATIENT' || requestId.isEmpty) return;
    if (mounted) setState(() { busy = true; error = null; });
    try {
      // List/notification data is never authorization. This endpoint derives
      // the Patient from the authenticated principal and rejects other owners.
      final next = await widget.session.api.medicalTransportRequest(requestId).timeout(const Duration(seconds: 30));
      if (mounted) setState(() => value = next);
    } catch (_) {
      if (mounted) setState(() {
        value = null;
        error = patientMedicalTransportText(widget.locale, 'loadFailed');
      });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> cancel() async {
    if (!patientMedicalTransportCanCancel(request['status']) || requestId.isEmpty || busy) return;
    setState(() => busy = true);
    try {
      final next = await widget.session.api.cancelMedicalTransport(
        requestId,
        reason: 'Cancelled by Patient from mobile app',
      ).timeout(const Duration(seconds: 30));
      if (mounted) setState(() { value = next; error = null; });
    } catch (_) {
      if (mounted) setState(() => error = patientMedicalTransportText(widget.locale, 'changeFailed'));
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
        appBar: AppBar(title: Text(patientMedicalTransportText(widget.locale, 'detailTitle'))),
        body: !roleAllowed
            ? Center(child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(patientMedicalTransportText(widget.locale, 'denied'), textAlign: TextAlign.center),
              ))
            : value == null && busy
                ? const Center(child: CircularProgressIndicator())
                : value == null
                    ? Center(child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.warning_amber_outlined, size: 42),
                          const SizedBox(height: 10),
                          Text(error ?? patientMedicalTransportText(widget.locale, 'loadFailed'), textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton.icon(onPressed: refresh, icon: const Icon(Icons.refresh), label: Text(patientMedicalTransportText(widget.locale, 'retry'))),
                        ]),
                      ))
                    : RefreshIndicator(
                        onRefresh: refresh,
                        child: ListView(
                          padding: const EdgeInsets.all(20),
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: [
                            Center(child: CircleAvatar(
                              radius: 34,
                              backgroundColor: const Color(0xFFE0F2FE),
                              child: Icon(request['mode'] == 'AIR' ? Icons.flight_outlined : Icons.local_shipping_outlined, size: 34),
                            )),
                            const SizedBox(height: 14),
                            Text(patientMedicalTransportText(widget.locale, 'tracking'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
                            const SizedBox(height: 8),
                            Center(child: Semantics(
                              liveRegion: true,
                              label: '${transportText(widget.locale, 'status')}: ${patientMedicalTransportStatusText(widget.locale, status)}',
                              child: Chip(label: Text(patientMedicalTransportStatusText(widget.locale, status), style: const TextStyle(fontWeight: FontWeight.w800))),
                            )),
                            const SizedBox(height: 16),
                            _detail(transportText(widget.locale, 'scheduledFor'), patientMedicalTransportDateTime(request['scheduledFor'])),
                            _detail(transportText(widget.locale, 'mode'), patientMedicalTransportModeText(widget.locale, request['mode'])),
                            _detail(transportText(widget.locale, 'assistance'), patientMedicalTransportAssistanceText(widget.locale, request['assistance'])),
                            _detail(transportText(widget.locale, 'pickup'), _location(request, pickup: true)),
                            _detail(transportText(widget.locale, 'destination'), _location(request, pickup: false)),
                            if (provider['displayName'] != null) _detail(patientMedicalTransportText(widget.locale, 'provider'), provider['displayName'].toString()),
                            if (request['etaMinutes'] != null) _detail(transportText(widget.locale, 'eta'), '${request['etaMinutes']} ${transportText(widget.locale, 'minutes')}'),
                            if (request['cancellationReason']?.toString().trim().isNotEmpty == true)
                              _detail(patientMedicalTransportText(widget.locale, 'cancellationReason'), request['cancellationReason'].toString()),
                            if (error != null) Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Semantics(liveRegion: true, child: Text(error!, textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.error))),
                            ),
                            const SizedBox(height: 16),
                            FilledButton.icon(
                              onPressed: busy ? null : refresh,
                              icon: const Icon(Icons.refresh_rounded),
                              label: Text(transportText(widget.locale, 'refresh')),
                            ),
                            if (patientMedicalTransportCanCancel(status)) ...[
                              const SizedBox(height: 8),
                              OutlinedButton.icon(
                                key: const ValueKey('patient-medical-transport-cancel'),
                                onPressed: busy ? null : cancel,
                                icon: const Icon(Icons.cancel_outlined),
                                label: Text(transportText(widget.locale, 'cancel')),
                              ),
                            ],
                            if (history.isNotEmpty) ...[
                              const SizedBox(height: 24),
                              Text(patientMedicalTransportText(widget.locale, 'history'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                              ...history.map((event) => ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: const Icon(Icons.radio_button_checked, size: 18),
                                title: Text(patientMedicalTransportStatusText(widget.locale, event['toStatus'])),
                                subtitle: Text([
                                  patientMedicalTransportDateTime(event['occurredAt']),
                                  if (event['etaMinutes'] != null) '${transportText(widget.locale, 'eta')}: ${event['etaMinutes']} ${transportText(widget.locale, 'minutes')}',
                                ].join(' · ')),
                              )),
                            ],
                          ],
                        ),
                      ),
      ),
    );
  }

  Widget _detail(String label, String content) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 126, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF475569)))),
          Expanded(child: Text(content)),
        ]),
      );

  String _location(Map<String, dynamic> row, {required bool pickup}) {
    final address = row[pickup ? 'pickupAddress' : 'destinationAddress']?.toString().trim() ?? '';
    if (address.isNotEmpty) return address;
    final latitude = row[pickup ? 'pickupLatitude' : 'destinationLatitude'];
    final longitude = row[pickup ? 'pickupLongitude' : 'destinationLongitude'];
    if (latitude == null || longitude == null) return '—';
    return '$latitude, $longitude';
  }
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

const Map<String, Map<String, String>> _patientMedicalTransportCopy = {
  'en': {
    'detailTitle': 'Medical transport details', 'tracking': 'Medical transport status', 'history': 'Status history', 'provider': 'Transport provider',
    'cancellationReason': 'Cancellation reason', 'retry': 'Retry', 'loadFailed': 'This transport request is not available. Refresh and try again.',
    'changeFailed': 'The transport request changed. Refresh before trying again.', 'denied': 'Medical transport details are available only to the Patient app.',
    'status.REQUESTED': 'Requested', 'status.ASSIGNED': 'Assigned', 'status.EN_ROUTE': 'En route', 'status.ARRIVED': 'Arrived',
    'status.TRANSPORTING': 'Transporting', 'status.COMPLETED': 'Completed', 'status.CANCELLED': 'Cancelled',
  },
  'ar': {
    'detailTitle': 'تفاصيل النقل الطبي', 'tracking': 'حالة النقل الطبي', 'history': 'سجل الحالة', 'provider': 'مقدم خدمة النقل',
    'cancellationReason': 'سبب الإلغاء', 'retry': 'إعادة المحاولة', 'loadFailed': 'طلب النقل هذا غير متاح. حدّث وحاول مرة أخرى.',
    'changeFailed': 'تغيّرت حالة طلب النقل. حدّث قبل المحاولة مرة أخرى.', 'denied': 'تفاصيل النقل الطبي متاحة فقط في تطبيق المريض.',
    'status.REQUESTED': 'تم الطلب', 'status.ASSIGNED': 'تم التعيين', 'status.EN_ROUTE': 'في الطريق', 'status.ARRIVED': 'وصل',
    'status.TRANSPORTING': 'جارٍ النقل', 'status.COMPLETED': 'مكتمل', 'status.CANCELLED': 'ملغى',
  },
  'fr': {
    'detailTitle': 'Détails du transport médical', 'tracking': 'Statut du transport médical', 'history': 'Historique du statut', 'provider': 'Prestataire de transport',
    'cancellationReason': 'Motif d’annulation', 'retry': 'Réessayer', 'loadFailed': 'Cette demande de transport n’est pas disponible. Actualisez et réessayez.',
    'changeFailed': 'La demande de transport a changé. Actualisez avant de réessayer.', 'denied': 'Les détails du transport médical sont réservés à l’application Patient.',
    'status.REQUESTED': 'Demandé', 'status.ASSIGNED': 'Attribué', 'status.EN_ROUTE': 'En route', 'status.ARRIVED': 'Arrivé',
    'status.TRANSPORTING': 'Transport en cours', 'status.COMPLETED': 'Terminé', 'status.CANCELLED': 'Annulé',
  },
  'es': {
    'detailTitle': 'Detalles del transporte médico', 'tracking': 'Estado del transporte médico', 'history': 'Historial de estado', 'provider': 'Proveedor de transporte',
    'cancellationReason': 'Motivo de cancelación', 'retry': 'Reintentar', 'loadFailed': 'Esta solicitud de transporte no está disponible. Actualiza e inténtalo de nuevo.',
    'changeFailed': 'La solicitud de transporte ha cambiado. Actualiza antes de volver a intentarlo.', 'denied': 'Los detalles del transporte médico solo están disponibles en la aplicación del paciente.',
    'status.REQUESTED': 'Solicitado', 'status.ASSIGNED': 'Asignado', 'status.EN_ROUTE': 'En camino', 'status.ARRIVED': 'Ha llegado',
    'status.TRANSPORTING': 'En traslado', 'status.COMPLETED': 'Completado', 'status.CANCELLED': 'Cancelado',
  },
};