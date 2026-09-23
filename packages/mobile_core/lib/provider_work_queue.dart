import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'provider_field_route.dart';
import 'transport_workspace.dart';

String providerWorkQueueText(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'title': {'en': 'Prioritized work queue', 'ar': 'قائمة العمل ذات الأولوية', 'fr': 'File de travail priorisée', 'es': 'Cola de trabajo priorizada'},
    'subtitle': {'en': 'Operational priorities only. No clinical diagnosis or inferred risk is used.', 'ar': 'أولويات تشغيلية فقط. لا يتم استخدام التشخيص السريري أو المخاطر المستنتجة.', 'fr': 'Priorités opérationnelles uniquement. Aucun diagnostic clinique ni risque inféré.', 'es': 'Solo prioridades operativas. No se usa diagnóstico clínico ni riesgo inferido.'},
    'refresh': {'en': 'Refresh', 'ar': 'تحديث', 'fr': 'Actualiser', 'es': 'Actualizar'},
    'empty': {'en': 'No active jobs to prioritize.', 'ar': 'لا توجد مهام نشطة لترتيبها.', 'fr': 'Aucune tâche active à prioriser.', 'es': 'No hay trabajos activos para priorizar.'},
    'scheduled': {'en': 'Scheduled', 'ar': 'مجدول', 'fr': 'Planifié', 'es': 'Programado'},
    'eta': {'en': 'ETA', 'ar': 'وقت الوصول المتوقع', 'fr': 'Heure estimée', 'es': 'ETA'},
    'minutes': {'en': 'min', 'ar': 'دقيقة', 'fr': 'min', 'es': 'min'},
    'explain': {'en': 'Why this priority?', 'ar': 'لماذا هذه الأولوية؟', 'fr': 'Pourquoi cette priorité ?', 'es': '¿Por qué esta prioridad?'},
    'openTransport': {'en': 'Open transport job', 'ar': 'فتح مهمة النقل', 'fr': 'Ouvrir le transport', 'es': 'Abrir trabajo de transporte'},
    'openRoute': {'en': 'Route & ETA', 'ar': 'المسار ووقت الوصول', 'fr': 'Itinéraire et ETA', 'es': 'Ruta y ETA'},
    'weights': {'en': 'Operational criteria', 'ar': 'المعايير التشغيلية', 'fr': 'Critères opérationnels', 'es': 'Criterios operativos'},
    'SCHEDULE_TIME': {'en': 'Scheduled time', 'ar': 'وقت الجدولة', 'fr': 'Heure planifiée', 'es': 'Hora programada'},
    'DISTANCE_ETA': {'en': 'Distance / ETA', 'ar': 'المسافة / وقت الوصول', 'fr': 'Distance / ETA', 'es': 'Distancia / ETA'},
    'OPERATIONAL_URGENCY': {'en': 'Operational lifecycle', 'ar': 'دورة العمل التشغيلية', 'fr': 'Cycle opérationnel', 'es': 'Ciclo operativo'},
    'SLA': {'en': 'SLA timing', 'ar': 'توقيت مستوى الخدمة', 'fr': 'Délai SLA', 'es': 'Tiempo SLA'},
    'CAPABILITY_FIT': {'en': 'Capability fit', 'ar': 'توافق القدرة', 'fr': 'Adéquation de capacité', 'es': 'Adecuación de capacidad'},
    'MEDICAL_TRANSPORT': {'en': 'Transport', 'ar': 'نقل', 'fr': 'Transport', 'es': 'Transporte'},
    'HOME_VISIT': {'en': 'Home visit', 'ar': 'زيارة منزلية', 'fr': 'Visite à domicile', 'es': 'Visita domiciliaria'},
    'provider.workQueue.reason.capabilityFit': {'en': 'Assigned work matches this provider category.', 'ar': 'العمل المسند متوافق مع فئة مقدم الخدمة.', 'fr': 'Le travail assigné correspond à la catégorie du prestataire.', 'es': 'El trabajo asignado coincide con la categoría del proveedor.'},
    'provider.workQueue.reason.capabilityMismatchAssignedStillVisible': {'en': 'Assigned work stays visible even when the category-fit check is not met.', 'ar': 'يبقى العمل المسند ظاهراً حتى عند عدم تطابق فئة القدرة.', 'fr': 'Le travail assigné reste visible même sans correspondance de catégorie.', 'es': 'El trabajo asignado sigue visible aunque no coincida la categoría.'},
    'provider.workQueue.reason.scheduledLater': {'en': 'Scheduled later in the operational window.', 'ar': 'مجدول لاحقاً ضمن النافذة التشغيلية.', 'fr': 'Planifié plus tard dans la fenêtre opérationnelle.', 'es': 'Programado más tarde en la ventana operativa.'},
    'provider.workQueue.reason.scheduledDueOrOverdue': {'en': 'Scheduled time is due or has passed.', 'ar': 'موعد العمل مستحق أو قد مضى.', 'fr': 'L’heure planifiée est arrivée ou dépassée.', 'es': 'La hora programada ya llegó o pasó.'},
    'provider.workQueue.reason.scheduledWithin30m': {'en': 'Scheduled within 30 minutes.', 'ar': 'مجدول خلال 30 دقيقة.', 'fr': 'Planifié dans les 30 minutes.', 'es': 'Programado dentro de 30 minutos.'},
    'provider.workQueue.reason.scheduledWithin2h': {'en': 'Scheduled within 2 hours.', 'ar': 'مجدول خلال ساعتين.', 'fr': 'Planifié dans les 2 heures.', 'es': 'Programado dentro de 2 horas.'},
    'provider.workQueue.reason.scheduledWithin8h': {'en': 'Scheduled within 8 hours.', 'ar': 'مجدول خلال 8 ساعات.', 'fr': 'Planifié dans les 8 heures.', 'es': 'Programado dentro de 8 horas.'},
    'provider.workQueue.reason.scheduledWithin24h': {'en': 'Scheduled within 24 hours.', 'ar': 'مجدول خلال 24 ساعة.', 'fr': 'Planifié dans les 24 heures.', 'es': 'Programado dentro de 24 horas.'},
    'provider.workQueue.reason.etaUnavailableNoDistanceInference': {'en': 'No ETA is available; distance is not inferred.', 'ar': 'لا يوجد وقت وصول متوقع؛ لا يتم استنتاج المسافة.', 'fr': 'Aucune ETA disponible ; la distance n’est pas inférée.', 'es': 'No hay ETA disponible; la distancia no se infiere.'},
    'provider.workQueue.reason.etaWithin15m': {'en': 'Existing ETA is within 15 minutes.', 'ar': 'وقت الوصول المتوقع الحالي خلال 15 دقيقة.', 'fr': 'L’ETA existante est inférieure à 15 minutes.', 'es': 'La ETA existente es de hasta 15 minutos.'},
    'provider.workQueue.reason.etaWithin30m': {'en': 'Existing ETA is within 30 minutes.', 'ar': 'وقت الوصول المتوقع الحالي خلال 30 دقيقة.', 'fr': 'L’ETA existante est inférieure à 30 minutes.', 'es': 'La ETA existente es de hasta 30 minutos.'},
    'provider.workQueue.reason.etaWithin60m': {'en': 'Existing ETA is within 60 minutes.', 'ar': 'وقت الوصول المتوقع الحالي خلال 60 دقيقة.', 'fr': 'L’ETA existante est inférieure à 60 minutes.', 'es': 'La ETA existente es de hasta 60 minutos.'},
    'provider.workQueue.reason.etaOver60m': {'en': 'Existing ETA is over 60 minutes.', 'ar': 'وقت الوصول المتوقع الحالي أكثر من 60 دقيقة.', 'fr': 'L’ETA existante dépasse 60 minutes.', 'es': 'La ETA existente supera 60 minutos.'},
    'provider.workQueue.reason.homeVisitConfirmed': {'en': 'Confirmed home visit operational state.', 'ar': 'حالة تشغيلية لزيارة منزلية مؤكدة.', 'fr': 'État opérationnel de visite à domicile confirmée.', 'es': 'Estado operativo de visita domiciliaria confirmada.'},
    'provider.workQueue.reason.transportAssigned': {'en': 'Transport job is assigned.', 'ar': 'مهمة النقل مسندة.', 'fr': 'Le transport est assigné.', 'es': 'El transporte está asignado.'},
    'provider.workQueue.reason.transportEnRoute': {'en': 'Transport crew is en route.', 'ar': 'طاقم النقل في الطريق.', 'fr': 'L’équipe de transport est en route.', 'es': 'El equipo de transporte está en ruta.'},
    'provider.workQueue.reason.transportArrived': {'en': 'Transport crew has arrived.', 'ar': 'وصل طاقم النقل.', 'fr': 'L’équipe de transport est arrivée.', 'es': 'El equipo de transporte ha llegado.'},
    'provider.workQueue.reason.transportingPatient': {'en': 'Transport is actively in progress.', 'ar': 'عملية النقل جارية حالياً.', 'fr': 'Le transport est en cours.', 'es': 'El transporte está en curso.'},
    'provider.workQueue.reason.slaHealthy': {'en': 'Operational SLA has comfortable remaining time.', 'ar': 'يتبقى وقت مريح ضمن مستوى الخدمة التشغيلي.', 'fr': 'Le SLA opérationnel dispose d’une marge confortable.', 'es': 'El SLA operativo aún dispone de margen suficiente.'},
    'provider.workQueue.reason.slaBreached': {'en': 'Scheduled start is more than 15 minutes overdue.', 'ar': 'تجاوز بدء الموعد أكثر من 15 دقيقة.', 'fr': 'Le début planifié est dépassé de plus de 15 minutes.', 'es': 'El inicio programado lleva más de 15 minutos de retraso.'},
    'provider.workQueue.reason.slaDue': {'en': 'Operational SLA is due now.', 'ar': 'مستوى الخدمة التشغيلي مستحق الآن.', 'fr': 'Le SLA opérationnel arrive à échéance.', 'es': 'El SLA operativo vence ahora.'},
    'provider.workQueue.reason.slaWithin15m': {'en': 'Operational SLA is due within 15 minutes.', 'ar': 'مستوى الخدمة التشغيلي مستحق خلال 15 دقيقة.', 'fr': 'Le SLA opérationnel arrive à échéance dans 15 minutes.', 'es': 'El SLA operativo vence en 15 minutos.'},
    'provider.workQueue.reason.slaWithin60m': {'en': 'Operational SLA is due within 60 minutes.', 'ar': 'مستوى الخدمة التشغيلي مستحق خلال 60 دقيقة.', 'fr': 'Le SLA opérationnel arrive à échéance dans 60 minutes.', 'es': 'El SLA operativo vence en 60 minutos.'},
  };
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return values[key]?[language] ?? values[key]?['en'] ?? key;
}

class ProviderWorkQueuePage extends StatefulWidget {
  const ProviderWorkQueuePage({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;

  @override
  State<ProviderWorkQueuePage> createState() => _ProviderWorkQueuePageState();
}

class _ProviderWorkQueuePageState extends State<ProviderWorkQueuePage> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _payload = const {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() { _loading = true; _error = null; });
    try {
      final result = await widget.session.api.providerWorkQueue();
      if (mounted) setState(() => _payload = result);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _maps(_payload['items']);
    final policy = _map(_payload['policy']);
    final weights = _map(policy['weights']);
    return Scaffold(
      appBar: AppBar(
        title: Text(providerWorkQueueText(widget.locale, 'title')),
        actions: [IconButton(onPressed: _load, tooltip: providerWorkQueueText(widget.locale, 'refresh'), icon: const Icon(Icons.refresh_rounded))],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(providerWorkQueueText(widget.locale, 'subtitle'), style: const TextStyle(color: Color(0xFF64748B))),
            const SizedBox(height: 12),
            if (_loading) const LinearProgressIndicator(),
            if (_error != null) ...[
              Card(child: Padding(padding: const EdgeInsets.all(14), child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C))))),
              const SizedBox(height: 12),
            ],
            if (weights.isNotEmpty) ...[
              _weightsCard(weights),
              const SizedBox(height: 12),
            ],
            if (!_loading && items.isEmpty && _error == null)
              Card(child: Padding(padding: const EdgeInsets.all(20), child: Text(providerWorkQueueText(widget.locale, 'empty')))),
            ...items.map(_itemCard),
          ],
        ),
      ),
    );
  }

  Widget _weightsCard(Map<String, dynamic> weights) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(providerWorkQueueText(widget.locale, 'weights'), style: const TextStyle(fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _weightChip('SCHEDULE_TIME', weights['scheduleTime']),
              _weightChip('DISTANCE_ETA', weights['distanceEta']),
              _weightChip('OPERATIONAL_URGENCY', weights['operationalUrgency']),
              _weightChip('SLA', weights['sla']),
              _weightChip('CAPABILITY_FIT', weights['capabilityFit']),
            ],
          ),
        ]),
      ),
    );
  }

  Widget _weightChip(String key, dynamic value) => Chip(
        label: Text('${providerWorkQueueText(widget.locale, key)} · ${value ?? 0}'),
      );

  Widget _itemCard(Map<String, dynamic> item) {
    final priority = _map(item['priority']);
    final criteria = _maps(priority['criteria']);
    final kind = item['kind']?.toString() ?? '';
    final rank = priority['rank'] ?? '-';
    final score = priority['score'] ?? 0;
    final patient = item['patientDisplayName']?.toString() ?? '';
    final scheduled = _displayDate(item['scheduledAt']?.toString() ?? '');
    final eta = item['etaMinutes'];
    return Card(
      child: ExpansionTile(
        leading: CircleAvatar(
          backgroundColor: widget.accent.withValues(alpha: 0.12),
          child: Text('$rank', style: TextStyle(color: widget.accent, fontWeight: FontWeight.w900)),
        ),
        title: Text(patient.isEmpty ? _kindLabel(kind) : patient, style: const TextStyle(fontWeight: FontWeight.w900)),
        subtitle: Text('${_kindLabel(kind)} · ${item['status'] ?? ''}\n${providerWorkQueueText(widget.locale, 'scheduled')}: $scheduled'),
        trailing: Chip(label: Text('$score/100')),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (eta != null)
            Text('${providerWorkQueueText(widget.locale, 'eta')}: $eta ${providerWorkQueueText(widget.locale, 'minutes')}'),
          const SizedBox(height: 10),
          Text(providerWorkQueueText(widget.locale, 'explain'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          ...criteria.map(_criterionRow),
          if (kind == 'HOME_VISIT') ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => Directionality(
                  textDirection: widget.locale.textDirection,
                  child: ProviderFieldRoutePage(
                    session: widget.session,
                    locale: widget.locale,
                    workItem: item,
                    accent: widget.accent,
                  ),
                ),
              )),
              icon: const Icon(Icons.route_outlined),
              label: Text(providerWorkQueueText(widget.locale, 'openRoute')),
            ),
          ],
          if (kind == 'MEDICAL_TRANSPORT') ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => Directionality(
                  textDirection: widget.locale.textDirection,
                  child: ProviderTransportWorkspace(session: widget.session, locale: widget.locale, accent: widget.accent),
                ),
              )),
              icon: const Icon(Icons.local_shipping_outlined),
              label: Text(providerWorkQueueText(widget.locale, 'openTransport')),
            ),
          ],
        ],
      ),
    );
  }

  Widget _criterionRow(Map<String, dynamic> criterion) {
    final key = criterion['key']?.toString() ?? '';
    final contribution = criterion['contribution'] ?? 0;
    final maximum = criterion['maximum'] ?? 0;
    final explanationKey = criterion['explanationKey']?.toString() ?? '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 145, child: Text(providerWorkQueueText(widget.locale, key), style: const TextStyle(fontWeight: FontWeight.w700))),
        Expanded(child: Text(providerWorkQueueText(widget.locale, explanationKey))),
        const SizedBox(width: 8),
        Text('$contribution/$maximum', style: TextStyle(color: widget.accent, fontWeight: FontWeight.w900)),
      ]),
    );
  }

  String _kindLabel(String kind) => providerWorkQueueText(widget.locale, kind);

  String _displayDate(String value) {
    final parsed = DateTime.tryParse(value);
    if (parsed == null) return value;
    final local = parsed.toLocal();
    String two(int number) => number.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
  }

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
    return const {};
  }

  List<Map<String, dynamic>> _maps(dynamic value) {
    if (value is! List) return const [];
    return value.map(_map).toList(growable: false);
  }
}
