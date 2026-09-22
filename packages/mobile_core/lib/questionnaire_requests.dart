import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorQuestionnaireRequestsPage extends StatefulWidget {
  const DoctorQuestionnaireRequestsPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
    required this.appointment,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;
  final Map<String, dynamic> appointment;

  @override
  State<DoctorQuestionnaireRequestsPage> createState() => _DoctorQuestionnaireRequestsPageState();
}

class _DoctorQuestionnaireRequestsPageState extends State<DoctorQuestionnaireRequestsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> options = const [];
  List<Map<String, dynamic>> requests = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => questionnaireRequestText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        api.doctorQuestionnaireRequestOptions(widget.patientId, widget.appointment['id'].toString()),
        api.doctorQuestionnaireRequests(widget.patientId),
      ]);
      if (!mounted) return;
      setState(() {
        options = _maps(values[0]['items']);
        requests = _maps(values[1]['items']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _create() async {
    if (options.isEmpty) {
      _message(t('noTemplates'));
      return;
    }
    final status = widget.appointment['status']?.toString();
    final startsAt = DateTime.tryParse(widget.appointment['startsAt']?.toString() ?? '')?.toUtc();
    final now = DateTime.now().toUtc();
    final preVisitDue = startsAt?.subtract(const Duration(minutes: 30));
    final canPreVisit = status == 'CONFIRMED' && preVisitDue != null && preVisitDue.isAfter(now);
    final canPostVisit = status == 'COMPLETED';
    if (!canPreVisit && !canPostVisit) {
      _message(t('invalidAppointment'));
      return;
    }

    String code = options.first['code'].toString();
    String context = canPreVisit ? 'PRE_VISIT' : 'POST_VISIT';
    final accepted = await showDialog<bool>(
      context: this.context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setLocal) => AlertDialog(
        title: Text(t('request')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          DropdownButtonFormField<String>(
            initialValue: code,
            decoration: InputDecoration(labelText: t('template')),
            items: options.map((item) => DropdownMenuItem(
              value: item['code'].toString(),
              child: Text(_localized(item['labels'], widget.locale, item['code'].toString())),
            )).toList(growable: false),
            onChanged: (value) => setLocal(() => code = value ?? code),
          ),
          const SizedBox(height: 12),
          if (canPostVisit)
            DropdownButtonFormField<String>(
              initialValue: context,
              decoration: InputDecoration(labelText: t('context')),
              items: const [
                DropdownMenuItem(value: 'POST_VISIT', child: Text('POST_VISIT')),
                DropdownMenuItem(value: 'FOLLOW_UP', child: Text('FOLLOW_UP')),
              ],
              onChanged: (value) => setLocal(() => context = value ?? context),
            )
          else
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event_available_outlined),
              title: Text(t('preVisit')),
              subtitle: Text('${t('due')}: ${_dateTime(preVisitDue)}'),
            ),
          const SizedBox(height: 8),
          Text(t('exactVersionHint'), style: const TextStyle(color: Color(0xFF64748B))),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('request'))),
        ],
      )),
    );
    if (accepted != true) return;

    final dueAt = context == 'PRE_VISIT'
        ? preVisitDue
        : now.add(const Duration(days: 7));
    if (dueAt == null) return;
    try {
      await api.createDoctorQuestionnaireRequest(widget.patientId, {
        'questionnaireCode': code,
        'appointmentId': widget.appointment['id'].toString(),
        'context': context,
        'dueAt': dueAt.toIso8601String(),
        'idempotencyKey': 'mobile-qreq-${DateTime.now().microsecondsSinceEpoch}',
      });
      await _load();
    } catch (value) {
      _message(value.toString());
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('doctorTitle')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: _create,
      icon: const Icon(Icons.add_task_outlined),
      label: Text(t('request')),
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: _load,
                child: requests.isEmpty
                    ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(t('noRequests'), textAlign: TextAlign.center))])
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                        itemCount: requests.length,
                        itemBuilder: (_, index) {
                          final item = requests[index];
                          return Card(child: ListTile(
                            leading: const Icon(Icons.assignment_outlined),
                            title: Text(_localized(item['labels'], widget.locale, item['code']?.toString() ?? t('questionnaire'))),
                            subtitle: Text(
                              '${item['context'] ?? ''} · ${item['status'] ?? ''}\n'
                              '${t('version')} ${item['questionnaireVersion'] ?? ''} · ${t('due')}: ${_dateTimeValue(item['dueAt'])}',
                            ),
                            isThreeLine: true,
                          ));
                        },
                      ),
              ),
  );

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

class PatientQuestionnaireRequestsPage extends StatefulWidget {
  const PatientQuestionnaireRequestsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientQuestionnaireRequestsPage> createState() => _PatientQuestionnaireRequestsPageState();
}

class _PatientQuestionnaireRequestsPageState extends State<PatientQuestionnaireRequestsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => questionnaireRequestText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final value = await widget.session.api.patientQuestionnaireRequests();
      if (mounted) setState(() => items = _maps(value['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _open(Map<String, dynamic> item) async {
    final completed = await Navigator.push<bool>(context, MaterialPageRoute(
      builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: RequestedQuestionnaireFormPage(
          session: widget.session,
          locale: widget.locale,
          request: item,
        ),
      ),
    ));
    if (completed == true) await _load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('patientTitle')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(
                onRefresh: _load,
                child: items.isEmpty
                    ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(t('noPatientRequests'), textAlign: TextAlign.center))])
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: items.length,
                        itemBuilder: (_, index) {
                          final item = items[index];
                          return Card(child: ListTile(
                            key: ValueKey('patient-questionnaire-request-${item['id']}'),
                            leading: const Icon(Icons.fact_check_outlined),
                            title: Text(_localized(item['labels'], widget.locale, item['code']?.toString() ?? t('questionnaire'))),
                            subtitle: Text(
                              '${item['context'] ?? ''}\n'
                              '${t('version')} ${item['questionnaireVersion'] ?? ''} · ${t('due')}: ${_dateTimeValue(item['dueAt'])}',
                            ),
                            isThreeLine: true,
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => _open(item),
                          ));
                        },
                      ),
              ),
  );
}

class RequestedQuestionnaireFormPage extends StatefulWidget {
  const RequestedQuestionnaireFormPage({
    super.key,
    required this.session,
    required this.locale,
    required this.request,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> request;

  @override
  State<RequestedQuestionnaireFormPage> createState() => _RequestedQuestionnaireFormPageState();
}

class _RequestedQuestionnaireFormPageState extends State<RequestedQuestionnaireFormPage> {
  final Map<String, dynamic> answers = {};
  bool saving = false;
  String? validation;

  String t(String key) => questionnaireRequestText(widget.locale, key);
  List<Map<String, dynamic>> get questions => _maps(_map(widget.request['schema'])['questions']);

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(_localized(widget.request['labels'], widget.locale, widget.request['code']?.toString() ?? t('questionnaire')))),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('${t('due')}: ${_dateTimeValue(widget.request['dueAt'])}', style: const TextStyle(color: Color(0xFF64748B))),
        const SizedBox(height: 16),
        ...questions.map(_question),
        if (validation != null) Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ),
        const SizedBox(height: 18),
        FilledButton.icon(
          key: const ValueKey('patient-questionnaire-submit'),
          onPressed: saving ? null : _submit,
          icon: const Icon(Icons.check_circle_outline),
          label: Text(t('submit')),
        ),
      ],
    ),
  );

  Widget _question(Map<String, dynamic> question) {
    final id = question['id']?.toString() ?? '';
    final type = question['type']?.toString() ?? '';
    final label = _localized(question['labels'], widget.locale, id);
    final required = question['required'] == true;
    final decorated = required ? '$label *' : label;

    if (type == 'BOOLEAN') {
      final value = answers[id] as bool?;
      return Card(child: SwitchListTile(
        title: Text(decorated),
        subtitle: value == null ? Text(t('notAnswered')) : null,
        value: value ?? false,
        onChanged: (next) => setState(() => answers[id] = next),
      ));
    }
    if (type == 'SINGLE_CHOICE') {
      final options = _maps(question['options']);
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: DropdownButtonFormField<String>(
          initialValue: answers[id]?.toString(),
          decoration: InputDecoration(labelText: decorated, border: const OutlineInputBorder()),
          items: options.map((option) => DropdownMenuItem(
            value: option['value'].toString(),
            child: Text(_localized(option['labels'], widget.locale, option['value'].toString())),
          )).toList(growable: false),
          onChanged: (value) => setState(() {
            if (value == null) { answers.remove(id); } else { answers[id] = value; }
          }),
        ),
      );
    }
    if (type == 'MULTI_CHOICE') {
      final options = _maps(question['options']);
      final selected = (answers[id] is List) ? List<String>.from(answers[id] as List) : <String>[];
      return Card(child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(decorated, style: const TextStyle(fontWeight: FontWeight.w700)),
          ...options.map((option) {
            final value = option['value'].toString();
            return CheckboxListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              value: selected.contains(value),
              title: Text(_localized(option['labels'], widget.locale, value)),
              onChanged: (checked) => setState(() {
                final next = [...selected];
                if (checked == true && !next.contains(value)) next.add(value);
                if (checked != true) next.remove(value);
                if (next.isEmpty) { answers.remove(id); } else { answers[id] = next; }
              }),
            );
          }),
        ]),
      ));
    }

    final keyboard = type == 'NUMBER' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        key: ValueKey('question-$id'),
        keyboardType: keyboard,
        maxLines: type == 'TEXT' ? 3 : 1,
        decoration: InputDecoration(
          labelText: decorated,
          hintText: type == 'DATE' ? 'YYYY-MM-DD' : null,
          border: const OutlineInputBorder(),
        ),
        onChanged: (value) {
          final trimmed = value.trim();
          if (trimmed.isEmpty) {
            answers.remove(id);
          } else if (type == 'NUMBER') {
            answers[id] = num.tryParse(trimmed) ?? trimmed;
          } else {
            answers[id] = trimmed;
          }
        },
      ),
    );
  }

  Future<void> _submit() async {
    for (final question in questions) {
      if (question['required'] == true) {
        final id = question['id']?.toString() ?? '';
        final value = answers[id];
        if (value == null || value == '' || (value is List && value.isEmpty)) {
          setState(() => validation = t('requiredQuestions'));
          return;
        }
      }
    }
    setState(() { saving = true; validation = null; });
    try {
      await widget.session.api.submitPatientQuestionnaireRequest(widget.request['id'].toString(), {
        'expectedLatestSequence': _int(widget.request['latestSequence'], 0),
        'answers': answers,
      });
      if (mounted) Navigator.pop(context, true);
    } on CarePointApiException catch (value) {
      if (mounted) setState(() => validation = value.toString());
    } catch (value) {
      if (mounted) setState(() => validation = value.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }
}

String questionnaireRequestText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'doctorTitle':'Questionnaire requests','patientTitle':'Requested questionnaires','request':'Request questionnaire',
      'questionnaire':'Questionnaire','template':'Active template','context':'Context','preVisit':'Pre-visit questionnaire',
      'due':'Due','version':'Version','refresh':'Refresh','cancel':'Cancel','submit':'Submit',
      'noTemplates':'No active questionnaire template is available.','noRequests':'No questionnaire requests for this patient.',
      'noPatientRequests':'No questionnaire is currently requested from you.','invalidAppointment':'This appointment cannot receive a questionnaire request in its current state.',
      'exactVersionHint':'The request is bound to this exact active questionnaire version. Later template changes will not alter it.',
      'notAnswered':'Not answered yet','requiredQuestions':'Complete all required questions before submitting.'
    },
    CarePointLocale.ar: {
      'doctorTitle':'طلبات الاستبيانات','patientTitle':'الاستبيانات المطلوبة','request':'طلب استبيان',
      'questionnaire':'استبيان','template':'القالب النشط','context':'السياق','preVisit':'استبيان قبل الزيارة',
      'due':'الموعد النهائي','version':'الإصدار','refresh':'تحديث','cancel':'إلغاء','submit':'إرسال',
      'noTemplates':'لا يوجد قالب استبيان نشط متاح.','noRequests':'لا توجد طلبات استبيان لهذا المريض.',
      'noPatientRequests':'لا يوجد استبيان مطلوب منك حالياً.','invalidAppointment':'لا يمكن طلب استبيان لهذه الموعد في حالته الحالية.',
      'exactVersionHint':'يرتبط الطلب بهذه النسخة النشطة تحديداً ولن تغيّره تعديلات القالب اللاحقة.',
      'notAnswered':'لم تتم الإجابة بعد','requiredQuestions':'أكمل جميع الأسئلة المطلوبة قبل الإرسال.'
    },
    CarePointLocale.fr: {
      'doctorTitle':'Demandes de questionnaires','patientTitle':'Questionnaires demandés','request':'Demander un questionnaire',
      'questionnaire':'Questionnaire','template':'Modèle actif','context':'Contexte','preVisit':'Questionnaire pré-consultation',
      'due':'Échéance','version':'Version','refresh':'Actualiser','cancel':'Annuler','submit':'Envoyer',
      'noTemplates':'Aucun modèle de questionnaire actif disponible.','noRequests':'Aucune demande de questionnaire pour ce patient.',
      'noPatientRequests':'Aucun questionnaire ne vous est actuellement demandé.','invalidAppointment':'Ce rendez-vous ne peut pas recevoir une demande de questionnaire dans son état actuel.',
      'exactVersionHint':'La demande est liée exactement à cette version active; les modifications ultérieures du modèle ne la changent pas.',
      'notAnswered':'Pas encore répondu','requiredQuestions':'Complétez toutes les questions obligatoires avant l’envoi.'
    },
    CarePointLocale.es: {
      'doctorTitle':'Solicitudes de cuestionario','patientTitle':'Cuestionarios solicitados','request':'Solicitar cuestionario',
      'questionnaire':'Cuestionario','template':'Plantilla activa','context':'Contexto','preVisit':'Cuestionario preconsulta',
      'due':'Vencimiento','version':'Versión','refresh':'Actualizar','cancel':'Cancelar','submit':'Enviar',
      'noTemplates':'No hay ninguna plantilla de cuestionario activa.','noRequests':'No hay solicitudes de cuestionario para este paciente.',
      'noPatientRequests':'No tienes ningún cuestionario solicitado pendiente.','invalidAppointment':'Esta cita no admite una solicitud de cuestionario en su estado actual.',
      'exactVersionHint':'La solicitud queda vinculada a esta versión activa exacta; cambios posteriores de la plantilla no la modifican.',
      'notAnswered':'Aún sin responder','requiredQuestions':'Completa todas las preguntas obligatorias antes de enviar.'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

String _localized(dynamic value, CarePointLocale locale, String fallback) {
  final map = _map(value);
  final key = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return map[key]?.toString().trim().isNotEmpty == true
      ? map[key].toString()
      : (map['en']?.toString().trim().isNotEmpty == true ? map['en'].toString() : fallback);
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

String _dateTime(DateTime? value) => value == null ? '—' : value.toLocal().toString().substring(0, 16);
String _dateTimeValue(dynamic value) => _dateTime(DateTime.tryParse(value?.toString() ?? ''));
