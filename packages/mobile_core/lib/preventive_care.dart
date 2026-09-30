import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientPreventiveCarePage extends StatefulWidget {
  const PatientPreventiveCarePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientPreventiveCarePage> createState() => _PatientPreventiveCarePageState();
}

class _PatientPreventiveCarePageState extends State<PatientPreventiveCarePage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> payload = const {};

  String t(String key) => preventiveCareText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final next = await widget.session.api.patientPreventiveCare();
      if (mounted) setState(() => payload = next);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _maps(payload['items']);
    final evaluation = _map(payload['evaluation']);
    return Scaffold(
      appBar: AppBar(
        title: Text(t('title')),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _policyCard(evaluation),
                      const SizedBox(height: 12),
                      if (items.isEmpty)
                        Card(child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Text(t('empty'), textAlign: TextAlign.center),
                        ))
                      else
                        ...items.map(_itemCard),
                    ],
                  ),
                ),
    );
  }

  Widget _policyCard(Map<String, dynamic> evaluation) => Card(child: Padding(
    padding: const EdgeInsets.all(14),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('policyTitle'), style: const TextStyle(fontWeight: FontWeight.w900)),
      const SizedBox(height: 4),
      Text(t('policyBody'), style: const TextStyle(color: Color(0xFF64748B))),
      if ((evaluation['skippedJurisdiction'] as num?)?.toInt() case final n? when n > 0)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text('${t('jurisdictionSkipped')}: $n', style: const TextStyle(color: Color(0xFF64748B))),
        ),
    ]),
  ));

  Widget _itemCard(Map<String, dynamic> item) {
    final evaluation = _map(item['evaluation']);
    final source = _localized(item['sourceLabels'], widget.locale, t('source'));
    final label = _localized(item['labels'], widget.locale, item['code']?.toString() ?? t('reminder'));
    final description = _localized(item['descriptionLabels'], widget.locale, '');
    return Card(child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.health_and_safety_outlined),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
            if (description.isNotEmpty) ...[const SizedBox(height: 4), Text(description)],
          ])),
        ]),
        const SizedBox(height: 10),
        _row(t('source'), source),
        _row(t('rule'), '${item['code'] ?? ''} · v${item['version'] ?? ''}'),
        _row(t('jurisdiction'), item['jurisdiction']),
        _row(t('reason'), _reason(evaluation['reason']?.toString() ?? '')),
        if (evaluation['lastImmunizationOn'] != null)
          _row(t('lastImmunization'), evaluation['lastImmunizationOn']),
        if (evaluation['dueSince'] != null)
          _row(t('dueSince'), evaluation['dueSince']),
        const SizedBox(height: 6),
        SelectableText(
          '${t('reference')}: ${item['sourceReference'] ?? ''}',
          style: const TextStyle(color: Color(0xFF64748B)),
        ),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (item['allowPostpone'] == true)
            OutlinedButton.icon(
              onPressed: () => _postpone(item),
              icon: const Icon(Icons.schedule_outlined),
              label: Text(t('postpone')),
            ),
          if (item['allowDismiss'] == true)
            OutlinedButton.icon(
              onPressed: () => _dismiss(item),
              icon: const Icon(Icons.visibility_off_outlined),
              label: Text(t('dismiss')),
            ),
        ]),
      ]),
    ));
  }

  Future<void> _postpone(Map<String, dynamic> item) async {
    final maxDays = _int(item['maxPostponeDays'], 365);
    final choices = <int>{7, 30, 90, maxDays}.where((days) => days > 0 && days <= maxDays).toList()..sort();
    final days = await showDialog<int>(context: context, builder: (dialogContext) => SimpleDialog(
      title: Text(t('postponeFor')),
      children: choices.map((value) => SimpleDialogOption(
        onPressed: () => Navigator.pop(dialogContext, value),
        child: Text('$value ${t('days')}'),
      )).toList(growable: false),
    ));
    if (days == null) return;
    final until = DateTime.now().toUtc().add(Duration(days: days));
    await _act(item, 'POSTPONED', postponedUntil: until.toIso8601String());
  }

  Future<void> _dismiss(Map<String, dynamic> item) async {
    final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(t('dismiss')),
      content: Text(t('dismissConfirm')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
      ],
    ));
    if (confirmed == true) await _act(item, 'DISMISSED');
  }

  Future<void> _act(Map<String, dynamic> item, String action, {String? postponedUntil}) async {
    try {
      await widget.session.api.actPatientPreventiveCare(
        item['ruleVersionId'].toString(),
        action: action,
        postponedUntil: postponedUntil,
        idempotencyKey: 'preventive-${DateTime.now().microsecondsSinceEpoch}',
      );
      await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Widget _row(String label, dynamic value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(width: 130, child: Text(label, style: const TextStyle(color: Color(0xFF64748B)))),
      Expanded(child: Text(value?.toString() ?? '—', style: const TextStyle(fontWeight: FontWeight.w700))),
    ]),
  );

  String _reason(String reason) => preventiveCareText(widget.locale, reason);
}

String preventiveCareText(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'title': {'en':'Preventive care','ar':'الرعاية الوقائية','fr':'Prévention','es':'Prevención'},
    'refresh': {'en':'Refresh','ar':'تحديث','fr':'Actualiser','es':'Actualizar'},
    'empty': {'en':'No preventive reminder is currently due under the published rules.','ar':'لا يوجد تذكير وقائي مستحق حالياً وفق القواعد المنشورة.','fr':'Aucun rappel préventif n’est actuellement dû selon les règles publiées.','es':'No hay recordatorios preventivos pendientes según las reglas publicadas.'},
    'policyTitle': {'en':'Rule-based reminders','ar':'تذكيرات مبنية على قواعد','fr':'Rappels fondés sur des règles','es':'Recordatorios basados en reglas'},
    'policyBody': {'en':'These reminders come from explicit published policies. They do not diagnose a condition or infer disease.','ar':'تأتي هذه التذكيرات من سياسات منشورة وصريحة، ولا تشخّص حالة ولا تستنتج مرضاً.','fr':'Ces rappels proviennent de politiques publiées explicites. Ils ne posent aucun diagnostic et n’infèrent aucune maladie.','es':'Estos recordatorios proceden de políticas publicadas explícitas. No diagnostican ni infieren enfermedades.'},
    'jurisdictionSkipped': {'en':'Country-specific rules not evaluated','ar':'قواعد خاصة بدولة لم يتم تقييمها','fr':'Règles nationales non évaluées','es':'Reglas específicas de país no evaluadas'},
    'source': {'en':'Source','ar':'المصدر','fr':'Source','es':'Fuente'},
    'rule': {'en':'Rule','ar':'القاعدة','fr':'Règle','es':'Regla'},
    'jurisdiction': {'en':'Jurisdiction','ar':'الاختصاص','fr':'Juridiction','es':'Jurisdicción'},
    'reason': {'en':'Why shown','ar':'سبب الظهور','fr':'Pourquoi affiché','es':'Por qué aparece'},
    'reference': {'en':'Reference','ar':'المرجع','fr':'Référence','es':'Referencia'},
    'lastImmunization': {'en':'Last recorded dose','ar':'آخر جرعة مسجلة','fr':'Dernière dose enregistrée','es':'Última dosis registrada'},
    'dueSince': {'en':'Due since','ar':'مستحق منذ','fr':'Dû depuis','es':'Pendiente desde'},
    'postpone': {'en':'Postpone','ar':'تأجيل','fr':'Reporter','es':'Posponer'},
    'postponeFor': {'en':'Postpone reminder','ar':'تأجيل التذكير','fr':'Reporter le rappel','es':'Posponer recordatorio'},
    'days': {'en':'days','ar':'أيام','fr':'jours','es':'días'},
    'dismiss': {'en':'Dismiss','ar':'إخفاء','fr':'Ignorer','es':'Descartar'},
    'dismissConfirm': {'en':'Dismiss this rule version? A future published version may appear again.','ar':'إخفاء هذا الإصدار من القاعدة؟ قد يظهر إصدار منشور جديد لاحقاً.','fr':'Ignorer cette version de règle ? Une future version publiée pourra réapparaître.','es':'¿Descartar esta versión de la regla? Una futura versión publicada puede volver a aparecer.'},
    'cancel': {'en':'Cancel','ar':'إلغاء','fr':'Annuler','es':'Cancelar'},
    'confirm': {'en':'Confirm','ar':'تأكيد','fr':'Confirmer','es':'Confirmar'},
    'reminder': {'en':'Preventive reminder','ar':'تذكير وقائي','fr':'Rappel préventif','es':'Recordatorio preventivo'},
    'AGE_WINDOW_MATCH': {'en':'Your recorded age is inside the published reminder window.','ar':'عمرك المسجل يقع ضمن نافذة التذكير المنشورة.','fr':'Votre âge enregistré se situe dans la fenêtre de rappel publiée.','es':'Tu edad registrada está dentro de la ventana de recordatorio publicada.'},
    'IMMUNIZATION_NOT_RECORDED': {'en':'No matching vaccine code is recorded in the current immunization history.','ar':'لا يوجد رمز لقاح مطابق مسجل في سجل التطعيم الحالي.','fr':'Aucun code vaccinal correspondant n’est enregistré dans l’historique actuel.','es':'No hay un código de vacuna coincidente registrado en el historial actual.'},
    'IMMUNIZATION_INTERVAL_DUE': {'en':'The published interval has elapsed since the last matching recorded dose.','ar':'انقضت المدة المنشورة منذ آخر جرعة مسجلة مطابقة.','fr':'L’intervalle publié est écoulé depuis la dernière dose correspondante enregistrée.','es':'Ha transcurrido el intervalo publicado desde la última dosis coincidente registrada.'},
  };
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return values[key]?[language] ?? values[key]?['en'] ?? key;
}

String _localized(dynamic value, CarePointLocale locale, String fallback) {
  final map = _map(value);
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  final localized = map[language]?.toString().trim() ?? '';
  if (localized.isNotEmpty) return localized;
  final english = map['en']?.toString().trim() ?? '';
  return english.isNotEmpty ? english : fallback;
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

int _int(dynamic value, int fallback) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;
