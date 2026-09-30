import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class OtherProviderInsightsActionButton extends StatelessWidget {
  const OtherProviderInsightsActionButton({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(
          context,
          MaterialPageRoute(
            builder: (_) => Directionality(
              textDirection: locale.textDirection,
              child: OtherProviderInsightsPage(
                session: session,
                locale: locale,
                appointment: appointment,
              ),
            ),
          ),
        ),
        icon: const Icon(Icons.insights_outlined),
        label: Text(_insightText(locale, 'open')),
      );
}

class OtherProviderInsightsPage extends StatefulWidget {
  const OtherProviderInsightsPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<OtherProviderInsightsPage> createState() => _OtherProviderInsightsPageState();
}

class _OtherProviderInsightsPageState extends State<OtherProviderInsightsPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> trends = const {};
  Map<String, dynamic> questionnaires = const {};

  String? get patientId => _mapInsight(widget.appointment['patient'])['id']?.toString();
  String get appointmentId => widget.appointment['id']?.toString() ?? '';

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    final id = patientId;
    if (id == null || id.isEmpty || appointmentId.isEmpty) {
      setState(() {
        loading = false;
        error = _insightText(widget.locale, 'missingContext');
      });
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = await Future.wait<Map<String, dynamic>>([
        widget.session.api.otherProviderObservationTrends(
          id,
          contextType: 'APPOINTMENT',
          contextId: appointmentId,
        ),
        widget.session.api.otherProviderQuestionnaireSummary(
          id,
          contextType: 'APPOINTMENT',
          contextId: appointmentId,
        ),
      ]);
      if (!mounted) return;
      setState(() {
        trends = result[0];
        questionnaires = result[1];
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(_insightText(widget.locale, 'title'))),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed: load,
                            icon: const Icon(Icons.refresh),
                            label: Text(_insightText(widget.locale, 'retry')),
                          ),
                        ],
                      ),
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: load,
                    child: ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        _securityCard(),
                        const SizedBox(height: 14),
                        Text(
                          _insightText(widget.locale, 'trends'),
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        ..._trendCards(),
                        const SizedBox(height: 18),
                        Text(
                          _insightText(widget.locale, 'questionnaires'),
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        ..._questionnaireCards(),
                      ],
                    ),
                  ),
      );

  Widget _securityCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.verified_user_outlined),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _insightText(widget.locale, 'security'),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ),
      );

  List<Widget> _trendCards() {
    final items = _listInsight(trends['items']);
    if (items.isEmpty) return [Card(child: Padding(padding: const EdgeInsets.all(16), child: Text(_insightText(widget.locale, 'noTrends'))))];
    return items.map((item) {
      final trend = _mapInsight(item['trend']);
      final series = _listInsight(trend['series']);
      final label = _localizedLabel(item['labels'], item['code']?.toString() ?? '—');
      return Card(
        child: ExpansionTile(
          leading: const Icon(Icons.show_chart),
          title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text('${item['code'] ?? ''} · ${trend['state'] ?? ''}'),
          children: series.isEmpty
              ? [Padding(padding: const EdgeInsets.all(16), child: Text(_insightText(widget.locale, 'noPoints')))]
              : series.map((value) => ListTile(
                    title: Text('${value['count'] ?? 0} ${_insightText(widget.locale, 'points')} · ${value['canonicalUnitCode'] ?? ''}'),
                    subtitle: Text(
                      '${_insightText(widget.locale, 'min')}: ${value['minimum'] ?? '—'}   '
                      '${_insightText(widget.locale, 'max')}: ${value['maximum'] ?? '—'}   '
                      '${_insightText(widget.locale, 'avg')}: ${value['average'] ?? '—'}',
                    ),
                  )).toList(growable: false),
        ),
      );
    }).toList(growable: false);
  }

  List<Widget> _questionnaireCards() {
    if (questionnaires['state'] == 'RESTRICTED') {
      return [Card(child: Padding(padding: const EdgeInsets.all(16), child: Text(_insightText(widget.locale, 'consentRequired'))))];
    }
    final items = _listInsight(questionnaires['items']);
    if (items.isEmpty) return [Card(child: Padding(padding: const EdgeInsets.all(16), child: Text(_insightText(widget.locale, 'noQuestionnaires'))))];
    return items.map((item) {
      final completed = item['status'] == 'COMPLETED';
      final label = _localizedLabel(item['labels'], item['code']?.toString() ?? '—');
      return Card(
        child: ListTile(
          leading: Icon(completed ? Icons.check_circle_outline : Icons.pending_outlined),
          title: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(
            '${item['code'] ?? ''}\n'
            '${_insightText(widget.locale, 'sequence')}: ${item['latestSequence'] ?? 0} · '
            '${_insightText(widget.locale, 'changed')}: ${item['changedQuestionCount'] ?? 0}\n'
            '${_insightText(widget.locale, 'healthChanged')}: ${_booleanLabel(item['healthChanged'])}',
          ),
          isThreeLine: true,
        ),
      );
    }).toList(growable: false);
  }

  String _localizedLabel(dynamic value, String fallback) {
    final labels = _mapInsight(value);
    return labels[widget.locale.name]?.toString() ?? labels['en']?.toString() ?? fallback;
  }

  String _booleanLabel(dynamic value) {
    if (value == true) return _insightText(widget.locale, 'yes');
    if (value == false) return _insightText(widget.locale, 'no');
    return '—';
  }
}

Map<String, dynamic> _mapInsight(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _listInsight(dynamic value) {
  if (value is! List) return const [];
  return value.map(_mapInsight).toList(growable: false);
}

String _insightText(CarePointLocale locale, String key) {
  const values = <String, Map<CarePointLocale, String>>{
    'open': {CarePointLocale.en: 'Authorized patient insights', CarePointLocale.ar: 'رؤى المريض المصرح بها', CarePointLocale.fr: 'Données patient autorisées', CarePointLocale.es: 'Datos autorizados del paciente'},
    'title': {CarePointLocale.en: 'Authorized patient insights', CarePointLocale.ar: 'رؤى المريض المصرح بها', CarePointLocale.fr: 'Données patient autorisées', CarePointLocale.es: 'Datos autorizados del paciente'},
    'trends': {CarePointLocale.en: 'Observation trends', CarePointLocale.ar: 'اتجاهات القياسات', CarePointLocale.fr: 'Tendances des observations', CarePointLocale.es: 'Tendencias de observaciones'},
    'questionnaires': {CarePointLocale.en: 'Questionnaire summary', CarePointLocale.ar: 'ملخص الاستبيانات', CarePointLocale.fr: 'Résumé des questionnaires', CarePointLocale.es: 'Resumen de cuestionarios'},
    'security': {CarePointLocale.en: 'Only category-authorized data with an active treatment context and patient consent is shown. No automated diagnosis is produced.', CarePointLocale.ar: 'تُعرض فقط البيانات المصرح بها للفئة مع سياق علاج نشط وموافقة المريض، ولا يتم إنشاء تشخيص آلي.', CarePointLocale.fr: 'Seules les données autorisées pour la catégorie, avec contexte de traitement actif et consentement du patient, sont affichées. Aucun diagnostic automatisé.', CarePointLocale.es: 'Solo se muestran datos autorizados para la categoría con contexto de tratamiento activo y consentimiento del paciente. No se genera diagnóstico automático.'},
    'retry': {CarePointLocale.en: 'Retry', CarePointLocale.ar: 'إعادة المحاولة', CarePointLocale.fr: 'Réessayer', CarePointLocale.es: 'Reintentar'},
    'noTrends': {CarePointLocale.en: 'No authorized observation trends are available.', CarePointLocale.ar: 'لا توجد اتجاهات قياسات مصرح بها.', CarePointLocale.fr: 'Aucune tendance d’observation autorisée.', CarePointLocale.es: 'No hay tendencias de observaciones autorizadas.'},
    'noPoints': {CarePointLocale.en: 'No comparable numeric points.', CarePointLocale.ar: 'لا توجد نقاط رقمية قابلة للمقارنة.', CarePointLocale.fr: 'Aucun point numérique comparable.', CarePointLocale.es: 'No hay puntos numéricos comparables.'},
    'noQuestionnaires': {CarePointLocale.en: 'No category-authorized questionnaires are available.', CarePointLocale.ar: 'لا توجد استبيانات مصرح بها للفئة.', CarePointLocale.fr: 'Aucun questionnaire autorisé pour cette catégorie.', CarePointLocale.es: 'No hay cuestionarios autorizados para esta categoría.'},
    'consentRequired': {CarePointLocale.en: 'Patient questionnaire consent is required.', CarePointLocale.ar: 'موافقة المريض مطلوبة لعرض ملخص الاستبيان.', CarePointLocale.fr: 'Le consentement du patient est requis.', CarePointLocale.es: 'Se requiere el consentimiento del paciente.'},
    'points': {CarePointLocale.en: 'points', CarePointLocale.ar: 'نقاط', CarePointLocale.fr: 'points', CarePointLocale.es: 'puntos'},
    'min': {CarePointLocale.en: 'Min', CarePointLocale.ar: 'الأدنى', CarePointLocale.fr: 'Min', CarePointLocale.es: 'Mín'},
    'max': {CarePointLocale.en: 'Max', CarePointLocale.ar: 'الأعلى', CarePointLocale.fr: 'Max', CarePointLocale.es: 'Máx'},
    'avg': {CarePointLocale.en: 'Average', CarePointLocale.ar: 'المتوسط', CarePointLocale.fr: 'Moyenne', CarePointLocale.es: 'Promedio'},
    'sequence': {CarePointLocale.en: 'Sequence', CarePointLocale.ar: 'التسلسل', CarePointLocale.fr: 'Séquence', CarePointLocale.es: 'Secuencia'},
    'changed': {CarePointLocale.en: 'Changed fields', CarePointLocale.ar: 'الحقول المتغيرة', CarePointLocale.fr: 'Champs modifiés', CarePointLocale.es: 'Campos modificados'},
    'healthChanged': {CarePointLocale.en: 'Health changed', CarePointLocale.ar: 'تغيرت الحالة الصحية', CarePointLocale.fr: 'État de santé modifié', CarePointLocale.es: 'Cambio de salud'},
    'yes': {CarePointLocale.en: 'Yes', CarePointLocale.ar: 'نعم', CarePointLocale.fr: 'Oui', CarePointLocale.es: 'Sí'},
    'no': {CarePointLocale.en: 'No', CarePointLocale.ar: 'لا', CarePointLocale.fr: 'Non', CarePointLocale.es: 'No'},
    'missingContext': {CarePointLocale.en: 'Patient appointment context is missing.', CarePointLocale.ar: 'سياق موعد المريض غير متوفر.', CarePointLocale.fr: 'Le contexte du rendez-vous patient est manquant.', CarePointLocale.es: 'Falta el contexto de la cita del paciente.'},
  };
  return values[key]?[locale] ?? values[key]?[CarePointLocale.en] ?? key;
}
