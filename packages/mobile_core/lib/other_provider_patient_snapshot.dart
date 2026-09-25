import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class OtherProviderPatientSnapshotButton extends StatelessWidget {
  const OtherProviderPatientSnapshotButton({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final Map<String, dynamic> appointment;

  @override
  Widget build(BuildContext context) {
    final patient = _map(appointment['patient']);
    final patientId = patient['id']?.toString() ?? '';
    final appointmentId = appointment['id']?.toString() ?? '';
    if (patientId.isEmpty || appointmentId.isEmpty) return const SizedBox.shrink();
    return OutlinedButton.icon(
      key: ValueKey('other-provider-patient-snapshot-$appointmentId'),
      onPressed: () => Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => Directionality(
            textDirection: locale.textDirection,
            child: OtherProviderPatientSnapshotPage(
              session: session,
              locale: locale,
              accent: accent,
              patientId: patientId,
              appointmentId: appointmentId,
              patientName: [
                patient['firstName']?.toString() ?? '',
                patient['lastName']?.toString() ?? '',
              ].where((value) => value.trim().isNotEmpty).join(' '),
            ),
          ),
        ),
      ),
      icon: const Icon(Icons.monitor_heart_outlined),
      label: Text(otherProviderSnapshotText(locale, 'button')),
    );
  }
}

class OtherProviderPatientSnapshotPage extends StatefulWidget {
  const OtherProviderPatientSnapshotPage({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.patientId,
    required this.appointmentId,
    required this.patientName,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final String patientId;
  final String appointmentId;
  final String patientName;

  @override
  State<OtherProviderPatientSnapshotPage> createState() => _OtherProviderPatientSnapshotPageState();
}

class _OtherProviderPatientSnapshotPageState extends State<OtherProviderPatientSnapshotPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> trends = const {};
  Map<String, dynamic> questionnaires = const {};

  String t(String key) => otherProviderSnapshotText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        widget.session.api.otherProviderObservationTrends(
          widget.patientId,
          contextType: 'APPOINTMENT',
          contextId: widget.appointmentId,
        ),
        widget.session.api.otherProviderQuestionnaireSummary(
          widget.patientId,
          contextType: 'APPOINTMENT',
          contextId: widget.appointmentId,
        ),
      ]);
      if (!mounted) return;
      setState(() {
        trends = values[0];
        questionnaires = values[1];
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.patientName.trim().isEmpty ? t('title') : widget.patientName),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
                  children: [
                    _securityCard(),
                    const SizedBox(height: 12),
                    _sectionTitle(t('trends'), Icons.show_chart_outlined),
                    ..._trendCards(),
                    const SizedBox(height: 18),
                    _sectionTitle(t('questionnaires'), Icons.fact_check_outlined),
                    ..._questionnaireCards(),
                  ],
                ),
              ),
  );

  Widget _securityCard() {
    final trendSecurity = _map(trends['security']);
    final questionnaireSecurity = _map(questionnaires['security']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Icon(Icons.verified_user_outlined, color: widget.accent),
            const SizedBox(width: 8),
            Expanded(child: Text(t('scopeTitle'), style: const TextStyle(fontWeight: FontWeight.w900))),
          ]),
          const SizedBox(height: 6),
          Text(t('scopeBody'), style: const TextStyle(color: Color(0xFF64748B))),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            _flag(t('capability'), trendSecurity['providerCategoryCapabilityEnforced'] == true),
            _flag(t('patientContext'), trendSecurity['patientContextVerified'] == true),
            _flag(t('observationConsent'), trendSecurity['observationConsentEnforced'] == true),
            _flag(t('questionnaireConsent'), questionnaireSecurity['questionnaireConsentEnforced'] == true),
            _flag(t('rawAnswersExcluded'), questionnaireSecurity['rawAnswersIncluded'] == false),
          ]),
        ]),
      ),
    );
  }

  Widget _flag(String label, bool ok) => Chip(
    avatar: Icon(ok ? Icons.check_circle_outline : Icons.info_outline, size: 18),
    label: Text(label),
  );

  Widget _sectionTitle(String label, IconData icon) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(children: [Icon(icon, color: widget.accent), const SizedBox(width: 8), Text(label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900))]),
  );

  List<Widget> _trendCards() {
    final items = _maps(trends['items']);
    if (items.isEmpty) return [_empty(t('noTrends'))];
    return items.map((item) {
      final trend = _map(item['trend']);
      final series = _maps(trend['series']);
      final table = _maps(trend['table']);
      final label = _localized(item['labels'], widget.locale, item['code']?.toString() ?? '');
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(label, style: const TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 4),
            Text('${t('accessBasis')}: ${item['accessBasis'] ?? '—'} · ${t('automatedDiagnosis')}: ${trend['automatedDiagnosis'] == true ? t('yes') : t('no')}',
              style: const TextStyle(color: Color(0xFF64748B))),
            const SizedBox(height: 10),
            ...series.map((row) => _seriesSummary(row)),
            if (table.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(t('recentPoints'), style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  columns: [DataColumn(label: Text(t('date'))), DataColumn(label: Text(t('value'))), DataColumn(label: Text(t('source')))],
                  rows: table.reversed.take(10).map((point) => DataRow(cells: [
                    DataCell(Text(_date(point['observedAt']))),
                    DataCell(Text('${point['value'] ?? '—'} ${point['unitCode'] ?? ''}')),
                    DataCell(Text(point['sourceType']?.toString() ?? '—')),
                  ])).toList(growable: false),
                ),
              ),
            ],
          ]),
        ),
      );
    }).toList(growable: false);
  }

  Widget _seriesSummary(Map<String, dynamic> row) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Wrap(spacing: 8, runSpacing: 8, children: [
      Chip(label: Text('${t('count')}: ${row['count'] ?? 0}')),
      Chip(label: Text('${t('minimum')}: ${row['minimum'] ?? '—'} ${row['canonicalUnitCode'] ?? ''}')),
      Chip(label: Text('${t('maximum')}: ${row['maximum'] ?? '—'} ${row['canonicalUnitCode'] ?? ''}')),
      Chip(label: Text('${t('average')}: ${row['average'] ?? '—'} ${row['canonicalUnitCode'] ?? ''}')),
    ]),
  );

  List<Widget> _questionnaireCards() {
    if (questionnaires['state'] == 'RESTRICTED') {
      return [Card(child: ListTile(
        leading: const Icon(Icons.lock_outline),
        title: Text(t('restricted')),
        subtitle: Text(t('consentRequired')),
      ))];
    }
    final items = _maps(questionnaires['items']);
    if (items.isEmpty) return [_empty(t('noQuestionnaires'))];
    return items.map((item) => Card(
      child: ListTile(
        leading: const Icon(Icons.assignment_turned_in_outlined),
        title: Text(_localized(item['labels'], widget.locale, item['code']?.toString() ?? '')),
        subtitle: Text(
          '${t('status')}: ${item['status'] ?? '—'}\n'
          '${t('version')}: ${item['questionnaireVersion'] ?? '—'} · ${t('completedAt')}: ${_date(item['completedAt'])}\n'
          '${t('changedQuestions')}: ${item['changedQuestionCount'] ?? 0}',
        ),
        isThreeLine: true,
      ),
    )).toList(growable: false);
  }

  Widget _empty(String label) => Card(child: Padding(padding: const EdgeInsets.all(16), child: Text(label, style: const TextStyle(color: Color(0xFF64748B)))));
}

String otherProviderSnapshotText(CarePointLocale locale, String key) {
  const copy = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'button':'Patient Snapshot','title':'Patient Snapshot','refresh':'Refresh','scopeTitle':'Capability-bounded snapshot',
      'scopeBody':'Only information allowed for this provider category, appointment context and active patient consent is shown.',
      'capability':'Capability enforced','patientContext':'Patient context verified','observationConsent':'Observation consent','questionnaireConsent':'Questionnaire consent','rawAnswersExcluded':'Raw answers excluded',
      'trends':'Allowed vital trends','noTrends':'No observation trend is available in the current scope.','accessBasis':'Access basis','automatedDiagnosis':'Automated diagnosis','yes':'Yes','no':'No',
      'recentPoints':'Recent measurements','date':'Date','value':'Value','source':'Source','count':'Count','minimum':'Min','maximum':'Max','average':'Average',
      'questionnaires':'Relevant questionnaire summary','restricted':'Questionnaire summary restricted','consentRequired':'Required questionnaire consent is not active.','noQuestionnaires':'No questionnaire summary is available in the current capability scope.',
      'status':'Status','version':'Version','completedAt':'Completed','changedQuestions':'Changed questions',
    },
    CarePointLocale.ar: {
      'button':'ملخص المريض','title':'ملخص المريض','refresh':'تحديث','scopeTitle':'ملخص مقيّد بالصلاحيات',
      'scopeBody':'تُعرض فقط المعلومات المسموح بها لفئة مقدم الخدمة وسياق الموعد وموافقة المريض النشطة.',
      'capability':'تطبيق الصلاحيات','patientContext':'تم التحقق من سياق المريض','observationConsent':'موافقة القياسات','questionnaireConsent':'موافقة الاستبيان','rawAnswersExcluded':'الإجابات الخام غير معروضة',
      'trends':'اتجاهات القياسات المسموحة','noTrends':'لا توجد سلسلة قياسات متاحة ضمن النطاق الحالي.','accessBasis':'أساس الوصول','automatedDiagnosis':'تشخيص آلي','yes':'نعم','no':'لا',
      'recentPoints':'القياسات الحديثة','date':'التاريخ','value':'القيمة','source':'المصدر','count':'العدد','minimum':'الأدنى','maximum':'الأعلى','average':'المتوسط',
      'questionnaires':'ملخص الاستبيانات ذات الصلة','restricted':'ملخص الاستبيان مقيّد','consentRequired':'موافقة الاستبيان المطلوبة غير نشطة.','noQuestionnaires':'لا يوجد ملخص استبيان متاح ضمن الصلاحيات الحالية.',
      'status':'الحالة','version':'الإصدار','completedAt':'مكتمل','changedQuestions':'الأسئلة المتغيرة',
    },
    CarePointLocale.fr: {
      'button':'Aperçu patient','title':'Aperçu patient','refresh':'Actualiser','scopeTitle':'Aperçu limité par les capacités',
      'scopeBody':'Seules les informations autorisées par la catégorie, le contexte du rendez-vous et le consentement actif sont affichées.',
      'capability':'Capacité appliquée','patientContext':'Contexte patient vérifié','observationConsent':'Consentement mesures','questionnaireConsent':'Consentement questionnaire','rawAnswersExcluded':'Réponses brutes exclues',
      'trends':'Tendances de constantes autorisées','noTrends':'Aucune tendance disponible dans le périmètre actuel.','accessBasis':'Base d’accès','automatedDiagnosis':'Diagnostic automatique','yes':'Oui','no':'Non',
      'recentPoints':'Mesures récentes','date':'Date','value':'Valeur','source':'Source','count':'Nombre','minimum':'Min','maximum':'Max','average':'Moyenne',
      'questionnaires':'Résumé des questionnaires pertinents','restricted':'Résumé questionnaire restreint','consentRequired':'Le consentement questionnaire requis n’est pas actif.','noQuestionnaires':'Aucun résumé de questionnaire disponible dans le périmètre actuel.',
      'status':'Statut','version':'Version','completedAt':'Terminé','changedQuestions':'Questions modifiées',
    },
    CarePointLocale.es: {
      'button':'Resumen del paciente','title':'Resumen del paciente','refresh':'Actualizar','scopeTitle':'Resumen limitado por capability',
      'scopeBody':'Sólo se muestra información permitida por la categoría del proveedor, el contexto de la cita y el consentimiento activo.',
      'capability':'Capability aplicada','patientContext':'Contexto del paciente verificado','observationConsent':'Consentimiento de mediciones','questionnaireConsent':'Consentimiento de cuestionario','rawAnswersExcluded':'Respuestas brutas excluidas',
      'trends':'Tendencias de constantes permitidas','noTrends':'No hay tendencias disponibles dentro del scope actual.','accessBasis':'Base de acceso','automatedDiagnosis':'Diagnóstico automático','yes':'Sí','no':'No',
      'recentPoints':'Mediciones recientes','date':'Fecha','value':'Valor','source':'Origen','count':'Cantidad','minimum':'Mín','maximum':'Máx','average':'Media',
      'questionnaires':'Resumen de cuestionarios relevantes','restricted':'Resumen de cuestionario restringido','consentRequired':'No está activo el consentimiento de cuestionario requerido.','noQuestionnaires':'No hay resumen de cuestionario disponible dentro del scope actual.',
      'status':'Estado','version':'Versión','completedAt':'Completado','changedQuestions':'Preguntas modificadas',
    },
  };
  return copy[locale]?[key] ?? copy[CarePointLocale.en]![key] ?? key;
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

String _localized(dynamic value, CarePointLocale locale, String fallback) {
  final map = _map(value);
  final key = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  final local = map[key]?.toString().trim() ?? '';
  if (local.isNotEmpty) return local;
  final english = map['en']?.toString().trim() ?? '';
  return english.isNotEmpty ? english : fallback;
}

String _date(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  final text = parsed.toString();
  return text.length >= 16 ? text.substring(0, 16) : text;
}
