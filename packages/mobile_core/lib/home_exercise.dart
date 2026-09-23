import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String homeExerciseText(CarePointLocale locale, String key) =>
    _strings[locale.name]?[key] ?? _strings['en']![key] ?? key;

const _strings = <String, Map<String, String>>{
  'en': {
    'title': 'Home exercise programme',
    'providerTitle': 'Home exercise plans',
    'newPlan': 'Create programme',
    'addExercise': 'Add exercise',
    'exerciseCode': 'Exercise code',
    'label': 'Exercise name',
    'instructions': 'Instructions',
    'repetitions': 'Repetitions',
    'sets': 'Sets',
    'frequency': 'Frequency',
    'daily': 'Daily',
    'weekly': 'Weekly',
    'interval': 'Interval',
    'materials': 'Material codes',
    'materialsHint': 'Comma-separated structured codes',
    'resources': 'Approved document/media refs',
    'resourcesHint': 'DOCUMENT:id or CLINICAL_MEDIA:id, comma-separated',
    'reviewAt': 'Review date (optional ISO date-time)',
    'create': 'Create',
    'cancel': 'Cancel',
    'remove': 'Remove',
    'empty': 'No home exercise programme is assigned yet.',
    'noDraft': 'Add at least one exercise.',
    'compliance': 'Declared adherence',
    'done': 'Done',
    'omitted': 'Omitted',
    'declarations': 'Declarations',
    'markDone': 'I did this',
    'markOmitted': 'I skipped this',
    'saved': 'Home exercise programme saved.',
    'declared': 'Your declaration was recorded.',
    'patientNotice': 'These tasks were assigned by your care provider. Your entries report what you did; they do not generate a diagnosis.',
    'providerNotice': 'Patient adherence shown here is patient-declared. No automated clinical inference is generated.',
    'refresh': 'Refresh',
    'required': 'Complete the required fields.',
  },
  'ar': {
    'title': 'برنامج التمارين المنزلية',
    'providerTitle': 'خطط التمارين المنزلية',
    'newPlan': 'إنشاء برنامج',
    'addExercise': 'إضافة تمرين',
    'exerciseCode': 'رمز التمرين',
    'label': 'اسم التمرين',
    'instructions': 'التعليمات',
    'repetitions': 'التكرارات',
    'sets': 'المجموعات',
    'frequency': 'التكرار الزمني',
    'daily': 'يومي',
    'weekly': 'أسبوعي',
    'interval': 'الفاصل',
    'materials': 'رموز المواد',
    'materialsHint': 'رموز منظمة مفصولة بفواصل',
    'resources': 'مراجع مستندات/وسائط معتمدة',
    'resourcesHint': 'DOCUMENT:id أو CLINICAL_MEDIA:id مفصولة بفواصل',
    'reviewAt': 'موعد المراجعة (ISO اختياري)',
    'create': 'إنشاء',
    'cancel': 'إلغاء',
    'remove': 'حذف',
    'empty': 'لا يوجد برنامج تمارين منزلية مخصص بعد.',
    'noDraft': 'أضف تمريناً واحداً على الأقل.',
    'compliance': 'الالتزام المصرح به',
    'done': 'تم',
    'omitted': 'تم التجاوز',
    'declarations': 'التصريحات',
    'markDone': 'قمت بهذا',
    'markOmitted': 'تجاوزت هذا',
    'saved': 'تم حفظ برنامج التمارين المنزلية.',
    'declared': 'تم تسجيل تصريحك.',
    'patientNotice': 'تم تعيين هذه المهام من مقدم الرعاية. إدخالاتك تصف ما قمت به ولا تنشئ تشخيصاً.',
    'providerNotice': 'الالتزام المعروض مصرح به من المريض ولا يتم إنشاء استنتاج سريري آلي.',
    'refresh': 'تحديث',
    'required': 'أكمل الحقول المطلوبة.',
  },
  'fr': {
    'title': 'Programme d’exercices à domicile',
    'providerTitle': 'Programmes à domicile',
    'newPlan': 'Créer un programme',
    'addExercise': 'Ajouter un exercice',
    'exerciseCode': 'Code exercice',
    'label': 'Nom de l’exercice',
    'instructions': 'Instructions',
    'repetitions': 'Répétitions',
    'sets': 'Séries',
    'frequency': 'Fréquence',
    'daily': 'Quotidienne',
    'weekly': 'Hebdomadaire',
    'interval': 'Intervalle',
    'materials': 'Codes matériel',
    'materialsHint': 'Codes structurés séparés par des virgules',
    'resources': 'Références document/média approuvées',
    'resourcesHint': 'DOCUMENT:id ou CLINICAL_MEDIA:id, séparés par des virgules',
    'reviewAt': 'Date de révision (ISO facultative)',
    'create': 'Créer',
    'cancel': 'Annuler',
    'remove': 'Retirer',
    'empty': 'Aucun programme d’exercices à domicile n’est encore attribué.',
    'noDraft': 'Ajoutez au moins un exercice.',
    'compliance': 'Adhésion déclarée',
    'done': 'Fait',
    'omitted': 'Omis',
    'declarations': 'Déclarations',
    'markDone': 'Je l’ai fait',
    'markOmitted': 'Je l’ai omis',
    'saved': 'Programme d’exercices enregistré.',
    'declared': 'Votre déclaration a été enregistrée.',
    'patientNotice': 'Ces tâches ont été attribuées par votre soignant. Vos saisies indiquent ce que vous avez fait et ne génèrent aucun diagnostic.',
    'providerNotice': 'L’adhésion affichée est déclarée par le patient. Aucune inférence clinique automatisée.',
    'refresh': 'Actualiser',
    'required': 'Complétez les champs obligatoires.',
  },
  'es': {
    'title': 'Programa de ejercicios domiciliarios',
    'providerTitle': 'Planes de ejercicios domiciliarios',
    'newPlan': 'Crear programa',
    'addExercise': 'Añadir ejercicio',
    'exerciseCode': 'Código de ejercicio',
    'label': 'Nombre del ejercicio',
    'instructions': 'Instrucciones',
    'repetitions': 'Repeticiones',
    'sets': 'Series',
    'frequency': 'Frecuencia',
    'daily': 'Diaria',
    'weekly': 'Semanal',
    'interval': 'Intervalo',
    'materials': 'Códigos de material',
    'materialsHint': 'Códigos estructurados separados por comas',
    'resources': 'Referencias de documentos/medios aprobados',
    'resourcesHint': 'DOCUMENT:id o CLINICAL_MEDIA:id, separados por comas',
    'reviewAt': 'Fecha de revisión (ISO opcional)',
    'create': 'Crear',
    'cancel': 'Cancelar',
    'remove': 'Eliminar',
    'empty': 'Aún no hay un programa de ejercicios domiciliarios asignado.',
    'noDraft': 'Añade al menos un ejercicio.',
    'compliance': 'Adherencia declarada',
    'done': 'Realizado',
    'omitted': 'Omitido',
    'declarations': 'Declaraciones',
    'markDone': 'Lo he realizado',
    'markOmitted': 'Lo he omitido',
    'saved': 'Programa de ejercicios guardado.',
    'declared': 'Tu declaración se ha registrado.',
    'patientNotice': 'Estas tareas fueron asignadas por tu profesional. Tus entradas indican lo que realizaste y no generan un diagnóstico.',
    'providerNotice': 'La adherencia mostrada es declarada por el paciente. No se genera inferencia clínica automática.',
    'refresh': 'Actualizar',
    'required': 'Completa los campos obligatorios.',
  },
};

class ProviderHomeExercisePage extends StatefulWidget {
  const ProviderHomeExercisePage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  @override
  State<ProviderHomeExercisePage> createState() => _ProviderHomeExercisePageState();
}

class _ProviderHomeExercisePageState extends State<ProviderHomeExercisePage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> plans = const [];
  final List<Map<String, dynamic>> draft = [];
  String get patientId => _map(widget.appointment['patient'])['id']?.toString() ?? '';
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  _HomeExerciseApi get api => _HomeExerciseApi(widget.session);
  String t(String key) => homeExerciseText(widget.locale, key);

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    if (patientId.isEmpty) return setState(() { busy = false; error = 'Patient context unavailable.'; });
    setState(() { busy = true; error = null; });
    try {
      final value = await api.providerPlans(patientId);
      if (mounted) setState(() => plans = _list(value['items']));
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('providerTitle')), actions: [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), tooltip: t('refresh'))]),
    body: busy ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
      onRefresh: load,
      child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
        Card(child: Padding(padding: const EdgeInsets.all(14), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.fact_check_outlined), const SizedBox(width: 10), Expanded(child: Text(t('providerNotice'))),
        ]))),
        if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!)),
        const SizedBox(height: 8),
        FilledButton.icon(onPressed: _createProgramme, icon: const Icon(Icons.add_task), label: Text(t('newPlan'))),
        const SizedBox(height: 12),
        if (plans.isEmpty) Padding(padding: const EdgeInsets.all(18), child: Text(t('empty'))),
        ...plans.map((plan) => Card(child: ListTile(
          leading: const CircleAvatar(child: Icon(Icons.fitness_center_outlined)),
          title: Text(t('title'), style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text('${_dateTime(plan['effectiveFrom'])}\n${_list(plan['exercises']).length} ${t('addExercise')}'),
          isThreeLine: true,
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showCompliance(plan),
        ))),
      ]),
    ),
  );

  Future<void> _createProgramme() async {
    draft.clear();
    final review = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(builder: (dialogContext, setDialog) => AlertDialog(
        title: Text(t('newPlan')),
        content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: review, decoration: InputDecoration(labelText: t('reviewAt'))),
          const SizedBox(height: 10),
          ...draft.asMap().entries.map((entry) => Card(child: ListTile(
            title: Text(entry.value['label']?.toString() ?? ''),
            subtitle: Text('${entry.value['repetitions']} × ${entry.value['sets']} · ${_map(entry.value['recurrence'])['frequency']}'),
            trailing: IconButton(icon: const Icon(Icons.delete_outline), tooltip: t('remove'), onPressed: () => setDialog(() => draft.removeAt(entry.key))),
          ))),
          OutlinedButton.icon(onPressed: () async {
            final item = await _exerciseDialog(dialogContext);
            if (item != null) setDialog(() => draft.add(item));
          }, icon: const Icon(Icons.add), label: Text(t('addExercise'))),
        ]))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('create'))),
        ],
      )),
    );
    if (accepted != true) return;
    if (draft.isEmpty) return _message(t('noDraft'));
    try {
      await api.createProviderPlan({
        'appointmentId': appointmentId,
        'idempotencyKey': 'mobile-hep-${DateTime.now().microsecondsSinceEpoch}',
        if (review.text.trim().isNotEmpty) 'reviewAt': review.text.trim(),
        'exercises': draft,
      });
      _message(t('saved'));
      await load();
    } catch (value) { _message(value.toString()); }
  }

  Future<Map<String, dynamic>?> _exerciseDialog(BuildContext parent) async {
    final code = TextEditingController();
    final label = TextEditingController();
    final instructions = TextEditingController();
    final repetitions = TextEditingController(text: '10');
    final sets = TextEditingController(text: '1');
    final interval = TextEditingController(text: '1');
    final materials = TextEditingController();
    final resources = TextEditingController();
    String frequency = 'DAILY';
    return showDialog<Map<String, dynamic>>(
      context: parent,
      builder: (_) => StatefulBuilder(builder: (context, setModal) => AlertDialog(
        title: Text(t('addExercise')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: code, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: t('exerciseCode'))),
          TextField(controller: label, decoration: InputDecoration(labelText: t('label'))),
          TextField(controller: instructions, maxLines: 3, decoration: InputDecoration(labelText: t('instructions'))),
          TextField(controller: repetitions, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: t('repetitions'))),
          TextField(controller: sets, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: t('sets'))),
          DropdownButtonFormField<String>(initialValue: frequency, decoration: InputDecoration(labelText: t('frequency')), items: [
            DropdownMenuItem(value: 'DAILY', child: Text(t('daily'))),
            DropdownMenuItem(value: 'WEEKLY', child: Text(t('weekly'))),
          ], onChanged: (value) => setModal(() => frequency = value ?? frequency)),
          TextField(controller: interval, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: t('interval'))),
          TextField(controller: materials, decoration: InputDecoration(labelText: t('materials'), helperText: t('materialsHint'))),
          TextField(controller: resources, decoration: InputDecoration(labelText: t('resources'), helperText: t('resourcesHint'))),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(t('cancel'))),
          FilledButton(onPressed: () {
            final reps = int.tryParse(repetitions.text.trim());
            final setCount = int.tryParse(sets.text.trim());
            final every = int.tryParse(interval.text.trim());
            if (code.text.trim().isEmpty || label.text.trim().isEmpty || reps == null || setCount == null || every == null) return;
            final approved = <Map<String, dynamic>>[];
            for (final raw in resources.text.split(',').map((item) => item.trim()).where((item) => item.isNotEmpty)) {
              final split = raw.indexOf(':');
              if (split <= 0 || split == raw.length - 1) continue;
              approved.add({'type': raw.substring(0, split).trim().toUpperCase(), 'id': raw.substring(split + 1).trim()});
            }
            Navigator.pop(context, {
              'exerciseCode': code.text.trim().toUpperCase(),
              'label': label.text.trim(),
              if (instructions.text.trim().isNotEmpty) 'instructions': instructions.text.trim(),
              'repetitions': reps,
              'sets': setCount,
              'recurrence': {'frequency': frequency, 'interval': every},
              'materialCodes': materials.text.split(',').map((item) => item.trim().toUpperCase()).where((item) => item.isNotEmpty).toSet().toList(),
              'approvedResources': approved,
            });
          }, child: Text(t('addExercise'))),
        ],
      )),
    );
  }

  Future<void> _showCompliance(Map<String, dynamic> plan) async {
    try {
      final value = await api.providerCompliance(plan['id'].toString());
      if (!mounted) return;
      final items = _list(value['items']);
      await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: SafeArea(child: FractionallySizedBox(heightFactor: .8, child: Column(children: [
          ListTile(title: Text(t('compliance'), style: const TextStyle(fontWeight: FontWeight.w800)), subtitle: Text(t('providerNotice')), trailing: IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close))),
          const Divider(height: 1),
          Expanded(child: items.isEmpty ? Center(child: Text(t('empty'))) : ListView.builder(itemCount: items.length, itemBuilder: (_, index) {
            final item = items[index];
            return ListTile(
              title: Text(item['label']?.toString() ?? item['exerciseCode']?.toString() ?? ''),
              subtitle: Text('${t('declarations')}: ${item['declared']} · ${t('done')}: ${item['done']} · ${t('omitted')}: ${item['omitted']}'),
            );
          })),
        ]))),
      ));
    } catch (value) { _message(value.toString()); }
  }

  void _message(String value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value))); }
}

class PatientHomeExercisePage extends StatefulWidget {
  const PatientHomeExercisePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<PatientHomeExercisePage> createState() => _PatientHomeExercisePageState();
}

class _PatientHomeExercisePageState extends State<PatientHomeExercisePage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> tasks = const [];
  _HomeExerciseApi get api => _HomeExerciseApi(widget.session);
  String t(String key) => homeExerciseText(widget.locale, key);

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final plans = await api.patientPlans();
      final homePlans = _list(plans['items']).where((plan) => _map(plan['data'])['kind'] == 'HOME_EXERCISE_PLAN').toList(growable: false);
      final next = <Map<String, dynamic>>[];
      for (final plan in homePlans) {
        final response = await api.patientTasks(plan['id'].toString());
        for (final task in _list(response['items'])) {
          if (_map(task['data'])['kind'] == 'EXERCISE') next.add({...task, 'plan': plan});
        }
      }
      if (mounted) setState(() => tasks = next);
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('title')), actions: [IconButton(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), tooltip: t('refresh'))]),
    body: busy ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
      onRefresh: load,
      child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
        Card(child: Padding(padding: const EdgeInsets.all(14), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.info_outline), const SizedBox(width: 10), Expanded(child: Text(t('patientNotice'))),
        ]))),
        if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!)),
        if (tasks.isEmpty) Padding(padding: const EdgeInsets.all(18), child: Text(t('empty'))),
        ...tasks.map(_taskCard),
      ]),
    ),
  );

  Widget _taskCard(Map<String, dynamic> task) {
    final data = _map(task['data']);
    final recurrence = _map(task['recurrence']);
    final resources = _list(data['approvedResources']);
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(data['label']?.toString() ?? data['exerciseCode']?.toString() ?? t('title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
      if (data['instructions'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(data['instructions'].toString())),
      const SizedBox(height: 8),
      Text('${t('repetitions')}: ${data['repetitions'] ?? '—'} · ${t('sets')}: ${data['sets'] ?? '—'}'),
      if (recurrence.isNotEmpty) Text('${t('frequency')}: ${recurrence['frequency']} · ${t('interval')}: ${recurrence['interval']}'),
      if (_listString(data['materialCodes']).isNotEmpty) Text('${t('materials')}: ${_listString(data['materialCodes']).join(', ')}'),
      if (resources.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Wrap(spacing: 6, children: resources.map((item) => Chip(label: Text('${item['type']}:${item['id']}'))).toList())),
      const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [
        FilledButton.icon(onPressed: () => _declare(task, 'DONE'), icon: const Icon(Icons.check), label: Text(t('markDone'))),
        OutlinedButton.icon(onPressed: () => _declare(task, 'OMITTED'), icon: const Icon(Icons.remove_circle_outline), label: Text(t('markOmitted'))),
      ]),
    ])));
  }

  Future<void> _declare(Map<String, dynamic> task, String outcome) async {
    final now = DateTime.now().toUtc();
    final occurrence = '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    try {
      await api.completeTask(task['id'].toString(), occurrence, outcome);
      _message(t('declared'));
    } catch (value) { _message(value.toString()); }
  }

  void _message(String value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value))); }
}

class _HomeExerciseApi {
  const _HomeExerciseApi(this.session);
  final CarePointSession session;

  Future<Map<String, dynamic>> providerPlans(String patientId) => _request('GET', '/provider/home-exercise-plans/patients/${Uri.encodeComponent(patientId)}');
  Future<Map<String, dynamic>> createProviderPlan(Map<String, dynamic> body) => _request('POST', '/provider/home-exercise-plans', body: body);
  Future<Map<String, dynamic>> providerCompliance(String planId) => _request('GET', '/provider/home-exercise-plans/${Uri.encodeComponent(planId)}/compliance');
  Future<Map<String, dynamic>> patientPlans() => _request('GET', '/patient/care-plans');
  Future<Map<String, dynamic>> patientTasks(String planId) => _request('GET', '/patient/care-plans/${Uri.encodeComponent(planId)}/tasks');
  Future<Map<String, dynamic>> completeTask(String taskId, String occurrenceKey, String outcome) =>
      _request('POST', '/patient/care-tasks/${Uri.encodeComponent(taskId)}/completions', body: {'occurrenceKey': occurrenceKey, 'outcome': outcome});

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body}) async {
    await session.api.me();
    final token = session.api.accessToken;
    if (token == null || token.isEmpty) throw const CarePointApiException('Authentication is required.');
    final uri = Uri.parse('${session.api.baseUrl}$path');
    final headers = <String, String>{
      'accept': 'application/json',
      'authorization': 'Bearer $token',
      if (body != null) 'content-type': 'application/json',
    };
    final response = method == 'GET'
        ? await http.get(uri, headers: headers)
        : await http.post(uri, headers: headers, body: jsonEncode(body));
    dynamic payload;
    if (response.body.isNotEmpty) {
      try { payload = jsonDecode(response.body); } catch (_) { payload = response.body; }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map && payload['message'] != null ? payload['message'].toString() : 'Request failed (${response.statusCode}).';
      throw CarePointApiException(message, statusCode: response.statusCode, payload: payload);
    }
    return _map(payload);
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

List<String> _listString(dynamic value) {
  if (value is! List) return const [];
  return value.whereType<String>().toList(growable: false);
}

String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
}
