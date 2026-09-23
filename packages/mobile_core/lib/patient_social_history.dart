import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientSocialHistoryPage extends StatefulWidget {
  const PatientSocialHistoryPage({
    super.key,
    required this.session,
    required this.locale,
  });

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientSocialHistoryPage> createState() => _PatientSocialHistoryPageState();
}

class _PatientSocialHistoryPageState extends State<PatientSocialHistoryPage> {
  bool loading = true;
  bool saving = false;
  String? error;
  String? validation;
  Map<String, dynamic> model = const {};
  Map<String, dynamic> answers = <String, dynamic>{};

  String t(String key) => patientSocialHistoryText(widget.locale, key);
  List<Map<String, dynamic>> get questions => _maps(_map(model['schema'])['questions']);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
      validation = null;
    });
    try {
      final value = await widget.session.api.patientSocialHistory();
      if (!mounted) return;
      setState(() {
        model = value;
        answers = Map<String, dynamic>.from(_map(value['answers']));
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
          actions: [
            IconButton(
              onPressed: loading || saving ? null : _load,
              tooltip: t('refresh'),
              icon: const Icon(Icons.refresh_outlined),
            ),
          ],
        ),
        body: loading
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(error!, textAlign: TextAlign.center),
                    ),
                  )
                : model['configured'] != true
                    ? _notConfigured()
                    : _form(),
      );

  Widget _notConfigured() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  const Icon(Icons.policy_outlined, size: 38),
                  const SizedBox(height: 12),
                  Text(t('notConfigured'), textAlign: TextAlign.center),
                  const SizedBox(height: 8),
                  Text(
                    t('policyHint'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFF64748B)),
                  ),
                ],
              ),
            ),
          ),
        ],
      );

  Widget _form() => ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _localized(model['labels'], widget.locale, t('title')),
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                  ),
                  final description = _localized(model['descriptionLabels'], widget.locale, '');
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(description),
                  ],
                  const SizedBox(height: 8),
                  Text(
                    '${t('version')} ${model['questionnaireVersion'] ?? ''}'
                    '${model['lastCompletedAt'] == null ? '' : ' · ${t('lastUpdated')}: ${_dateTime(model['lastCompletedAt'])}'}',
                    style: const TextStyle(color: Color(0xFF64748B)),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    t('versioningHint'),
                    style: const TextStyle(color: Color(0xFF64748B)),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          ...questions.map(_question),
          if (validation != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                validation!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const ValueKey('patient-social-history-save'),
            onPressed: saving ? null : _save,
            icon: const Icon(Icons.save_outlined),
            label: Text(t('save')),
          ),
        ],
      );

  Widget _question(Map<String, dynamic> question) {
    final id = question['id']?.toString() ?? '';
    final type = question['type']?.toString() ?? '';
    final required = question['required'] == true;
    final label = _localized(question['labels'], widget.locale, id);
    final decorated = required ? '$label *' : label;

    if (type == 'BOOLEAN') {
      final value = answers[id];
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: DropdownButtonFormField<bool>(
          key: ValueKey('social-history-$id'),
          initialValue: value is bool ? value : null,
          decoration: InputDecoration(
            labelText: decorated,
            border: const OutlineInputBorder(),
          ),
          items: [
            DropdownMenuItem(value: true, child: Text(t('yes'))),
            DropdownMenuItem(value: false, child: Text(t('no'))),
          ],
          onChanged: (next) => setState(() {
            if (next == null) {
              answers.remove(id);
            } else {
              answers[id] = next;
            }
          }),
        ),
      );
    }

    if (type == 'SINGLE_CHOICE') {
      final options = _maps(question['options']);
      final current = answers[id]?.toString();
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: DropdownButtonFormField<String>(
          key: ValueKey('social-history-$id'),
          initialValue: options.any((item) => item['value']?.toString() == current) ? current : null,
          decoration: InputDecoration(
            labelText: decorated,
            border: const OutlineInputBorder(),
          ),
          items: options
              .map((option) => DropdownMenuItem(
                    value: option['value'].toString(),
                    child: Text(_localized(option['labels'], widget.locale, option['value'].toString())),
                  ))
              .toList(growable: false),
          onChanged: (next) => setState(() {
            if (next == null) {
              answers.remove(id);
            } else {
              answers[id] = next;
            }
          }),
        ),
      );
    }

    if (type == 'MULTI_CHOICE') {
      final options = _maps(question['options']);
      final selected = answers[id] is List
          ? List<String>.from((answers[id] as List).map((value) => value.toString()))
          : <String>[];
      return Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(decorated, style: const TextStyle(fontWeight: FontWeight.w800)),
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
                    if (next.isEmpty) {
                      answers.remove(id);
                    } else {
                      answers[id] = next;
                    }
                  }),
                );
              }),
            ],
          ),
        ),
      );
    }

    final keyboard = type == 'NUMBER'
        ? const TextInputType.numberWithOptions(decimal: true)
        : TextInputType.text;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        key: ValueKey('social-history-$id-${model['latestSequence']}'),
        initialValue: answers[id]?.toString() ?? '',
        keyboardType: keyboard,
        maxLines: type == 'TEXT' ? 3 : 1,
        decoration: InputDecoration(
          labelText: decorated,
          hintText: type == 'DATE' ? 'YYYY-MM-DD' : null,
          border: const OutlineInputBorder(),
        ),
        onChanged: (raw) {
          final value = raw.trim();
          if (value.isEmpty) {
            answers.remove(id);
          } else if (type == 'NUMBER') {
            answers[id] = num.tryParse(value) ?? value;
          } else {
            answers[id] = value;
          }
        },
      ),
    );
  }

  Future<void> _save() async {
    for (final question in questions) {
      if (question['required'] != true) continue;
      final id = question['id']?.toString() ?? '';
      final value = answers[id];
      if (value == null || value == '' || (value is List && value.isEmpty)) {
        setState(() => validation = t('required'));
        return;
      }
    }
    setState(() {
      saving = true;
      validation = null;
    });
    try {
      await widget.session.api.updatePatientSocialHistory({
        'expectedLatestSequence': _int(model['latestSequence'], 0),
        'expectedQuestionnaireVersionId': model['questionnaireVersionId'].toString(),
        'answers': answers,
      });
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
      }
    } on CarePointApiException catch (value) {
      if (value.statusCode == 409) await _load();
      if (mounted) setState(() => validation = value.toString());
    } catch (value) {
      if (mounted) setState(() => validation = value.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }
}

String patientSocialHistoryText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Habits & social history',
      'refresh':'Refresh',
      'notConfigured':'Social-history questions are not configured for the current policy.',
      'policyHint':'Only questions enabled by the active Admin policy are shown. No fixed tobacco, alcohol or lifestyle fields are imposed by the app.',
      'version':'Template version',
      'lastUpdated':'Last updated',
      'versioningHint':'Saving creates a new encrypted, versioned response. Earlier responses are not overwritten.',
      'yes':'Yes','no':'No','save':'Save','saved':'Social history saved.','required':'Complete all required questions.'
    },
    CarePointLocale.ar: {
      'title':'العادات والتاريخ الاجتماعي',
      'refresh':'تحديث',
      'notConfigured':'أسئلة التاريخ الاجتماعي غير مهيأة ضمن السياسة الحالية.',
      'policyHint':'تُعرض فقط الأسئلة المفعلة في سياسة الإدارة. لا يفرض التطبيق حقولاً ثابتة للتبغ أو الكحول أو نمط الحياة.',
      'version':'إصدار القالب',
      'lastUpdated':'آخر تحديث',
      'versioningHint':'ينشئ الحفظ استجابة جديدة مشفرة ومؤرشفة بالإصدار ولا يستبدل الاستجابات السابقة.',
      'yes':'نعم','no':'لا','save':'حفظ','saved':'تم حفظ التاريخ الاجتماعي.','required':'أكمل جميع الأسئلة المطلوبة.'
    },
    CarePointLocale.fr: {
      'title':'Habitudes et antécédents sociaux',
      'refresh':'Actualiser',
      'notConfigured':'Les questions d’historique social ne sont pas configurées pour la politique actuelle.',
      'policyHint':'Seules les questions activées par la politique Admin sont affichées. L’application n’impose aucun champ fixe tabac, alcool ou mode de vie.',
      'version':'Version du modèle',
      'lastUpdated':'Dernière mise à jour',
      'versioningHint':'L’enregistrement crée une nouvelle réponse chiffrée et versionnée; les réponses précédentes ne sont pas écrasées.',
      'yes':'Oui','no':'Non','save':'Enregistrer','saved':'Historique social enregistré.','required':'Complétez toutes les questions obligatoires.'
    },
    CarePointLocale.es: {
      'title':'Hábitos y antecedentes sociales',
      'refresh':'Actualizar',
      'notConfigured':'Las preguntas de historia social no están configuradas para la política actual.',
      'policyHint':'Solo se muestran preguntas habilitadas por la política Admin. La app no impone campos fijos de tabaco, alcohol o estilo de vida.',
      'version':'Versión de plantilla',
      'lastUpdated':'Última actualización',
      'versioningHint':'Guardar crea una nueva respuesta cifrada y versionada; las respuestas anteriores no se sobrescriben.',
      'yes':'Sí','no':'No','save':'Guardar','saved':'Historia social guardada.','required':'Completa todas las preguntas obligatorias.'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

String _localized(dynamic value, CarePointLocale locale, String fallback) {
  final map = _map(value);
  final code = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  final localized = map[code]?.toString().trim() ?? '';
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

int _int(dynamic value, int fallback) =>
    value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? fallback;

String _dateTime(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} ${two(value.hour)}:${two(value.minute)}';
}
