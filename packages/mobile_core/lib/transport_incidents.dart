import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

const _incidentCopy = <CarePointLocale, Map<String, String>>{
  CarePointLocale.en: {
    'action': 'Incidents & events',
    'title': 'Transport incidents',
    'newIncident': 'Report incident',
    'category': 'Classification',
    'severity': 'Severity',
    'reasonCode': 'Reason code',
    'detail': 'Operational detail (optional)',
    'occurredAt': 'Occurred now',
    'save': 'Record incident',
    'timeline': 'Incident timeline',
    'none': 'No incidents recorded.',
    'criticalNotice': 'Critical incidents notify operations automatically.',
    'invalidReason': 'Enter a reason code using letters, numbers, dash, dot, colon or underscore.',
  },
  CarePointLocale.ar: {
    'action': 'الحوادث والأحداث',
    'title': 'حوادث النقل',
    'newIncident': 'تسجيل حادث',
    'category': 'التصنيف',
    'severity': 'الخطورة',
    'reasonCode': 'رمز السبب',
    'detail': 'تفاصيل تشغيلية (اختياري)',
    'occurredAt': 'حدث الآن',
    'save': 'حفظ الحادث',
    'timeline': 'سجل الحوادث',
    'none': 'لا توجد حوادث مسجلة.',
    'criticalNotice': 'الحوادث الحرجة ترسل إشعاراً للعمليات تلقائياً.',
    'invalidReason': 'أدخل رمز سبب صالحاً.',
  },
  CarePointLocale.fr: {
    'action': 'Incidents et événements',
    'title': 'Incidents de transport',
    'newIncident': 'Signaler un incident',
    'category': 'Classification',
    'severity': 'Gravité',
    'reasonCode': 'Code motif',
    'detail': 'Détail opérationnel (facultatif)',
    'occurredAt': 'Survenu maintenant',
    'save': 'Enregistrer l’incident',
    'timeline': 'Historique des incidents',
    'none': 'Aucun incident enregistré.',
    'criticalNotice': 'Les incidents critiques notifient automatiquement les opérations.',
    'invalidReason': 'Saisissez un code motif valide.',
  },
  CarePointLocale.es: {
    'action': 'Incidencias y eventos',
    'title': 'Incidencias de transporte',
    'newIncident': 'Registrar incidencia',
    'category': 'Clasificación',
    'severity': 'Severidad',
    'reasonCode': 'Código de motivo',
    'detail': 'Detalle operativo (opcional)',
    'occurredAt': 'Ocurrido ahora',
    'save': 'Registrar incidencia',
    'timeline': 'Timeline de incidencias',
    'none': 'No hay incidencias registradas.',
    'criticalNotice': 'Las incidencias críticas notifican automáticamente a operaciones.',
    'invalidReason': 'Introduce un código de motivo válido.',
  },
};

String transportIncidentText(CarePointLocale locale, String key) =>
    _incidentCopy[locale]?[key] ?? _incidentCopy[CarePointLocale.en]![key] ?? key;

Future<bool?> showTransportIncidentsSheet({
  required BuildContext context,
  required CarePointApi api,
  required String requestId,
  required CarePointLocale locale,
}) async {
  final history = await api.providerTransportIncidents(requestId);
  if (!context.mounted) return false;
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _TransportIncidentsSheet(api: api, requestId: requestId, locale: locale, initialHistory: history),
  );
}

class _TransportIncidentsSheet extends StatefulWidget {
  const _TransportIncidentsSheet({required this.api, required this.requestId, required this.locale, required this.initialHistory});
  final CarePointApi api;
  final String requestId;
  final CarePointLocale locale;
  final List<Map<String, dynamic>> initialHistory;

  @override
  State<_TransportIncidentsSheet> createState() => _TransportIncidentsSheetState();
}

class _TransportIncidentsSheetState extends State<_TransportIncidentsSheet> {
  static const categories = ['DELAY', 'VEHICLE_BREAKDOWN', 'PATIENT_CONDITION_CHANGE', 'REFUSAL', 'OPERATIONAL'];
  static const severities = ['INFO', 'WARNING', 'CRITICAL'];
  final reasonController = TextEditingController();
  final detailController = TextEditingController();
  late List<Map<String, dynamic>> history;
  String category = 'DELAY';
  String severity = 'WARNING';
  bool saving = false;
  String? error;

  @override
  void initState() {
    super.initState();
    history = widget.initialHistory;
  }

  @override
  void dispose() {
    reasonController.dispose();
    detailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.9,
        minChildSize: 0.6,
        maxChildSize: 0.98,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            Center(child: Container(width: 44, height: 4, decoration: BoxDecoration(color: Theme.of(context).dividerColor, borderRadius: BorderRadius.circular(8)))),
            const SizedBox(height: 18),
            Text(transportIncidentText(widget.locale, 'title'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
            const SizedBox(height: 18),
            Text(transportIncidentText(widget.locale, 'newIncident'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: category,
              decoration: InputDecoration(border: const OutlineInputBorder(), labelText: transportIncidentText(widget.locale, 'category')),
              items: categories.map((value) => DropdownMenuItem(value: value, child: Text(value.replaceAll('_', ' ')))).toList(growable: false),
              onChanged: saving ? null : (value) => setState(() => category = value ?? category),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: severity,
              decoration: InputDecoration(border: const OutlineInputBorder(), labelText: transportIncidentText(widget.locale, 'severity')),
              items: severities.map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(growable: false),
              onChanged: saving ? null : (value) => setState(() => severity = value ?? severity),
            ),
            if (severity == 'CRITICAL') ...[
              const SizedBox(height: 10),
              _notice(transportIncidentText(widget.locale, 'criticalNotice')),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              enabled: !saving,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(border: const OutlineInputBorder(), labelText: transportIncidentText(widget.locale, 'reasonCode')),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: detailController,
              enabled: !saving,
              minLines: 2,
              maxLines: 5,
              decoration: InputDecoration(border: const OutlineInputBorder(), labelText: transportIncidentText(widget.locale, 'detail')),
            ),
            if (error != null) ...[
              const SizedBox(height: 10),
              Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: saving ? null : _save,
              icon: saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.report_problem_outlined),
              label: Text(transportIncidentText(widget.locale, 'save')),
            ),
            const SizedBox(height: 24),
            Text(transportIncidentText(widget.locale, 'timeline'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            if (history.isEmpty)
              _notice(transportIncidentText(widget.locale, 'none'))
            else
              ...history.map(_incidentTile),
          ],
        ),
      );

  Widget _incidentTile(Map<String, dynamic> item) => Card(
        child: ListTile(
          leading: Icon(item['severity'] == 'CRITICAL' ? Icons.priority_high_rounded : Icons.event_note_outlined),
          title: Text('${item['category'] ?? ''} · ${item['severity'] ?? ''}'),
          subtitle: Text('${item['reasonCode'] ?? ''}\n${_displayDate(item['occurredAt']?.toString() ?? '')}'),
          isThreeLine: true,
        ),
      );

  Widget _notice(String text) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
        child: Text(text),
      );

  Future<void> _save() async {
    final reason = reasonController.text.trim().toUpperCase();
    if (!RegExp(r'^[A-Z0-9][A-Z0-9_.:-]{1,79}$').hasMatch(reason)) {
      setState(() => error = transportIncidentText(widget.locale, 'invalidReason'));
      return;
    }
    setState(() { saving = true; error = null; });
    try {
      await widget.api.recordProviderTransportIncident(
        widget.requestId,
        idempotencyKey: 'transport-incident-${widget.requestId}-${DateTime.now().microsecondsSinceEpoch}',
        category: category,
        severity: severity,
        reasonCode: reason,
        detail: detailController.text,
        occurredAt: DateTime.now(),
      );
      history = await widget.api.providerTransportIncidents(widget.requestId);
      if (mounted) {
        reasonController.clear();
        detailController.clear();
        setState(() {});
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }
}

String _displayDate(String raw) {
  final parsed = DateTime.tryParse(raw)?.toLocal();
  if (parsed == null) return raw;
  String two(int value) => value.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
