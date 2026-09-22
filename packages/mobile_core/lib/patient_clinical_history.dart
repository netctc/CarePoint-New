import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class PatientHospitalizationsPage extends StatefulWidget {
  const PatientHospitalizationsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<PatientHospitalizationsPage> createState() => _PatientHospitalizationsPageState();
}

class _PatientHospitalizationsPageState extends State<PatientHospitalizationsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];
  String t(String key) => patientClinicalHistoryText(widget.locale, key);

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final response = await widget.session.api.patientHospitalizations();
      if (mounted) setState(() => items = _maps(response['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _edit([Map<String, dynamic>? item]) async {
    final admitted = TextEditingController(text: _dateOnly(item?['admittedOn']));
    final discharged = TextEditingController(text: _dateOnly(item?['dischargedOn']));
    final facility = TextEditingController(text: item?['facility']?.toString() ?? '');
    final reason = TextEditingController(text: item?['reason']?.toString() ?? '');
    String? validation;
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
      title: Text(item == null ? t('addHospitalization') : t('editHospitalization')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: admitted, decoration: InputDecoration(labelText: t('admittedOn'), hintText: 'YYYY-MM-DD', border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: discharged, decoration: InputDecoration(labelText: t('dischargedOn'), hintText: t('optionalDate'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: facility, decoration: InputDecoration(labelText: t('facility'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: reason, maxLines: 3, decoration: InputDecoration(labelText: t('reason'), border: const OutlineInputBorder())),
        if (validation != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () {
          final start = _parseDate(admitted.text);
          final end = discharged.text.trim().isEmpty ? null : _parseDate(discharged.text);
          if (start == null || (discharged.text.trim().isNotEmpty && end == null)) {
            setDialogState(() => validation = t('invalidDate')); return;
          }
          if (end != null && end.isBefore(start)) {
            setDialogState(() => validation = t('invalidInterval')); return;
          }
          Navigator.pop(dialogContext, true);
        }, child: Text(t('save'))),
      ],
    )));
    if (accepted != true) { admitted.dispose(); discharged.dispose(); facility.dispose(); reason.dispose(); return; }
    try {
      final start = admitted.text.trim();
      final end = discharged.text.trim();
      if (item == null) {
        await widget.session.api.createPatientHospitalization(
          idempotencyKey: 'pat-hosp-${DateTime.now().microsecondsSinceEpoch}',
          admittedOn: start, dischargedOn: end, facility: facility.text.trim(), reason: reason.text.trim(),
        );
      } else {
        await widget.session.api.updatePatientHospitalization(
          item['id'].toString(), expectedVersion: (item['version'] as num).toInt(),
          admittedOn: start, dischargedOn: end, facility: facility.text.trim(), reason: reason.text.trim(),
        );
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
      await _load();
    } on CarePointApiException catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.statusCode == 409 ? t('conflict') : value.toString())));
      if (value.statusCode == 409) await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      admitted.dispose(); discharged.dispose(); facility.dispose(); reason.dispose();
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('hospitalizations')), actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))]),
    floatingActionButton: FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: Text(t('add'))),
    body: loading ? const Center(child: CircularProgressIndicator()) : error != null
      ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
      : items.isEmpty ? Center(child: Text(t('noHospitalizations')))
      : RefreshIndicator(onRefresh: _load, child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 96), itemCount: items.length,
          itemBuilder: (_, index) {
            final item = items[index];
            final interval = [item['admittedOn'], item['dischargedOn']].where((v) => v != null && v.toString().isNotEmpty).map((v) => _dateOnly(v)).join(' → ');
            return Card(child: ListTile(
              leading: const Icon(Icons.local_hospital_outlined),
              title: Text(item['facility']?.toString().isNotEmpty == true ? item['facility'].toString() : t('hospitalization')),
              subtitle: Text('$interval\n${item['reason'] ?? ''}\n${t('source')}: ${_sourceLabel(item['source'])}'),
              isThreeLine: true,
              trailing: IconButton(onPressed: () => _edit(item), icon: const Icon(Icons.edit_outlined), tooltip: t('edit')),
            ));
          },
        )),
  );
}

class PatientImmunizationsPage extends StatefulWidget {
  const PatientImmunizationsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<PatientImmunizationsPage> createState() => _PatientImmunizationsPageState();
}

class _PatientImmunizationsPageState extends State<PatientImmunizationsPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];
  String t(String key) => patientClinicalHistoryText(widget.locale, key);

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final response = await widget.session.api.patientImmunizations();
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
    String? validation;
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
      title: Text(item == null ? t('addImmunization') : t('editImmunization')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: occurred, decoration: InputDecoration(labelText: t('occurredOn'), hintText: 'YYYY-MM-DD', border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: vaccine, decoration: InputDecoration(labelText: t('vaccine'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: dose, decoration: InputDecoration(labelText: t('dose'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: lot, decoration: InputDecoration(labelText: t('lot'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: manufacturer, decoration: InputDecoration(labelText: t('manufacturer'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        ExpansionTile(title: Text(t('coding')), children: [
          TextField(controller: codeSystem, decoration: InputDecoration(labelText: t('codeSystem'), border: const OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(controller: code, decoration: InputDecoration(labelText: t('code'), border: const OutlineInputBorder())),
        ]),
        if (validation != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () {
          if (_parseDate(occurred.text) == null) { setDialogState(() => validation = t('invalidDate')); return; }
          if (vaccine.text.trim().isEmpty && code.text.trim().isEmpty) { setDialogState(() => validation = t('vaccineRequired')); return; }
          Navigator.pop(dialogContext, true);
        }, child: Text(t('save'))),
      ],
    )));
    if (accepted != true) { for (final c in [occurred, vaccine, codeSystem, code, dose, lot, manufacturer]) { c.dispose(); } return; }
    try {
      if (item == null) {
        await widget.session.api.createPatientImmunization(
          idempotencyKey: 'pat-imm-${DateTime.now().microsecondsSinceEpoch}', occurredOn: occurred.text.trim(),
          vaccineDisplay: vaccine.text.trim(), vaccineCodeSystem: codeSystem.text.trim(), vaccineCode: code.text.trim(),
          doseNumber: dose.text.trim(), lotNumber: lot.text.trim(), manufacturer: manufacturer.text.trim(),
        );
      } else {
        await widget.session.api.updatePatientImmunization(
          item['id'].toString(), expectedVersion: (item['version'] as num).toInt(), occurredOn: occurred.text.trim(),
          vaccineDisplay: vaccine.text.trim(), vaccineCodeSystem: codeSystem.text.trim(), vaccineCode: code.text.trim(),
          doseNumber: dose.text.trim(), lotNumber: lot.text.trim(), manufacturer: manufacturer.text.trim(),
        );
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
      await _load();
    } on CarePointApiException catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.statusCode == 409 ? t('duplicateOrConflict') : value.toString())));
      if (value.statusCode == 409) await _load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      for (final c in [occurred, vaccine, codeSystem, code, dose, lot, manufacturer]) { c.dispose(); }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('immunizations')), actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))]),
    floatingActionButton: FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: Text(t('add'))),
    body: loading ? const Center(child: CircularProgressIndicator()) : error != null
      ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
      : items.isEmpty ? Center(child: Text(t('noImmunizations')))
      : RefreshIndicator(onRefresh: _load, child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 96), itemCount: items.length,
          itemBuilder: (_, index) {
            final item = items[index];
            final name = item['vaccineDisplay']?.toString().isNotEmpty == true ? item['vaccineDisplay'].toString() : item['vaccineCode']?.toString() ?? t('immunization');
            final details = [t('date') + ': ' + _dateOnly(item['occurredOn']), if (item['doseNumber'] != null) t('dose') + ': ' + item['doseNumber'].toString(), if (item['lotNumber'] != null) t('lot') + ': ' + item['lotNumber'].toString(), t('source') + ': ' + _sourceLabel(item['source'])].join('\n');
            return Card(child: ListTile(
              leading: const Icon(Icons.vaccines_outlined),
              title: Text(name),
              subtitle: Text(details),
              isThreeLine: true,
              trailing: IconButton(onPressed: () => _edit(item), icon: const Icon(Icons.edit_outlined), tooltip: t('edit')),
            ));
          },
        )),
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

String patientClinicalHistoryText(CarePointLocale locale, String key) =>
    _clinicalHistoryText[locale.name]?[key] ?? _clinicalHistoryText['en']?[key] ?? key;

const Map<String, Map<String, String>> _clinicalHistoryText = {
  'en': {
    'hospitalizations':'Hospitalizations','hospitalization':'Hospitalization','addHospitalization':'Add hospitalization','editHospitalization':'Edit hospitalization',
    'immunizations':'Immunizations','immunization':'Immunization','addImmunization':'Add immunization','editImmunization':'Edit immunization',
    'admittedOn':'Admission date','dischargedOn':'Discharge date','optionalDate':'YYYY-MM-DD (optional)','facility':'Facility','reason':'Reason',
    'occurredOn':'Vaccination date','vaccine':'Vaccine','dose':'Dose','lot':'Lot','manufacturer':'Manufacturer','coding':'Optional coding','codeSystem':'Code system','code':'Code',
    'source':'Source','date':'Date','add':'Add','edit':'Edit','save':'Save','saved':'Saved.','cancel':'Cancel','refresh':'Refresh',
    'invalidDate':'Use a valid date in YYYY-MM-DD format.','invalidInterval':'Discharge cannot be before admission.','vaccineRequired':'Enter a vaccine name or code.',
    'conflict':'The record changed in another session. Latest data was reloaded.','duplicateOrConflict':'This immunization already exists or the record changed. Latest data was reloaded.',
    'noHospitalizations':'No hospitalizations recorded.','noImmunizations':'No immunizations recorded.'
  },
  'ar': {
    'hospitalizations':'دخول المستشفى','hospitalization':'دخول المستشفى','addHospitalization':'إضافة دخول للمستشفى','editHospitalization':'تعديل دخول المستشفى',
    'immunizations':'التطعيمات','immunization':'تطعيم','addImmunization':'إضافة تطعيم','editImmunization':'تعديل تطعيم',
    'admittedOn':'تاريخ الدخول','dischargedOn':'تاريخ الخروج','optionalDate':'YYYY-MM-DD (اختياري)','facility':'المنشأة','reason':'السبب',
    'occurredOn':'تاريخ التطعيم','vaccine':'اللقاح','dose':'الجرعة','lot':'رقم التشغيلة','manufacturer':'المصنّع','coding':'الترميز الاختياري','codeSystem':'نظام الترميز','code':'الرمز',
    'source':'المصدر','date':'التاريخ','add':'إضافة','edit':'تعديل','save':'حفظ','saved':'تم الحفظ.','cancel':'إلغاء','refresh':'تحديث',
    'invalidDate':'استخدم تاريخاً صالحاً بصيغة YYYY-MM-DD.','invalidInterval':'لا يمكن أن يسبق الخروج تاريخ الدخول.','vaccineRequired':'أدخل اسم اللقاح أو رمزه.',
    'conflict':'تم تغيير السجل في جلسة أخرى. تم تحميل أحدث البيانات.','duplicateOrConflict':'التطعيم موجود بالفعل أو تم تغيير السجل. تم تحميل أحدث البيانات.',
    'noHospitalizations':'لا توجد حالات دخول للمستشفى مسجلة.','noImmunizations':'لا توجد تطعيمات مسجلة.'
  },
  'fr': {
    'hospitalizations':'Hospitalisations','hospitalization':'Hospitalisation','addHospitalization':'Ajouter une hospitalisation','editHospitalization':'Modifier l’hospitalisation',
    'immunizations':'Vaccinations','immunization':'Vaccination','addImmunization':'Ajouter une vaccination','editImmunization':'Modifier la vaccination',
    'admittedOn':'Date d’admission','dischargedOn':'Date de sortie','optionalDate':'YYYY-MM-DD (facultatif)','facility':'Établissement','reason':'Motif',
    'occurredOn':'Date de vaccination','vaccine':'Vaccin','dose':'Dose','lot':'Lot','manufacturer':'Fabricant','coding':'Codification facultative','codeSystem':'Système de code','code':'Code',
    'source':'Source','date':'Date','add':'Ajouter','edit':'Modifier','save':'Enregistrer','saved':'Enregistré.','cancel':'Annuler','refresh':'Actualiser',
    'invalidDate':'Utilisez une date valide au format YYYY-MM-DD.','invalidInterval':'La sortie ne peut pas précéder l’admission.','vaccineRequired':'Saisissez un vaccin ou un code.',
    'conflict':'Le dossier a changé dans une autre session. Les dernières données ont été rechargées.','duplicateOrConflict':'Cette vaccination existe déjà ou le dossier a changé. Les dernières données ont été rechargées.',
    'noHospitalizations':'Aucune hospitalisation enregistrée.','noImmunizations':'Aucune vaccination enregistrée.'
  },
  'es': {
    'hospitalizations':'Hospitalizaciones','hospitalization':'Hospitalización','addHospitalization':'Añadir hospitalización','editHospitalization':'Editar hospitalización',
    'immunizations':'Vacunas','immunization':'Vacuna','addImmunization':'Añadir vacuna','editImmunization':'Editar vacuna',
    'admittedOn':'Fecha de ingreso','dischargedOn':'Fecha de alta','optionalDate':'YYYY-MM-DD (opcional)','facility':'Centro','reason':'Motivo',
    'occurredOn':'Fecha de vacunación','vaccine':'Vacuna','dose':'Dosis','lot':'Lote','manufacturer':'Fabricante','coding':'Codificación opcional','codeSystem':'Sistema de códigos','code':'Código',
    'source':'Origen','date':'Fecha','add':'Añadir','edit':'Editar','save':'Guardar','saved':'Guardado.','cancel':'Cancelar','refresh':'Actualizar',
    'invalidDate':'Usa una fecha válida con formato YYYY-MM-DD.','invalidInterval':'El alta no puede ser anterior al ingreso.','vaccineRequired':'Introduce el nombre o código de la vacuna.',
    'conflict':'El registro cambió en otra sesión. Se han recargado los últimos datos.','duplicateOrConflict':'La vacuna ya existe o el registro cambió. Se han recargado los últimos datos.',
    'noHospitalizations':'No hay hospitalizaciones registradas.','noImmunizations':'No hay vacunas registradas.'
  },
};
