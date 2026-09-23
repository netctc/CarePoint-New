import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientAppointmentPrepPage extends StatefulWidget {
  const PatientAppointmentPrepPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<PatientAppointmentPrepPage> createState() => _PatientAppointmentPrepPageState();
}

class _PatientAppointmentPrepPageState extends State<PatientAppointmentPrepPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> payload = const {};

  CarePointApi get api => widget.session.api;
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  String t(String key) => patientAppointmentContinuityText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final value = await api.patientAppointmentPrep(appointmentId);
      if (mounted) setState(() => payload = value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final readiness = _map(payload['readiness']);
    final tasks = _maps(payload['tasks']);
    return Scaffold(
      appBar: AppBar(
        title: Text(t('prepTitle')),
        actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
      ),
      body: loading && payload.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(12),
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  _readinessCard(readiness),
                  if (error != null) Card(child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  )),
                  const SizedBox(height: 10),
                  if (tasks.isEmpty && error == null)
                    Padding(padding: const EdgeInsets.all(24), child: Text(t('noPrep'), textAlign: TextAlign.center))
                  else
                    ...tasks.map(_taskCard),
                ],
              ),
            ),
    );
  }

  Widget _readinessCard(Map<String, dynamic> readiness) {
    final percent = _int(readiness['completionPercent'], 0);
    final ready = readiness['ready'] == true;
    return Card(child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(ready ? Icons.check_circle_outline : Icons.pending_actions_outlined),
          const SizedBox(width: 8),
          Expanded(child: Text(ready ? t('ready') : t('notReady'), style: const TextStyle(fontWeight: FontWeight.w900))),
          Text('$percent%'),
        ]),
        const SizedBox(height: 8),
        LinearProgressIndicator(value: (percent.clamp(0, 100)) / 100),
        const SizedBox(height: 8),
        Text(t('prepNotice'), style: const TextStyle(color: Color(0xFF64748B))),
      ]),
    ));
  }

  Widget _taskCard(Map<String, dynamic> task) {
    final status = task['status']?.toString() ?? 'PENDING';
    final required = task['required'] == true;
    final type = task['taskType']?.toString() ?? 'OTHER';
    final pending = status == 'PENDING';
    final sourceRequired = const {'QUESTIONNAIRE','OBSERVATION','DOCUMENT'}.contains(type);
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(_taskIcon(type)),
          title: Text(_taskLabel(task['code']?.toString() ?? '', widget.locale), style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text([
            '${t('type')}: $type',
            '${t('status')}: $status',
            if (task['dueAt'] != null) '${t('due')}: ${_dateTime(task['dueAt'])}',
            if (task['sourceRef']?.toString().isNotEmpty == true) '${t('sourceRef')}: ${task['sourceRef']}',
          ].join('\n')),
          isThreeLine: true,
          trailing: required ? Chip(label: Text(t('required'))) : null,
        ),
        if (pending) Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.tonalIcon(
              key: ValueKey('patient-prep-complete-${task['code']}'),
              onPressed: () => _complete(task, sourceRequired),
              icon: const Icon(Icons.check_circle_outline),
              label: Text(t('complete')),
            ),
            if (!required)
              OutlinedButton.icon(
                key: ValueKey('patient-prep-na-${task['code']}'),
                onPressed: () => _update(task, 'NOT_APPLICABLE'),
                icon: const Icon(Icons.remove_circle_outline),
                label: Text(t('notApplicable')),
              ),
          ],
        ),
      ]),
    ));
  }

  Future<void> _complete(Map<String, dynamic> task, bool sourceRequired) async {
    String? sourceRef;
    if (sourceRequired) {
      final controller = TextEditingController();
      final ok = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(t('evidenceTitle')),
        content: TextField(
          controller: controller,
          decoration: InputDecoration(
            labelText: t('sourceRef'),
            hintText: t('sourceRefHint'),
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim().isNotEmpty),
            child: Text(t('confirm')),
          ),
        ],
      ));
      sourceRef = controller.text.trim();
      controller.dispose();
      if (ok != true || sourceRef.isEmpty) return;
    } else {
      final ok = await _confirm(t('complete'), t('completePrompt'));
      if (!ok) return;
    }
    await _update(task, 'COMPLETED', sourceRef: sourceRef);
  }

  Future<void> _update(Map<String, dynamic> task, String status, {String? sourceRef}) async {
    final code = task['code']?.toString() ?? '';
    if (code.isEmpty) return;
    try {
      final next = await api.updatePatientAppointmentPrep(appointmentId, code, status: status, sourceRef: sourceRef);
      if (mounted) setState(() => payload = next);
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
        ],
      )) ?? false;
}

class PatientEncounterFollowUpPage extends StatefulWidget {
  const PatientEncounterFollowUpPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  State<PatientEncounterFollowUpPage> createState() => _PatientEncounterFollowUpPageState();
}

class _PatientEncounterFollowUpPageState extends State<PatientEncounterFollowUpPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic>? item;

  String t(String key) => patientAppointmentContinuityText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final value = await widget.session.api.patientEncounterFollowUp(widget.appointment['id'].toString());
      if (mounted) setState(() => item = value);
    } on CarePointApiException catch (value) {
      if (mounted) setState(() => error = value.statusCode == 404 ? t('followUpUnavailable') : value.toString());
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final followUp = _map(item?['followUp']);
    final days = _int(followUp['recommendedAfterDays'], 0);
    final starts = DateTime.tryParse(widget.appointment['startsAt']?.toString() ?? '');
    final recommended = starts == null || days <= 0 ? null : starts.add(Duration(days: days));
    final careTaskIds = _strings(followUp['careTaskIds']);
    return Scaffold(
      appBar: AppBar(
        title: Text(t('followUpTitle')),
        actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(t('followUpNotice'), style: const TextStyle(color: Color(0xFF475569))),
                    )),
                    Card(child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Row(children: [
                          const Icon(Icons.assignment_turned_in_outlined),
                          const SizedBox(width: 8),
                          Expanded(child: Text(t('releasedPlan'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18))),
                          Chip(label: Text('v${item?['version'] ?? '—'}')),
                        ]),
                        const SizedBox(height: 10),
                        Text('${t('status')}: ${item?['status'] ?? ''}'),
                        Text('${t('releasedAt')}: ${_dateTime(item?['releasedAt'])}'),
                        if (recommended != null) Text('${t('recommendedReview')}: ${_dateTime(recommended.toIso8601String())}'),
                        Text('${t('modality')}: ${followUp['modality'] ?? ''}'),
                        Text('${t('reason')}: ${followUp['reasonCode'] ?? ''}'),
                        if (followUp['instructions']?.toString().trim().isNotEmpty == true) ...[
                          const SizedBox(height: 12),
                          Text(t('instructions'), style: const TextStyle(fontWeight: FontWeight.w800)),
                          Text(followUp['instructions'].toString()),
                        ],
                        const SizedBox(height: 12),
                        Text(t('tasks'), style: const TextStyle(fontWeight: FontWeight.w800)),
                        if (careTaskIds.isEmpty)
                          Text(t('noLinkedTasks'))
                        else
                          ...careTaskIds.map((id) => ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(Icons.task_alt_outlined),
                            title: Text(id),
                          )),
                        const Divider(),
                        Text(
                          item?['bookingCreated'] == false ? t('bookingSeparate') : t('followUpNotice'),
                          style: const TextStyle(color: Color(0xFF64748B)),
                        ),
                      ]),
                    )),
                  ],
                ),
    );
  }
}

String patientAppointmentContinuityText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'prepTitle':'Prepare for visit','followUpTitle':'After-visit plan','refresh':'Refresh','ready':'Ready for visit','notReady':'Preparation in progress',
      'prepNotice':'Only explicitly required pending items affect readiness. Optional items never block the visit unless your care team configured them as required.',
      'noPrep':'No preparation tasks are configured.','type':'Type','status':'Status','due':'Due','sourceRef':'Evidence reference','sourceRefHint':'Questionnaire / observation / document reference ID',
      'required':'Required','complete':'Complete','notApplicable':'Not applicable','completePrompt':'Mark this preparation task as completed?','evidenceTitle':'Link completed evidence',
      'cancel':'Cancel','confirm':'Confirm','followUpUnavailable':'No released after-visit plan is available yet.','followUpNotice':'This is the released, versioned follow-up plan from your care team. It does not book an appointment automatically.',
      'releasedPlan':'Released follow-up plan','releasedAt':'Released','recommendedReview':'Recommended review','modality':'Recommended modality','reason':'Reason code','instructions':'Instructions','tasks':'Linked care tasks','noLinkedTasks':'No linked Care Plan tasks.','bookingSeparate':'If another visit is needed, booking remains a separate patient action.'
    },
    CarePointLocale.ar: {
      'prepTitle':'التحضير للزيارة','followUpTitle':'خطة ما بعد الزيارة','refresh':'تحديث','ready':'جاهز للزيارة','notReady':'التحضير قيد التنفيذ',
      'prepNotice':'تؤثر فقط العناصر المطلوبة صراحةً والمعلقة على الجاهزية. العناصر الاختيارية لا تمنع الزيارة ما لم يحددها فريق الرعاية كمطلوبة.',
      'noPrep':'لا توجد مهام تحضير مهيأة.','type':'النوع','status':'الحالة','due':'الاستحقاق','sourceRef':'مرجع الدليل','sourceRefHint':'معرّف الاستبيان / الملاحظة / المستند',
      'required':'مطلوب','complete':'إكمال','notApplicable':'غير منطبق','completePrompt':'تحديد مهمة التحضير كمكتملة؟','evidenceTitle':'ربط دليل الإكمال',
      'cancel':'إلغاء','confirm':'تأكيد','followUpUnavailable':'لا توجد خطة ما بعد الزيارة منشورة حتى الآن.','followUpNotice':'هذه خطة المتابعة المنشورة ذات الإصدار من فريق الرعاية. لا تحجز موعداً تلقائياً.',
      'releasedPlan':'خطة متابعة منشورة','releasedAt':'تاريخ النشر','recommendedReview':'المراجعة المقترحة','modality':'طريقة المتابعة','reason':'رمز السبب','instructions':'التعليمات','tasks':'مهام الرعاية المرتبطة','noLinkedTasks':'لا توجد مهام رعاية مرتبطة.','bookingSeparate':'إذا لزم موعد آخر فيبقى الحجز إجراءً مستقلاً يقوم به المريض.'
    },
    CarePointLocale.fr: {
      'prepTitle':'Préparer la consultation','followUpTitle':'Plan après consultation','refresh':'Actualiser','ready':'Prêt pour la consultation','notReady':'Préparation en cours',
      'prepNotice':'Seuls les éléments explicitement obligatoires et en attente affectent la préparation. Les éléments facultatifs ne bloquent jamais la consultation sauf politique explicite.',
      'noPrep':'Aucune tâche de préparation configurée.','type':'Type','status':'Statut','due':'Échéance','sourceRef':'Référence de preuve','sourceRefHint':'ID questionnaire / observation / document',
      'required':'Obligatoire','complete':'Terminer','notApplicable':'Non applicable','completePrompt':'Marquer cette tâche comme terminée ?','evidenceTitle':'Lier la preuve réalisée',
      'cancel':'Annuler','confirm':'Confirmer','followUpUnavailable':'Aucun plan après consultation publié pour le moment.','followUpNotice':'Il s’agit du plan de suivi versionné et publié par votre équipe de soins. Il ne réserve aucun rendez-vous automatiquement.',
      'releasedPlan':'Plan de suivi publié','releasedAt':'Publié','recommendedReview':'Révision recommandée','modality':'Modalité recommandée','reason':'Code motif','instructions':'Instructions','tasks':'Tâches de soins liées','noLinkedTasks':'Aucune tâche de plan de soins liée.','bookingSeparate':'Si une nouvelle visite est nécessaire, la réservation reste une action distincte du patient.'
    },
    CarePointLocale.es: {
      'prepTitle':'Preparar consulta','followUpTitle':'Plan postconsulta','refresh':'Actualizar','ready':'Listo para la consulta','notReady':'Preparación en curso',
      'prepNotice':'Solo los elementos pendientes marcados explícitamente como obligatorios afectan a la preparación. Los opcionales no bloquean salvo política explícita.',
      'noPrep':'No hay tareas de preparación configuradas.','type':'Tipo','status':'Estado','due':'Vencimiento','sourceRef':'Referencia de evidencia','sourceRefHint':'ID de cuestionario / observación / documento',
      'required':'Obligatorio','complete':'Completar','notApplicable':'No aplicable','completePrompt':'¿Marcar esta tarea de preparación como completada?','evidenceTitle':'Vincular evidencia completada',
      'cancel':'Cancelar','confirm':'Confirmar','followUpUnavailable':'Aún no hay un plan postconsulta liberado.','followUpNotice':'Este es el plan de seguimiento versionado y liberado por tu equipo asistencial. No reserva citas automáticamente.',
      'releasedPlan':'Plan liberado','releasedAt':'Liberado','recommendedReview':'Revisión recomendada','modality':'Modalidad recomendada','reason':'Código de motivo','instructions':'Instrucciones','tasks':'Tareas de cuidado vinculadas','noLinkedTasks':'No hay tareas de Care Plan vinculadas.','bookingSeparate':'Si necesitas otra consulta, la reserva sigue siendo una acción independiente del paciente.'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

IconData _taskIcon(String type) => switch (type) {
  'QUESTIONNAIRE' => Icons.fact_check_outlined,
  'OBSERVATION' => Icons.monitor_heart_outlined,
  'DOCUMENT' => Icons.description_outlined,
  'DEVICE_CHECK' => Icons.devices_outlined,
  'QUESTIONS' => Icons.question_answer_outlined,
  _ => Icons.task_alt_outlined,
};

String _taskLabel(String code, CarePointLocale locale) {
  const known = <String, Map<CarePointLocale, String>>{
    'PREPARE_QUESTIONS': {
      CarePointLocale.en:'Prepare questions', CarePointLocale.ar:'حضّر أسئلتك', CarePointLocale.fr:'Préparer vos questions', CarePointLocale.es:'Preparar preguntas',
    },
    'DEVICE_CHECK': {
      CarePointLocale.en:'Check device', CarePointLocale.ar:'فحص الجهاز', CarePointLocale.fr:'Vérifier l’appareil', CarePointLocale.es:'Comprobar dispositivo',
    },
  };
  return known[code]?[locale] ?? code.replaceAll('_', ' ');
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

int _int(dynamic value, int fallback) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;

String _dateTime(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
