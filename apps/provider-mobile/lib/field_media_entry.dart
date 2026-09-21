import 'dart:convert';
import 'dart:typed_data';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/provider_field_media.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

String fieldMediaText(CarePointLocale locale, String key) =>
    _fieldMediaStrings[locale.name]?[key] ?? _fieldMediaStrings['en']?[key] ?? key;

const _fieldMediaStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Consented field photo',
    'chooseVisit': 'Choose home visit',
    'emptyVisits': 'No confirmed or completed home visits are available.',
    'consentReady': 'Patient consent is active for this provider and visit.',
    'consentMissing': 'Photo capture is blocked until the patient grants clinical media consent.',
    'consentRule': 'Required: CLINICAL_MEDIA_CAPTURE · clinical-media-v1 · TREATMENT',
    'camera': 'Camera',
    'gallery': 'Gallery',
    'caption': 'Caption (optional)',
    'bodySite': 'Body/site code (optional)',
    'save': 'Save encrypted evidence',
    'saved': 'Photo evidence saved.',
    'history': 'Visit photo evidence',
    'emptyHistory': 'No photo evidence has been recorded for this visit.',
    'retention': 'Stored under governed clinical-media retention. Evidence links are append-only.',
    'unsupported': 'Only JPEG or PNG photos are accepted.',
    'tooLarge': 'The selected photo exceeds the 8 MB limit.',
    'retry': 'Retry',
    'captured': 'Captured',
    'digest': 'Integrity hash',
  },
  'ar': {
    'title': 'صورة ميدانية بموافقة المريض',
    'chooseVisit': 'اختر الزيارة المنزلية',
    'emptyVisits': 'لا توجد زيارات منزلية مؤكدة أو مكتملة.',
    'consentReady': 'موافقة المريض فعالة لهذا مقدم الخدمة وهذه الزيارة.',
    'consentMissing': 'يتم حظر التقاط الصورة حتى يمنح المريض موافقة الوسائط السريرية.',
    'consentRule': 'المطلوب: CLINICAL_MEDIA_CAPTURE · clinical-media-v1 · TREATMENT',
    'camera': 'الكاميرا',
    'gallery': 'المعرض',
    'caption': 'وصف اختياري',
    'bodySite': 'رمز موضع الجسم/المكان (اختياري)',
    'save': 'حفظ الدليل المشفر',
    'saved': 'تم حفظ دليل الصورة.',
    'history': 'أدلة صور الزيارة',
    'emptyHistory': 'لا توجد صور مسجلة لهذه الزيارة.',
    'retention': 'تخضع الصورة لسياسة الاحتفاظ بالوسائط السريرية، وروابط الدليل غير قابلة للتعديل.',
    'unsupported': 'يُسمح فقط بصور JPEG أو PNG.',
    'tooLarge': 'حجم الصورة المختارة يتجاوز 8 ميغابايت.',
    'retry': 'إعادة المحاولة',
    'captured': 'وقت الالتقاط',
    'digest': 'بصمة السلامة',
  },
  'fr': {
    'title': 'Photo terrain avec consentement',
    'chooseVisit': 'Choisir une visite à domicile',
    'emptyVisits': 'Aucune visite à domicile confirmée ou terminée n’est disponible.',
    'consentReady': 'Le consentement du patient est actif pour ce prestataire et cette visite.',
    'consentMissing': 'La capture est bloquée tant que le patient n’a pas accordé le consentement média clinique.',
    'consentRule': 'Requis : CLINICAL_MEDIA_CAPTURE · clinical-media-v1 · TREATMENT',
    'camera': 'Appareil photo',
    'gallery': 'Galerie',
    'caption': 'Légende (facultatif)',
    'bodySite': 'Code du site corporel (facultatif)',
    'save': 'Enregistrer la preuve chiffrée',
    'saved': 'Preuve photo enregistrée.',
    'history': 'Preuves photo de la visite',
    'emptyHistory': 'Aucune preuve photo n’a été enregistrée pour cette visite.',
    'retention': 'Conservation clinique gouvernée ; les liens de preuve sont en ajout seulement.',
    'unsupported': 'Seules les photos JPEG ou PNG sont acceptées.',
    'tooLarge': 'La photo sélectionnée dépasse la limite de 8 Mo.',
    'retry': 'Réessayer',
    'captured': 'Capturée',
    'digest': 'Empreinte d’intégrité',
  },
  'es': {
    'title': 'Foto de campo con consentimiento',
    'chooseVisit': 'Elegir visita domiciliaria',
    'emptyVisits': 'No hay visitas domiciliarias confirmadas o completadas disponibles.',
    'consentReady': 'El consentimiento del paciente está activo para este proveedor y visita.',
    'consentMissing': 'La captura queda bloqueada hasta que el paciente conceda consentimiento para medios clínicos.',
    'consentRule': 'Requerido: CLINICAL_MEDIA_CAPTURE · clinical-media-v1 · TREATMENT',
    'camera': 'Cámara',
    'gallery': 'Galería',
    'caption': 'Descripción (opcional)',
    'bodySite': 'Código de zona corporal (opcional)',
    'save': 'Guardar evidencia cifrada',
    'saved': 'Evidencia fotográfica guardada.',
    'history': 'Evidencia fotográfica de la visita',
    'emptyHistory': 'Todavía no hay evidencia fotográfica para esta visita.',
    'retention': 'Retención clínica gobernada; los vínculos de evidencia son de solo anexado.',
    'unsupported': 'Solo se aceptan fotografías JPEG o PNG.',
    'tooLarge': 'La fotografía seleccionada supera el límite de 8 MB.',
    'retry': 'Reintentar',
    'captured': 'Capturada',
    'digest': 'Hash de integridad',
  },
};

class ProviderFieldMediaLauncher extends StatelessWidget {
  const ProviderFieldMediaLauncher({
    super.key,
    required this.session,
    required this.locale,
    required this.workflowCapabilities,
    required this.child,
    this.accent = const Color(0xFF10B981),
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Set<String> workflowCapabilities;
  final Widget child;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    if (!workflowCapabilities.contains('MEDIA_CAPTURE')) return child;
    return Stack(
      children: [
        child,
        PositionedDirectional(
          end: 18,
          bottom: 428,
          child: FloatingActionButton.small(
            heroTag: 'provider-field-media',
            backgroundColor: accent,
            foregroundColor: Colors.white,
            tooltip: fieldMediaText(locale, 'title'),
            onPressed: () => _chooseVisit(context),
            child: const Icon(Icons.add_a_photo_outlined),
          ),
        ),
      ],
    );
  }

  Future<void> _chooseVisit(BuildContext context) async {
    try {
      final now = DateTime.now();
      final values = await session.api.providerAppointments(
        from: now.subtract(const Duration(days: 365)),
        to: now.add(const Duration(days: 31)),
      );
      final visits = values
          .where((item) =>
              item['modality'] == 'HOME_VISIT' &&
              (item['status'] == 'CONFIRMED' || item['status'] == 'COMPLETED'))
          .toList(growable: false)
        ..sort((left, right) =>
            (right['startsAt']?.toString() ?? '').compareTo(left['startsAt']?.toString() ?? ''));
      if (!context.mounted) return;
      if (visits.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(fieldMediaText(locale, 'emptyVisits'))),
        );
        return;
      }
      final selected = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        builder: (sheetContext) => Directionality(
          textDirection: locale.textDirection,
          child: SafeArea(
            child: FractionallySizedBox(
              heightFactor: .72,
              child: Column(
                children: [
                  ListTile(
                    title: Text(
                      fieldMediaText(locale, 'chooseVisit'),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    trailing: IconButton(
                      onPressed: () => Navigator.pop(sheetContext),
                      icon: const Icon(Icons.close),
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: ListView.builder(
                      itemCount: visits.length,
                      itemBuilder: (itemContext, index) {
                        final visit = visits[index];
                        final patient = _map(visit['patient']);
                        final name = [patient['firstName'], patient['lastName']]
                            .whereType<String>()
                            .where((value) => value.trim().isNotEmpty)
                            .join(' ');
                        return ListTile(
                          leading: const CircleAvatar(child: Icon(Icons.home_outlined)),
                          title: Text(name.isEmpty ? 'Patient' : name),
                          subtitle: Text('${_formatDate(visit['startsAt'])} · ${visit['status'] ?? ''}'),
                          onTap: () => Navigator.pop(itemContext, visit),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      if (selected == null || !context.mounted) return;
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => Directionality(
            textDirection: locale.textDirection,
            child: ProviderFieldMediaPage(
              session: session,
              locale: locale,
              appointment: selected,
              accent: accent,
            ),
          ),
        ),
      );
    } catch (value) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
      }
    }
  }
}

class ProviderFieldMediaPage extends StatefulWidget {
  const ProviderFieldMediaPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
    required this.accent,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Color accent;

  @override
  State<ProviderFieldMediaPage> createState() => _ProviderFieldMediaPageState();
}

class _ProviderFieldMediaPageState extends State<ProviderFieldMediaPage> {
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _caption = TextEditingController();
  final TextEditingController _bodySite = TextEditingController();
  late final ProviderFieldMediaApi _api;

  bool loading = true;
  bool saving = false;
  String? error;
  Map<String, dynamic> consent = <String, dynamic>{};
  List<Map<String, dynamic>> history = const [];
  Uint8List? selectedBytes;
  String? selectedMediaType;
  DateTime? selectedCapturedAt;

  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  bool get captureAllowed => consent['captureAllowed'] == true;

  @override
  void initState() {
    super.initState();
    _api = ProviderFieldMediaApi(widget.session);
    _load();
  }

  @override
  void dispose() {
    _caption.dispose();
    _bodySite.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final nextConsent = await _api.consentStatus(appointmentId);
      final nextHistory = await _api.history(appointmentId);
      if (!mounted) return;
      setState(() {
        consent = nextConsent;
        history = _mapList(nextHistory['items']);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _pick(ImageSource source) async {
    if (!captureAllowed || saving) return;
    try {
      final file = await _picker.pickImage(
        source: source,
        maxWidth: 2048,
        imageQuality: 85,
      );
      if (file == null) return;
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      if (bytes.lengthInBytes > 8 * 1024 * 1024) {
        _show(fieldMediaText(widget.locale, 'tooLarge'));
        return;
      }
      final mediaType = _photoMediaType(bytes);
      if (mediaType == null) {
        _show(fieldMediaText(widget.locale, 'unsupported'));
        return;
      }
      setState(() {
        selectedBytes = bytes;
        selectedMediaType = mediaType;
        selectedCapturedAt = DateTime.now().toUtc();
      });
    } catch (value) {
      if (mounted) _show(value.toString());
    }
  }

  Future<void> _save() async {
    final bytes = selectedBytes;
    final mediaType = selectedMediaType;
    final capturedAt = selectedCapturedAt;
    if (!captureAllowed || bytes == null || mediaType == null || capturedAt == null || saving) return;
    setState(() => saving = true);
    try {
      final safeAppointment = appointmentId.replaceAll(RegExp(r'[^A-Za-z0-9_.:-]'), '');
      final idempotencyKey = 'field-media-$safeAppointment-${DateTime.now().microsecondsSinceEpoch}';
      await _api.create(
        appointmentId,
        idempotencyKey: idempotencyKey,
        mediaType: mediaType,
        contentBase64: base64Encode(bytes),
        capturedAt: capturedAt,
        caption: _caption.text,
        bodySiteCode: _bodySite.text,
      );
      if (!mounted) return;
      setState(() {
        selectedBytes = null;
        selectedMediaType = null;
        selectedCapturedAt = null;
        _caption.clear();
        _bodySite.clear();
      });
      _show(fieldMediaText(widget.locale, 'saved'));
      await _load();
    } catch (value) {
      if (mounted) _show(value.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  void _show(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final patient = _map(widget.appointment['patient']);
    final patientName = [patient['firstName'], patient['lastName']]
        .whereType<String>()
        .where((value) => value.trim().isNotEmpty)
        .join(' ');
    return Scaffold(
      appBar: AppBar(title: Text(fieldMediaText(widget.locale, 'title'))),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _load,
                          icon: const Icon(Icons.refresh),
                          label: Text(fieldMediaText(widget.locale, 'retry')),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (patientName.isNotEmpty)
                        Text(patientName, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      Text('${_formatDate(widget.appointment['startsAt'])} · HOME_VISIT · ${widget.appointment['status'] ?? ''}'),
                      const SizedBox(height: 14),
                      _consentCard(),
                      const SizedBox(height: 14),
                      if (captureAllowed) _captureCard(),
                      const SizedBox(height: 18),
                      Text(fieldMediaText(widget.locale, 'history'), style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 8),
                      Text(fieldMediaText(widget.locale, 'retention')),
                      const SizedBox(height: 10),
                      if (history.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 20),
                          child: Text(fieldMediaText(widget.locale, 'emptyHistory'), textAlign: TextAlign.center),
                        )
                      else
                        ...history.map(_historyTile),
                    ],
                  ),
                ),
    );
  }

  Widget _consentCard() {
    final allowed = captureAllowed;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(allowed ? Icons.verified_user_outlined : Icons.lock_outline, color: allowed ? widget.accent : Colors.orange),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    fieldMediaText(widget.locale, allowed ? 'consentReady' : 'consentMissing'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 5),
                  Text(fieldMediaText(widget.locale, 'consentRule')),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _captureCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                FilledButton.icon(
                  onPressed: saving ? null : () => _pick(ImageSource.camera),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: Text(fieldMediaText(widget.locale, 'camera')),
                ),
                OutlinedButton.icon(
                  onPressed: saving ? null : () => _pick(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: Text(fieldMediaText(widget.locale, 'gallery')),
                ),
              ],
            ),
            if (selectedBytes != null) ...[
              const SizedBox(height: 14),
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.memory(selectedBytes!, height: 220, fit: BoxFit.cover),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _caption,
                maxLength: 500,
                maxLines: 2,
                decoration: InputDecoration(labelText: fieldMediaText(widget.locale, 'caption')),
              ),
              TextField(
                controller: _bodySite,
                maxLength: 80,
                decoration: InputDecoration(labelText: fieldMediaText(widget.locale, 'bodySite')),
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: saving ? null : _save,
                icon: saving
                    ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.lock_outline),
                label: Text(fieldMediaText(widget.locale, 'save')),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _historyTile(Map<String, dynamic> item) {
    final digest = item['contentDigest']?.toString() ?? '';
    final digestLabel = digest.length > 16 ? '${digest.substring(0, 16)}…' : digest;
    return Card(
      child: ListTile(
        leading: const Icon(Icons.photo_outlined),
        title: Text('${fieldMediaText(widget.locale, 'captured')}: ${_formatDate(item['capturedAt'])}'),
        subtitle: Text('${fieldMediaText(widget.locale, 'digest')}: $digestLabel'),
        trailing: item['encryptedAtRest'] == true ? const Icon(Icons.lock_outline) : null,
      ),
    );
  }
}

String? _photoMediaType(Uint8List bytes) {
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4e &&
      bytes[3] == 0x47 &&
      bytes[4] == 0x0d &&
      bytes[5] == 0x0a &&
      bytes[6] == 0x1a &&
      bytes[7] == 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff) {
    return 'image/jpeg';
  }
  return null;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _mapList(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _formatDate(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year.toString().padLeft(4, '0')} ${two(value.hour)}:${two(value.minute)}';
}
