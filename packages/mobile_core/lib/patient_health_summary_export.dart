import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'patient_export_api.dart';

const patientHealthSummaryExportScopes = <String>[
  'observations',
  'glucose',
  'medications',
  'questionnaire',
  'carePlan',
  'alerts',
];

String patientExportText(CarePointLocale locale, String key) => _patientExportMessages[locale]?[key] ?? _patientExportMessages[CarePointLocale.en]![key] ?? key;

String patientExportScopeText(CarePointLocale locale, String scope) => patientExportText(locale, 'scope.$scope');

const _patientExportMessages = <CarePointLocale, Map<String, String>>{
  CarePointLocale.en: {
    'title': 'Export my health summary',
    'entry': 'Share / export health summary',
    'intro': 'Choose exactly what to include. CarePoint generates an encrypted, time-limited PDF or JSON export.',
    'sections': 'Information to include',
    'format': 'Format',
    'generate': 'Generate export',
    'confirmTitle': 'Confirm health information export',
    'confirmBody': 'The export will contain only the selected sections. This action is audited.',
    'confirm': 'Confirm and generate',
    'cancel': 'Cancel',
    'status': 'Status',
    'expires': 'Expires',
    'checksum': 'SHA-256',
    'download': 'Download secure file',
    'received': 'Secure file received',
    'bytes': 'bytes',
    'wait': 'Generating your export…',
    'selectOne': 'Select at least one section.',
    'failed': 'Export generation failed.',
    'scope.observations': 'Latest observations',
    'scope.glucose': 'Glucose summary',
    'scope.medications': 'Medications',
    'scope.questionnaire': 'Questionnaire status',
    'scope.carePlan': 'Care plan',
    'scope.alerts': 'Active care alerts',
  },
  CarePointLocale.ar: {
    'title': 'تصدير ملخصي الصحي',
    'entry': 'مشاركة / تصدير الملخص الصحي',
    'intro': 'اختر بدقة ما تريد تضمينه. ينشئ CarePoint ملف PDF أو JSON مشفراً ومحدود المدة.',
    'sections': 'المعلومات المراد تضمينها',
    'format': 'الصيغة',
    'generate': 'إنشاء التصدير',
    'confirmTitle': 'تأكيد تصدير المعلومات الصحية',
    'confirmBody': 'سيتضمن التصدير الأقسام المحددة فقط. يتم تدقيق هذه العملية.',
    'confirm': 'تأكيد وإنشاء',
    'cancel': 'إلغاء',
    'status': 'الحالة',
    'expires': 'ينتهي',
    'checksum': 'SHA-256',
    'download': 'تنزيل الملف الآمن',
    'received': 'تم استلام الملف الآمن',
    'bytes': 'بايت',
    'wait': 'جارٍ إنشاء التصدير…',
    'selectOne': 'اختر قسماً واحداً على الأقل.',
    'failed': 'فشل إنشاء التصدير.',
    'scope.observations': 'أحدث القياسات',
    'scope.glucose': 'ملخص الغلوكوز',
    'scope.medications': 'الأدوية',
    'scope.questionnaire': 'حالة الاستبيان',
    'scope.carePlan': 'خطة الرعاية',
    'scope.alerts': 'تنبيهات الرعاية النشطة',
  },
  CarePointLocale.fr: {
    'title': 'Exporter mon résumé de santé',
    'entry': 'Partager / exporter le résumé de santé',
    'intro': 'Choisissez exactement les données à inclure. CarePoint génère un PDF ou JSON chiffré et à durée limitée.',
    'sections': 'Informations à inclure',
    'format': 'Format',
    'generate': 'Générer l’export',
    'confirmTitle': 'Confirmer l’export des données de santé',
    'confirmBody': 'L’export contiendra uniquement les sections sélectionnées. Cette action est auditée.',
    'confirm': 'Confirmer et générer',
    'cancel': 'Annuler',
    'status': 'Statut',
    'expires': 'Expire',
    'checksum': 'SHA-256',
    'download': 'Télécharger le fichier sécurisé',
    'received': 'Fichier sécurisé reçu',
    'bytes': 'octets',
    'wait': 'Génération de l’export…',
    'selectOne': 'Sélectionnez au moins une section.',
    'failed': 'La génération de l’export a échoué.',
    'scope.observations': 'Dernières observations',
    'scope.glucose': 'Résumé glycémique',
    'scope.medications': 'Médicaments',
    'scope.questionnaire': 'État du questionnaire',
    'scope.carePlan': 'Plan de soins',
    'scope.alerts': 'Alertes de soins actives',
  },
  CarePointLocale.es: {
    'title': 'Exportar mi resumen de salud',
    'entry': 'Compartir / exportar resumen de salud',
    'intro': 'Elige exactamente qué incluir. CarePoint genera un PDF o JSON cifrado y con expiración.',
    'sections': 'Información a incluir',
    'format': 'Formato',
    'generate': 'Generar exportación',
    'confirmTitle': 'Confirmar exportación de información de salud',
    'confirmBody': 'La exportación contendrá únicamente las secciones seleccionadas. Esta acción queda auditada.',
    'confirm': 'Confirmar y generar',
    'cancel': 'Cancelar',
    'status': 'Estado',
    'expires': 'Expira',
    'checksum': 'SHA-256',
    'download': 'Descargar archivo seguro',
    'received': 'Archivo seguro recibido',
    'bytes': 'bytes',
    'wait': 'Generando la exportación…',
    'selectOne': 'Selecciona al menos una sección.',
    'failed': 'Falló la generación de la exportación.',
    'scope.observations': 'Últimas observaciones',
    'scope.glucose': 'Resumen de glucosa',
    'scope.medications': 'Medicamentos',
    'scope.questionnaire': 'Estado del cuestionario',
    'scope.carePlan': 'Plan de cuidados',
    'scope.alerts': 'Alertas asistenciales activas',
  },
};

class PatientHealthSummaryExportPage extends StatefulWidget {
  const PatientHealthSummaryExportPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientHealthSummaryExportPage> createState() => _PatientHealthSummaryExportPageState();
}

class _PatientHealthSummaryExportPageState extends State<PatientHealthSummaryExportPage> {
  final Set<String> _selected = Set<String>.from(patientHealthSummaryExportScopes);
  String _format = 'PDF';
  bool _busy = false;
  Map<String, dynamic>? _job;
  String? _error;
  String? _downloadReceipt;

  Future<void> _generate() async {
    if (_selected.isEmpty) {
      setState(() => _error = patientExportText(widget.locale, 'selectOne'));
      return;
    }
    final scopes = patientHealthSummaryExportScopes.where(_selected.contains).toList(growable: false);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(patientExportText(widget.locale, 'confirmTitle')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(patientExportText(widget.locale, 'confirmBody')),
            const SizedBox(height: 12),
            Text('$_format · ${scopes.map((scope) => patientExportScopeText(widget.locale, scope)).join(', ')}'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(patientExportText(widget.locale, 'cancel'))),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(patientExportText(widget.locale, 'confirm'))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() { _busy = true; _error = null; _downloadReceipt = null; });
    try {
      var job = await widget.session.api.createPatientHealthSummaryExport(
        format: _format,
        scopes: scopes,
        clientRequestId: 'pat136-${DateTime.now().microsecondsSinceEpoch}',
      );
      if (mounted) setState(() => _job = job);
      final jobId = job['id']?.toString() ?? '';
      for (var attempt = 0; attempt < 30 && jobId.isNotEmpty; attempt++) {
        final status = job['status']?.toString();
        if (status == 'READY' || status == 'FAILED' || status == 'EXPIRED') break;
        await Future<void>.delayed(const Duration(seconds: 2));
        job = await widget.session.api.patientClinicalExport(jobId);
        if (mounted) setState(() => _job = job);
      }
      if (mounted && _job?['status'] == 'FAILED') {
        setState(() => _error = patientExportText(widget.locale, 'failed'));
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download() async {
    final jobId = _job?['id']?.toString() ?? '';
    if (jobId.isEmpty || _job?['status'] != 'READY') return;
    setState(() { _busy = true; _error = null; _downloadReceipt = null; });
    try {
      final result = await widget.session.api.downloadPatientClinicalExportBytes(jobId);
      if (!mounted) return;
      setState(() {
        _downloadReceipt = '${result['fileName']} · ${result['byteLength']} ${patientExportText(widget.locale, 'bytes')}';
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final job = _job;
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        appBar: AppBar(title: Text(patientExportText(widget.locale, 'title'))),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(patientExportText(widget.locale, 'intro')),
            const SizedBox(height: 16),
            Text(patientExportText(widget.locale, 'sections'), style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...patientHealthSummaryExportScopes.map((scope) => CheckboxListTile(
              key: ValueKey('pat136-scope-$scope'),
              value: _selected.contains(scope),
              title: Text(patientExportScopeText(widget.locale, scope)),
              contentPadding: EdgeInsets.zero,
              onChanged: _busy ? null : (checked) => setState(() {
                if (checked == true) { _selected.add(scope); } else { _selected.remove(scope); }
              }),
            )),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const ValueKey('pat136-format'),
              initialValue: _format,
              decoration: InputDecoration(labelText: patientExportText(widget.locale, 'format')),
              items: const [DropdownMenuItem(value: 'PDF', child: Text('PDF')), DropdownMenuItem(value: 'JSON', child: Text('JSON'))],
              onChanged: _busy ? null : (value) => setState(() => _format = value ?? 'PDF'),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              key: const ValueKey('pat136-generate'),
              onPressed: _busy ? null : _generate,
              icon: const Icon(Icons.ios_share_outlined),
              label: Text(_busy ? patientExportText(widget.locale, 'wait') : patientExportText(widget.locale, 'generate')),
            ),
            if (_error != null) Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
            if (job != null) ...[
              const SizedBox(height: 20),
              Card(child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${patientExportText(widget.locale, 'status')}: ${job['status'] ?? '-'}'),
                  Text('${patientExportText(widget.locale, 'expires')}: ${job['expiresAt'] ?? '-'}'),
                  if (job['contentDigest'] != null) SelectableText('${patientExportText(widget.locale, 'checksum')}: ${job['contentDigest']}'),
                  if (job['status'] == 'READY') ...[
                    const SizedBox(height: 12),
                    FilledButton.tonalIcon(
                      key: const ValueKey('pat136-download'),
                      onPressed: _busy ? null : _download,
                      icon: const Icon(Icons.download_outlined),
                      label: Text(patientExportText(widget.locale, 'download')),
                    ),
                  ],
                ]),
              )),
            ],
            if (_downloadReceipt != null) Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text('${patientExportText(widget.locale, 'received')}: $_downloadReceipt'),
            ),
          ],
        ),
      ),
    );
  }
}
