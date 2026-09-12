import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

String patientDocumentCentreText(CarePointLocale locale, String key) =>
    _documentCentreStrings[locale.name]?[key] ?? _documentCentreStrings['en']![key] ?? key;

const _documentCentreStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Clinical documents',
    'search': 'Search documents',
    'type': 'Type',
    'all': 'All types',
    'allInbox': 'All',
    'unopenedInbox': 'Unopened',
    'empty': 'No released clinical documents match this view.',
    'open': 'Secure open',
    'refresh': 'Refresh',
    'careTeam': 'Care team',
    'patient': 'Patient upload',
    'description': 'Description',
    'secureReady': 'The file was retrieved through a one-time CarePoint grant. This build keeps the bytes inside CarePoint and does not export them to shared device storage.',
    'referenceOnly': 'This record contains safe metadata only; no downloadable binary file is attached.',
    'bounded': 'Showing a bounded latest view. Older released documents remain available on the server.',
    'bytes': 'bytes',
    'close': 'Close',
    'retry': 'Retry',
    'opened': 'Opened',
    'unopened': 'Unopened',
    'acknowledged': 'Acknowledged',
    'acknowledge': 'Acknowledge',
    'patientProvided': 'Patient-provided',
    'notProviderVerified': 'Not provider-verified',
    'focused': 'Selected document',
    'addNote': 'Add personal note',
    'noteTitle': 'Title',
    'noteCategory': 'Category (optional)',
    'noteDescription': 'Description (optional)',
    'noteContent': 'Note',
    'save': 'Save',
    'cancel': 'Cancel',
    'required': 'Title and note are required.',
    'remove': 'Remove',
    'removeTitle': 'Remove personal document?',
    'removeBody': 'Only this patient-provided document will be removed from your CarePoint record. Provider-authored documents cannot be removed here.',
    'uploadFailed': 'Unable to save the personal note.',
    'actionFailed': 'The document action could not be completed.',
  },
  'ar': {
    'title': 'المستندات السريرية',
    'search': 'البحث في المستندات',
    'type': 'النوع',
    'all': 'كل الأنواع',
    'allInbox': 'الكل',
    'unopenedInbox': 'غير المفتوحة',
    'empty': 'لا توجد مستندات سريرية منشورة تطابق هذا العرض.',
    'open': 'فتح آمن',
    'refresh': 'تحديث',
    'careTeam': 'فريق الرعاية',
    'patient': 'رفع من المريض',
    'description': 'الوصف',
    'secureReady': 'تم جلب الملف عبر تصريح CarePoint صالح للاستخدام مرة واحدة. يحتفظ هذا الإصدار بالبيانات داخل CarePoint ولا يصدّرها إلى مساحة تخزين الجهاز المشتركة.',
    'referenceOnly': 'يحتوي هذا السجل على بيانات وصفية آمنة فقط ولا يوجد ملف ثنائي قابل للتنزيل.',
    'bounded': 'يتم عرض أحدث المستندات ضمن حد آمن. تبقى المستندات الأقدم المنشورة متاحة على الخادم.',
    'bytes': 'بايت',
    'close': 'إغلاق',
    'retry': 'إعادة المحاولة',
    'opened': 'مفتوح',
    'unopened': 'غير مفتوح',
    'acknowledged': 'تم التأكيد',
    'acknowledge': 'تأكيد الاطلاع',
    'patientProvided': 'مقدم من المريض',
    'notProviderVerified': 'غير موثّق من مقدم الرعاية',
    'focused': 'المستند المحدد',
    'addNote': 'إضافة ملاحظة شخصية',
    'noteTitle': 'العنوان',
    'noteCategory': 'التصنيف (اختياري)',
    'noteDescription': 'الوصف (اختياري)',
    'noteContent': 'الملاحظة',
    'save': 'حفظ',
    'cancel': 'إلغاء',
    'required': 'العنوان والملاحظة مطلوبان.',
    'remove': 'إزالة',
    'removeTitle': 'إزالة المستند الشخصي؟',
    'removeBody': 'سيتم فقط إزالة هذا المستند المقدم من المريض من سجل CarePoint. لا يمكن إزالة مستندات مقدم الرعاية من هنا.',
    'uploadFailed': 'تعذر حفظ الملاحظة الشخصية.',
    'actionFailed': 'تعذر إكمال إجراء المستند.',
  },
  'fr': {
    'title': 'Documents cliniques',
    'search': 'Rechercher des documents',
    'type': 'Type',
    'all': 'Tous les types',
    'allInbox': 'Tous',
    'unopenedInbox': 'Non ouverts',
    'empty': 'Aucun document clinique publié ne correspond à cette vue.',
    'open': 'Ouverture sécurisée',
    'refresh': 'Actualiser',
    'careTeam': 'Équipe de soins',
    'patient': 'Téléversement patient',
    'description': 'Description',
    'secureReady': 'Le fichier a été récupéré avec une autorisation CarePoint à usage unique. Cette version conserve les octets dans CarePoint et ne les exporte pas vers le stockage partagé de l’appareil.',
    'referenceOnly': 'Cet enregistrement contient uniquement des métadonnées sûres et aucun fichier binaire téléchargeable.',
    'bounded': 'Affichage borné des documents les plus récents. Les documents publiés plus anciens restent disponibles sur le serveur.',
    'bytes': 'octets',
    'close': 'Fermer',
    'retry': 'Réessayer',
    'opened': 'Ouvert',
    'unopened': 'Non ouvert',
    'acknowledged': 'Accusé de lecture',
    'acknowledge': 'Accuser réception',
    'patientProvided': 'Fourni par le patient',
    'notProviderVerified': 'Non vérifié par un professionnel',
    'focused': 'Document sélectionné',
    'addNote': 'Ajouter une note personnelle',
    'noteTitle': 'Titre',
    'noteCategory': 'Catégorie (facultatif)',
    'noteDescription': 'Description (facultatif)',
    'noteContent': 'Note',
    'save': 'Enregistrer',
    'cancel': 'Annuler',
    'required': 'Le titre et la note sont obligatoires.',
    'remove': 'Supprimer',
    'removeTitle': 'Supprimer le document personnel ?',
    'removeBody': 'Seul ce document fourni par le patient sera supprimé du dossier CarePoint. Les documents rédigés par un professionnel ne peuvent pas être supprimés ici.',
    'uploadFailed': 'Impossible d’enregistrer la note personnelle.',
    'actionFailed': 'L’action sur le document n’a pas pu être terminée.',
  },
  'es': {
    'title': 'Documentos clínicos',
    'search': 'Buscar documentos',
    'type': 'Tipo',
    'all': 'Todos los tipos',
    'allInbox': 'Todos',
    'unopenedInbox': 'Sin abrir',
    'empty': 'No hay documentos clínicos liberados que coincidan con esta vista.',
    'open': 'Apertura segura',
    'refresh': 'Actualizar',
    'careTeam': 'Equipo asistencial',
    'patient': 'Carga del paciente',
    'description': 'Descripción',
    'secureReady': 'El archivo se recuperó mediante una autorización CarePoint de un solo uso. Esta versión mantiene los bytes dentro de CarePoint y no los exporta al almacenamiento compartido del dispositivo.',
    'referenceOnly': 'Este registro contiene únicamente metadatos seguros y no tiene un archivo binario descargable.',
    'bounded': 'Se muestra una vista limitada de los documentos más recientes. Los documentos liberados más antiguos siguen disponibles en el servidor.',
    'bytes': 'bytes',
    'close': 'Cerrar',
    'retry': 'Reintentar',
    'opened': 'Abierto',
    'unopened': 'Sin abrir',
    'acknowledged': 'Confirmado',
    'acknowledge': 'Confirmar lectura',
    'patientProvided': 'Aportado por el paciente',
    'notProviderVerified': 'No verificado por un profesional',
    'focused': 'Documento seleccionado',
    'addNote': 'Añadir nota personal',
    'noteTitle': 'Título',
    'noteCategory': 'Categoría (opcional)',
    'noteDescription': 'Descripción (opcional)',
    'noteContent': 'Nota',
    'save': 'Guardar',
    'cancel': 'Cancelar',
    'required': 'El título y la nota son obligatorios.',
    'remove': 'Eliminar',
    'removeTitle': '¿Eliminar documento personal?',
    'removeBody': 'Solo se eliminará este documento aportado por el paciente de tu registro CarePoint. Los documentos creados por profesionales no se pueden eliminar aquí.',
    'uploadFailed': 'No se pudo guardar la nota personal.',
    'actionFailed': 'No se pudo completar la acción sobre el documento.',
  },
};

const _documentKinds = <String>[
  'ALL',
  'CLINICAL_ATTACHMENT',
  'LAB_REPORT',
  'IMAGING_REPORT',
  'IMAGING_REFERENCE',
  'PATHOLOGY_REPORT',
  'PATIENT_UPLOAD',
  'OTHER',
];

class PatientDocumentCentrePage extends StatefulWidget {
  const PatientDocumentCentrePage({
    super.key,
    required this.session,
    required this.locale,
    this.focusDocumentId,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final String? focusDocumentId;

  @override
  State<PatientDocumentCentrePage> createState() => _PatientDocumentCentrePageState();
}

class _PatientDocumentCentrePageState extends State<PatientDocumentCentrePage> {
  bool busy = true;
  bool truncated = false;
  String? error;
  String query = '';
  String kind = 'ALL';
  String inboxView = 'all';
  final Set<String> mutating = <String>{};
  List<Map<String, dynamic>> documents = const [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final result = await widget.session.api.patientDocumentCentre(
        limit: 100,
        focusDocumentId: widget.focusDocumentId,
      );
      if (!mounted) return;
      setState(() {
        documents = _list(result['items']);
        truncated = result['truncated'] == true;
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  List<Map<String, dynamic>> get visibleDocuments {
    final q = query.trim().toLowerCase();
    return documents.where((document) {
      if (kind != 'ALL' && document['kind']?.toString() != kind) return false;
      if (inboxView == 'unopened' && document['opened'] == true) return false;
      if (q.isEmpty) return true;
      final metadata = _map(document['metadata']);
      final haystack = [document['kind'], metadata['title'], metadata['fileName'], metadata['description']]
          .whereType<Object>()
          .map((value) => value.toString().toLowerCase())
          .join(' ');
      return haystack.contains(q);
    }).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final items = visibleDocuments;
    return Scaffold(
      key: const ValueKey('patient-document-centre'),
      appBar: AppBar(
        title: Text(patientDocumentCentreText(widget.locale, 'title')),
        actions: [
          IconButton(
            key: const ValueKey('patient-document-refresh'),
            onPressed: busy ? null : load,
            tooltip: patientDocumentCentreText(widget.locale, 'refresh'),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('patient-document-add-note'),
        onPressed: busy ? null : _addPersonalNote,
        icon: const Icon(Icons.note_add_outlined),
        label: Text(patientDocumentCentreText(widget.locale, 'addNote')),
      ),
      body: busy
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(error!, textAlign: TextAlign.center), const SizedBox(height: 12), FilledButton(onPressed: load, child: Text(patientDocumentCentreText(widget.locale, 'retry')))])))
              : RefreshIndicator(
                  onRefresh: load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 104),
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      SegmentedButton<String>(
                        key: const ValueKey('patient-document-inbox-view'),
                        segments: [
                          ButtonSegment(value: 'all', label: Text(patientDocumentCentreText(widget.locale, 'allInbox'))),
                          ButtonSegment(value: 'unopened', label: Text(patientDocumentCentreText(widget.locale, 'unopenedInbox'))),
                        ],
                        selected: {inboxView},
                        onSelectionChanged: (value) => setState(() => inboxView = value.first),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        key: const ValueKey('patient-document-search'),
                        onChanged: (value) => setState(() => query = value),
                        decoration: InputDecoration(
                          labelText: patientDocumentCentreText(widget.locale, 'search'),
                          prefixIcon: const Icon(Icons.search),
                          border: const OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        key: const ValueKey('patient-document-kind-filter'),
                        initialValue: kind,
                        decoration: InputDecoration(labelText: patientDocumentCentreText(widget.locale, 'type'), border: const OutlineInputBorder()),
                        items: _documentKinds.map((value) => DropdownMenuItem(value: value, child: Text(value == 'ALL' ? patientDocumentCentreText(widget.locale, 'all') : value))).toList(growable: false),
                        onChanged: (value) {
                          if (value != null) setState(() => kind = value);
                        },
                      ),
                      if (truncated) Padding(padding: const EdgeInsets.only(top: 10), child: Text(patientDocumentCentreText(widget.locale, 'bounded'), style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)))),
                      const SizedBox(height: 14),
                      if (items.isEmpty)
                        Padding(padding: const EdgeInsets.symmetric(vertical: 36), child: Center(child: Text(patientDocumentCentreText(widget.locale, 'empty'), textAlign: TextAlign.center)))
                      else
                        ...items.map(_documentCard),
                    ],
                  ),
                ),
    );
  }

  Widget _documentCard(Map<String, dynamic> document) {
    final metadata = _map(document['metadata']);
    final id = document['id']?.toString() ?? '';
    final title = metadata['title']?.toString() ?? metadata['fileName']?.toString() ?? document['kind']?.toString() ?? patientDocumentCentreText(widget.locale, 'title');
    final patientProvided = document['source'] == 'PATIENT';
    final source = patientProvided ? patientDocumentCentreText(widget.locale, 'patient') : patientDocumentCentreText(widget.locale, 'careTeam');
    final createdAt = DateTime.tryParse(document['createdAt']?.toString() ?? '')?.toLocal();
    final opened = document['opened'] == true || document['firstOpenedAt'] != null;
    final acknowledged = document['acknowledged'] == true || document['acknowledgedAt'] != null;
    final focused = widget.focusDocumentId != null && widget.focusDocumentId == id;
    final state = <String>[
      opened ? patientDocumentCentreText(widget.locale, 'opened') : patientDocumentCentreText(widget.locale, 'unopened'),
      if (acknowledged) patientDocumentCentreText(widget.locale, 'acknowledged'),
      if (patientProvided) patientDocumentCentreText(widget.locale, 'patientProvided'),
      if (patientProvided) patientDocumentCentreText(widget.locale, 'notProviderVerified'),
      if (focused) patientDocumentCentreText(widget.locale, 'focused'),
    ].join(' · ');
    return Card(
      key: ValueKey('patient-document-$id'),
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Column(
          children: [
            ListTile(
              leading: CircleAvatar(child: Icon(opened ? Icons.description_outlined : Icons.mark_email_unread_outlined)),
              title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('${document['kind'] ?? ''} · $source · ${_date(createdAt)}\n$state'),
              isThreeLine: true,
              trailing: IconButton(
                key: ValueKey('patient-document-open-$id'),
                onPressed: mutating.contains(id) ? null : () => _openDocument(document),
                tooltip: patientDocumentCentreText(widget.locale, 'open'),
                icon: Icon(document['downloadable'] == true ? Icons.lock_open_outlined : Icons.info_outline),
              ),
            ),
            if ((opened && !acknowledged) || document['patientRemovable'] == true)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    if (opened && !acknowledged)
                      TextButton.icon(
                        key: ValueKey('patient-document-ack-$id'),
                        onPressed: mutating.contains(id) ? null : () => _acknowledge(document),
                        icon: const Icon(Icons.done_all_outlined),
                        label: Text(patientDocumentCentreText(widget.locale, 'acknowledge')),
                      ),
                    if (document['patientRemovable'] == true)
                      TextButton.icon(
                        key: ValueKey('patient-document-remove-$id'),
                        onPressed: mutating.contains(id) ? null : () => _remove(document),
                        icon: const Icon(Icons.delete_outline),
                        label: Text(patientDocumentCentreText(widget.locale, 'remove')),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _openDocument(Map<String, dynamic> document) async {
    final metadata = _map(document['metadata']);
    final id = document['id']?.toString() ?? '';
    final title = metadata['title']?.toString() ?? metadata['fileName']?.toString() ?? patientDocumentCentreText(widget.locale, 'title');
    if (document['downloadable'] != true) {
      await _showText(title, '${metadata['description'] ?? ''}\n\n${patientDocumentCentreText(widget.locale, 'referenceOnly')}');
      return;
    }
    try {
      final downloaded = await widget.session.api.downloadPatientClinicalDocument(id);
      if (!mounted) return;
      if (downloaded.mediaType == 'image/jpeg' || downloaded.mediaType == 'image/png') {
        await showDialog<void>(
          context: context,
          builder: (_) => AlertDialog(
            title: Text(title),
            content: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640, maxHeight: 640),
              child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [Image.memory(Uint8List.fromList(downloaded.bytes), fit: BoxFit.contain), const SizedBox(height: 12), Text(downloaded.fileName)])),
            ),
            actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(patientDocumentCentreText(widget.locale, 'close')))],
          ),
        );
      } else if (downloaded.mediaType == 'text/plain') {
        String value;
        try {
          value = utf8.decode(downloaded.bytes);
        } catch (_) {
          value = patientDocumentCentreText(widget.locale, 'secureReady');
        }
        await _showText(title, value);
      } else {
        await _showText(
          title,
          '${downloaded.fileName}\n${downloaded.mediaType}\n${downloaded.bytes.length} ${patientDocumentCentreText(widget.locale, 'bytes')}\n\n${patientDocumentCentreText(widget.locale, 'secureReady')}',
        );
      }
      if (mounted) await load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Future<void> _acknowledge(Map<String, dynamic> document) async {
    final id = document['id']?.toString() ?? '';
    if (id.isEmpty || mutating.contains(id)) return;
    setState(() => mutating.add(id));
    try {
      await widget.session.api.acknowledgePatientClinicalDocument(id);
      if (mounted) await load();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(patientDocumentCentreText(widget.locale, 'actionFailed'))));
    } finally {
      if (mounted) setState(() => mutating.remove(id));
    }
  }

  Future<void> _remove(Map<String, dynamic> document) async {
    final id = document['id']?.toString() ?? '';
    if (id.isEmpty || mutating.contains(id)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(patientDocumentCentreText(widget.locale, 'removeTitle')),
        content: Text(patientDocumentCentreText(widget.locale, 'removeBody')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(patientDocumentCentreText(widget.locale, 'cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(patientDocumentCentreText(widget.locale, 'remove'))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => mutating.add(id));
    try {
      await widget.session.api.removePatientClinicalDocumentFromInbox(id);
      if (mounted) await load();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(patientDocumentCentreText(widget.locale, 'actionFailed'))));
    } finally {
      if (mounted) setState(() => mutating.remove(id));
    }
  }

  Future<void> _addPersonalNote() async {
    final draft = await showDialog<_PatientNoteDraft>(
      context: context,
      builder: (_) => _PatientNoteDialog(locale: widget.locale),
    );
    if (draft == null || !mounted) return;
    setState(() => busy = true);
    try {
      await widget.session.api.uploadPatientTextDocument(
        title: draft.title,
        content: draft.content,
        category: draft.category,
        description: draft.description,
      );
      if (mounted) await load();
    } catch (_) {
      if (mounted) {
        setState(() => busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(patientDocumentCentreText(widget.locale, 'uploadFailed'))));
      }
    }
  }

  Future<void> _showText(String title, String body) => showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(child: SelectableText(body.trim())),
          actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(patientDocumentCentreText(widget.locale, 'close')))],
        ),
      );
}

class _PatientNoteDraft {
  const _PatientNoteDraft({required this.title, required this.content, this.category, this.description});
  final String title;
  final String content;
  final String? category;
  final String? description;
}

class _PatientNoteDialog extends StatefulWidget {
  const _PatientNoteDialog({required this.locale});
  final CarePointLocale locale;

  @override
  State<_PatientNoteDialog> createState() => _PatientNoteDialogState();
}

class _PatientNoteDialogState extends State<_PatientNoteDialog> {
  final titleController = TextEditingController();
  final categoryController = TextEditingController();
  final descriptionController = TextEditingController();
  final contentController = TextEditingController();
  String? validation;

  @override
  void dispose() {
    titleController.dispose();
    categoryController.dispose();
    descriptionController.dispose();
    contentController.dispose();
    super.dispose();
  }

  void save() {
    final title = titleController.text.trim();
    final content = contentController.text.trim();
    if (title.isEmpty || content.isEmpty) {
      setState(() => validation = patientDocumentCentreText(widget.locale, 'required'));
      return;
    }
    Navigator.pop(
      context,
      _PatientNoteDraft(
        title: title,
        content: content,
        category: categoryController.text.trim().isEmpty ? null : categoryController.text.trim(),
        description: descriptionController.text.trim().isEmpty ? null : descriptionController.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(patientDocumentCentreText(widget.locale, 'addNote')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                key: const ValueKey('patient-document-note-title'),
                controller: titleController,
                decoration: InputDecoration(labelText: patientDocumentCentreText(widget.locale, 'noteTitle')),
              ),
              TextField(
                key: const ValueKey('patient-document-note-category'),
                controller: categoryController,
                decoration: InputDecoration(labelText: patientDocumentCentreText(widget.locale, 'noteCategory')),
              ),
              TextField(
                key: const ValueKey('patient-document-note-description'),
                controller: descriptionController,
                maxLines: 2,
                decoration: InputDecoration(labelText: patientDocumentCentreText(widget.locale, 'noteDescription')),
              ),
              TextField(
                key: const ValueKey('patient-document-note-content'),
                controller: contentController,
                minLines: 4,
                maxLines: 10,
                decoration: InputDecoration(labelText: patientDocumentCentreText(widget.locale, 'noteContent')),
              ),
              if (validation != null)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(validation!, key: const ValueKey('patient-document-note-validation')),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(patientDocumentCentreText(widget.locale, 'cancel'))),
          FilledButton(key: const ValueKey('patient-document-note-save'), onPressed: save, child: Text(patientDocumentCentreText(widget.locale, 'save'))),
        ],
      );
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _date(DateTime? value) => value == null
    ? '—'
    : '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}/${value.year.toString().padLeft(4, '0')}';
