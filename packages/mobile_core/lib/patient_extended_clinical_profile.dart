import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

const _extendedKinds = ['IMPLANT_DEVICE', 'FAMILY_HISTORY', 'REPRODUCTIVE_HEALTH'];

class PatientExtendedClinicalProfilePage extends StatefulWidget {
  const PatientExtendedClinicalProfilePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<PatientExtendedClinicalProfilePage> createState() => _PatientExtendedClinicalProfilePageState();
}

class _PatientExtendedClinicalProfilePageState extends State<PatientExtendedClinicalProfilePage> {
  String kind = _extendedKinds.first;
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> items = const [];
  CarePointApi get api => widget.session.api;
  String t(String key) => patientExtendedClinicalProfileText(widget.locale, key);

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final value = await api.patientClinicalProfileEntries(kind: kind);
      if (mounted) setState(() => items = _maps(value['items']));
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('title')), actions: [
      IconButton(onPressed: _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh')),
    ]),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: loading ? null : () => _edit(),
      icon: const Icon(Icons.add),
      label: Text(t('add')),
    ),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
      children: [
        Card(child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.lock_outline),
            const SizedBox(width: 10),
            Expanded(child: Text(kind == 'REPRODUCTIVE_HEALTH' ? t('reproductivePrivacy') : t('privacy'))),
          ]),
        )),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'IMPLANT_DEVICE', icon: const Icon(Icons.medical_information_outlined), label: Text(t('devices'))),
            ButtonSegment(value: 'FAMILY_HISTORY', icon: const Icon(Icons.family_restroom_outlined), label: Text(t('family'))),
            ButtonSegment(value: 'REPRODUCTIVE_HEALTH', icon: const Icon(Icons.health_and_safety_outlined), label: Text(t('reproductive'))),
          ],
          selected: {kind},
          onSelectionChanged: loading ? null : (value) async {
            setState(() { kind = value.first; items = const []; });
            await _load();
          },
        ),
        const SizedBox(height: 12),
        if (loading)
          const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
        else if (error != null)
          Card(child: Padding(padding: const EdgeInsets.all(16), child: Text(error!)))
        else if (items.isEmpty)
          Card(child: Padding(padding: const EdgeInsets.all(20), child: Text(t('empty'), textAlign: TextAlign.center)))
        else
          ...items.map(_card),
      ],
    ),
  );

  Widget _card(Map<String, dynamic> item) {
    final data = _map(item['data']);
    final provenance = _map(item['provenance']);
    final title = switch (kind) {
      'IMPLANT_DEVICE' => data['display']?.toString() ?? t('device'),
      'FAMILY_HISTORY' => data['conditionDisplay']?.toString() ?? t('family'),
      _ => t('reproductive'),
    };
    final detail = switch (kind) {
      'IMPLANT_DEVICE' => [
          if (data['deviceType'] != null) data['deviceType'].toString(),
          if (data['implantedOn'] != null) '${t('implantedOn')}: ${data['implantedOn']}',
          '${t('deviceStatus')}: ${data['deviceStatus'] ?? 'ACTIVE'}',
        ].join(' · '),
      'FAMILY_HISTORY' => '${t('relationship')}: ${data['relationship'] ?? '—'}',
      _ => [
          if (data['pregnancyStatus'] != null) '${t('pregnancyStatus')}: ${data['pregnancyStatus']}',
          if (data['lactating'] != null) '${t('lactating')}: ${data['lactating'] == true ? t('yes') : t('no')}',
          if (data['gravida'] != null) 'G${data['gravida']}',
          if (data['para'] != null) 'P${data['para']}',
        ].join(' · '),
    };
    return Card(child: ListTile(
      leading: Icon(kind == 'IMPLANT_DEVICE' ? Icons.medical_information_outlined : kind == 'FAMILY_HISTORY' ? Icons.family_restroom_outlined : Icons.health_and_safety_outlined),
      title: Text(title),
      subtitle: Text([
        detail,
        '${t('status')}: ${item['status'] ?? '—'} · ${item['verificationStatus'] ?? '—'}',
        '${t('source')}: ${provenance['sourceType'] ?? '—'}',
      ].where((value) => value.isNotEmpty).join('\n')),
      isThreeLine: true,
      trailing: IconButton(
        key: ValueKey('patient-extended-profile-edit-${item['id']}'),
        onPressed: () => _edit(item),
        icon: const Icon(Icons.edit_outlined),
        tooltip: t('edit'),
      ),
    ));
  }

  Future<void> _edit([Map<String, dynamic>? item]) async {
    final result = switch (kind) {
      'IMPLANT_DEVICE' => await _implantDialog(item),
      'FAMILY_HISTORY' => await _familyDialog(item),
      _ => await _reproductiveDialog(item),
    };
    if (result == null) return;
    try {
      if (item == null) {
        await api.createPatientClinicalProfileEntry(kind: kind, data: _map(result['data']), status: result['status'].toString());
      } else {
        await api.updatePatientClinicalProfileEntry(
          item['id'].toString(),
          expectedVersion: _int(item['version']),
          data: _map(result['data']),
          status: result['status'].toString(),
        );
      }
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
    } on CarePointApiException catch (value) {
      if (value.statusCode == 409) await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Future<Map<String, dynamic>?> _implantDialog(Map<String, dynamic>? item) async {
    final data = _map(item?['data']);
    final display = TextEditingController(text: data['display']?.toString() ?? '');
    final type = TextEditingController(text: data['deviceType']?.toString() ?? '');
    final implanted = TextEditingController(text: data['implantedOn']?.toString() ?? '');
    final facility = TextEditingController(text: data['facility']?.toString() ?? '');
    final notes = TextEditingController(text: data['notes']?.toString() ?? '');
    final retired = TextEditingController(text: data['retiredOn']?.toString() ?? '');
    var deviceStatus = data['deviceStatus']?.toString() ?? 'ACTIVE';
    String? validation;
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setLocal) => AlertDialog(
      title: Text(item == null ? t('addDevice') : t('editDevice')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        _field(display, 'deviceName', required: true), _field(type, 'deviceType'), _field(implanted, 'implantedOn', hint: 'YYYY-MM-DD'),
        _field(facility, 'facility'),
        DropdownButtonFormField<String>(
          initialValue: deviceStatus,
          decoration: InputDecoration(labelText: t('deviceStatus'), border: const OutlineInputBorder()),
          items: ['ACTIVE','RETIRED'].map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(),
          onChanged: (v) => setLocal(() => deviceStatus = v ?? deviceStatus),
        ),
        const SizedBox(height: 10),
        if (deviceStatus == 'RETIRED') _field(retired, 'retiredOn', hint: 'YYYY-MM-DD'),
        _field(notes, 'notes', maxLines: 3),
        if (validation != null) Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () {
          if (display.text.trim().isEmpty) { setLocal(() => validation = t('required')); return; }
          if (!_optionalDateValid(implanted.text) || !_optionalDateValid(retired.text)) { setLocal(() => validation = t('invalidDate')); return; }
          Navigator.pop(dialogContext, true);
        }, child: Text(t('save'))),
      ],
    )));
    final result = accepted == true ? <String,dynamic>{
      'status': deviceStatus == 'RETIRED' ? 'INACTIVE' : 'ACTIVE',
      'data': <String,dynamic>{
        'display': display.text.trim(),
        if (type.text.trim().isNotEmpty) 'deviceType': type.text.trim(),
        if (implanted.text.trim().isNotEmpty) 'implantedOn': implanted.text.trim(),
        if (facility.text.trim().isNotEmpty) 'facility': facility.text.trim(),
        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
        'deviceStatus': deviceStatus,
        if (deviceStatus == 'RETIRED' && retired.text.trim().isNotEmpty) 'retiredOn': retired.text.trim(),
      }
    } : null;
    for (final c in [display,type,implanted,facility,notes,retired]) { c.dispose(); }
    return result;
  }

  Future<Map<String, dynamic>?> _familyDialog(Map<String, dynamic>? item) async {
    final data = _map(item?['data']);
    var relationship = data['relationship']?.toString() ?? 'PARENT';
    final condition = TextEditingController(text: data['conditionDisplay']?.toString() ?? '');
    final codeSystem = TextEditingController(text: data['codeSystem']?.toString() ?? '');
    final code = TextEditingController(text: data['code']?.toString() ?? '');
    final notes = TextEditingController(text: data['notes']?.toString() ?? '');
    String? validation;
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setLocal) => AlertDialog(
      title: Text(item == null ? t('addFamily') : t('editFamily')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(t('familyPrivacy'), style: const TextStyle(fontSize: 12)), const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: relationship,
          decoration: InputDecoration(labelText: t('relationship'), border: const OutlineInputBorder()),
          items: ['PARENT','SIBLING','CHILD','GRANDPARENT','OTHER'].map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(),
          onChanged: (v) => setLocal(() => relationship = v ?? relationship),
        ),
        const SizedBox(height: 10), _field(condition, 'condition', required: true),
        _field(codeSystem, 'codeSystem'), _field(code, 'code'), _field(notes, 'notes', maxLines: 3),
        if (validation != null) Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () {
          if (condition.text.trim().isEmpty) { setLocal(() => validation = t('required')); return; }
          Navigator.pop(dialogContext, true);
        }, child: Text(t('save'))),
      ],
    )));
    final result = accepted == true ? <String,dynamic>{
      'status': 'ACTIVE',
      'data': <String,dynamic>{
        'relationship': relationship, 'conditionDisplay': condition.text.trim(),
        if (codeSystem.text.trim().isNotEmpty) 'codeSystem': codeSystem.text.trim(),
        if (code.text.trim().isNotEmpty) 'code': code.text.trim(),
        if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
      }
    } : null;
    for (final c in [condition,codeSystem,code,notes]) { c.dispose(); }
    return result;
  }

  Future<Map<String, dynamic>?> _reproductiveDialog(Map<String, dynamic>? item) async {
    final data = _map(item?['data']);
    var pregnancy = data['pregnancyStatus']?.toString() ?? 'UNKNOWN';
    var lactating = data['lactating'] == true;
    final gravida = TextEditingController(text: data['gravida']?.toString() ?? '');
    final para = TextEditingController(text: data['para']?.toString() ?? '');
    final effectiveDate = TextEditingController(text: data['effectiveDate']?.toString() ?? '');
    final notes = TextEditingController(text: data['notes']?.toString() ?? '');
    String? validation;
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, setLocal) => AlertDialog(
      title: Text(item == null ? t('addReproductive') : t('editReproductive')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(t('reproductiveOptional'), style: const TextStyle(fontSize: 12)), const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: pregnancy,
          decoration: InputDecoration(labelText: t('pregnancyStatus'), border: const OutlineInputBorder()),
          items: ['UNKNOWN','PREGNANT','NOT_PREGNANT'].map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(),
          onChanged: (v) => setLocal(() => pregnancy = v ?? pregnancy),
        ),
        CheckboxListTile(contentPadding: EdgeInsets.zero, value: lactating, title: Text(t('lactating')), onChanged: (v) => setLocal(() => lactating = v == true)),
        _field(gravida, 'gravida', keyboard: TextInputType.number), _field(para, 'para', keyboard: TextInputType.number),
        _field(effectiveDate, 'effectiveDate', hint: 'YYYY-MM-DD'), _field(notes, 'notes', maxLines: 3),
        if (validation != null) Text(validation!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () {
          final g = gravida.text.trim().isEmpty ? null : int.tryParse(gravida.text.trim());
          final p = para.text.trim().isEmpty ? null : int.tryParse(para.text.trim());
          if ((g != null && (g < 0 || g > 99)) || (p != null && (p < 0 || p > 99))) { setLocal(() => validation = t('invalidNumber')); return; }
          if (!_optionalDateValid(effectiveDate.text)) { setLocal(() => validation = t('invalidDate')); return; }
          Navigator.pop(dialogContext, true);
        }, child: Text(t('save'))),
      ],
    )));
    final g = int.tryParse(gravida.text.trim()), p = int.tryParse(para.text.trim());
    final result = accepted == true ? <String,dynamic>{
      'status':'ACTIVE',
      'data': <String,dynamic>{
        'pregnancyStatus':pregnancy, 'lactating':lactating,
        if (g != null) 'gravida':g, if (p != null) 'para':p,
        if (effectiveDate.text.trim().isNotEmpty) 'effectiveDate':effectiveDate.text.trim(),
        if (notes.text.trim().isNotEmpty) 'notes':notes.text.trim(),
      }
    } : null;
    for (final c in [gravida,para,effectiveDate,notes]) { c.dispose(); }
    return result;
  }

  Widget _field(TextEditingController controller, String key, {bool required=false, String? hint, int maxLines=1, TextInputType? keyboard}) =>
      Padding(padding: const EdgeInsets.only(bottom: 10), child: TextField(
        controller: controller, keyboardType: keyboard, maxLines: maxLines,
        decoration: InputDecoration(labelText: t(key) + (required ? ' *' : ''), hintText: hint, border: const OutlineInputBorder()),
      ));

  bool _optionalDateValid(String value) {
    final text=value.trim(); if (text.isEmpty) return true;
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) return false;
    final parsed=DateTime.tryParse(text);
    return parsed != null && parsed.toIso8601String().substring(0,10)==text;
  }
}

String patientExtendedClinicalProfileText(CarePointLocale locale, String key) => _copy[locale]?[key] ?? _copy[CarePointLocale.en]?[key] ?? key;
const _copy=<CarePointLocale,Map<String,String>>{
  CarePointLocale.en:{'title':'Extended health profile','devices':'Devices','family':'Family history','reproductive':'Reproductive health','refresh':'Refresh','add':'Add','edit':'Edit','save':'Save','cancel':'Cancel','saved':'Saved.','empty':'No entries in this section.','privacy':'These entries are encrypted, versioned and shared with clinicians only under the existing clinical-profile consent rules.','reproductivePrivacy':'This section is optional, encrypted and never inferred from other CarePoint data.','familyPrivacy':'Record relationship and condition only. Do not enter the family member’s name or identifying details.','device':'Medical device','deviceName':'Device / implant','deviceType':'Device type','implantedOn':'Implanted on','facility':'Facility','notes':'Notes','deviceStatus':'Device status','retiredOn':'Retired on','addDevice':'Add device or implant','editDevice':'Edit device or implant','relationship':'Relationship','condition':'Condition','codeSystem':'Code system','code':'Code','addFamily':'Add family history','editFamily':'Edit family history','pregnancyStatus':'Pregnancy status','lactating':'Lactating','gravida':'Pregnancies (gravida)','para':'Births (para)','effectiveDate':'Effective date','addReproductive':'Add reproductive health','editReproductive':'Edit reproductive health','reproductiveOptional':'Enter only information you choose to share. CarePoint does not infer pregnancy or reproductive status.','status':'Status','source':'Source','yes':'Yes','no':'No','required':'Complete the required field.','invalidDate':'Use a valid YYYY-MM-DD date.','invalidNumber':'Use an integer from 0 to 99.'},
  CarePointLocale.ar:{'title':'الملف الصحي الموسّع','devices':'الأجهزة','family':'التاريخ العائلي','reproductive':'الصحة الإنجابية','refresh':'تحديث','add':'إضافة','edit':'تعديل','save':'حفظ','cancel':'إلغاء','saved':'تم الحفظ.','empty':'لا توجد بيانات في هذا القسم.','privacy':'تُشفّر هذه البيانات وتُحفظ بإصدارات ولا تُشارك مع المختصين إلا وفق موافقات الملف السريري الحالية.','reproductivePrivacy':'هذا القسم اختياري ومشفّر ولا يتم استنتاجه من بيانات CarePoint الأخرى.','familyPrivacy':'سجّل صلة القرابة والحالة فقط، ولا تدخل اسم القريب أو بياناته التعريفية.','device':'جهاز طبي','deviceName':'الجهاز أو الزرعة','deviceType':'نوع الجهاز','implantedOn':'تاريخ الزرع','facility':'المنشأة','notes':'ملاحظات','deviceStatus':'حالة الجهاز','retiredOn':'تاريخ الإزالة/الإيقاف','addDevice':'إضافة جهاز أو زرعة','editDevice':'تعديل جهاز أو زرعة','relationship':'صلة القرابة','condition':'الحالة','codeSystem':'نظام الترميز','code':'الرمز','addFamily':'إضافة تاريخ عائلي','editFamily':'تعديل التاريخ العائلي','pregnancyStatus':'حالة الحمل','lactating':'رضاعة','gravida':'عدد مرات الحمل','para':'عدد الولادات','effectiveDate':'تاريخ السريان','addReproductive':'إضافة صحة إنجابية','editReproductive':'تعديل الصحة الإنجابية','reproductiveOptional':'أدخل فقط المعلومات التي تختار مشاركتها. لا يستنتج CarePoint الحمل أو الحالة الإنجابية.','status':'الحالة','source':'المصدر','yes':'نعم','no':'لا','required':'أكمل الحقل المطلوب.','invalidDate':'استخدم تاريخاً صالحاً بصيغة YYYY-MM-DD.','invalidNumber':'استخدم عدداً صحيحاً من 0 إلى 99.'},
  CarePointLocale.fr:{'title':'Profil de santé étendu','devices':'Dispositifs','family':'Antécédents familiaux','reproductive':'Santé reproductive','refresh':'Actualiser','add':'Ajouter','edit':'Modifier','save':'Enregistrer','cancel':'Annuler','saved':'Enregistré.','empty':'Aucune donnée dans cette section.','privacy':'Ces données sont chiffrées, versionnées et partagées avec les cliniciens uniquement selon les consentements du profil clinique existants.','reproductivePrivacy':'Cette section est facultative, chiffrée et n’est jamais déduite d’autres données CarePoint.','familyPrivacy':'Indiquez seulement le lien de parenté et la condition, sans nom ni donnée identifiante du proche.','device':'Dispositif médical','deviceName':'Dispositif / implant','deviceType':'Type de dispositif','implantedOn':'Date d’implantation','facility':'Établissement','notes':'Notes','deviceStatus':'État du dispositif','retiredOn':'Date de retrait','addDevice':'Ajouter un dispositif','editDevice':'Modifier le dispositif','relationship':'Lien de parenté','condition':'Condition','codeSystem':'Système de code','code':'Code','addFamily':'Ajouter un antécédent familial','editFamily':'Modifier l’antécédent familial','pregnancyStatus':'Statut de grossesse','lactating':'Allaitement','gravida':'Grossesses (gravida)','para':'Accouchements (para)','effectiveDate':'Date effective','addReproductive':'Ajouter santé reproductive','editReproductive':'Modifier santé reproductive','reproductiveOptional':'Saisissez uniquement les informations que vous choisissez de partager. CarePoint ne déduit pas la grossesse ni le statut reproductif.','status':'Statut','source':'Source','yes':'Oui','no':'Non','required':'Complétez le champ obligatoire.','invalidDate':'Utilisez une date valide YYYY-MM-DD.','invalidNumber':'Utilisez un entier de 0 à 99.'},
  CarePointLocale.es:{'title':'Perfil de salud ampliado','devices':'Dispositivos','family':'Antecedentes familiares','reproductive':'Salud reproductiva','refresh':'Actualizar','add':'Añadir','edit':'Editar','save':'Guardar','cancel':'Cancelar','saved':'Guardado.','empty':'No hay datos en esta sección.','privacy':'Estos datos se cifran, versionan y solo se comparten con clínicos según los consentimientos existentes del perfil clínico.','reproductivePrivacy':'Esta sección es opcional, cifrada y nunca se infiere a partir de otros datos de CarePoint.','familyPrivacy':'Registra solo parentesco y condición; no introduzcas nombre ni datos identificativos del familiar.','device':'Dispositivo médico','deviceName':'Dispositivo / implante','deviceType':'Tipo de dispositivo','implantedOn':'Fecha de implante','facility':'Centro','notes':'Notas','deviceStatus':'Estado del dispositivo','retiredOn':'Fecha de retirada','addDevice':'Añadir dispositivo o implante','editDevice':'Editar dispositivo o implante','relationship':'Parentesco','condition':'Condición','codeSystem':'Sistema de códigos','code':'Código','addFamily':'Añadir antecedente familiar','editFamily':'Editar antecedente familiar','pregnancyStatus':'Estado de embarazo','lactating':'Lactancia','gravida':'Embarazos (gravida)','para':'Partos (para)','effectiveDate':'Fecha efectiva','addReproductive':'Añadir salud reproductiva','editReproductive':'Editar salud reproductiva','reproductiveOptional':'Introduce solo la información que elijas compartir. CarePoint no infiere embarazo ni estado reproductivo.','status':'Estado','source':'Origen','yes':'Sí','no':'No','required':'Completa el campo obligatorio.','invalidDate':'Usa una fecha válida YYYY-MM-DD.','invalidNumber':'Usa un entero de 0 a 99.'},
};
Map<String,dynamic> _map(dynamic value){if(value is Map<String,dynamic>)return value;if(value is Map)return value.map((k,v)=>MapEntry(k.toString(),v));return const{};}
List<Map<String,dynamic>> _maps(dynamic value)=>value is List?value.map(_map).toList(growable:false):const[];
int _int(dynamic value)=>value is num?value.toInt():int.tryParse(value?.toString()??'')??0;
