import 'dart:convert';

import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String documentText(CarePointLocale locale, String key) => _strings[locale.name]?[key] ?? _strings['en']![key] ?? key;

const _strings = <String, Map<String, String>>{
  'en': {
    'title': 'Documents & diagnostics', 'documents': 'Clinical documents', 'reports': 'Diagnostic reports',
    'noDocuments': 'No released clinical documents.', 'noReports': 'No released diagnostic reports.',
    'open': 'Open', 'release': 'Release to patient', 'newReference': 'New imaging reference', 'newReport': 'New diagnostic report',
    'finalize': 'Finalize', 'status': 'Status', 'type': 'Type', 'titleField': 'Title', 'reference': 'External reference',
    'description': 'Description', 'findings': 'Findings', 'impression': 'Impression', 'save': 'Save', 'cancel': 'Cancel',
    'accessBasis': 'Access basis', 'encrypted': 'Encrypted at rest', 'released': 'Released to patient',
    'contentProtected': 'Binary content is available only through the authenticated CarePoint API.',
    'refresh': 'Refresh', 'required': 'Required fields are missing.', 'patientUpload': 'Patient upload',
  },
  'ar': {
    'title': 'المستندات والتشخيص', 'documents': 'المستندات السريرية', 'reports': 'التقارير التشخيصية',
    'noDocuments': 'لا توجد مستندات سريرية منشورة.', 'noReports': 'لا توجد تقارير تشخيصية منشورة.',
    'open': 'فتح', 'release': 'إرسال للمريض', 'newReference': 'مرجع تصوير جديد', 'newReport': 'تقرير تشخيصي جديد',
    'finalize': 'اعتماد نهائي', 'status': 'الحالة', 'type': 'النوع', 'titleField': 'العنوان', 'reference': 'المرجع الخارجي',
    'description': 'الوصف', 'findings': 'النتائج', 'impression': 'الانطباع', 'save': 'حفظ', 'cancel': 'إلغاء',
    'accessBasis': 'أساس الوصول', 'encrypted': 'مشفّر أثناء التخزين', 'released': 'مُرسل للمريض',
    'contentProtected': 'المحتوى الثنائي متاح فقط عبر واجهة CarePoint الموثّقة.',
    'refresh': 'تحديث', 'required': 'الحقول المطلوبة غير مكتملة.', 'patientUpload': 'رفع من المريض',
  },
  'fr': {
    'title': 'Documents et diagnostics', 'documents': 'Documents cliniques', 'reports': 'Rapports diagnostiques',
    'noDocuments': 'Aucun document clinique publié.', 'noReports': 'Aucun rapport diagnostique publié.',
    'open': 'Ouvrir', 'release': 'Publier au patient', 'newReference': 'Nouvelle référence d’imagerie', 'newReport': 'Nouveau rapport diagnostique',
    'finalize': 'Finaliser', 'status': 'Statut', 'type': 'Type', 'titleField': 'Titre', 'reference': 'Référence externe',
    'description': 'Description', 'findings': 'Résultats', 'impression': 'Impression', 'save': 'Enregistrer', 'cancel': 'Annuler',
    'accessBasis': 'Base d’accès', 'encrypted': 'Chiffré au repos', 'released': 'Publié au patient',
    'contentProtected': 'Le contenu binaire est disponible uniquement via l’API CarePoint authentifiée.',
    'refresh': 'Actualiser', 'required': 'Des champs obligatoires sont manquants.', 'patientUpload': 'Téléversement patient',
  },
  'es': {
    'title': 'Documentos y diagnóstico', 'documents': 'Documentos clínicos', 'reports': 'Informes diagnósticos',
    'noDocuments': 'No hay documentos clínicos liberados.', 'noReports': 'No hay informes diagnósticos liberados.',
    'open': 'Abrir', 'release': 'Liberar al paciente', 'newReference': 'Nueva referencia de imagen', 'newReport': 'Nuevo informe diagnóstico',
    'finalize': 'Finalizar', 'status': 'Estado', 'type': 'Tipo', 'titleField': 'Título', 'reference': 'Referencia externa',
    'description': 'Descripción', 'findings': 'Hallazgos', 'impression': 'Impresión', 'save': 'Guardar', 'cancel': 'Cancelar',
    'accessBasis': 'Base de acceso', 'encrypted': 'Cifrado en reposo', 'released': 'Liberado al paciente',
    'contentProtected': 'El contenido binario solo está disponible mediante la API autenticada de CarePoint.',
    'refresh': 'Actualizar', 'required': 'Faltan campos obligatorios.', 'patientUpload': 'Carga del paciente',
  },
};

class ClinicalDocumentsActionButton extends StatelessWidget {
  const ClinicalDocumentsActionButton({super.key, required this.session, required this.locale, required this.appointment});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: ProviderClinicalDocumentsPage(session: session, locale: locale, appointment: appointment),
        ))),
        icon: const Icon(Icons.folder_shared_outlined),
        label: Text(documentText(locale, 'title')),
      );
}

class PatientClinicalDocumentsPage extends StatefulWidget {
  const PatientClinicalDocumentsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<PatientClinicalDocumentsPage> createState() => _PatientClinicalDocumentsPageState();
}

class _PatientClinicalDocumentsPageState extends State<PatientClinicalDocumentsPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> documents = const [];
  List<Map<String, dynamic>> reports = const [];

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final result = await Future.wait([widget.session.api.patientClinicalDocuments(), widget.session.api.patientDiagnosticReports()]);
      if (mounted) setState(() { documents = _list(result[0]['items']); reports = _list(result[1]['items']); });
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(documentText(widget.locale, 'title')), actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh))]),
        body: busy ? const Center(child: CircularProgressIndicator()) : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.all(16), children: [
                _sectionTitle(documentText(widget.locale, 'documents')),
                if (documents.isEmpty) _empty(documentText(widget.locale, 'noDocuments')) else ...documents.map(_documentCard),
                const SizedBox(height: 18),
                _sectionTitle(documentText(widget.locale, 'reports')),
                if (reports.isEmpty) _empty(documentText(widget.locale, 'noReports')) else ...reports.map(_reportCard),
              ])),
      );

  Widget _documentCard(Map<String, dynamic> document) {
    final metadata = _map(document['metadata']);
    return Card(child: ListTile(
      leading: const CircleAvatar(child: Icon(Icons.description_outlined)),
      title: Text(metadata['title']?.toString() ?? metadata['fileName']?.toString() ?? document['kind']?.toString() ?? documentText(widget.locale, 'documents'), style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text('${document['kind'] ?? ''} · ${documentText(widget.locale, 'encrypted')}'),
      trailing: IconButton(onPressed: () => _openDocument(document), icon: const Icon(Icons.open_in_new), tooltip: documentText(widget.locale, 'open')),
    ));
  }

  Widget _reportCard(Map<String, dynamic> report) {
    final data = _map(report['data']);
    return Card(child: ExpansionTile(
      leading: const CircleAvatar(child: Icon(Icons.image_outlined)),
      title: Text('${report['type'] ?? documentText(widget.locale, 'reports')} · ${report['status'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text(data['impression']?.toString() ?? data['findings']?.toString() ?? ''),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [if (data['findings'] != null) _line(documentText(widget.locale, 'findings'), data['findings']), if (data['impression'] != null) _line(documentText(widget.locale, 'impression'), data['impression'])],
    ));
  }

  Future<void> _openDocument(Map<String, dynamic> document) async {
    try {
      final result = await widget.session.api.clinicalDocumentContent(document['id'].toString());
      if (!mounted) return;
      final metadata = _map(result['metadata']);
      String body;
      if (result['storageMode'] == 'EXTERNAL_REFERENCE') {
        body = '${metadata['title'] ?? ''}\n\n${metadata['externalReference'] ?? ''}\n\n${metadata['description'] ?? ''}';
      } else if (result['mediaType'] == 'text/plain' && result['contentBase64'] is String) {
        try { body = utf8.decode(base64Decode(result['contentBase64'].toString())); } catch (_) { body = documentText(widget.locale, 'contentProtected'); }
      } else {
        body = '${metadata['fileName'] ?? metadata['title'] ?? ''}\n\n${result['mediaType'] ?? ''}\n${result['byteLength'] ?? ''} bytes\n\n${documentText(widget.locale, 'contentProtected')}';
      }
      await showDialog<void>(context: context, builder: (_) => AlertDialog(title: Text(metadata['title']?.toString() ?? documentText(widget.locale, 'documents')), content: SingleChildScrollView(child: SelectableText(body)), actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(documentText(widget.locale, 'cancel')))]));
    } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); }
  }

  Widget _sectionTitle(String value) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)));
  Widget _empty(String value) => Padding(padding: const EdgeInsets.symmetric(vertical: 20), child: Center(child: Text(value, textAlign: TextAlign.center)));
  Widget _line(String label, dynamic value) => Padding(padding: const EdgeInsets.only(top: 8), child: Align(alignment: AlignmentDirectional.centerStart, child: RichText(text: TextSpan(style: DefaultTextStyle.of(context).style, children: [TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w800)), TextSpan(text: value?.toString() ?? '')]))));
}

class ProviderClinicalDocumentsPage extends StatefulWidget {
  const ProviderClinicalDocumentsPage({super.key, required this.session, required this.locale, required this.appointment});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  @override
  State<ProviderClinicalDocumentsPage> createState() => _ProviderClinicalDocumentsPageState();
}

class _ProviderClinicalDocumentsPageState extends State<ProviderClinicalDocumentsPage> {
  bool busy = true;
  String? error;
  String? accessBasis;
  List<Map<String, dynamic>> documents = const [];
  List<Map<String, dynamic>> reports = const [];
  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;
  String get appointmentId => widget.appointment['id'].toString();
  String? get patientId => _map(widget.appointment['patient'])['id']?.toString();

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    final id = patientId;
    if (id == null || id.isEmpty) { setState(() { busy = false; error = 'Patient id unavailable.'; }); return; }
    setState(() { busy = true; error = null; });
    try {
      final result = await Future.wait([api.providerClinicalDocuments(id), api.providerDiagnosticReports(id)]);
      if (mounted) setState(() { documents = _list(result[0]['items']); reports = _list(result[1]['items']); accessBasis = result[0]['accessBasis']?.toString(); });
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(documentText(locale, 'title')), actions: [IconButton(onPressed: load, icon: const Icon(Icons.refresh))]),
        body: busy ? const Center(child: CircularProgressIndicator()) : error != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
            : RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 100), children: [
                if (accessBasis != null) Text('${documentText(locale, 'accessBasis')}: $accessBasis', style: const TextStyle(color: Color(0xFF64748B))),
                const SizedBox(height: 10),
                _sectionTitle(documentText(locale, 'documents')),
                if (documents.isEmpty) _empty(documentText(locale, 'noDocuments')) else ...documents.map(_documentCard),
                const SizedBox(height: 18),
                _sectionTitle(documentText(locale, 'reports')),
                if (reports.isEmpty) _empty(documentText(locale, 'noReports')) else ...reports.map(_reportCard),
              ])),
        floatingActionButton: PopupMenuButton<String>(
          onSelected: (value) => value == 'reference' ? _newReference() : _newReport(),
          itemBuilder: (_) => [
            PopupMenuItem(value: 'reference', child: ListTile(leading: const Icon(Icons.link_outlined), title: Text(documentText(locale, 'newReference')))),
            PopupMenuItem(value: 'report', child: ListTile(leading: const Icon(Icons.image_outlined), title: Text(documentText(locale, 'newReport')))),
          ],
          child: FloatingActionButton(onPressed: null, child: const Icon(Icons.add)),
        ),
      );

  Widget _documentCard(Map<String, dynamic> document) {
    final metadata = _map(document['metadata']);
    return Card(child: ListTile(
      title: Text(metadata['title']?.toString() ?? metadata['fileName']?.toString() ?? document['kind']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text('${document['kind'] ?? ''} · ${document['releasedToPatient'] == true ? documentText(locale, 'released') : documentText(locale, 'encrypted')}'),
      trailing: document['releasedToPatient'] == true ? null : TextButton(onPressed: () => _run(() => api.releaseClinicalDocument(document['id'].toString())), child: Text(documentText(locale, 'release'))),
    ));
  }

  Widget _reportCard(Map<String, dynamic> report) {
    final data = _map(report['data']);
    return Card(child: ExpansionTile(
      title: Text('${report['type'] ?? ''} · ${report['status'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text(data['impression']?.toString() ?? data['findings']?.toString() ?? ''),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        if (data['findings'] != null) _line(documentText(locale, 'findings'), data['findings']),
        if (data['impression'] != null) _line(documentText(locale, 'impression'), data['impression']),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [
          if (report['status'] == 'DRAFT') FilledButton.tonal(onPressed: () => _run(() => api.finalizeDiagnosticReport(report['id'].toString())), child: Text(documentText(locale, 'finalize'))),
          if (report['status'] == 'FINAL') FilledButton(onPressed: () => _run(() => api.releaseDiagnosticReport(report['id'].toString())), child: Text(documentText(locale, 'release'))),
        ]),
      ],
    ));
  }

  Future<void> _newReference() async {
    final title = TextEditingController();
    final reference = TextEditingController();
    final description = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(
      title: Text(documentText(locale, 'newReference')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: title, decoration: InputDecoration(labelText: documentText(locale, 'titleField'))),
        TextField(controller: reference, decoration: InputDecoration(labelText: documentText(locale, 'reference'))),
        TextField(controller: description, maxLines: 3, decoration: InputDecoration(labelText: documentText(locale, 'description'))),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(documentText(locale, 'cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(documentText(locale, 'save')))],
    ));
    if (ok != true) return;
    if (title.text.trim().isEmpty || reference.text.trim().isEmpty) { _message(documentText(locale, 'required')); return; }
    await _run(() => api.createEncounterDocumentReference(appointmentId, {'title': title.text.trim(), 'externalReference': reference.text.trim(), if (description.text.trim().isNotEmpty) 'description': description.text.trim()}));
  }

  Future<void> _newReport() async {
    String type = 'IMAGING';
    final findings = TextEditingController();
    final impression = TextEditingController();
    final documentId = documents.isEmpty ? null : documents.first['id']?.toString();
    final ok = await showDialog<bool>(context: context, builder: (_) => StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
      title: Text(documentText(locale, 'newReport')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(initialValue: type, items: const [DropdownMenuItem(value: 'IMAGING', child: Text('IMAGING')), DropdownMenuItem(value: 'PATHOLOGY', child: Text('PATHOLOGY')), DropdownMenuItem(value: 'OTHER', child: Text('OTHER'))], onChanged: (value) { if (value != null) setDialogState(() => type = value); }, decoration: InputDecoration(labelText: documentText(locale, 'type'))),
        TextField(controller: findings, maxLines: 4, decoration: InputDecoration(labelText: documentText(locale, 'findings'))),
        TextField(controller: impression, maxLines: 3, decoration: InputDecoration(labelText: documentText(locale, 'impression'))),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(documentText(locale, 'cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(documentText(locale, 'save')))],
    )));
    if (ok != true) return;
    if (findings.text.trim().isEmpty) { _message(documentText(locale, 'required')); return; }
    await _run(() => api.createDiagnosticReport(appointmentId, {'type': type, 'findings': findings.text.trim(), if (impression.text.trim().isNotEmpty) 'impression': impression.text.trim(), if (documentId != null) 'documentId': documentId}));
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() action) async {
    try { await action(); await load(); } catch (value) { _message(value.toString()); }
  }
  void _message(String value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value))); }
  Widget _sectionTitle(String value) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)));
  Widget _empty(String value) => Padding(padding: const EdgeInsets.symmetric(vertical: 20), child: Center(child: Text(value, textAlign: TextAlign.center)));
  Widget _line(String label, dynamic value) => Padding(padding: const EdgeInsets.only(top: 8), child: Align(alignment: AlignmentDirectional.centerStart, child: RichText(text: TextSpan(style: DefaultTextStyle.of(context).style, children: [TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w800)), TextSpan(text: value?.toString() ?? '')]))));
}

Map<String, dynamic> _map(dynamic value) { if (value is Map<String, dynamic>) return value; if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item)); return <String, dynamic>{}; }
List<Map<String, dynamic>> _list(dynamic value) { if (value is! List) return const []; return value.map(_map).toList(growable: false); }
