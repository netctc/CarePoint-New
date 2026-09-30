import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class ProviderCategoryFormsLauncher extends StatelessWidget {
  const ProviderCategoryFormsLauncher({
    super.key,
    required this.session,
    required this.locale,
    required this.workflowCapabilities,
    required this.child,
    this.accent = const Color(0xFF10B981),
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Set<String> workflowCapabilities;
  final Widget child;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    if (!workflowCapabilities.contains('CATEGORY_FORMS')) return child;
    return Stack(children: [
      child,
      PositionedDirectional(
        end: 18,
        bottom: 572,
        child: FloatingActionButton.small(
          heroTag: 'provider-category-forms',
          backgroundColor: accent,
          foregroundColor: Colors.white,
          tooltip: providerFormText(locale, 'title'),
          onPressed: () => Navigator.push<void>(
            context,
            MaterialPageRoute(builder: (_) => Directionality(
              textDirection: locale.textDirection,
              child: ProviderCategoryFormsPage(
                session: session,
                locale: locale,
                accent: accent,
              ),
            )),
          ),
          child: const Icon(Icons.dynamic_form_outlined),
        ),
      ),
    ]);
  }
}

class ProviderCategoryFormsPage extends StatefulWidget {
  const ProviderCategoryFormsPage({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;

  @override
  State<ProviderCategoryFormsPage> createState() => _ProviderCategoryFormsPageState();
}

class _ProviderCategoryFormsPageState extends State<ProviderCategoryFormsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> forms = const [];
  List<Map<String, dynamic>> appointments = const [];
  List<Map<String, dynamic>> transports = const [];
  List<Map<String, dynamic>> ambulances = const [];

  CarePointApi get api => widget.session.api;
  String t(String key) => providerFormText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final now = DateTime.now();
      final values = await Future.wait<dynamic>([
        api.providerCategoryForms(),
        api.providerAppointments(
          from: now.subtract(const Duration(days: 365)),
          to: now.add(const Duration(days: 31)),
        ),
        api.providerMedicalTransportJobs(),
        api.providerEmergencyAmbulanceJobs(),
      ]);
      if (!mounted) return;
      setState(() {
        forms = _maps(_map(values[0])['items']);
        appointments = _maps(values[1]).where((item) =>
          item['status'] == 'CONFIRMED' || item['status'] == 'COMPLETED'
        ).toList(growable: false);
        transports = _maps(values[2]).where((item) =>
          const {'ASSIGNED','EN_ROUTE','ARRIVED','TRANSPORTING','COMPLETED'}.contains(item['status'])
        ).toList(growable: false);
        ambulances = _maps(values[3]).where((item) =>
          const {'ASSIGNED','EN_ROUTE','ARRIVED','TRANSPORTING','COMPLETED'}.contains(item['status'])
        ).toList(growable: false);
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
      title: Text(t('title')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: t('refresh'))],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(error!, textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: Text(t('retry'))),
                ]),
              ))
            : RefreshIndicator(
                onRefresh: _load,
                child: forms.isEmpty
                    ? ListView(children: [Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text(t('empty'), textAlign: TextAlign.center),
                      )])
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: forms.length,
                        itemBuilder: (_, index) => _formCard(forms[index]),
                      ),
              ),
  );

  Widget _formCard(Map<String, dynamic> form) {
    final purpose = form['purpose']?.toString() ?? 'GENERAL';
    final version = form['version'] ?? '—';
    return Card(child: ListTile(
      leading: CircleAvatar(
        backgroundColor: widget.accent.withValues(alpha: .12),
        child: Icon(Icons.assignment_outlined, color: widget.accent),
      ),
      title: Text(_label(form['labels'], form['code']?.toString() ?? t('form')), style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text('$purpose · ${t('version')} $version'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _chooseContext(form),
    ));
  }

  Future<void> _chooseContext(Map<String, dynamic> form) async {
    final contexts = _compatibleContexts(form);
    if (contexts.isEmpty) {
      _message(t('noContext'));
      return;
    }
    final chosen = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => Directionality(
        textDirection: widget.locale.textDirection,
        child: SafeArea(child: FractionallySizedBox(
          heightFactor: .72,
          child: Column(children: [
            ListTile(
              leading: const Icon(Icons.link_outlined),
              title: Text(t('chooseContext'), style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text(_label(form['labels'], form['code']?.toString() ?? t('form'))),
            ),
            const Divider(height: 1),
            Expanded(child: ListView.builder(
              itemCount: contexts.length,
              itemBuilder: (_, index) {
                final item = contexts[index];
                return ListTile(
                  leading: Icon(_contextIcon(item['type']?.toString() ?? '')),
                  title: Text(item['label']?.toString() ?? item['id']?.toString() ?? ''),
                  subtitle: Text('${item['type']} · ${item['status'] ?? ''}'),
                  onTap: () => Navigator.pop(sheetContext, item),
                );
              },
            )),
          ]),
        )),
      ),
    );
    if (chosen == null || !mounted) return;
    await Navigator.push<void>(
      context,
      MaterialPageRoute(builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: ProviderCategoryFormResponsePage(
          session: widget.session,
          locale: widget.locale,
          accent: widget.accent,
          form: form,
          contextType: chosen['type'].toString(),
          contextId: chosen['id'].toString(),
          contextLabel: chosen['label']?.toString() ?? '',
        ),
      )),
    );
  }

  List<Map<String, dynamic>> _compatibleContexts(Map<String, dynamic> form) {
    final purpose = form['purpose']?.toString() ?? 'GENERAL';
    final result = <Map<String, dynamic>>[];

    if (purpose != 'TRANSPORT_EQUIPMENT') {
      final source = purpose == 'HOME_VISIT'
          ? appointments.where((item) => item['modality'] == 'HOME_VISIT')
          : appointments;
      for (final item in source) {
        final patient = _map(item['patient']);
        final patientName = [patient['firstName'], patient['lastName']]
            .whereType<String>().where((value) => value.trim().isNotEmpty).join(' ');
        result.add({
          'type': 'APPOINTMENT',
          'id': item['id'],
          'status': item['status'],
          'label': '${patientName.isEmpty ? t('appointment') : patientName} · ${_date(item['startsAt'])}',
        });
      }
    }

    if (purpose == 'TRANSPORT_EQUIPMENT' || purpose == 'GENERAL') {
      for (final item in transports) {
        result.add({
          'type': 'MEDICAL_TRANSPORT',
          'id': item['id'],
          'status': item['status'],
          'label': '${t('transport')} · ${_short(item['id'])}',
        });
      }
    }

    if (purpose == 'GENERAL') {
      for (final item in ambulances) {
        result.add({
          'type': 'EMERGENCY_AMBULANCE',
          'id': item['id'],
          'status': item['status'],
          'label': '${t('ambulance')} · ${_short(item['id'])}',
        });
      }
    }
    return result;
  }

  IconData _contextIcon(String type) => switch (type) {
    'MEDICAL_TRANSPORT' => Icons.local_shipping_outlined,
    'EMERGENCY_AMBULANCE' => Icons.emergency_outlined,
    _ => Icons.event_available_outlined,
  };

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  String _label(dynamic labels, String fallback) {
    final map = _map(labels);
    final localized = map[widget.locale.name]?.toString().trim() ?? '';
    if (localized.isNotEmpty) return localized;
    final english = map['en']?.toString().trim() ?? '';
    return english.isNotEmpty ? english : fallback;
  }
}

class ProviderCategoryFormResponsePage extends StatefulWidget {
  const ProviderCategoryFormResponsePage({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.form,
    required this.contextType,
    required this.contextId,
    required this.contextLabel,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final Map<String, dynamic> form;
  final String contextType;
  final String contextId;
  final String contextLabel;

  @override
  State<ProviderCategoryFormResponsePage> createState() => _ProviderCategoryFormResponsePageState();
}

class _ProviderCategoryFormResponsePageState extends State<ProviderCategoryFormResponsePage> {
  final Map<String, dynamic> answers = {};
  bool saving = false;
  int expectedLatestSequence = 0;
  String? validation;

  String t(String key) => providerFormText(widget.locale, key);
  List<Map<String, dynamic>> get questions => _maps(_map(widget.form['schema'])['questions']);

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(_label(widget.form['labels'], widget.form['code']?.toString() ?? t('form')))),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(child: ListTile(
          leading: const Icon(Icons.verified_user_outlined),
          title: Text('${widget.form['purpose'] ?? 'GENERAL'} · ${t('version')} ${widget.form['version'] ?? '—'}'),
          subtitle: Text('${widget.contextType} · ${widget.contextLabel}\n${t('serverAuthority')}'),
          isThreeLine: true,
        )),
        const SizedBox(height: 12),
        ...questions.map(_question),
        if (validation != null) Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ),
        const SizedBox(height: 18),
        FilledButton.icon(
          key: const ValueKey('provider-category-form-submit'),
          onPressed: saving ? null : _submit,
          icon: const Icon(Icons.fact_check_outlined),
          label: Text(t('submit')),
        ),
      ],
    ),
  );

  Widget _question(Map<String, dynamic> question) {
    final id = question['id']?.toString() ?? '';
    final type = question['type']?.toString() ?? 'TEXT';
    final title = _label(question['labels'], id);
    final required = question['required'] == true;
    final label = required ? '$title *' : title;

    if (type == 'BOOLEAN') {
      final value = answers[id] as bool?;
      return Card(child: SwitchListTile(
        title: Text(label),
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
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
          items: options.map((option) => DropdownMenuItem(
            value: option['value']?.toString(),
            child: Text(_label(option['labels'], option['value']?.toString() ?? '')),
          )).toList(growable: false),
          onChanged: (value) => setState(() {
            if (value == null) { answers.remove(id); } else { answers[id] = value; }
          }),
        ),
      );
    }

    if (type == 'MULTI_CHOICE') {
      final options = _maps(question['options']);
      final selected = answers[id] is List
          ? (answers[id] as List).map((value) => value.toString()).toSet()
          : <String>{};
      return Card(child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
          ...options.map((option) {
            final value = option['value']?.toString() ?? '';
            return CheckboxListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              value: selected.contains(value),
              title: Text(_label(option['labels'], value)),
              onChanged: (checked) => setState(() {
                final next = <String>{...selected};
                if (checked == true) { next.add(value); } else { next.remove(value); }
                if (next.isEmpty) { answers.remove(id); } else { answers[id] = next.toList(growable: false); }
              }),
            );
          }),
        ]),
      ));
    }

    final number = type == 'NUMBER';
    final date = type == 'DATE';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        key: ValueKey('provider-form-question-$id'),
        keyboardType: number
            ? const TextInputType.numberWithOptions(decimal: true, signed: true)
            : date ? TextInputType.datetime : TextInputType.text,
        maxLines: type == 'TEXT' ? 3 : 1,
        maxLength: type == 'TEXT' && question['maxLength'] is num
            ? (question['maxLength'] as num).toInt()
            : null,
        decoration: InputDecoration(
          labelText: label,
          hintText: date ? 'YYYY-MM-DD' : null,
          border: const OutlineInputBorder(),
        ),
        onChanged: (raw) {
          final value = raw.trim();
          if (value.isEmpty) {
            answers.remove(id);
          } else if (number) {
            answers[id] = num.tryParse(value) ?? value;
          } else {
            answers[id] = value;
          }
        },
      ),
    );
  }

  Future<void> _submit() async {
    final clientError = _validate();
    if (clientError != null) {
      setState(() => validation = clientError);
      return;
    }
    setState(() { saving = true; validation = null; });
    try {
      final result = await widget.session.api.submitProviderCategoryForm(
        widget.form['code'].toString(),
        contextType: widget.contextType,
        contextId: widget.contextId,
        expectedLatestSequence: expectedLatestSequence,
        answers: answers,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('${t('saved')} · ${t('version')} ${result['formVersion'] ?? widget.form['version']} · #${result['sequence'] ?? ''}'),
      ));
      Navigator.pop(context);
    } on CarePointApiException catch (value) {
      final payload = _map(value.payload);
      final current = payload['currentSequence'];
      if (value.statusCode == 409 && current is num) {
        setState(() {
          expectedLatestSequence = current.toInt();
          validation = '${t('sequenceConflict')} ${t('sequence')} $expectedLatestSequence. ${t('submitAgain')}';
        });
      } else {
        setState(() => validation = value.toString());
      }
    } catch (value) {
      if (mounted) setState(() => validation = value.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  String? _validate() {
    for (final question in questions) {
      final id = question['id']?.toString() ?? '';
      final value = answers[id];
      if (question['required'] == true && (value == null || value == '' || (value is List && value.isEmpty))) {
        return '${t('required')}: ${_label(question['labels'], id)}';
      }
      if (value == null) continue;
      if (question['type'] == 'NUMBER' && value is num) {
        final min = question['min'];
        final max = question['max'];
        if (min is num && value < min) return '${t('minimum')} ${min.toString()}';
        if (max is num && value > max) return '${t('maximum')} ${max.toString()}';
      }
      if (question['type'] == 'DATE' && (value is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value))) {
        return t('invalidDate');
      }
      if (question['type'] == 'NUMBER' && value is! num) return t('invalidNumber');
    }
    return null;
  }

  String _label(dynamic labels, String fallback) {
    final map = _map(labels);
    final localized = map[widget.locale.name]?.toString().trim() ?? '';
    if (localized.isNotEmpty) return localized;
    final english = map['en']?.toString().trim() ?? '';
    return english.isNotEmpty ? english : fallback;
  }
}

String providerFormText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Category forms','form':'Form','version':'Version','refresh':'Refresh','retry':'Retry',
      'empty':'No active form is configured for this provider category.','chooseContext':'Choose authorized work context',
      'noContext':'No compatible authorized work context is available.','appointment':'Appointment','transport':'Medical transport',
      'ambulance':'Emergency ambulance','submit':'Submit','saved':'Form response saved','notAnswered':'Not answered yet',
      'required':'Required','minimum':'Minimum','maximum':'Maximum','invalidDate':'Use YYYY-MM-DD.','invalidNumber':'Enter a valid number.',
      'serverAuthority':'The server validates capability, context, active schema and response version.','sequenceConflict':'A newer response already exists. Current sequence:',
      'sequence':'Sequence','submitAgain':'Review your answers and submit again to create an explicit new immutable response.'
    },
    CarePointLocale.ar: {
      'title':'نماذج الفئة','form':'النموذج','version':'الإصدار','refresh':'تحديث','retry':'إعادة المحاولة',
      'empty':'لا يوجد نموذج نشط مهيأ لهذه الفئة.','chooseContext':'اختر سياق العمل المصرح به',
      'noContext':'لا يوجد سياق عمل متوافق ومصرح به.','appointment':'موعد','transport':'نقل طبي',
      'ambulance':'إسعاف طارئ','submit':'إرسال','saved':'تم حفظ استجابة النموذج','notAnswered':'لم تتم الإجابة بعد',
      'required':'مطلوب','minimum':'الحد الأدنى','maximum':'الحد الأقصى','invalidDate':'استخدم YYYY-MM-DD.','invalidNumber':'أدخل رقماً صالحاً.',
      'serverAuthority':'يتحقق الخادم من الصلاحية والسياق والمخطط النشط وإصدار الاستجابة.','sequenceConflict':'توجد استجابة أحدث. التسلسل الحالي:',
      'sequence':'التسلسل','submitAgain':'راجع الإجابات وأرسل مرة أخرى لإنشاء استجابة جديدة غير قابلة للتعديل.'
    },
    CarePointLocale.fr: {
      'title':'Formulaires de catégorie','form':'Formulaire','version':'Version','refresh':'Actualiser','retry':'Réessayer',
      'empty':'Aucun formulaire actif pour cette catégorie.','chooseContext':'Choisir un contexte de travail autorisé',
      'noContext':'Aucun contexte compatible et autorisé.','appointment':'Rendez-vous','transport':'Transport médical',
      'ambulance':'Ambulance d’urgence','submit':'Envoyer','saved':'Réponse enregistrée','notAnswered':'Pas encore répondu',
      'required':'Obligatoire','minimum':'Minimum','maximum':'Maximum','invalidDate':'Utilisez YYYY-MM-DD.','invalidNumber':'Saisissez un nombre valide.',
      'serverAuthority':'Le serveur valide la capacité, le contexte, le schéma actif et la version de réponse.','sequenceConflict':'Une réponse plus récente existe. Séquence actuelle :',
      'sequence':'Séquence','submitAgain':'Vérifiez vos réponses puis renvoyez pour créer une nouvelle réponse immuable.'
    },
    CarePointLocale.es: {
      'title':'Formularios por categoría','form':'Formulario','version':'Versión','refresh':'Actualizar','retry':'Reintentar',
      'empty':'No hay formulario activo para esta categoría.','chooseContext':'Elegir contexto de trabajo autorizado',
      'noContext':'No hay un contexto compatible y autorizado.','appointment':'Cita','transport':'Transporte médico',
      'ambulance':'Ambulancia de emergencia','submit':'Enviar','saved':'Respuesta guardada','notAnswered':'Aún sin responder',
      'required':'Obligatorio','minimum':'Mínimo','maximum':'Máximo','invalidDate':'Usa YYYY-MM-DD.','invalidNumber':'Introduce un número válido.',
      'serverAuthority':'El servidor valida capability, contexto, schema activo y versión de respuesta.','sequenceConflict':'Ya existe una respuesta más reciente. Secuencia actual:',
      'sequence':'Secuencia','submitAgain':'Revisa las respuestas y vuelve a enviar para crear una nueva respuesta inmutable.'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]?[key] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _date(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year} ${two(value.hour)}:${two(value.minute)}';
}

String _short(dynamic raw) {
  final value = raw?.toString() ?? '';
  return value.length <= 8 ? value : value.substring(0, 8);
}
