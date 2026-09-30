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
    'observations': 'Vitals & observations', 'medAdmin': 'Medication administration', 'wound': 'Wound assessment', 'procedure': 'Procedure checklist',
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
    'observations': 'العلامات الحيوية والملاحظات', 'medAdmin': 'تسجيل إعطاء الدواء', 'wound': 'تقييم الجرح', 'procedure': 'قائمة تحقق الإجراء',
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
    'observations': 'Constantes et observations', 'medAdmin': 'Administration du médicament', 'wound': 'Évaluation de plaie', 'procedure': 'Checklist de procédure',
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
    'observations': 'Constantes y observaciones', 'medAdmin': 'Administración de medicación', 'wound': 'Evaluación de heridas', 'procedure': 'Checklist de procedimiento',
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
    required this.observationCodes,
    required this.child,
    this.accent = const Color(0xFF10B981),
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Set<String> workflowCapabilities;
  final Set<String> observationCodes;
  final Widget child;
  final Color accent;

  bool get procedureEnabled => workflowCapabilities.contains('PROCEDURE_CHECKLIST') && workflowCapabilities.contains('CATEGORY_FORMS');
  bool get enabled => observationCodes.isNotEmpty || workflowCapabilities.contains('MED_ADMIN') || workflowCapabilities.contains('WOUND_CARE') || procedureEnabled;

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
            observationCodes: observationCodes,
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
    required this.observationCodes,
    required this.accent,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Set<String> workflowCapabilities;
  final Set<String> observationCodes;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final patient = _map(appointment['patient']);
    final name = [patient['firstName'], patient['lastName']].whereType<String>().where((v) => v.trim().isNotEmpty).join(' ');
    final actions = <Widget>[];
    if (observationCodes.isNotEmpty) {
      actions.add(_ActionTile(
        icon: Icons.monitor_heart_outlined,
        title: nursingText(locale, 'observations'),
        onTap: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: ProviderObservationPanelPage(
            session: session,
            locale: locale,
            appointment: appointment,
            allowedCodes: observationCodes,
            accent: accent,
          ),
        ))),
      ));
    }
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
    if (workflowCapabilities.contains('PROCEDURE_CHECKLIST') && workflowCapabilities.contains('CATEGORY_FORMS')) {
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


class ProviderObservationPanelPage extends StatefulWidget {
  const ProviderObservationPanelPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
    required this.allowedCodes,
    required this.accent,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Set<String> allowedCodes;
  final Color accent;

  @override
  State<ProviderObservationPanelPage> createState() => _ProviderObservationPanelPageState();
}

class _ProviderObservationPanelPageState extends State<ProviderObservationPanelPage> {
  bool loading = true;
  String? error;
  List<Map<String, dynamic>> catalog = const [];
  List<Map<String, dynamic>> devices = const [];
  String? deviceError;
  final Map<String, TextEditingController> values = {};
  final Map<String, String> units = {};
  final Map<String, String> selectedDevices = {};
  final Set<String> saving = {};

  String get patientId => _patientId(widget.appointment);
  String get encounterId => widget.appointment['id']?.toString() ?? '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final controller in values.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final result = await widget.session.api.providerObservationCatalog();
      Map<String, dynamic> deviceResult = const {};
      String? nextDeviceError;
      try {
        if (patientId.isNotEmpty && encounterId.isNotEmpty) {
          deviceResult = await widget.session.api.providerAssignedDevices(patientId, encounterId);
        }
      } catch (value) {
        nextDeviceError = value.toString();
      }
      final next = _mapList(result['items'])
          .where((item) => widget.allowedCodes.contains(item['code']?.toString()))
          .toList(growable: false);
      for (final item in next) {
        final code = item['code']?.toString() ?? '';
        if (code.isEmpty) continue;
        values.putIfAbsent(code, TextEditingController.new);
        final allowed = (item['allowedUnitCodes'] is List)
            ? (item['allowedUnitCodes'] as List).whereType<String>().toList(growable: false)
            : const <String>[];
        units[code] = units[code] ?? (allowed.isNotEmpty ? allowed.first : item['canonicalUnitCode']?.toString() ?? '');
      }
      final nextDevices = _mapList(deviceResult['items']);
      for (final item in next) {
        final code = item['code']?.toString() ?? '';
        if (code.isEmpty) continue;
        final compatible = nextDevices.where((device) {
          final codes = device['observationCodes'];
          return codes is List && codes.whereType<String>().contains(code);
        }).toList(growable: false);
        if (compatible.isNotEmpty && !compatible.any((device) => device['id']?.toString() == selectedDevices[code])) {
          selectedDevices[code] = compatible.first['id'].toString();
        }
      }
      if (!mounted) return;
      setState(() {
        catalog = next;
        devices = nextDevices;
        deviceError = nextDeviceError;
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _save(Map<String, dynamic> metric) async {
    final code = metric['code']?.toString() ?? '';
    final controller = values[code];
    final value = double.tryParse(controller?.text.trim() ?? '');
    final unit = units[code] ?? '';
    if (code.isEmpty || value == null || unit.isEmpty || patientId.isEmpty || encounterId.isEmpty) {
      _message(observationPanelText(widget.locale, 'invalid'));
      return;
    }
    setState(() => saving.add(code));
    try {
      await widget.session.api.recordProviderObservation(
        patientId,
        code: code,
        value: value,
        unitCode: unit,
        observedAt: DateTime.now(),
        encounterId: encounterId,
      );
      controller?.clear();
      _message(observationPanelText(widget.locale, 'saved'));
    } catch (value) {
      _message(value.toString());
    } finally {
      if (mounted) setState(() => saving.remove(code));
    }
  }


  Future<void> _saveDevice(Map<String, dynamic> metric) async {
    final code = metric['code']?.toString() ?? '';
    final controller = values[code];
    final value = double.tryParse(controller?.text.trim() ?? '');
    final unit = units[code] ?? '';
    final deviceId = selectedDevices[code] ?? '';
    if (code.isEmpty || value == null || unit.isEmpty || deviceId.isEmpty || patientId.isEmpty || encounterId.isEmpty) {
      _message(observationPanelText(widget.locale, 'invalidDevice'));
      return;
    }
    setState(() => saving.add(code));
    try {
      final result = await widget.session.api.recordProviderDeviceObservation(
        patientId,
        deviceId: deviceId,
        externalEventId: 'provider-mobile-${DateTime.now().microsecondsSinceEpoch}',
        code: code,
        value: value,
        unitCode: unit,
        observedAt: DateTime.now(),
        encounterId: encounterId,
      );
      if (result['sourceType']?.toString() != 'DEVICE' || result['sourceId']?.toString() != deviceId) {
        throw StateError('Device provenance was not preserved by the server.');
      }
      controller?.clear();
      _message(observationPanelText(widget.locale, 'deviceSaved'));
    } catch (value) {
      _message(value.toString());
    } finally {
      if (mounted) setState(() => saving.remove(code));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(observationPanelText(widget.locale, 'title')),
      actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh_outlined))],
    ),
    body: loading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (error != null) _ErrorCard(error!, _load),
                Card(child: ListTile(
                  leading: const Icon(Icons.shield_outlined),
                  title: Text(observationPanelText(widget.locale, 'capabilityBound'), style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(observationPanelText(widget.locale, 'noInference')),
                )),
                if (deviceError != null) Card(child: ListTile(
                  leading: const Icon(Icons.usb_off_outlined),
                  title: Text(observationPanelText(widget.locale, 'deviceUnavailable')),
                  subtitle: Text(deviceError!),
                )),
                if (catalog.isEmpty && error == null)
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(observationPanelText(widget.locale, 'empty'), textAlign: TextAlign.center),
                  )
                else
                  ...catalog.map(_metricCard),
              ],
            ),
          ),
  );

  Widget _metricCard(Map<String, dynamic> metric) {
    final code = metric['code']?.toString() ?? '';
    final allowedUnits = (metric['allowedUnitCodes'] is List)
        ? (metric['allowedUnitCodes'] as List).whereType<String>().toList(growable: false)
        : const <String>[];
    final label = _label(_map(metric['labels']), widget.locale);
    final compatibleDevices = devices.where((device) {
      final codes = device['observationCodes'];
      return codes is List && codes.whereType<String>().contains(code);
    }).toList(growable: false);
    return Card(child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(Icons.monitor_heart_outlined, color: widget.accent),
          const SizedBox(width: 8),
          Expanded(child: Text(label.isEmpty ? code : label, style: const TextStyle(fontWeight: FontWeight.w800))),
          Text(code, style: Theme.of(context).textTheme.labelSmall),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: TextField(
            controller: values[code],
            enabled: !saving.contains(code),
            keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
            decoration: InputDecoration(
              labelText: observationPanelText(widget.locale, 'value'),
              border: const OutlineInputBorder(),
            ),
          )),
          const SizedBox(width: 10),
          SizedBox(
            width: 132,
            child: DropdownButtonFormField<String>(
              initialValue: units[code],
              decoration: InputDecoration(
                labelText: observationPanelText(widget.locale, 'unit'),
                border: const OutlineInputBorder(),
              ),
              items: allowedUnits.map((unit) => DropdownMenuItem(value: unit, child: Text(unit))).toList(growable: false),
              onChanged: saving.contains(code) ? null : (value) => setState(() {
                if (value != null) units[code] = value;
              }),
            ),
          ),
        ]),
        const SizedBox(height: 10),
        FilledButton.icon(
          onPressed: saving.contains(code) ? null : () => _save(metric),
          icon: const Icon(Icons.edit_note_outlined),
          label: Text(observationPanelText(widget.locale, 'recordManual')),
        ),
        if (compatibleDevices.isNotEmpty) ...[
          const SizedBox(height: 12),
          Divider(height: 1),
          const SizedBox(height: 12),
          Text(observationPanelText(widget.locale, 'deviceSection'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(observationPanelText(widget.locale, 'deviceProvenance'), style: const TextStyle(color: Color(0xFF64748B))),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            key: ValueKey('device-capture-$code'),
            initialValue: selectedDevices[code],
            decoration: InputDecoration(
              labelText: observationPanelText(widget.locale, 'device'),
              border: const OutlineInputBorder(),
            ),
            items: compatibleDevices.map((device) {
              final model = _map(device['model']);
              return DropdownMenuItem(
                value: device['id']?.toString(),
                child: Text('${model['manufacturer'] ?? ''} ${model['modelName'] ?? ''} · ${device['serialNumber'] ?? ''}'),
              );
            }).toList(growable: false),
            onChanged: saving.contains(code) ? null : (value) => setState(() {
              if (value != null) selectedDevices[code] = value;
            }),
          ),
          const SizedBox(height: 10),
          FilledButton.tonalIcon(
            onPressed: saving.contains(code) ? null : () => _saveDevice(metric),
            icon: const Icon(Icons.sensors_outlined),
            label: Text(observationPanelText(widget.locale, 'recordDevice')),
          ),
        ],
      ]),
    ));
  }

  void _message(String value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }
}

String observationPanelText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Vitals & observations','capabilityBound':'Capability-bound panel','noInference':'Only metrics authorized for this provider category are shown. Units/ranges are enforced by the server; no automated diagnosis is produced.','empty':'No observation metric is enabled for this category.','value':'Value','unit':'Unit','record':'Record observation','recordManual':'Record manual observation','recordDevice':'Import authorized device reading','deviceSection':'Authorized device capture','device':'Device','deviceProvenance':'Device imports are stored with DEVICE provenance and can never impersonate a manual/provider entry.','deviceSaved':'Device observation imported.','deviceUnavailable':'Authorized devices unavailable','saved':'Observation recorded.','invalid':'Enter a valid value and unit for this visit.','invalidDevice':'Choose an authorized device and enter a valid captured value/unit.'
    },
    CarePointLocale.ar: {
      'title':'العلامات الحيوية والملاحظات','capabilityBound':'لوحة مقيدة بالصلاحيات','noInference':'تظهر فقط المقاييس المسموح بها لفئة مقدم الخدمة. يفرض الخادم الوحدات والنطاقات ولا ينتج أي تشخيص آلي.','empty':'لا يوجد مقياس ملاحظات مفعّل لهذه الفئة.','value':'القيمة','unit':'الوحدة','record':'تسجيل الملاحظة','recordManual':'تسجيل ملاحظة يدوية','recordDevice':'استيراد قراءة جهاز مصرح','deviceSection':'التقاط من جهاز مصرح','device':'الجهاز','deviceProvenance':'تُحفظ قراءات الجهاز بمصدر DEVICE ولا يمكن أن تنتحل إدخالاً يدوياً/مهنياً.','deviceSaved':'تم استيراد قراءة الجهاز.','deviceUnavailable':'الأجهزة المصرح بها غير متاحة','saved':'تم تسجيل الملاحظة.','invalid':'أدخل قيمة ووحدة صالحتين لهذه الزيارة.','invalidDevice':'اختر جهازاً مصرحاً وأدخل قيمة ووحدة صالحتين.'
    },
    CarePointLocale.fr: {
      'title':'Constantes et observations','capabilityBound':'Panneau limité par capacité','noInference':'Seules les métriques autorisées pour cette catégorie sont affichées. Le serveur impose unités/plages et ne produit aucun diagnostic automatisé.','empty':'Aucune métrique d’observation n’est activée pour cette catégorie.','value':'Valeur','unit':'Unité','record':'Enregistrer','recordManual':'Saisie manuelle','recordDevice':'Importer la mesure du dispositif','deviceSection':'Capture par dispositif autorisé','device':'Dispositif','deviceProvenance':'Les mesures importées gardent la provenance DEVICE et ne peuvent pas se faire passer pour une saisie manuelle/professionnelle.','deviceSaved':'Mesure du dispositif importée.','deviceUnavailable':'Dispositifs autorisés indisponibles','saved':'Observation enregistrée.','invalid':'Saisissez une valeur et une unité valides pour cette visite.','invalidDevice':'Choisissez un dispositif autorisé et une valeur/unité valide.'
    },
    CarePointLocale.es: {
      'title':'Constantes y observaciones','capabilityBound':'Panel limitado por capability','noInference':'Solo se muestran métricas autorizadas para esta categoría. El servidor aplica unidades/rangos y no genera diagnóstico automático.','empty':'No hay ninguna métrica de observación habilitada para esta categoría.','value':'Valor','unit':'Unidad','record':'Registrar observación','recordManual':'Registrar observación manual','recordDevice':'Importar lectura de dispositivo','deviceSection':'Captura desde dispositivo autorizado','device':'Dispositivo','deviceProvenance':'Las lecturas importadas se guardan con provenance DEVICE y nunca pueden hacerse pasar por una entrada manual/profesional.','deviceSaved':'Lectura del dispositivo importada.','deviceUnavailable':'Dispositivos autorizados no disponibles','saved':'Observación registrada.','invalid':'Introduce un valor y una unidad válidos para esta visita.','invalidDevice':'Elige un dispositivo autorizado e introduce un valor/unidad válido.'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
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
        initialValue: selectedOrderId,
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
        initialValue: mediaId,
        decoration: InputDecoration(labelText: nursingText(widget.locale, 'photo'), border: const OutlineInputBorder()),
        items: [
          DropdownMenuItem<String?>(value: null, child: Text(nursingText(widget.locale, 'noPhoto'))),
          ...media.map((item) => DropdownMenuItem<String?>(
            value: item['clinicalMediaId']?.toString(),
            child: Text('${_formatDate(item['capturedAt'])} · ${_shortId(item['clinicalMediaId'])}'),
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
          initialValue: selectedCode,
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
        initialValue: value is String ? value : null,
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
            final next = <String>{...selected}; active ? next.add(option) : next.remove(option); onChanged(next.toList());
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

String _shortId(dynamic raw) {
  final value = raw?.toString() ?? '';
  return value.length <= 8 ? value : value.substring(0, 8);
}

String _formatDate(dynamic raw) {
  final value = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (value == null) return '—';
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year} ${two(value.hour)}:${two(value.minute)}';
}
