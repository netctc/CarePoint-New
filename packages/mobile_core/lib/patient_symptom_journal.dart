import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientSymptomJournalPage extends StatefulWidget {
  const PatientSymptomJournalPage({
    super.key,
    required this.session,
    required this.locale,
  });

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientSymptomJournalPage> createState() => _PatientSymptomJournalPageState();
}

class _PatientSymptomJournalPageState extends State<PatientSymptomJournalPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => patientSymptomText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final value = await widget.session.api.patientSymptoms(limit: 100);
      if (!mounted) return;
      setState(() => items = _maps(value['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _add() async {
    final symptom = TextEditingController();
    final duration = TextEditingController(text: '1');
    final contextController = TextEditingController();
    final notes = TextEditingController();
    var severity = 5;
    var durationUnit = 'HOURS';
    var occurredAt = DateTime.now();
    String? validation;

    final accepted = await showDialog<bool>(
      context: this.context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(t('add')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: symptom,
                  decoration: InputDecoration(
                    labelText: t('symptom'),
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                Text('${t('severity')}: $severity / 10', style: const TextStyle(fontWeight: FontWeight.w700)),
                Slider(
                  value: severity.toDouble(),
                  min: 0,
                  max: 10,
                  divisions: 10,
                  label: severity.toString(),
                  onChanged: (value) => setLocal(() => severity = value.round()),
                ),
                const SizedBox(height: 4),
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: duration,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: t('duration'),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: durationUnit,
                      decoration: InputDecoration(
                        labelText: t('unit'),
                        border: const OutlineInputBorder(),
                      ),
                      items: const ['MINUTES', 'HOURS', 'DAYS', 'WEEKS']
                          .map((value) => DropdownMenuItem(value: value, child: Text(value)))
                          .toList(growable: false),
                      onChanged: (value) => setLocal(() => durationUnit = value ?? durationUnit),
                    ),
                  ),
                ]),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () async {
                    final date = await showDatePicker(
                      context: dialogContext,
                      initialDate: occurredAt,
                      firstDate: DateTime.now().subtract(const Duration(days: 3650)),
                      lastDate: DateTime.now(),
                    );
                    if (date == null || !dialogContext.mounted) return;
                    final time = await showTimePicker(
                      context: dialogContext,
                      initialTime: TimeOfDay.fromDateTime(occurredAt),
                    );
                    if (time == null) return;
                    setLocal(() {
                      occurredAt = DateTime(date.year, date.month, date.day, time.hour, time.minute);
                    });
                  },
                  icon: const Icon(Icons.schedule_outlined),
                  label: Text('${t('started')}: ${_dateTime(occurredAt)}'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: contextController,
                  maxLines: 2,
                  decoration: InputDecoration(
                    labelText: t('context'),
                    hintText: t('contextHint'),
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: notes,
                  maxLines: 3,
                  decoration: InputDecoration(
                    labelText: t('notes'),
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                Text(t('patientReportedHint'), style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                if (validation != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(t('cancel')),
            ),
            FilledButton(
              onPressed: () {
                final durationValue = num.tryParse(duration.text.trim());
                if (symptom.text.trim().isEmpty) {
                  setLocal(() => validation = t('symptomRequired'));
                  return;
                }
                if (durationValue == null || durationValue <= 0) {
                  setLocal(() => validation = t('durationRequired'));
                  return;
                }
                if (contextController.text.trim().isEmpty) {
                  setLocal(() => validation = t('contextRequired'));
                  return;
                }
                if (occurredAt.isAfter(DateTime.now().add(const Duration(minutes: 5)))) {
                  setLocal(() => validation = t('futureInvalid'));
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              child: Text(t('save')),
            ),
          ],
        ),
      ),
    );

    if (accepted == true) {
      try {
        await widget.session.api.createPatientSymptom(
          idempotencyKey: 'patient-symptom-${DateTime.now().microsecondsSinceEpoch}',
          symptom: symptom.text.trim(),
          severity: severity,
          durationValue: num.parse(duration.text.trim()),
          durationUnit: durationUnit,
          context: contextController.text.trim(),
          occurredAt: occurredAt,
          notes: notes.text.trim(),
        );
        if (mounted) {
          ScaffoldMessenger.of(this.context).showSnackBar(SnackBar(content: Text(t('saved'))));
        }
        await _load();
      } catch (value) {
        if (mounted) {
          ScaffoldMessenger.of(this.context).showSnackBar(SnackBar(content: Text(value.toString())));
        }
      }
    }

    symptom.dispose();
    duration.dispose();
    contextController.dispose();
    notes.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('title')),
      actions: [
        IconButton(
          onPressed: loading ? null : _load,
          icon: const Icon(Icons.refresh_outlined),
          tooltip: t('refresh'),
        ),
      ],
    ),
    floatingActionButton: FloatingActionButton.extended(
      key: const ValueKey('patient-symptom-add'),
      onPressed: _add,
      icon: const Icon(Icons.add),
      label: Text(t('add')),
    ),
    body: loading && items.isEmpty
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline),
                        const SizedBox(width: 10),
                        Expanded(child: Text(t('patientReportedHint'))),
                      ],
                    ),
                  ),
                ),
                if (error != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ),
                  ),
                if (items.isEmpty && error == null)
                  Padding(
                    padding: const EdgeInsets.all(28),
                    child: Text(t('empty'), textAlign: TextAlign.center),
                  )
                else
                  ...items.map(_itemCard),
              ],
            ),
          ),
  );

  Widget _itemCard(Map<String, dynamic> item) {
    final provenance = _map(item['provenance']);
    final duration = _map(item['duration']);
    final effective = DateTime.tryParse(
      item['effectiveAt']?.toString() ??
          item['occurredAt']?.toString() ??
          item['reportedAt']?.toString() ??
          '',
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Expanded(
                child: Text(
                  item['symptom']?.toString() ?? t('symptom'),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                ),
              ),
              Chip(label: Text('${item['severity'] ?? '—'}/10')),
            ]),
            Text('${t('started')}: ${_dateTime(effective)}'),
            Text('${t('duration')}: ${duration['value'] ?? '—'} ${duration['unit'] ?? ''}'),
            Text('${t('context')}: ${item['context'] ?? '—'}'),
            if (item['notes']?.toString().trim().isNotEmpty == true)
              Text('${t('notes')}: ${item['notes']}'),
            const SizedBox(height: 8),
            Row(children: [
              const Icon(Icons.person_outline, size: 18),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${t('source')}: ${provenance['sourceType'] ?? 'PATIENT_REPORTED'}',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
            ]),
          ],
        ),
      ),
    );
  }
}

String patientSymptomText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Symptom journal','add':'Add symptom','refresh':'Refresh','empty':'No symptoms reported yet.','symptom':'Symptom','severity':'Intensity','duration':'Duration','unit':'Unit','started':'Started','context':'Context / trigger','contextHint':'What were you doing or what may have triggered it?','notes':'Notes (optional)','patientReportedHint':'These entries are patient-reported symptoms, not professional diagnoses.','cancel':'Cancel','save':'Save','saved':'Symptom saved.','symptomRequired':'Symptom is required.','durationRequired':'Enter a positive duration.','contextRequired':'Context / trigger is required.','futureInvalid':'Start time cannot be in the future.','source':'Source'
    },
    CarePointLocale.ar: {
      'title':'يوميات الأعراض','add':'إضافة عرض','refresh':'تحديث','empty':'لم يتم الإبلاغ عن أعراض بعد.','symptom':'العرض','severity':'الشدة','duration':'المدة','unit':'الوحدة','started':'بداية العرض','context':'السياق / المحفز','contextHint':'ماذا كنت تفعل أو ما الذي قد يكون حفّز العرض؟','notes':'ملاحظات (اختياري)','patientReportedHint':'هذه أعراض أبلغ عنها المريض وليست تشخيصات مهنية.','cancel':'إلغاء','save':'حفظ','saved':'تم حفظ العرض.','symptomRequired':'العرض مطلوب.','durationRequired':'أدخل مدة موجبة.','contextRequired':'السياق / المحفز مطلوب.','futureInvalid':'لا يمكن أن تكون البداية في المستقبل.','source':'المصدر'
    },
    CarePointLocale.fr: {
      'title':'Journal des symptômes','add':'Ajouter un symptôme','refresh':'Actualiser','empty':'Aucun symptôme signalé.','symptom':'Symptôme','severity':'Intensité','duration':'Durée','unit':'Unité','started':'Début','context':'Contexte / déclencheur','contextHint':'Que faisiez-vous ou quel élément a pu déclencher le symptôme ?','notes':'Notes (facultatif)','patientReportedHint':'Ces entrées sont des symptômes déclarés par le patient, pas des diagnostics professionnels.','cancel':'Annuler','save':'Enregistrer','saved':'Symptôme enregistré.','symptomRequired':'Le symptôme est obligatoire.','durationRequired':'Saisissez une durée positive.','contextRequired':'Le contexte / déclencheur est obligatoire.','futureInvalid':'Le début ne peut pas être dans le futur.','source':'Source'
    },
    CarePointLocale.es: {
      'title':'Diario de síntomas','add':'Añadir síntoma','refresh':'Actualizar','empty':'Todavía no hay síntomas reportados.','symptom':'Síntoma','severity':'Intensidad','duration':'Duración','unit':'Unidad','started':'Inicio','context':'Contexto / desencadenante','contextHint':'¿Qué estabas haciendo o qué pudo desencadenarlo?','notes':'Notas (opcional)','patientReportedHint':'Estas entradas son síntomas reportados por el paciente, no diagnósticos profesionales.','cancel':'Cancelar','save':'Guardar','saved':'Síntoma guardado.','symptomRequired':'El síntoma es obligatorio.','durationRequired':'Introduce una duración positiva.','contextRequired':'El contexto / desencadenante es obligatorio.','futureInvalid':'El inicio no puede estar en el futuro.','source':'Origen'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
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

String _dateTime(DateTime? value) {
  if (value == null) return '—';
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
}
