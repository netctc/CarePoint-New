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
  },
  'ar': {
    'title': 'المستندات السريرية',
    'search': 'البحث في المستندات',
    'type': 'النوع',
    'all': 'كل الأنواع',
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
  },
  'fr': {
    'title': 'Documents cliniques',
    'search': 'Rechercher des documents',
    'type': 'Type',
    'all': 'Tous les types',
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
  },
  'es': {
    'title': 'Documentos clínicos',
    'search': 'Buscar documentos',
    'type': 'Tipo',
    'all': 'Todos los tipos',
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
  const PatientDocumentCentrePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientDocumentCentrePage> createState() => _PatientDocumentCentrePageState();
}

class _PatientDocumentCentrePageState extends State<PatientDocumentCentrePage> {
  bool busy = true;
  bool truncated = false;
  String? error;
  String query = '';
  String kind = 'ALL';
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
      final result = await widget.session.api.patientDocumentCentre(limit: 100);
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
      body: busy
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(error!, textAlign: TextAlign.center), const SizedBox(height: 12), FilledButton(onPressed: load, child: Text('Retry'))])))
              : RefreshIndicator(
                  onRefresh: load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
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
    final title = metadata['title']?.toString() ?? metadata['fileName']?.toString() ?? document['kind']?.toString() ?? patientDocumentCentreText(widget.locale, 'title');
    final source = document['source'] == 'PATIENT' ? patientDocumentCentreText(widget.locale, 'patient') : patientDocumentCentreText(widget.locale, 'careTeam');
    final createdAt = DateTime.tryParse(document['createdAt']?.toString() ?? '')?.toLocal();
    return Card(
      key: ValueKey('patient-document-${document['id']}'),
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.description_outlined)),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text('${document['kind'] ?? ''} · $source · ${_date(createdAt)}'),
        trailing: IconButton(
          key: ValueKey('patient-document-open-${document['id']}'),
          onPressed: () => _openDocument(document),
          tooltip: patientDocumentCentreText(widget.locale, 'open'),
          icon: Icon(document['downloadable'] == true ? Icons.lock_open_outlined : Icons.info_outline),
        ),
      ),
    );
  }

  Future<void> _openDocument(Map<String, dynamic> document) async {
    final metadata = _map(document['metadata']);
    final title = metadata['title']?.toString() ?? metadata['fileName']?.toString() ?? patientDocumentCentreText(widget.locale, 'title');
    if (document['downloadable'] != true) {
      await _showText(title, '${metadata['description'] ?? ''}\n\n${patientDocumentCentreText(widget.locale, 'referenceOnly')}');
      return;
    }
    try {
      final downloaded = await widget.session.api.downloadPatientClinicalDocument(document['id'].toString());
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
        return;
      }
      if (downloaded.mediaType == 'text/plain') {
        String value;
        try {
          value = utf8.decode(downloaded.bytes);
        } catch (_) {
          value = patientDocumentCentreText(widget.locale, 'secureReady');
        }
        await _showText(title, value);
        return;
      }
      await _showText(
        title,
        '${downloaded.fileName}\n${downloaded.mediaType}\n${downloaded.bytes.length} ${patientDocumentCentreText(widget.locale, 'bytes')}\n\n${patientDocumentCentreText(widget.locale, 'secureReady')}',
      );
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
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
