import 'dart:async';

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

String patientMedicalTransportEquipmentText(CarePointLocale locale, dynamic raw) {
  final values = raw is List ? raw.map((value) => value.toString()).toList(growable: false) : const <String>[];
  if (values.isEmpty) return transportText(locale, 'none');
  return values.map((value) => switch (value) {
    'OXYGEN' => transportText(locale, 'oxygen'),
    'MONITORING' => transportText(locale, 'monitoring'),
    'VENTILATION' => transportText(locale, 'ventilation'),
    _ => value,
  }).join(', ');
}

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
  Map<String, dynamic> tracking = <String, dynamic>{};
  Map<String, dynamic> timeline = <String, dynamic>{};
  bool busy = true;
  bool liveRefreshInFlight = false;
  String? error;
  Timer? fallbackTimer;
  StreamSubscription<Map<String, dynamic>>? trackingSubscription;
  StreamSubscription<Map<String, dynamic>>? milestoneSubscription;
  StreamSubscription<Map<String, dynamic>>? lifecycleSubscription;

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
      refresh().then((_) => _startRealtimeDelivery());
    }
  }

  @override
  void dispose() {
    fallbackTimer?.cancel();
    trackingSubscription?.cancel();
    milestoneSubscription?.cancel();
    lifecycleSubscription?.cancel();
    super.dispose();
  }

  Future<void> refresh({bool silent = false}) async {
    if (widget.session.account['role'] != 'PATIENT' || requestId.isEmpty) return;
    if (!silent && mounted) setState(() { busy = true; error = null; });
    try {
      final next = await widget.session.api.medicalTransportRequest(requestId).timeout(const Duration(seconds: 30));
      Map<String, dynamic> nextTracking = <String, dynamic>{};
      Map<String, dynamic> nextTimeline = <String, dynamic>{};
      try {
        nextTracking = await widget.session.api.medicalTransportTracking(requestId).timeout(const Duration(seconds: 20));
      } catch (_) {
        // Transport status remains usable even when the optional tracking
        // surface is temporarily unavailable.
      }
      try {
        nextTimeline = await widget.session.api.medicalTransportTimeline(requestId).timeout(const Duration(seconds: 20));
      } catch (_) {
        // The authoritative request response remains usable if the extended
        // Phase 9 timeline is temporarily unavailable.
      }
      if (mounted) setState(() {
        value = next;
        tracking = nextTracking;
        timeline = nextTimeline;
        if (silent) error = null;
      });
    } catch (_) {
      if (!silent && mounted) setState(() {
        value = null;
        error = patientMedicalTransportText(widget.locale, 'loadFailed');
      });
    } finally {
      if (!silent && mounted) setState(() => busy = false);
    }
  }

  void _startRealtimeDelivery() {
    if (!mounted || requestId.isEmpty) return;
    fallbackTimer?.cancel();
    trackingSubscription?.cancel();
    milestoneSubscription?.cancel();
    lifecycleSubscription?.cancel();

    final replayFrom = DateTime.now().subtract(const Duration(seconds: 5));
    trackingSubscription = widget.session.api.transportRealtimeEvents(
      requestId,
      topic: 'TRANSPORT_TRACKING',
      after: replayFrom,
    ).listen((_) => _refreshFromRealtime(), onError: (_) {});
    milestoneSubscription = widget.session.api.transportRealtimeEvents(
      requestId,
      topic: 'TRANSPORT_MILESTONES',
      after: replayFrom,
    ).listen((_) => _refreshFromRealtime(), onError: (_) {});
    lifecycleSubscription = widget.session.api.transportRealtimeEvents(
      requestId,
      topic: 'TRANSPORT_LIFECYCLE',
      after: replayFrom,
    ).listen((_) => _refreshFromRealtime(), onError: (_) {});
    fallbackTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => _refreshFromRealtime(),
    );
  }

  Future<void> _refreshFromRealtime() async {
    if (!mounted || liveRefreshInFlight) return;
    liveRefreshInFlight = true;
    try {
      await refresh(silent: true);
    } finally {
      liveRefreshInFlight = false;
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
    final tripTimeline = _list(timeline['items']);
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
                            _detail(transportText(widget.locale, 'companions'), '${request['companionCount'] ?? 0}'),
                            _detail(transportText(widget.locale, 'equipment'), patientMedicalTransportEquipmentText(widget.locale, request['equipment'])),
                            _detail(transportText(widget.locale, 'pickup'), _location(request, pickup: true)),
                            _detail(transportText(widget.locale, 'destination'), _location(request, pickup: false)),
                            if (provider['displayName'] != null) _detail(patientMedicalTransportText(widget.locale, 'provider'), provider['displayName'].toString()),
                            if (request['etaMinutes'] != null) _detail(transportText(widget.locale, 'eta'), '${request['etaMinutes']} ${transportText(widget.locale, 'minutes')}'),
                            if (const {'EN_ROUTE', 'ARRIVED', 'TRANSPORTING'}.contains(status) || tracking['visible'] == true)
                              _vehicleTrackingCard(),
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
                            if (tripTimeline.isNotEmpty) ...[
                              const SizedBox(height: 24),
                              Text(
                                patientMedicalTransportText(widget.locale, 'tripTimeline'),
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                              ),
                              ...tripTimeline.map((event) => _timelineTile(event)),
                            ] else if (history.isNotEmpty) ...[
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


  Widget _timelineTile(Map<String, dynamic> event) {
    final kind = event['kind']?.toString() ?? '';
    final code = event['code']?.toString() ?? '';
    final detected = kind == 'MILESTONE';
    final distance = event['distanceMeters'];
    final authority = event['authority']?.toString() ?? '';
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        detected ? Icons.assistant_navigation : Icons.radio_button_checked,
        size: 19,
      ),
      title: Text(
        detected
            ? patientMedicalTransportText(widget.locale, 'milestone.$code')
            : patientMedicalTransportStatusText(widget.locale, code),
      ),
      subtitle: Text([
        patientMedicalTransportDateTime(event['occurredAt']),
        if (distance != null)
          '${patientMedicalTransportText(widget.locale, 'distance')}: $distance m',
        if (authority == 'AUTOMATED_DETECTION')
          patientMedicalTransportText(widget.locale, 'detectedNotStatus'),
      ].join(' · ')),
    );
  }

  Widget _vehicleTrackingCard() {
    final visible = tracking['visible'] == true;
    final freshness = tracking['freshness']?.toString();
    final visibilityStatus = tracking['visibilityStatus']?.toString() ?? '';
    final location = _map(tracking['location']);
    final latitude = location['latitude'];
    final longitude = location['longitude'];
    final capturedAt = location['capturedAt'];
    final title = transportText(widget.locale, 'vehicleTracking');
    final statusText = visible
        ? freshness == 'FRESH'
            ? transportText(widget.locale, 'trackingFresh')
            : transportText(widget.locale, 'trackingStale')
        : visibilityStatus == 'WAITING_FOR_HEARTBEAT'
            ? transportText(widget.locale, 'trackingWaiting')
            : transportText(widget.locale, 'trackingStopped');
    return Container(
      key: const ValueKey('patient-vehicle-tracking'),
      margin: const EdgeInsets.only(top: 8, bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.local_shipping_outlined),
          const SizedBox(width: 8),
          Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w900))),
        ]),
        const SizedBox(height: 8),
        Text(statusText),
        if (visible && latitude != null && longitude != null) ...[
          const SizedBox(height: 6),
          Text('$latitude, $longitude', style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
        if (visible && capturedAt != null) ...[
          const SizedBox(height: 4),
          Text('${transportText(widget.locale, 'locationUpdated')}: ${patientMedicalTransportDateTime(capturedAt)}'),
        ],
        const SizedBox(height: 8),
        Text(
          transportText(widget.locale, 'etaSeparateNotice'),
          style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
        ),
      ]),
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
    'detailTitle': 'Medical transport details', 'tracking': 'Medical transport status', 'history': 'Status history', 'tripTimeline': 'Trip timeline', 'distance': 'Distance', 'detectedNotStatus': 'Detected automatically — does not change transport status', 'provider': 'Transport provider',
    'milestone.TRACKING_STARTED': 'Location sharing started', 'milestone.FIRST_POSITION_RECEIVED': 'First vehicle position received', 'milestone.NEAR_PICKUP': 'Vehicle is near pickup', 'milestone.PICKUP_ARRIVAL_DETECTED': 'Vehicle arrival at pickup detected', 'milestone.NEAR_DESTINATION': 'Vehicle is near destination', 'milestone.DESTINATION_ARRIVAL_DETECTED': 'Vehicle arrival at destination detected', 'milestone.TRACKING_STOPPED': 'Location sharing stopped',
    'cancellationReason': 'Cancellation reason', 'retry': 'Retry', 'loadFailed': 'This transport request is not available. Refresh and try again.',
    'changeFailed': 'The transport request changed. Refresh before trying again.', 'denied': 'Medical transport details are available only to the Patient app.',
    'status.REQUESTED': 'Requested', 'status.ASSIGNED': 'Assigned', 'status.EN_ROUTE': 'En route', 'status.ARRIVED': 'Arrived',
    'status.TRANSPORTING': 'Transporting', 'status.COMPLETED': 'Completed', 'status.CANCELLED': 'Cancelled',
  },
  'ar': {
    'detailTitle': 'تفاصيل النقل الطبي', 'tracking': 'حالة النقل الطبي', 'history': 'سجل الحالة', 'tripTimeline': 'الخط الزمني للرحلة', 'distance': 'المسافة', 'detectedNotStatus': 'تم الاكتشاف تلقائياً — لا يغيّر حالة النقل', 'provider': 'مقدم خدمة النقل',
    'milestone.TRACKING_STARTED': 'بدأت مشاركة الموقع', 'milestone.FIRST_POSITION_RECEIVED': 'تم استلام أول موقع للمركبة', 'milestone.NEAR_PICKUP': 'المركبة قريبة من نقطة الاستلام', 'milestone.PICKUP_ARRIVAL_DETECTED': 'تم اكتشاف وصول المركبة إلى نقطة الاستلام', 'milestone.NEAR_DESTINATION': 'المركبة قريبة من الوجهة', 'milestone.DESTINATION_ARRIVAL_DETECTED': 'تم اكتشاف وصول المركبة إلى الوجهة', 'milestone.TRACKING_STOPPED': 'توقفت مشاركة الموقع',
    'cancellationReason': 'سبب الإلغاء', 'retry': 'إعادة المحاولة', 'loadFailed': 'طلب النقل هذا غير متاح. حدّث وحاول مرة أخرى.',
    'changeFailed': 'تغيّرت حالة طلب النقل. حدّث قبل المحاولة مرة أخرى.', 'denied': 'تفاصيل النقل الطبي متاحة فقط في تطبيق المريض.',
    'status.REQUESTED': 'تم الطلب', 'status.ASSIGNED': 'تم التعيين', 'status.EN_ROUTE': 'في الطريق', 'status.ARRIVED': 'وصل',
    'status.TRANSPORTING': 'جارٍ النقل', 'status.COMPLETED': 'مكتمل', 'status.CANCELLED': 'ملغى',
  },
  'fr': {
    'detailTitle': 'Détails du transport médical', 'tracking': 'Statut du transport médical', 'history': 'Historique du statut', 'tripTimeline': 'Chronologie du trajet', 'distance': 'Distance', 'detectedNotStatus': 'Détection automatique — ne modifie pas le statut du transport', 'provider': 'Prestataire de transport',
    'milestone.TRACKING_STARTED': 'Partage de position démarré', 'milestone.FIRST_POSITION_RECEIVED': 'Première position du véhicule reçue', 'milestone.NEAR_PICKUP': 'Le véhicule est proche du point de prise en charge', 'milestone.PICKUP_ARRIVAL_DETECTED': 'Arrivée du véhicule au point de prise en charge détectée', 'milestone.NEAR_DESTINATION': 'Le véhicule est proche de la destination', 'milestone.DESTINATION_ARRIVAL_DETECTED': 'Arrivée du véhicule à destination détectée', 'milestone.TRACKING_STOPPED': 'Partage de position arrêté',
    'cancellationReason': 'Motif d’annulation', 'retry': 'Réessayer', 'loadFailed': 'Cette demande de transport n’est pas disponible. Actualisez et réessayez.',
    'changeFailed': 'La demande de transport a changé. Actualisez avant de réessayer.', 'denied': 'Les détails du transport médical sont réservés à l’application Patient.',
    'status.REQUESTED': 'Demandé', 'status.ASSIGNED': 'Attribué', 'status.EN_ROUTE': 'En route', 'status.ARRIVED': 'Arrivé',
    'status.TRANSPORTING': 'Transport en cours', 'status.COMPLETED': 'Terminé', 'status.CANCELLED': 'Annulé',
  },
  'es': {
    'detailTitle': 'Detalles del transporte médico', 'tracking': 'Estado del transporte médico', 'history': 'Historial de estado', 'tripTimeline': 'Cronología del traslado', 'distance': 'Distancia', 'detectedNotStatus': 'Detección automática — no cambia el estado del transporte', 'provider': 'Proveedor de transporte',
    'milestone.TRACKING_STARTED': 'Ubicación compartida iniciada', 'milestone.FIRST_POSITION_RECEIVED': 'Primera posición del vehículo recibida', 'milestone.NEAR_PICKUP': 'El vehículo está cerca del punto de recogida', 'milestone.PICKUP_ARRIVAL_DETECTED': 'Llegada del vehículo al punto de recogida detectada', 'milestone.NEAR_DESTINATION': 'El vehículo está cerca del destino', 'milestone.DESTINATION_ARRIVAL_DETECTED': 'Llegada del vehículo al destino detectada', 'milestone.TRACKING_STOPPED': 'Ubicación compartida detenida',
    'cancellationReason': 'Motivo de cancelación', 'retry': 'Reintentar', 'loadFailed': 'Esta solicitud de transporte no está disponible. Actualiza e inténtalo de nuevo.',
    'changeFailed': 'La solicitud de transporte ha cambiado. Actualiza antes de volver a intentarlo.', 'denied': 'Los detalles del transporte médico solo están disponibles en la aplicación del paciente.',
    'status.REQUESTED': 'Solicitado', 'status.ASSIGNED': 'Asignado', 'status.EN_ROUTE': 'En camino', 'status.ARRIVED': 'Ha llegado',
    'status.TRANSPORTING': 'En traslado', 'status.COMPLETED': 'Completado', 'status.CANCELLED': 'Cancelado',
  },
};