import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientCarePlansPage extends StatefulWidget {
  const PatientCarePlansPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientCarePlansPage> createState() => _PatientCarePlansPageState();
}

class _PatientCarePlansPageState extends State<PatientCarePlansPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => patientCarePlanText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final value = await widget.session.api.patientCarePlans();
      if (mounted) setState(() => items = _maps(value['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('title')),
      actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    body: loading && items.isEmpty
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(12),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Card(child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Text(t('intro'), style: const TextStyle(color: Color(0xFF475569))),
                )),
                if (error != null)
                  Card(child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  )),
                if (!loading && error == null && items.isEmpty)
                  Padding(padding: const EdgeInsets.all(28), child: Text(t('empty'), textAlign: TextAlign.center)),
                ...items.map(_planCard),
              ],
            ),
          ),
  );

  Widget _planCard(Map<String, dynamic> plan) {
    final data = _map(plan['data']);
    final title = data['title']?.toString().trim();
    return Card(child: ListTile(
      key: ValueKey('patient-care-plan-${plan['id']}'),
      leading: const Icon(Icons.assignment_turned_in_outlined),
      title: Text(title?.isNotEmpty == true ? title! : t('carePlan'), style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text([
        '${t('status')}: ${plan['status'] ?? ''}',
        if (plan['reviewAt'] != null) '${t('review')}: ${_date(plan['reviewAt'])}',
        if (data['summary']?.toString().trim().isNotEmpty == true) data['summary'].toString(),
      ].join('\n')),
      isThreeLine: true,
      trailing: const Icon(Icons.chevron_right),
      onTap: () => Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => Directionality(
          textDirection: widget.locale.textDirection,
          child: PatientCarePlanDetailPage(
            session: widget.session,
            locale: widget.locale,
            plan: plan,
          ),
        )),
      ).then((_) => _load()),
    ));
  }
}

class PatientCarePlanDetailPage extends StatefulWidget {
  const PatientCarePlanDetailPage({
    super.key,
    required this.session,
    required this.locale,
    required this.plan,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> plan;

  @override
  State<PatientCarePlanDetailPage> createState() => _PatientCarePlanDetailPageState();
}

class _PatientCarePlanDetailPageState extends State<PatientCarePlanDetailPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> goals = const [];
  List<Map<String, dynamic>> tasks = const [];
  Map<String, dynamic> adherence = const {};
  int adherenceDays = 30;

  CarePointApi get api => widget.session.api;
  String t(String key) => patientCarePlanText(widget.locale, key);
  String get planId => widget.plan['id'].toString();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final now = DateTime.now().toUtc();
      final values = await Future.wait([
        api.patientCarePlanGoals(planId),
        api.patientCarePlanTasks(planId),
        api.patientCarePlanAdherence(
          planId,
          from: now.subtract(Duration(days: adherenceDays)),
          to: now,
        ),
      ]);
      if (!mounted) return;
      setState(() {
        goals = _maps(values[0]['items']);
        tasks = _maps(values[1]['items']);
        adherence = _map(values[2]);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final planData = _map(widget.plan['data']);
    return Scaffold(
      appBar: AppBar(
        title: Text(planData['title']?.toString().trim().isNotEmpty == true ? planData['title'].toString() : t('carePlan')),
        actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
      ),
      body: loading && goals.isEmpty && tasks.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(12),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  _planSummary(planData),
                  const SizedBox(height: 12),
                  _adherenceCard(),
                  if (error != null) Card(child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  )),
                  const SizedBox(height: 12),
                  _header(t('goals'), Icons.flag_outlined),
                  if (goals.isEmpty) _empty(t('noGoals')) else ...goals.map(_goalCard),
                  const SizedBox(height: 16),
                  _header(t('tasks'), Icons.task_alt_outlined),
                  if (tasks.isEmpty) _empty(t('noTasks')) else ...tasks.map(_taskCard),
                ],
              ),
            ),
    );
  }

  Widget _planSummary(Map<String, dynamic> data) => Card(child: Padding(
    padding: const EdgeInsets.all(14),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(data['title']?.toString() ?? t('carePlan'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
      if (data['summary']?.toString().trim().isNotEmpty == true) ...[
        const SizedBox(height: 6),
        Text(data['summary'].toString()),
      ],
      const SizedBox(height: 8),
      Text('${t('responsible')}: ${widget.plan['responsibleProviderId'] ?? '—'}'),
      Text('${t('period')}: ${_date(widget.plan['effectiveFrom'])} → ${_date(widget.plan['effectiveUntil'])}'),
      if (widget.plan['reviewAt'] != null) Text('${t('review')}: ${_date(widget.plan['reviewAt'])}'),
      Text(t('noInference'), style: const TextStyle(color: Color(0xFF64748B))),
    ]),
  ));


  Widget _adherenceCard() {
    final summary = _map(adherence['summary']);
    final denominator = _map(adherence['denominator']);
    final pct = summary['reportedCompletionPct'];
    return Card(
      key: const ValueKey('patient-care-plan-adherence'),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const Icon(Icons.insights_outlined),
            const SizedBox(width: 8),
            Expanded(child: Text(t('adherence'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17))),
          ]),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [7, 30, 90].map((days) => ChoiceChip(
              selected: adherenceDays == days,
              label: Text('${days}d'),
              onSelected: loading ? null : (_) {
                if (adherenceDays == days) return;
                setState(() => adherenceDays = days);
                _load();
              },
            )).toList(growable: false),
          ),
          const SizedBox(height: 12),
          if (denominator['value'] == null || denominator['value'] == 0)
            Text(t('noRecordedOutcomes'))
          else ...[
            Text(
              pct == null ? '—' : '${pct.toString()}%',
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900),
            ),
            Text(t('reportedCompletion')),
            const SizedBox(height: 8),
            Text('${t('doneCount')}: ${summary['done'] ?? 0}'),
            Text('${t('omittedCount')}: ${summary['omitted'] ?? 0}'),
            Text('${t('denominator')}: ${denominator['value'] ?? 0} · ${t('recordedOutcomes')}'),
          ],
          const SizedBox(height: 8),
          Text(
            t('adherenceNotice'),
            style: const TextStyle(color: Color(0xFF64748B)),
          ),
        ]),
      ),
    );
  }

  Widget _header(String value, IconData icon) => Row(children: [
    Icon(icon),
    const SizedBox(width: 8),
    Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18))),
  ]);

  Widget _empty(String value) => Card(child: Padding(padding: const EdgeInsets.all(14), child: Text(value)));

  Widget _goalCard(Map<String, dynamic> goal) {
    final data = _map(goal['data']);
    final detail = <String>[
      data['criterion']?.toString() ?? '',
      if (goal['metricCode'] != null) '${t('metric')}: ${goal['metricCode']}',
      if (data['comparator'] != null) '${data['comparator']} ${data['targetValue'] ?? ''}${data['targetUpperValue'] == null ? '' : ' – ${data['targetUpperValue']}'} ${data['unitCode'] ?? ''}'.trim(),
      '${t('period')}: ${_date(goal['periodStart'])} → ${_date(goal['periodEnd'])}',
    ].where((value) => value.trim().isNotEmpty).join('\n');
    return Card(child: ListTile(
      leading: const Icon(Icons.flag_circle_outlined),
      title: Text(data['label']?.toString() ?? t('goal'), style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text(detail),
      isThreeLine: true,
      trailing: Chip(label: Text(goal['status']?.toString() ?? '')),
    ));
  }

  Widget _taskCard(Map<String, dynamic> task) {
    final data = _map(task['data']);
    final completion = _map(task['latestCompletion']);
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.checklist_outlined),
          title: Text(data['label']?.toString() ?? t('task'), style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text([
            if (data['instructions']?.toString().trim().isNotEmpty == true) data['instructions'].toString(),
            '${t('type')}: ${data['kind'] ?? ''}',
            if (task['dueAt'] != null) '${t('due')}: ${_dateTime(task['dueAt'])}',
            if (task['recurrence'] != null) '${t('recurrence')}: ${_map(task['recurrence']).entries.map((entry) => '${entry.key}=${entry.value}').join(', ')}',
            if (completion.isNotEmpty) '${t('latest')}: ${completion['outcome']} · ${_dateTime(completion['occurredAt'])}${completion['reasonCode'] == null ? '' : ' · ${completion['reasonCode']}'}',
          ].join('\n')),
          isThreeLine: true,
        ),
        if (task['status'] == 'ACTIVE') Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.tonalIcon(
              key: ValueKey('patient-care-task-done-${task['id']}'),
              onPressed: () => _complete(task, 'DONE'),
              icon: const Icon(Icons.check_circle_outline),
              label: Text(t('done')),
            ),
            OutlinedButton.icon(
              key: ValueKey('patient-care-task-omit-${task['id']}'),
              onPressed: () => _complete(task, 'OMITTED'),
              icon: const Icon(Icons.remove_circle_outline),
              label: Text(t('omit')),
            ),
          ],
        ),
      ]),
    ));
  }

  Future<void> _complete(Map<String, dynamic> task, String outcome) async {
    String? reasonCode;
    if (outcome == 'OMITTED') {
      final controller = TextEditingController();
      final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(t('omitReason')),
        content: TextField(
          controller: controller,
          decoration: InputDecoration(labelText: t('reasonCode'), hintText: 'NOT_TODAY', border: const OutlineInputBorder()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, controller.text.trim().isNotEmpty), child: Text(t('confirm'))),
        ],
      ));
      reasonCode = controller.text.trim().toUpperCase().replaceAll(RegExp(r'[^A-Z0-9_:-]'), '_');
      controller.dispose();
      if (accepted != true || reasonCode.isEmpty) return;
    } else {
      final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(t('markDone')),
        content: Text(t('markDonePrompt')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
        ],
      ));
      if (accepted != true) return;
    }

    try {
      await api.completePatientCareTask(
        task['id'].toString(),
        occurrenceKey: _occurrenceKey(task),
        outcome: outcome,
        reasonCode: reasonCode,
      );
      await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  String _occurrenceKey(Map<String, dynamic> task) {
    final recurrence = _map(task['recurrence']);
    final source = recurrence.isEmpty
        ? DateTime.tryParse(task['dueAt']?.toString() ?? '')?.toUtc()
        : DateTime.now().toUtc();
    final value = source ?? DateTime.now().toUtc();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)}';
  }
}

String patientCarePlanText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Care Plans','carePlan':'Care Plan','intro':'Your active Care Plans are clinician-authored. Progress shown here comes only from recorded goals, tasks and your actions; it is not an automatic diagnosis.','adherence':'Task adherence','reportedCompletion':'Reported completion among recorded outcomes','doneCount':'Done','omittedCount':'Omitted','denominator':'Denominator','recordedOutcomes':'recorded outcomes','noRecordedOutcomes':'No DONE/OMITTED outcomes were recorded in this period.','adherenceNotice':'Only outcomes you recorded are included. Missing/unrecorded occurrences are not counted as non-adherence and this summary makes no clinical conclusion.','refresh':'Refresh','empty':'No active Care Plans.','status':'Status','review':'Next review','responsible':'Responsible provider','period':'Period','goals':'Goals','goal':'Goal','noGoals':'No active goals.','metric':'Metric','tasks':'Tasks','task':'Task','noTasks':'No patient tasks.','type':'Type','due':'Due','recurrence':'Recurrence','latest':'Latest action','done':'Done','omit':'Omit','omitReason':'Why are you omitting this occurrence?','reasonCode':'Reason code','markDone':'Mark task done','markDonePrompt':'Confirm that you completed this task occurrence.','confirm':'Confirm','cancel':'Cancel','noInference':'Care Plan content and goals come from your care team; this page does not generate clinical conclusions.'
    },
    CarePointLocale.ar: {
      'title':'خطط الرعاية','carePlan':'خطة رعاية','intro':'خطط الرعاية النشطة يضعها الفريق السريري. يعتمد التقدم هنا فقط على الأهداف والمهام والإجراءات المسجلة ولا يمثل تشخيصاً آلياً.','adherence':'الالتزام بالمهام','reportedCompletion':'الإكمال المبلّغ عنه ضمن النتائج المسجلة','doneCount':'مكتملة','omittedCount':'متخطاة','denominator':'المقام','recordedOutcomes':'نتائج مسجلة','noRecordedOutcomes':'لم يتم تسجيل نتائج مكتملة/متخطاة خلال هذه الفترة.','adherenceNotice':'يتم احتساب النتائج التي سجلتها فقط. لا تُعتبر الحالات غير المسجلة عدم التزام ولا يستنتج هذا الملخص أي حكم سريري.','refresh':'تحديث','empty':'لا توجد خطط رعاية نشطة.','status':'الحالة','review':'المراجعة القادمة','responsible':'المسؤول','period':'الفترة','goals':'الأهداف','goal':'هدف','noGoals':'لا توجد أهداف نشطة.','metric':'المقياس','tasks':'المهام','task':'مهمة','noTasks':'لا توجد مهام للمريض.','type':'النوع','due':'الاستحقاق','recurrence':'التكرار','latest':'آخر إجراء','done':'تم','omit':'تخطّي','omitReason':'لماذا تتخطى هذه المهمة؟','reasonCode':'رمز السبب','markDone':'تحديد المهمة كمكتملة','markDonePrompt':'أكد أنك أكملت هذه المهمة.','confirm':'تأكيد','cancel':'إلغاء','noInference':'محتوى الخطة والأهداف مصدره فريق الرعاية ولا تنشئ هذه الصفحة استنتاجات سريرية.'
    },
    CarePointLocale.fr: {
      'title':'Plans de soins','carePlan':'Plan de soins','intro':'Vos plans actifs sont rédigés par l’équipe clinique. La progression repose uniquement sur les objectifs, tâches et actions enregistrés; elle ne constitue pas un diagnostic automatique.','adherence':'Adhésion aux tâches','reportedCompletion':'Achèvement déclaré parmi les résultats enregistrés','doneCount':'Fait','omittedCount':'Omis','denominator':'Dénominateur','recordedOutcomes':'résultats enregistrés','noRecordedOutcomes':'Aucun résultat FAIT/OMIS n’a été enregistré sur cette période.','adherenceNotice':'Seuls les résultats que vous avez enregistrés sont inclus. Les occurrences non enregistrées ne sont pas comptées comme non-adhésion et ce résumé ne produit aucune conclusion clinique.','refresh':'Actualiser','empty':'Aucun plan de soins actif.','status':'Statut','review':'Prochaine révision','responsible':'Professionnel responsable','period':'Période','goals':'Objectifs','goal':'Objectif','noGoals':'Aucun objectif actif.','metric':'Métrique','tasks':'Tâches','task':'Tâche','noTasks':'Aucune tâche patient.','type':'Type','due':'Échéance','recurrence':'Récurrence','latest':'Dernière action','done':'Fait','omit':'Omettre','omitReason':'Pourquoi omettez-vous cette occurrence ?','reasonCode':'Code motif','markDone':'Marquer comme faite','markDonePrompt':'Confirmez que vous avez effectué cette occurrence.','confirm':'Confirmer','cancel':'Annuler','noInference':'Le contenu et les objectifs viennent de votre équipe de soins; cette page ne génère aucune conclusion clinique.'
    },
    CarePointLocale.es: {
      'title':'Planes de cuidado','carePlan':'Plan de cuidado','intro':'Tus planes activos son definidos por el equipo clínico. El progreso se basa solo en objetivos, tareas y acciones registradas; no es un diagnóstico automático.','adherence':'Adherencia a tareas','reportedCompletion':'Cumplimiento declarado entre resultados registrados','doneCount':'Hechas','omittedCount':'Omitidas','denominator':'Denominador','recordedOutcomes':'resultados registrados','noRecordedOutcomes':'No se registraron resultados HECHA/OMITIDA en este periodo.','adherenceNotice':'Solo se incluyen los resultados que registraste. Las ocurrencias no registradas no se cuentan como incumplimiento y este resumen no genera conclusiones clínicas.','refresh':'Actualizar','empty':'No hay planes de cuidado activos.','status':'Estado','review':'Próxima revisión','responsible':'Profesional responsable','period':'Periodo','goals':'Objetivos','goal':'Objetivo','noGoals':'No hay objetivos activos.','metric':'Métrica','tasks':'Tareas','task':'Tarea','noTasks':'No hay tareas para el paciente.','type':'Tipo','due':'Vencimiento','recurrence':'Recurrencia','latest':'Última acción','done':'Hecha','omit':'Omitir','omitReason':'¿Por qué omites esta tarea?','reasonCode':'Código de motivo','markDone':'Marcar como hecha','markDonePrompt':'Confirma que completaste esta tarea.','confirm':'Confirmar','cancel':'Cancelar','noInference':'El contenido y los objetivos proceden de tu equipo asistencial; esta página no genera conclusiones clínicas.'
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

String _date(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)}';
}

String _dateTime(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
