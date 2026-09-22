import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/provider_field_media.dart';
import 'package:carepoint_mobile_core/provider_nursing_api.dart';
import 'package:flutter/material.dart';

String nursingText(CarePointLocale locale, String key) =>
    _nursingStrings[locale.name]?[key] ?? _nursingStrings['en']?[key] ?? key;

const _nursingStrings = <String, Map<String, String>>{
  'en': {
    'title': 'Nursing workflows', 'chooseVisit': 'Choose patient visit', 'empty': 'No confirmed or completed visits are available.',
    'medAdmin': 'Medication administration', 'wound': 'Wound assessment', 'procedure': 'Procedure checklist',
    'prescription': 'Active prescription', 'administered': 'Administered', 'omitted': 'Omitted', 'dose': 'Dose', 'route': 'Route',
    'omission': 'Omission reason', 'note': 'Note (optional)', 'save': 'Save signed record', 'saved': 'Record saved.', 'history': 'History',
    'site': 'Body/site code', 'woundType': 'Wound type', 'length': 'Length (cm)', 'width': 'Width (cm)', 'depth': 'Depth (cm, optional)',
    'exudate': 'Exudate code', 'photo': 'Consented encrypted photo (optional)', 'noPhoto': 'No photo', 'photoRule': 'Only consented Clinical Media from this visit can be linked.',
    'checklist': 'Configured checklist', 'complete': 'Complete procedure checklist', 'required': 'Required', 'yes': 'Yes', 'no': 'No',
    'select': 'Select', 'retry': 'Retry', 'noConfig': 'No active procedure checklist is configured for this category.',
    'signed': 'Signed & append-only', 'encrypted': 'Encrypted at rest', 'noInference': 'No automated clinical inference.',
  },
  'ar': {
    'title': 'مسارات التمريض', 'chooseVisit': 'اختر زيارة المريض', 'empty': 'لا توجد زيارات مؤكدة أو مكتملة.',
    'medAdmin': 'تسجيل إعطاء الدواء', 'wound': 'تقييم الجرح', 'procedure': 'قائمة تحقق الإجراء',
    'prescription': 'وصفة فعالة', 'administered': 'تم الإعطاء', 'omitted': 'لم يُعطَ', 'dose': 'الجرعة', 'route': 'طريقة الإعطاء',
    'omission': 'سبب عدم الإعطاء', 'note': 'ملاحظة اختيارية', 'save': 'حفظ السجل الموقّع', 'saved': 'تم حفظ السجل.', 'history': 'السجل',
    'site': 'رمز موضع الجسم', 'woundType': 'نوع الجرح', 'length': 'الطول (سم)', 'width': 'العرض (سم)', 'depth': 'العمق (سم، اختياري)',
    'exudate': 'رمز الإفراز', 'photo': 'صورة سريرية مشفرة بموافقة المريض (اختياري)', 'noPhoto': 'بدون صورة', 'photoRule': 'يمكن ربط وسائط سريرية بموافقة المريض من هذه الزيارة فقط.',
    'checklist': 'قائمة التحقق المهيأة', 'complete': 'إكمال قائمة تحقق الإجراء', 'required': 'إلزامي', 'yes': 'نعم', 'no': 'لا',
    'select': 'اختيار', 'retry': 'إعادة المحاولة', 'noConfig': 'لا توجد قائمة تحقق إجراء فعالة لهذه الفئة.',
    'signed': 'موقّع وغير قابل للتعديل', 'encrypted': 'مشفر أثناء التخزين', 'noInference': 'لا يوجد استنتاج سريري آلي.',
  },
  'fr': {
    'title': 'Parcours infirmiers', 'chooseVisit': 'Choisir la visite patient', 'empty': 'Aucune visite confirmée ou terminée.',
    'medAdmin': 'Administration du médicament', 'wound': 'Évaluation de plaie', 'procedure': 'Checklist de procédure',
    'prescription': 'Prescription active', 'administered': 'Administré', 'omitted': 'Omis', 'dose': 'Dose', 'route': 'Voie',
    'omission': 'Motif d’omission', 'note': 'Note (facultatif)', 'save': 'Enregistrer le dossier signé', 'saved': 'Dossier enregistré.', 'history': 'Historique',
    'site': 'Code du site corporel', 'woundType': 'Type de plaie', 'length': 'Longueur (cm)', 'width': 'Largeur (cm)', 'depth': 'Profondeur (cm, facultatif)',
    'exudate': 'Code d’exsudat', 'photo': 'Photo chiffrée avec consentement (facultatif)', 'noPhoto': 'Aucune photo', 'photoRule': 'Seuls les médias cliniques consentis de cette visite peuvent être liés.',
    'checklist': 'Checklist configurée', 'complete': 'Terminer la checklist de procédure', 'required': 'Obligatoire', 'yes': 'Oui', 'no': 'Non',
    'select': 'Sélectionner', 'retry': 'Réessayer', 'noConfig': 'Aucune checklist de procédure active pour cette catégorie.',
    'signed': 'Signé et append-only', 'encrypted': 'Chiffré au repos', 'noInference': 'Aucune inférence clinique automatisée.',
  },
  'es': {
    'title': 'Flujos de enfermería', 'chooseVisit': 'Elegir visita del paciente', 'empty': 'No hay visitas confirmadas o completadas.',
    'medAdmin': 'Administración de medicación', 'wound': 'Evaluación de heridas', 'procedure': 'Checklist de procedimiento',
    'prescription': 'Prescripción activa', 'administered': 'Administrado', 'omitted': 'Omitido', 'dose': 'Dosis', 'route': 'Vía',
    'omission': 'Motivo de omisión', 'note': 'Nota (opcional)', 'save': 'Guardar registro firmado', 'saved': 'Registro guardado.', 'history': 'Historial',
    'site': 'Código de zona corporal', 'woundType': 'Tipo de herida', 'length': 'Longitud (cm)', 'width': 'Anchura (cm)', 'depth': 'Profundidad (cm, opcional)',
    'exudate': 'Código de exudado', 'photo': 'Foto cifrada con consentimiento (opcional)', 'noPhoto': 'Sin foto', 'photoRule': 'Solo se puede vincular Clinical Media consentido de esta visita.',
    'checklist': 'Checklist configurado', 'complete': 'Completar checklist de procedimiento', 'required': 'Obligatorio', 'yes': 'Sí', 'no': 'No',
    'select': 'Seleccionar', 'retry': 'Reintentar', 'noConfig': 'No hay un checklist de procedimiento activo para esta categoría.',
    'signed': 'Firmado y append-only', 'encrypted': 'Cifrado en reposo', 'noInference': 'Sin inferencia clínica automatizada.',
  },
};

class ProviderNursingLauncher extends StatelessWidget {
  const ProviderNursingLauncher({
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

  bool get enabled => workflowCapabilities.any({'MED_ADMIN', 'WOUND_CARE', 'PROCEDURE_CHECKLIST'}.contains);

  @override
  Widget build(BuildContext context) {
    if (!enabled) return child;
    return Stack(children: [
      child,
      PositionedDirectional(
        end: 18,
        bottom: 512,
        child: FloatingActionButton.small(
          heroTag: 'provider-nursing-workflows',
          backgroundColor: accent,
          foregroundColor: Colors.white,
          tooltip: nursingText(locale, 'title'),
          onPressed: () => _chooseVisit(context),
          child: const Icon(Icons.medical_services_outlined),
        ),
      ),
    ]);
  }

  Future<void> _chooseVisit(BuildContext context) async {
    try {
      final now = DateTime.now();
      final values = await session.api.providerAppointments(
        from: now.subtract(const Duration(days: 365)),
        to: now.add(const Duration(days: 31)),
      );
      final appointments = values
          .where((item) => item['status'] == 'CONFIRMED' || item['status'] == 'COMPLETED')
          .toList(growable: false)
        ..sort((a, b) => (b['startsAt']?.toString() ?? '').compareTo(a['startsAt']?.toString() ?? ''));
      if (!context.mounted) return;
      if (appointments.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(nursingText(locale, 'empty'))));
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
              child: Column(children: [
                ListTile(title: Text(nursingText(locale, 'chooseVisit'), style: const TextStyle(fontWeight: FontWeight.w800))),
                const Divider(height: 1),
                Expanded(child: ListView.builder(
                  itemCount: appointments.length,
                  itemBuilder: (_, index) {
                    final appointment = appointments[index];
                    final patient = _map(appointment['patient']);
                    final name = [patient['firstName'], patient['lastName']].whereType<String>().where((v) => v.trim().isNotEmpty).join(' ');
                    return ListTile(
                      leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                      title: Text(name.isEmpty ? 'Patient' : name),
                      subtitle: Text('${_formatDate(appointment['startsAt'])} · ${appointment['status'] ?? ''}'),
                      onTap: () => Navigator.pop(sheetContext, appointment),
                    );
                  },
                )),
              ]),
            ),
          ),
        ),
      );
      if (selected == null || !context.mounted) return;
      await Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: ProviderNursingWorkspace(
            session: session,
            locale: locale,
            appointment: selected,
            workflowCapabilities: workflowCapabilities,
            accent: accent,
          ),
        )),
      );
    } catch (value) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }
}

class ProviderNursingWorkspace extends StatelessWidget {
  const ProviderNursingWorkspace({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
    required this.workflowCapabilities,
    required this.accent,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Set<String> workflowCapabilities;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final patient = _map(appointment['patient']);
    final name = [patient['firstName'], patient['lastName']].whereType<String>().where((v) => v.trim().isNotEmpty).join(' ');
    final actions = <Widget>[];
    if (workflowCapabilities.contains('MED_ADMIN')) {
      actions.add(_ActionTile(
        icon: Icons.medication_outlined,
        title: nursingText(locale, 'medAdmin'),
        onTap: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: MedicationAdministrationPage(session: session, locale: locale, appointment: appointment, accent: accent),
        ))),
      ));
    }
    if (workflowCapabilities.contains('WOUND_CARE')) {
      actions.add(_ActionTile(
        icon: Icons.healing_outlined,
        title: nursingText(locale, 'wound'),
        onTap: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: WoundAssessmentPage(session: session, locale: locale, appointment: appointment, accent: accent),
        ))),
      ));
    }
    if (workflowCapabilities.contains('PROCEDURE_CHECKLIST')) {
      actions.add(_ActionTile(
        icon: Icons.fact_check_outlined,
        title: nursingText(locale, 'procedure'),
        onTap: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: ProcedureChecklistPage(session: session, locale: locale, appointment: appointment, accent: accent),
        ))),
      ));
    }
    return Scaffold(
      appBar: AppBar(title: Text(nursingText(locale, 'title'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(child: ListTile(
          leading: const Icon(Icons.person_outline),
          title: Text(name.isEmpty ? 'Patient' : name, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text('${_formatDate(appointment['startsAt'])} · ${appointment['status'] ?? ''}'),
        )),
        const SizedBox(height: 8),
        ...actions,
        const SizedBox(height: 12),
        Text('${nursingText(locale, 'encrypted')} · ${nursingText(locale, 'noInference')}', style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }
}

class MedicationAdministrationPage extends StatefulWidget {
  const MedicationAdministrationPage({super.key, required this.session, required this.locale, required this.appointment, required this.accent});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Color accent;
  @override State<MedicationAdministrationPage> createState() => _MedicationAdministrationPageState();
}

class _MedicationAdministrationPageState extends State<MedicationAdministrationPage> {
  late final ProviderNursingApi api;
  final dose = TextEditingController();
  final route = TextEditingController();
  final omission = TextEditingController();
  final note = TextEditingController();
  bool loading = true, saving = false;
  String? error, selectedOrderId;
  String status = 'ADMINISTERED';
  List<Map<String, dynamic>> prescriptions = const [], history = const [];

  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  String get patientId => _patientId(widget.appointment);

  @override void initState() { super.initState(); api = ProviderNursingApi(widget.session); _load(); }
  @override void dispose() { dose.dispose(); route.dispose(); omission.dispose(); note.dispose(); super.dispose(); }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final source = await api.eligiblePrescriptions(appointmentId);
      final hist = patientId.isEmpty ? <String, dynamic>{'items': const []} : await api.medicationHistory(patientId);
      if (!mounted) return;
      setState(() {
        prescriptions = _mapList(source['items']);
        history = _mapList(hist['items']);
        selectedOrderId = prescriptions.any((p) => p['id'] == selectedOrderId) ? selectedOrderId : (prescriptions.isEmpty ? null : prescriptions.first['id']?.toString());
      });
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Future<void> _save() async {
    if (selectedOrderId == null || saving) return;
    setState(() => saving = true);
    try {
      await api.recordMedicationAdministration(
        appointmentId: appointmentId,
        prescriptionOrderId: selectedOrderId!,
        status: status,
        administeredAt: DateTime.now(),
        idempotencyKey: 'med-admin-${DateTime.now().microsecondsSinceEpoch}',
        dose: status == 'ADMINISTERED' ? dose.text : null,
        route: status == 'ADMINISTERED' ? route.text : null,
        omissionReason: status == 'OMITTED' ? omission.text : null,
        note: note.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(nursingText(widget.locale, 'saved'))));
      dose.clear(); route.clear(); omission.clear(); note.clear();
      await _load();
    } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); }
    finally { if (mounted) setState(() => saving = false); }
  }

  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(nursingText(widget.locale, 'medAdmin'))),
    body: loading ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.all(16), children: [
      if (error != null) _ErrorCard(error!, _load),
      DropdownButtonFormField<String>(
        value: selectedOrderId,
        decoration: InputDecoration(labelText: nursingText(widget.locale, 'prescription'), border: const OutlineInputBorder()),
        items: prescriptions.map((p) {
          final medication = _map(p['medication']);
          final label = '${medication['name'] ?? p['id'] ?? ''}${medication['strength'] == null ? '' : ' · ${medication['strength']}'}';
          return DropdownMenuItem(value: p['id']?.toString(), child: Text(label, overflow: TextOverflow.ellipsis));
        }).toList(),
        onChanged: saving ? null : (value) => setState(() => selectedOrderId = value),
      ),
      const SizedBox(height: 12),
      SegmentedButton<String>(
        segments: [
          ButtonSegment(value: 'ADMINISTERED', label: Text(nursingText(widget.locale, 'administered'))),
          ButtonSegment(value: 'OMITTED', label: Text(nursingText(widget.locale, 'omitted'))),
        ],
        selected: {status}, onSelectionChanged: saving ? null : (value) => setState(() => status = value.first),
      ),
      const SizedBox(height: 12),
      if (status == 'ADMINISTERED') ...[
        TextField(controller: dose, decoration: InputDecoration(labelText: nursingText(widget.locale, 'dose'), border: const OutlineInputBorder())),
        const SizedBox(height: 10),
        TextField(controller: route, decoration: InputDecoration(labelText: nursingText(widget.locale, 'route'), border: const OutlineInputBorder())),
      ] else
        TextField(controller: omission, decoration: InputDecoration(labelText: nursingText(widget.locale, 'omission'), border: const OutlineInputBorder())),
      const SizedBox(height: 10),
      TextField(controller: note, maxLines: 2, decoration: InputDecoration(labelText: nursingText(widget.locale, 'note'), border: const OutlineInputBorder())),
      const SizedBox(height: 12),
      FilledButton.icon(onPressed: selectedOrderId == null || saving ? null : _save, icon: const Icon(Icons.verified_outlined), label: Text(nursingText(widget.locale, 'save'))),
      const SizedBox(height: 18),
      Text(nursingText(widget.locale, 'history'), style: Theme.of(context).textTheme.titleMedium),
      ...history.take(20).map((item) => ListTile(
        leading: const Icon(Icons.history),
        title: Text(item['administrationStatus']?.toString() ?? ''),
        subtitle: Text('${_formatDate(item['administeredAt'])} · ${nursingText(widget.locale, 'signed')}'),
      )),
    ]),
  );
}

class WoundAssessmentPage extends StatefulWidget {
  const WoundAssessmentPage({super.key, required this.session, required this.locale, required this.appointment, required this.accent});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Color accent;
  @override State<WoundAssessmentPage> createState() => _WoundAssessmentPageState();
}

class _WoundAssessmentPageState extends State<WoundAssessmentPage> {
  late final ProviderNursingApi api;
  late final ProviderFieldMediaApi mediaApi;
  final site = TextEditingController(), type = TextEditingController(), length = TextEditingController(), width = TextEditingController(), depth = TextEditingController(), exudate = TextEditingController(), notes = TextEditingController();
  bool loading = true, saving = false;
  String? error, mediaId;
  List<Map<String, dynamic>> media = const [], history = const [];
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  String get patientId => _patientId(widget.appointment);

  @override void initState() { super.initState(); api = ProviderNursingApi(widget.session); mediaApi = ProviderFieldMediaApi(widget.session); _load(); }
  @override void dispose() { for (final c in [site,type,length,width,depth,exudate,notes]) { c.dispose(); } super.dispose(); }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      Map<String, dynamic> mediaResult = <String, dynamic>{'items': const []};
      try { mediaResult = await mediaApi.history(appointmentId); } catch (_) {}
      final woundResult = patientId.isEmpty ? <String, dynamic>{'items': const []} : await api.woundHistory(patientId);
      if (!mounted) return;
      setState(() { media = _mapList(mediaResult['items']); history = _mapList(woundResult['items']); });
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Future<void> _save() async {
    if (saving) return;
    final l = double.tryParse(length.text.trim()), w = double.tryParse(width.text.trim());
    final d = depth.text.trim().isEmpty ? null : double.tryParse(depth.text.trim());
    if (l == null || w == null || (depth.text.trim().isNotEmpty && d == null)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Invalid dimensions.'))); return;
    }
    setState(() => saving = true);
    try {
      await api.recordWoundAssessment(
        appointmentId: appointmentId, siteCode: site.text, woundType: type.text,
        lengthCm: l, widthCm: w, depthCm: d, exudate: exudate.text, assessedAt: DateTime.now(),
        idempotencyKey: 'wound-${DateTime.now().microsecondsSinceEpoch}', clinicalMediaId: mediaId, notes: notes.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(nursingText(widget.locale, 'saved'))));
      for (final c in [site,type,length,width,depth,exudate,notes]) { c.clear(); }
      setState(() => mediaId = null); await _load();
    } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); }
    finally { if (mounted) setState(() => saving = false); }
  }

  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(nursingText(widget.locale, 'wound'))),
    body: loading ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.all(16), children: [
      if (error != null) _ErrorCard(error!, _load),
      TextField(controller: site, decoration: InputDecoration(labelText: nursingText(widget.locale, 'site'), border: const OutlineInputBorder())), const SizedBox(height: 10),
      TextField(controller: type, decoration: InputDecoration(labelText: nursingText(widget.locale, 'woundType'), border: const OutlineInputBorder())), const SizedBox(height: 10),
      Row(children: [
        Expanded(child: TextField(controller: length, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: nursingText(widget.locale, 'length'), border: const OutlineInputBorder()))),
        const SizedBox(width: 8),
        Expanded(child: TextField(controller: width, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: nursingText(widget.locale, 'width'), border: const OutlineInputBorder()))),
      ]), const SizedBox(height: 10),
      TextField(controller: depth, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: nursingText(widget.locale, 'depth'), border: const OutlineInputBorder())), const SizedBox(height: 10),
      TextField(controller: exudate, decoration: InputDecoration(labelText: nursingText(widget.locale, 'exudate'), border: const OutlineInputBorder())), const SizedBox(height: 10),
      DropdownButtonFormField<String?>(
        value: mediaId,
        decoration: InputDecoration(labelText: nursingText(widget.locale, 'photo'), border: const OutlineInputBorder()),
        items: [
          DropdownMenuItem<String?>(value: null, child: Text(nursingText(widget.locale, 'noPhoto'))),
          ...media.map((item) => DropdownMenuItem<String?>(
            value: item['clinicalMediaId']?.toString(),
            child: Text('${_formatDate(item['capturedAt'])} · ${(item['clinicalMediaId'] ?? '').toString().substring(0, ((item['clinicalMediaId'] ?? '').toString().length).clamp(0, 8)))}'),
          )),
        ],
        onChanged: saving ? null : (value) => setState(() => mediaId = value),
      ),
      const SizedBox(height: 6), Text(nursingText(widget.locale, 'photoRule'), style: Theme.of(context).textTheme.bodySmall), const SizedBox(height: 10),
      TextField(controller: notes, maxLines: 2, decoration: InputDecoration(labelText: nursingText(widget.locale, 'note'), border: const OutlineInputBorder())), const SizedBox(height: 12),
      FilledButton.icon(onPressed: saving ? null : _save, icon: const Icon(Icons.save_outlined), label: Text(nursingText(widget.locale, 'save'))),
      const SizedBox(height: 18), Text(nursingText(widget.locale, 'history'), style: Theme.of(context).textTheme.titleMedium),
      ...history.take(20).map((item) => ListTile(leading: const Icon(Icons.healing_outlined), title: Text(_map(item['data'])['siteCode']?.toString() ?? ''), subtitle: Text('${_formatDate(item['assessedAt'])} · ${nursingText(widget.locale, 'encrypted')}'))),
    ]),
  );
}

class ProcedureChecklistPage extends StatefulWidget {
  const ProcedureChecklistPage({super.key, required this.session, required this.locale, required this.appointment, required this.accent});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Color accent;
  @override State<ProcedureChecklistPage> createState() => _ProcedureChecklistPageState();
}

class _ProcedureChecklistPageState extends State<ProcedureChecklistPage> {
  late final ProviderNursingApi api;
  bool loading = true, saving = false;
  String? error, selectedCode;
  List<Map<String, dynamic>> forms = const [];
  Map<String, dynamic> answers = <String, dynamic>{};
  String get appointmentId => widget.appointment['id']?.toString() ?? '';
  @override void initState() { super.initState(); api = ProviderNursingApi(widget.session); _load(); }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final result = await api.procedureChecklists();
      if (!mounted) return;
      final next = _mapList(result['items']);
      setState(() { forms = next; selectedCode = next.isEmpty ? null : next.first['code']?.toString(); answers = <String, dynamic>{}; });
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  Map<String, dynamic>? get selected => forms.cast<Map<String, dynamic>?>().firstWhere((f) => f?['code'] == selectedCode, orElse: () => null);
  List<Map<String, dynamic>> get questions => _mapList(_map(selected?['schema'])['questions']);

  Future<void> _complete() async {
    final code = selectedCode; if (code == null || saving) return;
    setState(() => saving = true);
    try {
      await api.completeProcedureChecklist(
        code: code, appointmentId: appointmentId, expectedLatestSequence: 0, answers: answers,
        idempotencyKey: 'procedure-$code-${DateTime.now().microsecondsSinceEpoch}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(nursingText(widget.locale, 'saved'))));
      setState(() => answers = <String, dynamic>{});
    } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); }
    finally { if (mounted) setState(() => saving = false); }
  }

  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(nursingText(widget.locale, 'procedure'))),
    body: loading ? const Center(child: CircularProgressIndicator()) : ListView(padding: const EdgeInsets.all(16), children: [
      if (error != null) _ErrorCard(error!, _load),
      if (forms.isEmpty) Text(nursingText(widget.locale, 'noConfig')) else ...[
        DropdownButtonFormField<String>(
          value: selectedCode,
          decoration: InputDecoration(labelText: nursingText(widget.locale, 'checklist'), border: const OutlineInputBorder()),
          items: forms.map((f) => DropdownMenuItem(value: f['code']?.toString(), child: Text(_label(_map(f['labels']), widget.locale)))).toList(),
          onChanged: saving ? null : (value) => setState(() { selectedCode = value; answers = <String, dynamic>{}; }),
        ),
        const SizedBox(height: 14),
        ...questions.map((q) => _QuestionEditor(
          question: q, locale: widget.locale, value: answers[q['id']?.toString()],
          onChanged: (value) => setState(() { final id = q['id']?.toString() ?? ''; if (id.isNotEmpty) answers[id] = value; }),
        )),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: saving ? null : _complete, icon: const Icon(Icons.fact_check_outlined), label: Text(nursingText(widget.locale, 'complete'))),
      ],
    ]),
  );
}

class _QuestionEditor extends StatelessWidget {
  const _QuestionEditor({required this.question, required this.locale, required this.value, required this.onChanged});
  final Map<String, dynamic> question;
  final CarePointLocale locale;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;

  @override Widget build(BuildContext context) {
    final type = question['type']?.toString() ?? 'TEXT';
    final title = _label(_map(question['labels']), locale);
    final required = question['required'] == true;
    final label = required ? '$title · ${nursingText(locale, 'required')}' : title;
    if (type == 'BOOLEAN') {
      return Card(child: SwitchListTile(title: Text(label), value: value == true, onChanged: onChanged));
    }
    if (type == 'SINGLE_CHOICE') {
      final options = _mapList(question['options']);
      return Padding(padding: const EdgeInsets.only(bottom: 10), child: DropdownButtonFormField<String>(
        value: value is String ? value : null,
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        items: options.map((o) => DropdownMenuItem(value: o['value']?.toString(), child: Text(_label(_map(o['labels']), locale)))).toList(),
        onChanged: onChanged,
      ));
    }
    if (type == 'MULTI_CHOICE') {
      final selected = value is List ? value.map((e) => e.toString()).toSet() : <String>{};
      final options = _mapList(question['options']);
      return Padding(padding: const EdgeInsets.only(bottom: 10), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        Wrap(spacing: 6, children: options.map((o) {
          final option = o['value']?.toString() ?? '';
          return FilterChip(label: Text(_label(_map(o['labels']), locale)), selected: selected.contains(option), onSelected: (active) {
            final next = {...selected}; active ? next.add(option) : next.remove(option); onChanged(next.toList());
          });
        }).toList()),
      ]));
    }
    return Padding(padding: const EdgeInsets.only(bottom: 10), child: TextFormField(
      key: ValueKey('${question['id']}-${value ?? ''}'),
      initialValue: value?.toString() ?? '',
      keyboardType: type == 'NUMBER' ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      onChanged: (raw) {
        if (type == 'NUMBER') { onChanged(double.tryParse(raw)); } else { onChanged(raw); }
      },
    ));
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.title, required this.onTap});
  final IconData icon; final String title; final VoidCallback onTap;
  @override Widget build(BuildContext context) => Card(child: ListTile(leading: Icon(icon), title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)), trailing: const Icon(Icons.chevron_right), onTap: onTap));
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard(this.message, this.retry);
  final String message; final VoidCallback retry;
  @override Widget build(BuildContext context) => Card(color: Theme.of(context).colorScheme.errorContainer, child: ListTile(title: Text(message), trailing: IconButton(onPressed: retry, icon: const Icon(Icons.refresh))));
}

String _patientId(Map<String, dynamic> appointment) {
  final direct = appointment['patientId']?.toString() ?? '';
  if (direct.isNotEmpty) return direct;
  return _map(appointment['patient'])['id']?.toString() ?? '';
}

String _label(Map<String, dynamic> labels, CarePointLocale locale) {
  return labels[locale.name]?.toString().trim().isNotEmpty == true
      ? labels[locale.name].toString()
      : labels['en']?.toString() ?? '';
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _mapList(dynamic value) {
  if (value is! List) return <Map<String, dynamic>>[];
  return value.map(_map).toList(growable: false);
}

String _formatDate(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year} ${two(value.hour)}:${two(value.minute)}';
}
