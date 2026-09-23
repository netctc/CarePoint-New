import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorImmunizationsPage extends StatefulWidget {
  const DoctorImmunizationsPage({
    super.key,
    required this.session,
    required this.locale,
    required this.patientId,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final String patientId;

  @override
  State<DoctorImmunizationsPage> createState() => _DoctorImmunizationsPageState();
}

class _DoctorImmunizationsPageState extends State<DoctorImmunizationsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  String t(String key) => doctorImmunizationText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final response = await widget.session.api.doctorPatientImmunizations(widget.patientId);
      if (mounted) setState(() => items = _maps(response['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _edit([Map<String, dynamic>? item]) async {
    final occurred = TextEditingController(text: _dateOnly(item?['occurredOn']));
    final vaccine = TextEditingController(text: item?['vaccineDisplay']?.toString() ?? '');
    final codeSystem = TextEditingController(text: item?['vaccineCodeSystem']?.toString() ?? '');
    final code = TextEditingController(text: item?['vaccineCode']?.toString() ?? '');
    final dose = TextEditingController(text: item?['doseNumber']?.toString() ?? '');
    final lot = TextEditingController(text: item?['lotNumber']?.toString() ?? '');
    final manufacturer = TextEditingController(text: item?['manufacturer']?.toString() ?? '');
    final route = TextEditingController(text: item?['route']?.toString() ?? '');
    final site = TextEditingController(text: item?['site']?.toString() ?? '');
    String? validation;

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
        title: Text(item == null ? t('add') : t('edit')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: occurred, decoration: InputDecoration(labelText: t('date'), hintText: 'YYYY-MM-DD', border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: vaccine, decoration: InputDecoration(labelText: t('vaccine'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: dose, decoration: InputDecoration(labelText: t('dose'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: lot, decoration: InputDecoration(labelText: t('lot'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: manufacturer, decoration: InputDecoration(labelText: t('manufacturer'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: route, decoration: InputDecoration(labelText: t('route'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: site, decoration: InputDecoration(labelText: t('site'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          ExpansionTile(title: Text(t('coding')), children: [
            TextField(controller: codeSystem, decoration: InputDecoration(labelText: t('codeSystem'), border: const OutlineInputBorder())),
            const SizedBox(height: 10),
            TextField(controller: code, decoration: InputDecoration(labelText: t('code'), border: const OutlineInputBorder())),
          ]),
          if (validation != null) Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () {
            if (_parseDate(occurred.text) == null) {
              setDialogState(() => validation = t('invalidDate'));
              return;
            }
            if (vaccine.text.trim().isEmpty && code.text.trim().isEmpty) {
              setDialogState(() => validation = t('vaccineRequired'));
              return;
            }
            Navigator.pop(dialogContext, true);
          }, child: Text(t('save'))),
        ],
      )),
    );

    final controllers = [occurred, vaccine, codeSystem, code, dose, lot, manufacturer, route, site];
    if (accepted != true) {
      for (final controller in controllers) { controller.dispose(); }
      return;
    }

    try {
      if (item == null) {
        await widget.session.api.createDoctorPatientImmunization(
          widget.patientId,
          idempotencyKey: 'doc-imm-${DateTime.now().microsecondsSinceEpoch}',
          occurredOn: occurred.text.trim(),
          vaccineDisplay: vaccine.text.trim(),
          vaccineCodeSystem: codeSystem.text.trim(),
          vaccineCode: code.text.trim(),
          doseNumber: dose.text.trim(),
          lotNumber: lot.text.trim(),
          manufacturer: manufacturer.text.trim(),
          route: route.text.trim(),
          site: site.text.trim(),
        );
      } else {
        await widget.session.api.updateDoctorPatientImmunization(
          widget.patientId,
          item['id'].toString(),
          expectedVersion: (item['version'] as num).toInt(),
          occurredOn: occurred.text.trim(),
          vaccineDisplay: vaccine.text.trim(),
          vaccineCodeSystem: codeSystem.text.trim(),
          vaccineCode: code.text.trim(),
          doseNumber: dose.text.trim(),
          lotNumber: lot.text.trim(),
          manufacturer: manufacturer.text.trim(),
          route: route.text.trim(),
          site: site.text.trim(),
        );
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
      await _load();
    } on CarePointApiException catch (value) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.statusCode == 409 ? t('conflict') : value.toString())));
      }
      if (value.statusCode == 409) await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      for (final controller in controllers) { controller.dispose(); }
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
                        final title = item['vaccineDisplay']?.toString().isNotEmpty == true
                            ? item['vaccineDisplay'].toString()
                            : item['vaccineCode']?.toString() ?? t('immunization');
                        final source = _sourceLabel(item['source']);
                        final details = [
                          '${t('date')}: ${_dateOnly(item['occurredOn'])}',
                          if (item['doseNumber'] != null) '${t('dose')}: ${item['doseNumber']}',
                          if (item['lotNumber'] != null) '${t('lot')}: ${item['lotNumber']}',
                          '${t('source')}: $source',
                        ].join('\n');
                        return Card(child: ListTile(
                          leading: const Icon(Icons.vaccines_outlined),
                          title: Text(title),
                          subtitle: Text(details),
                          isThreeLine: true,
                          trailing: IconButton(onPressed: () => _edit(item), icon: const Icon(Icons.edit_outlined), tooltip: t('edit')),
                        ));
                      },
                    ),
                  ),
  );
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map((item) => item is Map<String, dynamic> ? item : Map<String, dynamic>.from(item as Map)).toList(growable: false);
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

String _sourceLabel(dynamic value) {
  if (value is Map && value['kind'] != null) return value['kind'].toString();
  return '—';
}

String doctorImmunizationText(CarePointLocale locale, String key) =>
    _messages[locale]?[key] ?? _messages[CarePointLocale.en]?[key] ?? key;

const Map<CarePointLocale, Map<String, String>> _messages = {
  CarePointLocale.en: {
    'title':'Immunization history','immunization':'Immunization','add':'Add immunization','edit':'Edit immunization',
    'date':'Vaccination date','vaccine':'Vaccine','dose':'Dose','lot':'Lot','manufacturer':'Manufacturer','route':'Route','site':'Site',
    'coding':'Optional coding','codeSystem':'Code system','code':'Code','source':'Source','save':'Save','cancel':'Cancel','refresh':'Refresh',
    'saved':'Immunization saved.','empty':'No immunizations recorded.','invalidDate':'Use a valid YYYY-MM-DD date.',
    'vaccineRequired':'Enter a vaccine name or code.','conflict':'The record changed or is duplicated. Latest data was reloaded.',
    'missingPatient':'Patient context is unavailable.'
  },
  CarePointLocale.ar: {
    'title':'سجل التطعيمات','immunization':'تطعيم','add':'إضافة تطعيم','edit':'تعديل تطعيم',
    'date':'تاريخ التطعيم','vaccine':'اللقاح','dose':'الجرعة','lot':'رقم التشغيلة','manufacturer':'المصنّع','route':'طريقة الإعطاء','site':'موضع الإعطاء',
    'coding':'الترميز الاختياري','codeSystem':'نظام الترميز','code':'الرمز','source':'المصدر','save':'حفظ','cancel':'إلغاء','refresh':'تحديث',
    'saved':'تم حفظ التطعيم.','empty':'لا توجد تطعيمات مسجلة.','invalidDate':'استخدم تاريخاً صالحاً بصيغة YYYY-MM-DD.',
    'vaccineRequired':'أدخل اسم اللقاح أو رمزه.','conflict':'تم تغيير السجل أو أن التطعيم مكرر. تم تحميل أحدث البيانات.',
    'missingPatient':'سياق المريض غير متاح.'
  },
  CarePointLocale.fr: {
    'title':'Historique vaccinal','immunization':'Vaccination','add':'Ajouter une vaccination','edit':'Modifier la vaccination',
    'date':'Date de vaccination','vaccine':'Vaccin','dose':'Dose','lot':'Lot','manufacturer':'Fabricant','route':'Voie','site':'Site',
    'coding':'Codification facultative','codeSystem':'Système de code','code':'Code','source':'Source','save':'Enregistrer','cancel':'Annuler','refresh':'Actualiser',
    'saved':'Vaccination enregistrée.','empty':'Aucune vaccination enregistrée.','invalidDate':'Utilisez une date valide au format YYYY-MM-DD.',
    'vaccineRequired':'Saisissez un vaccin ou un code.','conflict':'Le dossier a changé ou la vaccination est dupliquée. Les dernières données ont été rechargées.',
    'missingPatient':'Le contexte patient est indisponible.'
  },
  CarePointLocale.es: {
    'title':'Historial de vacunación','immunization':'Vacuna','add':'Añadir vacuna','edit':'Editar vacuna',
    'date':'Fecha de vacunación','vaccine':'Vacuna','dose':'Dosis','lot':'Lote','manufacturer':'Fabricante','route':'Vía','site':'Lugar de administración',
    'coding':'Codificación opcional','codeSystem':'Sistema de códigos','code':'Código','source':'Origen','save':'Guardar','cancel':'Cancelar','refresh':'Actualizar',
    'saved':'Vacuna guardada.','empty':'No hay vacunas registradas.','invalidDate':'Usa una fecha válida con formato YYYY-MM-DD.',
    'vaccineRequired':'Introduce el nombre o código de la vacuna.','conflict':'El registro cambió o la vacuna está duplicada. Se han recargado los últimos datos.',
    'missingPatient':'No está disponible el contexto del paciente.'
  },
};
