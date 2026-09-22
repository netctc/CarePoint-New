import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'patient_clinical_export_api.dart';

String patientClinicalExportText(CarePointLocale locale, String key) =>
    _patientClinicalExportStrings[locale.name]?[key] ??
    _patientClinicalExportStrings['en']![key] ??
    key;

const _patientClinicalExportStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Share my health',
    'intro': 'Create a time-limited copy of your current CarePoint health summary. The export is generated on the server and protected until you request a one-time secure download.',
    'scopeTitle': 'Included scope',
    'scope': 'Current CarePoint health summary only',
    'scopeHint': 'This export does not grant another person ongoing access to your CarePoint account.',
    'format': 'Export format',
    'pdf': 'PDF',
    'json': 'JSON',
    'request': 'Create export',
    'confirmTitle': 'Create a clinical export?',
    'confirmBody': 'The export may contain sensitive health information. It will expire automatically. Continue only if you intend to use this copy now.',
    'confirm': 'Create',
    'cancel': 'Cancel',
    'status': 'Status',
    'created': 'Created',
    'expires': 'Expires',
    'refresh': 'Refresh status',
    'download': 'Secure download',
    'downloadHint': 'A one-time grant is requested only when you press Secure download. The token is never saved by the app.',
    'ready': 'Your export is ready.',
    'pending': 'Your export is being prepared.',
    'failed': 'The export could not be generated.',
    'expired': 'This export has expired. Create a new export if needed.',
    'downloadedTitle': 'Secure copy in memory',
    'downloadedHint': 'The retrieved bytes remain in this CarePoint screen only and are not written to shared device storage by this workflow.',
    'file': 'File',
    'size': 'Size',
    'copyJson': 'Copy JSON',
    'copied': 'JSON copied to the clipboard.',
    'clear': 'Clear secure copy',
    'retry': 'Retry',
  },
  'ar': {
    'title': 'مشاركة ملخص صحتي',
    'intro': 'أنشئ نسخة محدودة المدة من ملخصك الصحي الحالي في CarePoint. يتم إنشاء التصدير على الخادم ويبقى محمياً حتى تطلب تنزيلاً آمناً لمرة واحدة.',
    'scopeTitle': 'النطاق المشمول',
    'scope': 'ملخص CarePoint الصحي الحالي فقط',
    'scopeHint': 'هذا التصدير لا يمنح أي شخص وصولاً مستمراً إلى حساب CarePoint الخاص بك.',
    'format': 'صيغة التصدير',
    'pdf': 'PDF',
    'json': 'JSON',
    'request': 'إنشاء التصدير',
    'confirmTitle': 'إنشاء تصدير سريري؟',
    'confirmBody': 'قد يحتوي التصدير على معلومات صحية حساسة وسيتم حذفه تلقائياً بعد انتهاء صلاحيته. تابع فقط إذا كنت تنوي استخدام هذه النسخة الآن.',
    'confirm': 'إنشاء',
    'cancel': 'إلغاء',
    'status': 'الحالة',
    'created': 'تم الإنشاء',
    'expires': 'تنتهي الصلاحية',
    'refresh': 'تحديث الحالة',
    'download': 'تنزيل آمن',
    'downloadHint': 'يتم طلب تصريح لمرة واحدة فقط عند الضغط على التنزيل الآمن. لا يحفظ التطبيق الرمز مطلقاً.',
    'ready': 'التصدير جاهز.',
    'pending': 'يتم تجهيز التصدير.',
    'failed': 'تعذر إنشاء التصدير.',
    'expired': 'انتهت صلاحية هذا التصدير. أنشئ تصديراً جديداً عند الحاجة.',
    'downloadedTitle': 'نسخة آمنة في الذاكرة',
    'downloadedHint': 'تبقى البيانات المسترجعة داخل شاشة CarePoint هذه ولا تتم كتابتها إلى التخزين المشترك للجهاز ضمن هذا المسار.',
    'file': 'الملف',
    'size': 'الحجم',
    'copyJson': 'نسخ JSON',
    'copied': 'تم نسخ JSON إلى الحافظة.',
    'clear': 'مسح النسخة الآمنة',
    'retry': 'إعادة المحاولة',
  },
  'fr': {
    'title': 'Partager ma santé',
    'intro': 'Créez une copie temporaire de votre résumé de santé CarePoint actuel. L’export est généré côté serveur et reste protégé jusqu’à la demande d’un téléchargement sécurisé à usage unique.',
    'scopeTitle': 'Périmètre inclus',
    'scope': 'Résumé de santé CarePoint actuel uniquement',
    'scopeHint': 'Cet export ne donne aucun accès continu à votre compte CarePoint.',
    'format': 'Format d’export',
    'pdf': 'PDF',
    'json': 'JSON',
    'request': 'Créer l’export',
    'confirmTitle': 'Créer un export clinique ?',
    'confirmBody': 'L’export peut contenir des données de santé sensibles et expirera automatiquement. Continuez seulement si vous comptez utiliser cette copie maintenant.',
    'confirm': 'Créer',
    'cancel': 'Annuler',
    'status': 'Statut',
    'created': 'Créé',
    'expires': 'Expire',
    'refresh': 'Actualiser le statut',
    'download': 'Téléchargement sécurisé',
    'downloadHint': 'Une autorisation à usage unique est demandée uniquement lorsque vous appuyez sur Téléchargement sécurisé. Le jeton n’est jamais enregistré.',
    'ready': 'Votre export est prêt.',
    'pending': 'Votre export est en préparation.',
    'failed': 'L’export n’a pas pu être généré.',
    'expired': 'Cet export a expiré. Créez-en un nouveau si nécessaire.',
    'downloadedTitle': 'Copie sécurisée en mémoire',
    'downloadedHint': 'Les octets récupérés restent uniquement dans cet écran CarePoint et ne sont pas écrits dans le stockage partagé de l’appareil.',
    'file': 'Fichier',
    'size': 'Taille',
    'copyJson': 'Copier le JSON',
    'copied': 'JSON copié dans le presse-papiers.',
    'clear': 'Effacer la copie sécurisée',
    'retry': 'Réessayer',
  },
  'es': {
    'title': 'Compartir mi salud',
    'intro': 'Crea una copia temporal de tu resumen de salud actual de CarePoint. El export se genera en el servidor y permanece protegido hasta que solicitas una descarga segura de un solo uso.',
    'scopeTitle': 'Ámbito incluido',
    'scope': 'Solo el resumen de salud actual de CarePoint',
    'scopeHint': 'Este export no concede a otra persona acceso continuo a tu cuenta CarePoint.',
    'format': 'Formato de exportación',
    'pdf': 'PDF',
    'json': 'JSON',
    'request': 'Crear exportación',
    'confirmTitle': '¿Crear una exportación clínica?',
    'confirmBody': 'La exportación puede contener información sanitaria sensible y caducará automáticamente. Continúa solo si vas a utilizar esta copia ahora.',
    'confirm': 'Crear',
    'cancel': 'Cancelar',
    'status': 'Estado',
    'created': 'Creada',
    'expires': 'Caduca',
    'refresh': 'Actualizar estado',
    'download': 'Descarga segura',
    'downloadHint': 'El permiso de un solo uso se solicita únicamente al pulsar Descarga segura. El token nunca se guarda en la app.',
    'ready': 'Tu exportación está lista.',
    'pending': 'Tu exportación se está preparando.',
    'failed': 'No se pudo generar la exportación.',
    'expired': 'Esta exportación ha caducado. Crea una nueva si la necesitas.',
    'downloadedTitle': 'Copia segura en memoria',
    'downloadedHint': 'Los bytes recuperados permanecen solo en esta pantalla de CarePoint y este flujo no los escribe en el almacenamiento compartido del dispositivo.',
    'file': 'Archivo',
    'size': 'Tamaño',
    'copyJson': 'Copiar JSON',
    'copied': 'JSON copiado al portapapeles.',
    'clear': 'Borrar copia segura',
    'retry': 'Reintentar',
  },
};

class PatientClinicalExportPage extends StatefulWidget {
  const PatientClinicalExportPage({
    super.key,
    required this.session,
    required this.locale,
  });

  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientClinicalExportPage> createState() => _PatientClinicalExportPageState();
}

class _PatientClinicalExportPageState extends State<PatientClinicalExportPage> {
  late final PatientClinicalExportApi exports;
  Timer? poller;
  String format = 'PDF';
  bool busy = false;
  String? error;
  Map<String, dynamic>? job;
  CarePointDownloadedClinicalExport? downloaded;

  @override
  void initState() {
    super.initState();
    exports = PatientClinicalExportApi(widget.session.api);
  }

  @override
  void dispose() {
    poller?.cancel();
    downloaded = null;
    super.dispose();
  }

  String text(String key) => patientClinicalExportText(widget.locale, key);

  Future<void> requestExport() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(text('confirmTitle')),
        content: Text(text('confirmBody')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(text('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(text('confirm'))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      busy = true;
      error = null;
      downloaded = null;
    });
    try {
      final created = await exports.create(
        format: format,
        clientRequestId: _newClientRequestId(),
      );
      if (!mounted) return;
      setState(() => job = created);
      _schedulePolling();
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> refreshStatus() async {
    final currentId = job?['id']?.toString();
    if (currentId == null || currentId.isEmpty) return;
    try {
      final value = await exports.status(currentId);
      if (!mounted) return;
      setState(() {
        job = value;
        error = null;
      });
      final status = value['status']?.toString();
      if (status == 'PENDING' || status == 'PROCESSING') {
        _schedulePolling();
      } else {
        poller?.cancel();
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    }
  }

  void _schedulePolling() {
    poller?.cancel();
    poller = Timer.periodic(const Duration(seconds: 2), (_) {
      final status = job?['status']?.toString();
      if (status == 'PENDING' || status == 'PROCESSING') {
        void refreshStatus();
      } else {
        poller?.cancel();
      }
    });
  }

  Future<void> secureDownload() async {
    final currentId = job?['id']?.toString();
    if (currentId == null || job?['status']?.toString() != 'READY') return;
    setState(() {
      busy = true;
      error = null;
      downloaded = null;
    });
    try {
      final value = await exports.download(currentId);
      if (mounted) setState(() => downloaded = value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> copyJson() async {
    final value = downloaded;
    if (value == null || !value.mediaType.contains('json')) return;
    await Clipboard.setData(ClipboardData(text: utf8.decode(value.bytes, allowMalformed: false)));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text('copied'))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = job?['status']?.toString();
    return Directionality(
      textDirection: widget.locale.textDirection,
      child: Scaffold(
        key: const ValueKey('patient-clinical-export-page'),
        appBar: AppBar(title: Text(text('title'))),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(text('intro')),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(text('scopeTitle'), style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.health_and_safety_outlined),
                      title: Text(text('scope')),
                      subtitle: Text(text('scopeHint')),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(text('format'), style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              key: const ValueKey('patient-clinical-export-format'),
              segments: [
                ButtonSegment(value: 'PDF', icon: const Icon(Icons.picture_as_pdf_outlined), label: Text(text('pdf'))),
                ButtonSegment(value: 'JSON', icon: const Icon(Icons.data_object_outlined), label: Text(text('json'))),
              ],
              selected: {format},
              onSelectionChanged: busy || job != null ? null : (values) => setState(() => format = values.first),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              key: const ValueKey('patient-clinical-export-request'),
              onPressed: busy ? null : requestExport,
              icon: const Icon(Icons.ios_share_outlined),
              label: Text(text('request')),
            ),
            if (busy) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (error != null) ...[
              const SizedBox(height: 12),
              Card(
                color: Theme.of(context).colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(error!),
                      const SizedBox(height: 8),
                      OutlinedButton(onPressed: refreshStatus, child: Text(text('retry'))),
                    ],
                  ),
                ),
              ),
            ],
            if (job != null) ...[
              const SizedBox(height: 16),
              _statusCard(status),
            ],
            if (downloaded != null) ...[
              const SizedBox(height: 16),
              _downloadedCard(downloaded!),
            ],
          ],
        ),
      ),
    );
  }

  Widget _statusCard(String? status) {
    final message = switch (status) {
      'READY' => text('ready'),
      'FAILED' => text('failed'),
      'EXPIRED' => text('expired'),
      _ => text('pending'),
    };
    return Card(
      key: const ValueKey('patient-clinical-export-status'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text('${text('status')}: ${status ?? '—'}', style: Theme.of(context).textTheme.titleMedium)),
                IconButton(onPressed: busy ? null : refreshStatus, tooltip: text('refresh'), icon: const Icon(Icons.refresh)),
              ],
            ),
            Text(message),
            const SizedBox(height: 8),
            if (job?['createdAt'] != null) Text('${text('created')}: ${_date(job!['createdAt'])}'),
            if (job?['expiresAt'] != null) Text('${text('expires')}: ${_date(job!['expiresAt'])}'),
            if (job?['errorCode'] != null) Text(job!['errorCode'].toString()),
            if (status == 'READY') ...[
              const SizedBox(height: 12),
              Text(text('downloadHint')),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                key: const ValueKey('patient-clinical-export-download'),
                onPressed: busy ? null : secureDownload,
                icon: const Icon(Icons.lock_outline),
                label: Text(text('download')),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _downloadedCard(CarePointDownloadedClinicalExport value) {
    return Card(
      key: const ValueKey('patient-clinical-export-secure-copy'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(text('downloadedTitle'), style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(text('downloadedHint')),
            const SizedBox(height: 8),
            Text('${text('file')}: ${value.fileName}'),
            Text('${text('size')}: ${value.bytes.length} bytes'),
            const SizedBox(height: 12),
            if (value.mediaType.contains('json'))
              OutlinedButton.icon(
                key: const ValueKey('patient-clinical-export-copy-json'),
                onPressed: copyJson,
                icon: const Icon(Icons.copy_outlined),
                label: Text(text('copyJson')),
              ),
            TextButton.icon(
              key: const ValueKey('patient-clinical-export-clear'),
              onPressed: () => setState(() => downloaded = null),
              icon: const Icon(Icons.delete_outline),
              label: Text(text('clear')),
            ),
          ],
        ),
      ),
    );
  }

  String _date(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null ? value?.toString() ?? '—' : parsed.toLocal().toString();
  }

  String _newClientRequestId() {
    final random = Random.secure().nextInt(0x7fffffff).toRadixString(16);
    return 'patient-export-${DateTime.now().microsecondsSinceEpoch}-$random';
  }
}
