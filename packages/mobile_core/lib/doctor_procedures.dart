import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorProceduresPage extends StatefulWidget {
  const DoctorProceduresPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorProceduresPage> createState() => _DoctorProceduresPageState();
}

class _DoctorProceduresPageState extends State<DoctorProceduresPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => doctorProcedureText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final response = await widget.session.api.doctorPatientProcedures(widget.patientId);
      if (mounted) setState(() => items = _maps(response['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _edit([Map<String, dynamic>? item]) async {
    final current = _map(item?['data']);
    final display = TextEditingController(text: current['display']?.toString() ?? '');
    final performedDate = TextEditingController(text: _dateOnly(current['performedDate']));
    final facility = TextEditingController(text: current['facility']?.toString() ?? '');
    String? validation;

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(item == null ? t('add') : t('edit')),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(
                controller: display,
                maxLength: 300,
                decoration: InputDecoration(labelText: t('procedure'), border: const OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: performedDate,
                decoration: InputDecoration(labelText: t('date'), hintText: t('dateHint'), border: const OutlineInputBorder()),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: facility,
                maxLength: 300,
                decoration: InputDecoration(labelText: t('facility'), border: const OutlineInputBorder()),
              ),
              if (validation != null) Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
            FilledButton(
              onPressed: () {
                if (display.text.trim().isEmpty) {
                  setDialogState(() => validation = t('procedureRequired'));
                  return;
                }
                if (performedDate.text.trim().isNotEmpty && _parseDate(performedDate.text) == null) {
                  setDialogState(() => validation = t('invalidDate'));
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

    if (accepted != true) {
      display.dispose();
      performedDate.dispose();
      facility.dispose();
      return;
    }

    try {
      if (item == null) {
        await widget.session.api.createDoctorPatientProcedure(
          widget.patientId,
          display: display.text.trim(),
          performedDate: performedDate.text.trim(),
          facility: facility.text.trim(),
        );
      } else {
        await widget.session.api.updateDoctorPatientProcedure(
          widget.patientId,
          item['id'].toString(),
          expectedVersion: (item['version'] as num).toInt(),
          display: display.text.trim(),
          performedDate: performedDate.text.trim(),
          facility: facility.text.trim(),
        );
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
      await _load();
    } on CarePointApiException catch (value) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(value.statusCode == 409 ? t('conflict') : value.toString()),
        ));
      }
      if (value.statusCode == 409) await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      display.dispose();
      performedDate.dispose();
      facility.dispose();
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(t('title')),
      actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))],
    ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: () => _edit(),
      icon: const Icon(Icons.add),
      label: Text(t('add')),
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : items.isEmpty
                ? Center(child: Text(t('empty')))
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
                      itemCount: items.length,
                      itemBuilder: (_, index) {
                        final item = items[index];
                        final data = _map(item['data']);
                        final provenance = _map(item['provenance']);
                        final details = <String>[
                          if (data['performedDate'] != null) '${t('date')}: ${_dateOnly(data['performedDate'])}',
                          if (data['facility']?.toString().isNotEmpty == true) '${t('facility')}: ${data['facility']}',
                          '${t('source')}: ${provenance['sourceType'] ?? '—'}',
                          '${t('verification')}: ${item['verificationStatus'] ?? '—'}',
                          '${t('version')}: ${item['version'] ?? '—'}',
                        ].join('\n');
                        return Card(
                          child: ListTile(
                            leading: const Icon(Icons.medical_information_outlined),
                            title: Text(data['display']?.toString() ?? t('procedure')),
                            subtitle: Text(details),
                            isThreeLine: true,
                            trailing: IconButton(
                              onPressed: () => _edit(item),
                              icon: const Icon(Icons.edit_outlined),
                              tooltip: t('edit'),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
  );
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

String _dateOnly(dynamic value) {
  final text = value?.toString() ?? '';
  return text.length >= 10 ? text.substring(0, 10) : text;
}

DateTime? _parseDate(String value) {
  final text = value.trim();
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) return null;
  return DateTime.tryParse(text);
}

String doctorProcedureText(CarePointLocale locale, String key) =>
    _messages[locale]?[key] ?? _messages[CarePointLocale.en]?[key] ?? key;

const Map<CarePointLocale, Map<String, String>> _messages = {
  CarePointLocale.en: {
    'title':'Procedure history','procedure':'Procedure / surgery','add':'Add procedure','edit':'Edit procedure',
    'date':'Performed date','dateHint':'YYYY-MM-DD (optional)','facility':'Facility','source':'Source','verification':'Verification',
    'version':'Version','save':'Save','cancel':'Cancel','refresh':'Refresh','saved':'Procedure saved.','empty':'No procedures recorded.',
    'procedureRequired':'Procedure name is required.','invalidDate':'Use a valid YYYY-MM-DD date.','conflict':'The record changed in another session. Latest data was reloaded.',
    'missingPatient':'Patient context is unavailable.'
  },
  CarePointLocale.ar: {
    'title':'سجل الإجراءات والعمليات','procedure':'الإجراء / العملية','add':'إضافة إجراء','edit':'تعديل الإجراء',
    'date':'تاريخ الإجراء','dateHint':'YYYY-MM-DD (اختياري)','facility':'المنشأة','source':'المصدر','verification':'التحقق',
    'version':'الإصدار','save':'حفظ','cancel':'إلغاء','refresh':'تحديث','saved':'تم حفظ الإجراء.','empty':'لا توجد إجراءات مسجلة.',
    'procedureRequired':'اسم الإجراء مطلوب.','invalidDate':'استخدم تاريخاً صالحاً بصيغة YYYY-MM-DD.','conflict':'تم تغيير السجل في جلسة أخرى. تم تحميل أحدث البيانات.',
    'missingPatient':'سياق المريض غير متاح.'
  },
  CarePointLocale.fr: {
    'title':'Historique des actes','procedure':'Acte / chirurgie','add':'Ajouter un acte','edit':'Modifier l’acte',
    'date':'Date de réalisation','dateHint':'YYYY-MM-DD (facultatif)','facility':'Établissement','source':'Source','verification':'Vérification',
    'version':'Version','save':'Enregistrer','cancel':'Annuler','refresh':'Actualiser','saved':'Acte enregistré.','empty':'Aucun acte enregistré.',
    'procedureRequired':'Le nom de l’acte est obligatoire.','invalidDate':'Utilisez une date valide au format YYYY-MM-DD.','conflict':'Le dossier a changé dans une autre session. Les dernières données ont été rechargées.',
    'missingPatient':'Le contexte patient est indisponible.'
  },
  CarePointLocale.es: {
    'title':'Historial de procedimientos','procedure':'Procedimiento / cirugía','add':'Añadir procedimiento','edit':'Editar procedimiento',
    'date':'Fecha del procedimiento','dateHint':'YYYY-MM-DD (opcional)','facility':'Centro','source':'Origen','verification':'Verificación',
    'version':'Versión','save':'Guardar','cancel':'Cancelar','refresh':'Actualizar','saved':'Procedimiento guardado.','empty':'No hay procedimientos registrados.',
    'procedureRequired':'El nombre del procedimiento es obligatorio.','invalidDate':'Usa una fecha válida con formato YYYY-MM-DD.','conflict':'El registro cambió en otra sesión. Se han recargado los últimos datos.',
    'missingPatient':'No está disponible el contexto del paciente.'
  },
};
