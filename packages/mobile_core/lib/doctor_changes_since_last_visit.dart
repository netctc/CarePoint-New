import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorChangesSinceLastVisitPage extends StatefulWidget {
  const DoctorChangesSinceLastVisitPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorChangesSinceLastVisitPage> createState() => _DoctorChangesSinceLastVisitPageState();
}

class _DoctorChangesSinceLastVisitPageState extends State<DoctorChangesSinceLastVisitPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> payload = const {};

  String t(String key) => doctorChangesSinceLastVisitText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final value = await widget.session.api.doctorChangesSinceLastVisit(widget.patientId);
      if (mounted) setState(() => payload = value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final changes = _maps(payload['changes']);
    final available = payload['available'] == true;
    final since = DateTime.tryParse(payload['since']?.toString() ?? '')?.toLocal();
    return Scaffold(
      appBar: AppBar(
        title: Text(t('title')),
        actions: [
          IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh')),
        ],
      ),
      body: loading && payload.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 28),
                children: [
                  Card(child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Row(children: [
                        const Icon(Icons.update_outlined),
                        const SizedBox(width: 8),
                        Expanded(child: Text(t('subtitle'), style: const TextStyle(fontWeight: FontWeight.w800))),
                      ]),
                      const SizedBox(height: 6),
                      Text(available
                          ? '${t('since')}: ${_dateTime(since)}'
                          : t('noPreviousConsult')),
                      const SizedBox(height: 8),
                      Text(t('deterministic'), style: const TextStyle(color: Color(0xFF64748B))),
                    ]),
                  )),
                  if (error != null)
                    Card(child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    )),
                  if (available) ...[
                    const SizedBox(height: 6),
                    _summaryCard(),
                    if (_strings(payload['restrictedSections']).isNotEmpty) ...[
                      const SizedBox(height: 6),
                      _restrictedCard(),
                    ],
                    const SizedBox(height: 10),
                    if (changes.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(t('noChanges'), textAlign: TextAlign.center),
                      )
                    else
                      ...changes.map(_changeCard),
                  ],
                  const SizedBox(height: 14),
                  OutlinedButton.icon(
                    key: const ValueKey('doctor-changes-open-full-history'),
                    onPressed: () => Navigator.pop(context, true),
                    icon: const Icon(Icons.history_outlined),
                    label: Text(t('fullHistory')),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _summaryCard() {
    final summary = _map(payload['summary']);
    const domains = [
      'HEALTH_PROFILE',
      'CLINICAL_PROFILE',
      'QUESTIONNAIRE',
      'OBSERVATION',
      'LAB_RESULT',
      'CLINICAL_ALERT',
    ];
    return Card(child: Padding(
      padding: const EdgeInsets.all(14),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: domains.map((domain) => Chip(
          label: Text('${_domainLabel(domain)} · ${_count(summary[domain])}'),
        )).toList(growable: false),
      ),
    ));
  }

  Widget _restrictedCard() => Card(
    child: ListTile(
      leading: const Icon(Icons.visibility_off_outlined),
      title: Text(t('restricted')),
      subtitle: Text(_strings(payload['restrictedSections']).join(' · ')),
    ),
  );

  Widget _changeCard(Map<String, dynamic> item) {
    final domain = item['domain']?.toString() ?? '';
    final metadata = _map(item['metadata']);
    final fields = _strings(item['changedFields']);
    final occurredAt = DateTime.tryParse(item['occurredAt']?.toString() ?? '')?.toLocal();
    final details = <String>[
      '${t('when')}: ${_dateTime(occurredAt)}',
      '${t('type')}: ${item['changeType'] ?? ''}',
      if (fields.isNotEmpty) '${t('fields')}: ${fields.join(', ')}',
      ..._metadataLines(domain, metadata),
    ];
    return Card(child: ListTile(
      key: ValueKey('doctor-change-${item['resourceId']}'),
      leading: Icon(_domainIcon(domain)),
      title: Text(_domainLabel(domain), style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text(details.join('\n')),
      isThreeLine: true,
      trailing: IconButton(
        key: ValueKey('doctor-change-source-${item['resourceId']}'),
        tooltip: t('source'),
        onPressed: () => _showSource(item),
        icon: const Icon(Icons.open_in_new_outlined),
      ),
    ));
  }

  List<String> _metadataLines(String domain, Map<String, dynamic> metadata) {
    if (domain == 'CLINICAL_PROFILE') {
      return [
        if (metadata['kind'] != null) '${t('clinicalKind')}: ${metadata['kind']}',
        if (metadata['verificationStatus'] != null) '${t('verification')}: ${metadata['verificationStatus']}',
      ];
    }
    if (domain == 'QUESTIONNAIRE') {
      return [if (metadata['code'] != null) '${t('questionnaire')}: ${metadata['code']}'];
    }
    if (domain == 'OBSERVATION') {
      return [if (metadata['metricCode'] != null) '${t('metric')}: ${metadata['metricCode']}'];
    }
    if (domain == 'LAB_RESULT') {
      return [if (metadata['status'] != null) '${t('resultStatus')}: ${metadata['status']}'];
    }
    if (domain == 'CLINICAL_ALERT') {
      return [
        if (metadata['metricCode'] != null) '${t('metric')}: ${metadata['metricCode']}',
        if (metadata['severity'] != null) '${t('severity')}: ${metadata['severity']}',
        if (metadata['status'] != null) '${t('alertStatus')}: ${metadata['status']}',
      ];
    }
    return const [];
  }

  Future<void> _showSource(Map<String, dynamic> item) async {
    final target = item['detailTarget']?.toString() ?? '';
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => Directionality(
        textDirection: widget.locale.textDirection,
        child: SafeArea(child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(t('sourceRecord'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            const SizedBox(height: 12),
            Text('${t('resourceType')}: ${item['resourceType'] ?? ''}'),
            Text('${t('resourceId')}: ${item['resourceId'] ?? ''}'),
            if (item['resourceVersion'] != null) Text('${t('version')}: ${item['resourceVersion']}'),
            if (item['sourceId'] != null) Text('${t('sourceId')}: ${item['sourceId']}'),
            const SizedBox(height: 10),
            Text(t('sourceTarget'), style: const TextStyle(fontWeight: FontWeight.w800)),
            SelectableText(target, key: ValueKey('doctor-change-detail-target-${item['resourceId']}')),
            const SizedBox(height: 12),
            Text(t('sourceHint'), style: const TextStyle(color: Color(0xFF64748B))),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => Navigator.pop(sheetContext), child: Text(t('close'))),
          ]),
        )),
      ),
    );
  }

  String _domainLabel(String domain) => doctorChangesSinceLastVisitText(widget.locale, 'domain.$domain');
  int _count(dynamic value) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;
}

IconData _domainIcon(String domain) => switch (domain) {
  'HEALTH_PROFILE' => Icons.person_outline,
  'CLINICAL_PROFILE' => Icons.medication_outlined,
  'QUESTIONNAIRE' => Icons.fact_check_outlined,
  'OBSERVATION' => Icons.monitor_heart_outlined,
  'LAB_RESULT' => Icons.science_outlined,
  'CLINICAL_ALERT' => Icons.notification_important_outlined,
  _ => Icons.change_circle_outlined,
};

String doctorChangesSinceLastVisitText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Since my last consult','subtitle':'Source-linked changes since your previous completed consult','refresh':'Refresh',
      'since':'Since','deterministic':'This view is chronological and deterministic; it does not score risk or infer diagnoses.',
      'noPreviousConsult':'No previous completed consult with you is available.','noChanges':'No accessible changes since your previous consult.',
      'restricted':'Restricted sections remain hidden','fullHistory':'Open full clinical history','source':'Source record','sourceRecord':'Source record',
      'resourceType':'Resource type','resourceId':'Resource ID','version':'Version','sourceId':'Source ID','sourceTarget':'Canonical source target',
      'sourceHint':'The target and identifiers come from the server projection so the original record remains traceable.','close':'Close',
      'when':'When','type':'Change','fields':'Changed fields','clinicalKind':'Clinical kind','verification':'Verification',
      'questionnaire':'Questionnaire','metric':'Metric','resultStatus':'Result status','severity':'Severity','alertStatus':'Alert status',
      'domain.HEALTH_PROFILE':'Health data','domain.CLINICAL_PROFILE':'Medication / clinical profile','domain.QUESTIONNAIRE':'Questionnaire',
      'domain.OBSERVATION':'Observation','domain.LAB_RESULT':'Laboratory result','domain.CLINICAL_ALERT':'Clinical alert',
    },
    CarePointLocale.ar: {
      'title':'منذ آخر استشارة لي','subtitle':'تغييرات مرتبطة بالمصدر منذ آخر استشارة مكتملة معك','refresh':'تحديث',
      'since':'منذ','deterministic':'هذا العرض زمني وحتمي ولا يحسب المخاطر أو يستنتج تشخيصاً.',
      'noPreviousConsult':'لا توجد استشارة مكتملة سابقة معك.','noChanges':'لا توجد تغييرات متاحة منذ الاستشارة السابقة.',
      'restricted':'تبقى الأقسام المقيدة مخفية','fullHistory':'فتح التاريخ السريري الكامل','source':'السجل المصدر','sourceRecord':'السجل المصدر',
      'resourceType':'نوع المورد','resourceId':'معرّف المورد','version':'الإصدار','sourceId':'معرّف المصدر','sourceTarget':'مسار المصدر الأساسي',
      'sourceHint':'المسار والمعرّفات تأتي من عرض الخادم للحفاظ على إمكانية تتبع السجل الأصلي.','close':'إغلاق',
      'when':'الوقت','type':'التغيير','fields':'الحقول المتغيرة','clinicalKind':'النوع السريري','verification':'التحقق',
      'questionnaire':'الاستبيان','metric':'المقياس','resultStatus':'حالة النتيجة','severity':'الشدة','alertStatus':'حالة التنبيه',
      'domain.HEALTH_PROFILE':'بيانات صحية','domain.CLINICAL_PROFILE':'الأدوية / الملف السريري','domain.QUESTIONNAIRE':'استبيان',
      'domain.OBSERVATION':'ملاحظة','domain.LAB_RESULT':'نتيجة مختبر','domain.CLINICAL_ALERT':'تنبيه سريري',
    },
    CarePointLocale.fr: {
      'title':'Depuis ma dernière consultation','subtitle':'Changements liés à leur source depuis votre dernière consultation terminée','refresh':'Actualiser',
      'since':'Depuis','deterministic':'Cette vue est chronologique et déterministe; elle ne calcule aucun risque et n’infère aucun diagnostic.',
      'noPreviousConsult':'Aucune consultation terminée précédente avec vous.','noChanges':'Aucun changement accessible depuis la consultation précédente.',
      'restricted':'Les sections restreintes restent masquées','fullHistory':'Ouvrir l’historique clinique complet','source':'Dossier source','sourceRecord':'Dossier source',
      'resourceType':'Type de ressource','resourceId':'ID ressource','version':'Version','sourceId':'ID source','sourceTarget':'Cible source canonique',
      'sourceHint':'La cible et les identifiants proviennent de la projection serveur afin de préserver la traçabilité du dossier original.','close':'Fermer',
      'when':'Quand','type':'Changement','fields':'Champs modifiés','clinicalKind':'Type clinique','verification':'Vérification',
      'questionnaire':'Questionnaire','metric':'Mesure','resultStatus':'Statut résultat','severity':'Sévérité','alertStatus':'Statut alerte',
      'domain.HEALTH_PROFILE':'Données de santé','domain.CLINICAL_PROFILE':'Médicament / profil clinique','domain.QUESTIONNAIRE':'Questionnaire',
      'domain.OBSERVATION':'Observation','domain.LAB_RESULT':'Résultat de laboratoire','domain.CLINICAL_ALERT':'Alerte clinique',
    },
    CarePointLocale.es: {
      'title':'Desde mi última consulta','subtitle':'Cambios enlazados a su fuente desde tu última consulta completada','refresh':'Actualizar',
      'since':'Desde','deterministic':'Esta vista es cronológica y determinista; no puntúa riesgo ni infiere diagnósticos.',
      'noPreviousConsult':'No existe una consulta completada previa contigo.','noChanges':'No hay cambios accesibles desde la consulta anterior.',
      'restricted':'Las secciones restringidas permanecen ocultas','fullHistory':'Abrir historial clínico completo','source':'Registro fuente','sourceRecord':'Registro fuente',
      'resourceType':'Tipo de recurso','resourceId':'ID de recurso','version':'Versión','sourceId':'ID de fuente','sourceTarget':'Destino canónico de fuente',
      'sourceHint':'El destino y los identificadores proceden de la proyección del servidor para mantener trazable el registro original.','close':'Cerrar',
      'when':'Cuándo','type':'Cambio','fields':'Campos modificados','clinicalKind':'Tipo clínico','verification':'Verificación',
      'questionnaire':'Cuestionario','metric':'Métrica','resultStatus':'Estado del resultado','severity':'Severidad','alertStatus':'Estado de alerta',
      'domain.HEALTH_PROFILE':'Datos de salud','domain.CLINICAL_PROFILE':'Medicación / perfil clínico','domain.QUESTIONNAIRE':'Cuestionario',
      'domain.OBSERVATION':'Observación','domain.LAB_RESULT':'Resultado de laboratorio','domain.CLINICAL_ALERT':'Alerta clínica',
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
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

List<String> _strings(dynamic value) {
  if (value is! List) return const [];
  return value.whereType<String>().toList(growable: false);
}

String _dateTime(DateTime? value) {
  if (value == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
}
