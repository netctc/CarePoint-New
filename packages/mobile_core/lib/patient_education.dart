import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class DoctorPatientEducationPage extends StatefulWidget {
  const DoctorPatientEducationPage({super.key, required this.session, required this.locale, required this.patientId, required this.appointmentId});
  final CarePointSession session; final CarePointLocale locale; final String patientId; final String appointmentId;
  @override State<DoctorPatientEducationPage> createState() => _DoctorPatientEducationPageState();
}

class _DoctorPatientEducationPageState extends State<DoctorPatientEducationPage> {
  bool loading = true; String? error;
  List<Map<String,dynamic>> catalog = const [], assignments = const [], carePlans = const [];
  CarePointApi get api => widget.session.api;
  String t(String key) => patientEducationText(widget.locale, key);
  @override void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final values = await Future.wait([
        api.doctorEducationCatalog(widget.appointmentId),
        api.doctorPatientEducation(widget.patientId),
      ]);
      var plans = const <Map<String,dynamic>>[];
      try {
        plans = _maps((await api.doctorPatientCarePlans(widget.patientId))['items'])
          .where((item) => ['ACTIVE','PAUSED'].contains(item['status']?.toString())).toList(growable: false);
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        catalog = _maps(values[0]['items']);
        assignments = _maps(values[1]['items']);
        carePlans = plans;
      });
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Future<void> _assign(Map<String,dynamic> content) async {
    String contextChoice = 'NONE';
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(
      builder: (context, setLocal) => AlertDialog(
        title: Text(t('assign')),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(_localized(content['labels'], widget.locale, content['code']?.toString() ?? t('material')), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: contextChoice,
            decoration: InputDecoration(labelText: t('carePlanContext'), border: const OutlineInputBorder()),
            items: [
              DropdownMenuItem(value: 'NONE', child: Text(t('noContext'))),
              ...carePlans.map((plan) => DropdownMenuItem(
                value: plan['id'].toString(),
                child: Text(_map(plan['data'])['title']?.toString() ?? plan['id'].toString()),
              )),
            ],
            onChanged: (value) => setLocal(() => contextChoice = value ?? 'NONE'),
          ),
          const SizedBox(height: 10),
          Text(t('sourceNotice'), style: const TextStyle(color: Color(0xFF64748B))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('assign'))),
        ],
      ),
    ));
    if (accepted != true) return;
    try {
      await api.assignDoctorPatientEducation(widget.patientId, {
        'appointmentId': widget.appointmentId,
        'contentVersionId': content['id'].toString(),
        'idempotencyKey': 'mobile-education-${DateTime.now().microsecondsSinceEpoch}',
        if (contextChoice != 'NONE') 'contextKind': 'CARE_PLAN',
        if (contextChoice != 'NONE') 'contextId': contextChoice,
      });
      await _load();
    } catch (value) { _message(value.toString()); }
  }

  Future<void> _revoke(Map<String,dynamic> assignment) async {
    final ok = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(t('revoke')), content: Text(t('revokePrompt')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(t('cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(t('confirm'))),
      ],
    )) ?? false;
    if (!ok) return;
    try { await api.revokeDoctorPatientEducation(assignment['id'].toString()); await _load(); }
    catch (value) { _message(value.toString()); }
  }

  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('doctorTitle')), actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))]),
    body: loading ? const Center(child: CircularProgressIndicator())
      : error != null ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
      : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(12), children: [
          _header(t('approvedCatalog'), Icons.school_outlined),
          if (catalog.isEmpty) _empty(t('noCatalog')) else ...catalog.map(_catalogCard),
          const SizedBox(height: 18),
          _header(t('assigned'), Icons.assignment_turned_in_outlined),
          if (assignments.isEmpty) _empty(t('noAssignments')) else ...assignments.map(_assignmentCard),
        ])),
  );

  Widget _header(String text, IconData icon) => Row(children: [Icon(icon), const SizedBox(width: 8), Expanded(child: Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)))]);
  Widget _empty(String text) => Card(child: Padding(padding: const EdgeInsets.all(14), child: Text(text)));

  Widget _catalogCard(Map<String,dynamic> item) => Card(child: Padding(
    padding: const EdgeInsets.all(12),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(_localized(item['labels'], widget.locale, item['code']?.toString() ?? t('material')), style: const TextStyle(fontWeight: FontWeight.w900)),
      const SizedBox(height: 6), Text(_localized(item['bodyLabels'], widget.locale, ''), maxLines: 4, overflow: TextOverflow.ellipsis),
      const SizedBox(height: 8), Text('${t('source')}: ${item['sourceName'] ?? '—'}', style: const TextStyle(color: Color(0xFF475569))),
      if (item['sourceUrl'] != null) SelectableText(item['sourceUrl'].toString(), style: const TextStyle(color: Color(0xFF64748B))),
      const SizedBox(height: 8),
      FilledButton.tonalIcon(key: ValueKey('doctor-education-assign-${item['id']}'), onPressed: () => _assign(item), icon: const Icon(Icons.send_outlined), label: Text(t('assign'))),
    ]),
  ));

  Widget _assignmentCard(Map<String,dynamic> item) {
    final content = _map(item['content']); final active = item['status'] == 'ASSIGNED';
    return Card(child: ListTile(
      leading: Icon(active ? Icons.menu_book_outlined : Icons.block_outlined),
      title: Text(_localized(content['labels'], widget.locale, content['code']?.toString() ?? t('material'))),
      subtitle: Text([
        '${t('version')} ${content['version'] ?? ''}',
        '${t('source')}: ${content['sourceName'] ?? '—'}',
        if (item['contextKind'] != null) '${t('context')}: ${item['contextKind']}',
        '${t('status')}: ${item['status'] ?? ''}',
      ].join('\n')), isThreeLine: true,
      trailing: active ? IconButton(key: ValueKey('doctor-education-revoke-${item['id']}'), tooltip: t('revoke'), onPressed: () => _revoke(item), icon: const Icon(Icons.remove_circle_outline)) : null,
    ));
  }
  void _message(String value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value))); }
}

class PatientEducationPage extends StatefulWidget {
  const PatientEducationPage({super.key, required this.session, required this.locale});
  final CarePointSession session; final CarePointLocale locale;
  @override State<PatientEducationPage> createState() => _PatientEducationPageState();
}

class _PatientEducationPageState extends State<PatientEducationPage> {
  bool loading = true; String? error; List<Map<String,dynamic>> items = const [];
  String t(String key) => patientEducationText(widget.locale, key);
  @override void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final result = await widget.session.api.patientEducation();
      if (mounted) setState(() => items = _maps(result['items']));
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(t('patientTitle')), actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined), tooltip: t('refresh'))]),
    body: loading ? const Center(child: CircularProgressIndicator())
      : error != null ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
      : RefreshIndicator(onRefresh: _load, child: items.isEmpty
          ? ListView(children: [Padding(padding: const EdgeInsets.all(28), child: Text(t('noPatientEducation'), textAlign: TextAlign.center))])
          : ListView.builder(padding: const EdgeInsets.all(12), itemCount: items.length, itemBuilder: (_, index) => _patientCard(items[index]))),
  );

  Widget _patientCard(Map<String,dynamic> assignment) {
    final content = _map(assignment['content']);
    return Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [const Icon(Icons.school_outlined), const SizedBox(width: 8), Expanded(child: Text(_localized(content['labels'], widget.locale, content['code']?.toString() ?? t('material')), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)))]),
      const SizedBox(height: 10), Text(_localized(content['bodyLabels'], widget.locale, '')),
      const SizedBox(height: 12), Text('${t('source')}: ${content['sourceName'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700)),
      if (content['sourceUrl'] != null) SelectableText(content['sourceUrl'].toString(), style: const TextStyle(color: Color(0xFF64748B))),
      const SizedBox(height: 8), Text('${t('version')}: ${content['version'] ?? ''}', style: const TextStyle(color: Color(0xFF64748B))),
      if (assignment['contextKind'] != null) Text('${t('context')}: ${assignment['contextKind']}', style: const TextStyle(color: Color(0xFF64748B))),
      const SizedBox(height: 8), Text(t('patientNotice'), style: const TextStyle(color: Color(0xFF64748B))),
    ])));
  }
}

String patientEducationText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String,String>>{
    CarePointLocale.en: {'doctorTitle':'Patient education','patientTitle':'Education from my care team','approvedCatalog':'Approved content','assigned':'Assigned to this patient','material':'Education material','assign':'Assign','revoke':'Revoke','revokePrompt':'Revoke this education assignment? The catalog version remains unchanged.','refresh':'Refresh','cancel':'Cancel','confirm':'Confirm','source':'Source','sourceNotice':'The patient will receive this exact approved version with its source visible.','version':'Version','context':'Context','status':'Status','carePlanContext':'Optional Care Plan context','noContext':'No specific Care Plan','noCatalog':'No published education content is available.','noAssignments':'No education has been assigned by you to this patient.','noPatientEducation':'No active education content is assigned to you.','patientNotice':'This material was assigned by your care team. It supports education and does not replace individualized medical advice.'},
    CarePointLocale.ar: {'doctorTitle':'تثقيف المريض','patientTitle':'مواد تثقيفية من فريق الرعاية','approvedCatalog':'محتوى معتمد','assigned':'المواد المرسلة لهذا المريض','material':'مادة تثقيفية','assign':'إرسال','revoke':'إلغاء','revokePrompt':'إلغاء إرسال هذه المادة؟ تبقى نسخة الكتالوج دون تغيير.','refresh':'تحديث','cancel':'إلغاء','confirm':'تأكيد','source':'المصدر','sourceNotice':'سيحصل المريض على هذه النسخة المعتمدة نفسها مع إظهار المصدر.','version':'الإصدار','context':'السياق','status':'الحالة','carePlanContext':'سياق خطة الرعاية اختياري','noContext':'بدون خطة رعاية محددة','noCatalog':'لا يوجد محتوى تثقيفي منشور.','noAssignments':'لم ترسل مواد تثقيفية لهذا المريض.','noPatientEducation':'لا توجد مواد تثقيفية نشطة مخصصة لك.','patientNotice':'تم إرسال هذه المادة من فريق الرعاية لدعم التثقيف ولا تستبدل المشورة الطبية الفردية.'},
    CarePointLocale.fr: {'doctorTitle':'Éducation du patient','patientTitle':'Éducation de mon équipe de soins','approvedCatalog':'Contenu approuvé','assigned':'Attribué à ce patient','material':'Ressource éducative','assign':'Attribuer','revoke':'Révoquer','revokePrompt':'Révoquer cette attribution ? La version du catalogue reste inchangée.','refresh':'Actualiser','cancel':'Annuler','confirm':'Confirmer','source':'Source','sourceNotice':'Le patient recevra exactement cette version approuvée avec sa source visible.','version':'Version','context':'Contexte','status':'Statut','carePlanContext':'Contexte Plan de soins facultatif','noContext':'Aucun Plan de soins spécifique','noCatalog':'Aucun contenu éducatif publié.','noAssignments':'Vous n’avez attribué aucun contenu à ce patient.','noPatientEducation':'Aucun contenu éducatif actif ne vous est attribué.','patientNotice':'Cette ressource est attribuée par votre équipe de soins; elle soutient l’éducation et ne remplace pas un avis médical individualisé.'},
    CarePointLocale.es: {'doctorTitle':'Educación del paciente','patientTitle':'Educación de mi equipo asistencial','approvedCatalog':'Contenido aprobado','assigned':'Asignado a este paciente','material':'Material educativo','assign':'Asignar','revoke':'Revocar','revokePrompt':'¿Revocar esta asignación? La versión del catálogo permanece intacta.','refresh':'Actualizar','cancel':'Cancelar','confirm':'Confirmar','source':'Fuente','sourceNotice':'El paciente recibirá exactamente esta versión aprobada con la fuente visible.','version':'Versión','context':'Contexto','status':'Estado','carePlanContext':'Contexto opcional de Plan de cuidado','noContext':'Sin Plan de cuidado específico','noCatalog':'No hay contenido educativo publicado.','noAssignments':'No has asignado material educativo a este paciente.','noPatientEducation':'No tienes material educativo activo asignado.','patientNotice':'Este material fue asignado por tu equipo asistencial; apoya la educación y no sustituye consejo médico individualizado.'},
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

String _localized(dynamic value, CarePointLocale locale, String fallback) {
  final map = _map(value);
  final code = switch (locale) { CarePointLocale.ar => 'ar', CarePointLocale.fr => 'fr', CarePointLocale.es => 'es', _ => 'en' };
  final local = map[code]?.toString().trim() ?? '';
  if (local.isNotEmpty) return local;
  final english = map['en']?.toString().trim() ?? '';
  return english.isNotEmpty ? english : fallback;
}
Map<String,dynamic> _map(dynamic value) {
  if (value is Map<String,dynamic>) return value;
  if (value is Map) return value.map((key,item) => MapEntry(key.toString(), item));
  return const {};
}
List<Map<String,dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}
