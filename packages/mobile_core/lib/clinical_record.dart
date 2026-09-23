import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'clinical_documents.dart';
import 'clinical_localization.dart';
import 'clinical_orders.dart';
import 'other_provider_insights.dart';
import 'follow_up_recommendation.dart';
import 'doctor_immunizations.dart';
import 'doctor_lab_series.dart';
import 'doctor_procedures.dart';
import 'doctor_care_plan_rpm.dart';
import 'doctor_orders_coordination.dart';
import 'questionnaire_requests.dart';

class ClinicalActionButton extends StatelessWidget {
  const ClinicalActionButton({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
    this.clinicalOrderCapabilities,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Set<String>? clinicalOrderCapabilities;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
          textDirection: locale.textDirection,
          child: ClinicalRecordPage(
            session: session,
            locale: locale,
            appointment: appointment,
            clinicalOrderCapabilities: clinicalOrderCapabilities,
          ),
        ))),
        icon: const Icon(Icons.medical_services_outlined),
        label: Text(clinicalText(locale, 'clinicalChart')),
      );
}

class ClinicalRecordPage extends StatefulWidget {
  const ClinicalRecordPage({
    super.key,
    required this.session,
    required this.locale,
    required this.appointment,
    this.clinicalOrderCapabilities,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> appointment;
  final Set<String>? clinicalOrderCapabilities;
  @override State<ClinicalRecordPage> createState() => _ClinicalRecordPageState();
}

class _ClinicalRecordPageState extends State<ClinicalRecordPage> {
  final chiefComplaint = TextEditingController(); final subjective = TextEditingController(); final objective = TextEditingController(); final assessment = TextEditingController(); final plan = TextEditingController();
  final heartRate = TextEditingController(); final systolic = TextEditingController(); final diastolic = TextEditingController(); final oxygen = TextEditingController();
  bool busy = true; bool saving = false; String? error; Map<String, dynamic>? encounter;
  List<Map<String, dynamic>> encounterTemplates = const [];
  String? selectedEncounterTemplateId;
  String? encounterTemplateError;
  CarePointApi get api => widget.session.api; CarePointLocale get locale => widget.locale; String get appointmentId => widget.appointment['id'].toString(); bool get finalized => encounter?['finalized'] == true;

  @override void initState() { super.initState(); load(); }
  @override void dispose() { chiefComplaint.dispose(); subjective.dispose(); objective.dispose(); assessment.dispose(); plan.dispose(); heartRate.dispose(); systolic.dispose(); diastolic.dispose(); oxygen.dispose(); super.dispose(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final next = await api.clinicalEncounter(appointmentId); final data = _map(_map(next['latestRecord'])['data']); final vitals = _map(data['vitals']);
      chiefComplaint.text = data['chiefComplaint']?.toString() ?? ''; subjective.text = data['subjective']?.toString() ?? ''; objective.text = data['objective']?.toString() ?? ''; assessment.text = data['assessment']?.toString() ?? ''; plan.text = data['plan']?.toString() ?? '';
      heartRate.text = vitals['heartRateBpm']?.toString() ?? ''; systolic.text = vitals['systolicMmHg']?.toString() ?? ''; diastolic.text = vitals['diastolicMmHg']?.toString() ?? ''; oxygen.text = vitals['oxygenSaturationPct']?.toString() ?? '';
      var templates = const <Map<String, dynamic>>[];
      String? templateError;
      if (widget.session.role == 'DOCTOR') {
        try {
          templates = _list((await api.doctorEncounterTemplates(appointmentId))['items']);
        } catch (value) {
          templateError = value.toString();
        }
      }
      if (mounted) setState(() {
        encounter = next;
        encounterTemplates = templates;
        encounterTemplateError = templateError;
        if (selectedEncounterTemplateId != null && !templates.any((item) => item['templateVersionId']?.toString() == selectedEncounterTemplateId)) {
          selectedEncounterTemplateId = null;
        }
      });
    } catch (value) { if (mounted) setState(() => error = value.toString()); } finally { if (mounted) setState(() => busy = false); }
  }

  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(clinicalText(locale, 'clinicalChart'))),
    body: busy ? const Center(child: CircularProgressIndicator()) : error != null ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center))) : ListView(padding: const EdgeInsets.all(16), children: [
      _summary(),
      if (widget.session.role == 'DOCTOR' && !finalized) ...[
        const SizedBox(height: 12),
        _encounterTemplateSelector(),
      ],
      const SizedBox(height: 12),
      ..._structuredClinicalFields(),
      const SizedBox(height: 18),
      if (!finalized) FilledButton.icon(onPressed: saving ? null : save, icon: const Icon(Icons.lock_outline), label: Text(clinicalText(locale, 'saveRevision'))), if (!finalized) const SizedBox(height: 10),
      if (!finalized) OutlinedButton.icon(onPressed: saving ? null : finalize, icon: const Icon(Icons.task_alt), label: Text(clinicalText(locale, widget.session.role == 'DOCTOR' ? 'signFinalize' : 'finalize'))), const SizedBox(height: 10),
      OutlinedButton.icon(onPressed: showPatientHistory, icon: const Icon(Icons.history), label: Text(clinicalText(locale, 'patientHistory'))), const SizedBox(height: 10),
      if (widget.session.role == 'DOCTOR') ...[
        OutlinedButton.icon(
          key: const ValueKey('doctor-questionnaire-request-entry'),
          onPressed: _openQuestionnaireRequests,
          icon: const Icon(Icons.fact_check_outlined),
          label: Text(questionnaireRequestText(locale, 'doctorTitle')),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          key: const ValueKey('doctor-orders-coordination-entry'),
          onPressed: _openOrdersCoordination,
          icon: const Icon(Icons.rule_folder_outlined),
          label: Text(doctorOrdersCoordinationText(locale, 'title')),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          key: const ValueKey('doctor-lab-series-entry'),
          onPressed: _openLabSeries,
          icon: const Icon(Icons.show_chart_outlined),
          label: Text(doctorLabSeriesText(locale, 'title')),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          key: const ValueKey('doctor-care-plan-rpm-entry'),
          onPressed: _openCarePlanRpm,
          icon: const Icon(Icons.monitor_heart_outlined),
          label: Text(doctorCarePlanRpmText(locale, 'title')),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          key: const ValueKey('doctor-procedure-history-entry'),
          onPressed: _openProcedures,
          icon: const Icon(Icons.medical_information_outlined),
          label: Text(doctorProcedureText(locale, 'title')),
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          key: const ValueKey('doctor-immunization-history-entry'),
          onPressed: _openImmunizations,
          icon: const Icon(Icons.vaccines_outlined),
          label: Text(doctorImmunizationText(locale, 'title')),
        ),
        const SizedBox(height: 10),
      ],
      if (widget.session.role == 'OTHER_PROVIDER') OtherProviderInsightsActionButton(session: widget.session, locale: locale, appointment: widget.appointment),
      if (widget.session.role == 'OTHER_PROVIDER') const SizedBox(height: 10),
      ClinicalOrdersActionButton(
        session: widget.session,
        locale: locale,
        appointment: widget.appointment,
        clinicalOrderCapabilities: widget.clinicalOrderCapabilities,
      ), const SizedBox(height: 10),
      ClinicalDocumentsActionButton(session: widget.session, locale: locale, appointment: widget.appointment),
      if (widget.session.role == 'DOCTOR' && finalized) ...[
        const SizedBox(height: 10),
        OutlinedButton.icon(onPressed: saving ? null : _addAddendum, icon: const Icon(Icons.post_add_outlined), label: Text(clinicalText(locale, 'addendum'))),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
            textDirection: locale.textDirection,
            child: ProviderFollowUpPage(session: widget.session, locale: locale, appointment: widget.appointment),
          ))),
          icon: const Icon(Icons.event_repeat_outlined),
          label: Text(clinicalText(locale, 'followUp')),
        ),
      ],
      if (_list(encounter?['addenda']).isNotEmpty) ...[
        const SizedBox(height: 16),
        _addendaSection(),
      ],
    ]),
  );

  Widget _textField(TextEditingController controller, String key, int maxLines, {String? helperText, bool required = false}) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextField(
      enabled: !finalized,
      controller: controller,
      decoration: InputDecoration(
        labelText: clinicalText(locale, key) + (required ? ' *' : ''),
        helperText: helperText,
        border: const OutlineInputBorder(),
      ),
      maxLines: maxLines,
    ),
  );
  Widget _numberField(TextEditingController controller, String key) => SizedBox(width: 170, child: TextField(enabled: !finalized, controller: controller, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: clinicalText(locale, key), border: const OutlineInputBorder())));
  Widget _summary() { final latest = _map(encounter?['latestRecord']); return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [const Icon(Icons.shield_outlined), const SizedBox(width: 8), Expanded(child: Text(clinicalText(locale, 'encrypted'), style: const TextStyle(fontWeight: FontWeight.w800))), if (finalized) Chip(label: Text(clinicalText(locale, 'finalized')))]), if (latest['revision'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${clinicalText(locale, 'revision')}: ${latest['revision']}')), if (encounter?['accessBasis'] != null) Text('${clinicalText(locale, 'accessBasis')}: ${encounter!['accessBasis']}')]))); }


  Widget _encounterTemplateSelector() {
    if (encounterTemplateError != null) {
      return Card(child: ListTile(
        leading: const Icon(Icons.error_outline),
        title: Text(encounterTemplateText(locale, 'unavailable')),
        subtitle: Text(encounterTemplateError!),
      ));
    }
    if (encounterTemplates.isEmpty) {
      return Card(child: ListTile(
        leading: const Icon(Icons.view_quilt_outlined),
        title: Text(encounterTemplateText(locale, 'title')),
        subtitle: Text(encounterTemplateText(locale, 'none')),
      ));
    }
    return Card(child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(encounterTemplateText(locale, 'title'), style: const TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        Text(encounterTemplateText(locale, 'structureOnly'), style: const TextStyle(color: Color(0xFF64748B))),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          key: const ValueKey('doctor-encounter-template-selector'),
          initialValue: selectedEncounterTemplateId,
          decoration: InputDecoration(labelText: encounterTemplateText(locale, 'select'), border: const OutlineInputBorder()),
          items: encounterTemplates.map((item) => DropdownMenuItem(
            value: item['templateVersionId']?.toString(),
            child: Text('${_localizedTemplate(item['labels'], locale, item['code']?.toString() ?? '')} · v${item['version'] ?? ''}'),
          )).toList(growable: false),
          onChanged: (value) => setState(() => selectedEncounterTemplateId = value),
        ),
        if (selectedEncounterTemplateId != null)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              key: const ValueKey('doctor-encounter-template-clear'),
              onPressed: () => setState(() => selectedEncounterTemplateId = null),
              icon: const Icon(Icons.restart_alt),
              label: Text(encounterTemplateText(locale, 'standard')),
            ),
          ),
      ]),
    ));
  }

  Map<String, dynamic>? _selectedEncounterTemplate() {
    if (selectedEncounterTemplateId == null) return null;
    for (final item in encounterTemplates) {
      if (item['templateVersionId']?.toString() == selectedEncounterTemplateId) return item;
    }
    return null;
  }

  List<Map<String, dynamic>> _templateSections() {
    final selected = _selectedEncounterTemplate();
    if (selected == null) return const [];
    return _list(_map(selected['layout'])['sections']);
  }

  List<Widget> _structuredClinicalFields() {
    const defaultOrder = ['CHIEF_COMPLAINT', 'SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'PLAN', 'VITALS'];
    final configured = _templateSections();
    final byKey = <String, Map<String, dynamic>>{};
    final order = <String>[];
    for (final section in configured) {
      final key = section['key']?.toString().toUpperCase();
      if (key == null || !defaultOrder.contains(key) || byKey.containsKey(key)) continue;
      byKey[key] = section;
      order.add(key);
    }
    for (final key in defaultOrder) {
      if (!order.contains(key)) order.add(key);
    }
    return order.map((key) {
      final section = byKey[key] ?? const <String, dynamic>{};
      if (key == 'VITALS') return _vitalsTemplateBlock(section);
      final controller = _templateController(key);
      final textKey = _templateClinicalKey(key);
      if (controller == null || textKey == null) return const SizedBox.shrink();
      return _textField(
        controller,
        textKey,
        key == 'CHIEF_COMPLAINT' ? 2 : 4,
        helperText: _localizedTemplate(section['guidanceLabels'], locale, ''),
        required: section['required'] == true,
      );
    }).toList(growable: false);
  }

  Widget _vitalsTemplateBlock(Map<String, dynamic> section) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        clinicalText(locale, 'vitals') + (section['required'] == true ? ' *' : ''),
        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
      ),
      if (_localizedTemplate(section['guidanceLabels'], locale, '').isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(_localizedTemplate(section['guidanceLabels'], locale, ''), style: const TextStyle(color: Color(0xFF64748B))),
        ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          _numberField(heartRate, 'heartRate'),
          _numberField(systolic, 'systolic'),
          _numberField(diastolic, 'diastolic'),
          _numberField(oxygen, 'oxygen'),
        ],
      ),
      const SizedBox(height: 6),
    ],
  );

  TextEditingController? _templateController(String key) => switch (key) {
    'CHIEF_COMPLAINT' => chiefComplaint,
    'SUBJECTIVE' => subjective,
    'OBJECTIVE' => objective,
    'ASSESSMENT' => assessment,
    'PLAN' => plan,
    _ => null,
  };

  String? _templateClinicalKey(String key) => switch (key) {
    'CHIEF_COMPLAINT' => 'chiefComplaint',
    'SUBJECTIVE' => 'subjective',
    'OBJECTIVE' => 'objective',
    'ASSESSMENT' => 'assessment',
    'PLAN' => 'plan',
    _ => null,
  };

  String? _missingRequiredTemplateField() {
    for (final section in _templateSections()) {
      if (section['required'] != true) continue;
      final key = section['key']?.toString().toUpperCase() ?? '';
      if (key == 'VITALS') {
        if ([heartRate, systolic, diastolic, oxygen].every((controller) => controller.text.trim().isEmpty)) return clinicalText(locale, 'vitals');
        continue;
      }
      final controller = _templateController(key);
      final textKey = _templateClinicalKey(key);
      if (controller != null && textKey != null && controller.text.trim().isEmpty) return clinicalText(locale, textKey);
    }
    return null;
  }

  Widget _addendaSection() {
    final addenda = _list(encounter?['addenda']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(clinicalText(locale, 'addenda'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      ...addenda.map((item) {
        final data = _map(item['data']);
        return Card(child: ListTile(
          leading: const Icon(Icons.verified_user_outlined),
          title: Text(data['reason']?.toString() ?? clinicalText(locale, 'addendum')),
          subtitle: Text((data['text']?.toString() ?? '') + '\n' + _dateTime(DateTime.tryParse(item['signedAt']?.toString() ?? '')?.toLocal())),
          isThreeLine: true,
        ));
      }),
    ]);
  }

  Future<void> _addAddendum() async {
    if (!finalized) return;
    final reason = TextEditingController();
    final text = TextEditingController();
    final accepted = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(clinicalText(locale, 'addendum')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: reason, maxLines: 2, decoration: InputDecoration(labelText: clinicalText(locale, 'addendumReason'), border: const OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(controller: text, maxLines: 6, decoration: InputDecoration(labelText: clinicalText(locale, 'addendumText'), border: const OutlineInputBorder())),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(cpText(locale, 'common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(cpText(locale, 'common.save'))),
      ],
    ));
    final reasonValue = reason.text.trim();
    final textValue = text.text.trim();
    reason.dispose(); text.dispose();
    if (accepted != true || reasonValue.isEmpty || textValue.isEmpty) return;
    setState(() => saving = true);
    try {
      await api.createEncounterAddendum(appointmentId, reason: reasonValue, text: textValue);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(clinicalText(locale, 'addendumSaved'))));
      await load();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> save() async {
    final missingRequired = _missingRequiredTemplateField();
    if (missingRequired != null) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${encounterTemplateText(locale, 'required')}: $missingRequired')));
      return;
    }
    final body = <String, dynamic>{}; void add(String key, TextEditingController controller) { if (controller.text.trim().isNotEmpty) body[key] = controller.text.trim(); }
    add('chiefComplaint', chiefComplaint); add('subjective', subjective); add('objective', objective); add('assessment', assessment); add('plan', plan);
    final vitals = <String, dynamic>{}; void vital(String key, TextEditingController controller) { final value = num.tryParse(controller.text.trim()); if (value != null) vitals[key] = value; }
    vital('heartRateBpm', heartRate); vital('systolicMmHg', systolic); vital('diastolicMmHg', diastolic); vital('oxygenSaturationPct', oxygen); if (vitals.isNotEmpty) body['vitals'] = vitals; if (body.isEmpty) return;
    setState(() => saving = true); try { await api.writeClinicalRecord(appointmentId, body); if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(clinicalText(locale, 'saved')))); await load(); } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); } finally { if (mounted) setState(() => saving = false); }
  }

  Future<void> finalize() async {
    final doctorSignature = widget.session.role == 'DOCTOR';
    final ok = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(clinicalText(locale, doctorSignature ? 'signFinalize' : 'finalize')),
      content: Text(clinicalText(locale, doctorSignature ? 'signFinalizePrompt' : 'finalizePrompt')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(cpText(locale, 'common.cancel'))),
        FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(clinicalText(locale, doctorSignature ? 'signFinalize' : 'finalize'))),
      ],
    ));
    if (ok != true) return;
    setState(() => saving = true);
    try {
      if (doctorSignature) await api.signClinicalEncounter(appointmentId);
      encounter = await api.finalizeClinicalEncounter(appointmentId);
      if (mounted) {
        setState(() {});
        if (doctorSignature) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(clinicalText(locale, 'signedFinalized'))));
      }
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _openQuestionnaireRequests() async {
    final patientId = _map(widget.appointment['patient'])['id']?.toString();
    if (patientId == null || patientId.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(questionnaireRequestText(locale, 'invalidAppointment'))));
      return;
    }
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: DoctorQuestionnaireRequestsPage(
        session: widget.session,
        locale: locale,
        patientId: patientId,
        appointment: widget.appointment,
      ),
    )));
  }

  Future<void> _openLabSeries() async {
    final patientId = _map(widget.appointment['patient'])['id']?.toString();
    if (patientId == null || patientId.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(doctorLabSeriesText(locale, 'missingPatient'))));
      return;
    }
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: DoctorLabSeriesPage(session: widget.session, locale: locale, patientId: patientId),
    )));
  }

  Future<void> _openOrdersCoordination() async {
    final patientId = _map(widget.appointment['patient'])['id']?.toString();
    if (patientId == null || patientId.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(doctorOrdersCoordinationText(locale, 'missingPatient'))));
      return;
    }
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: DoctorOrdersCoordinationPage(
        session: widget.session,
        locale: locale,
        patientId: patientId,
        appointmentId: appointmentId,
      ),
    )));
  }

  Future<void> _openCarePlanRpm() async {
    final patientId = _map(widget.appointment['patient'])['id']?.toString();
    if (patientId == null || patientId.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(doctorCarePlanRpmText(locale, 'missingPatient'))));
      return;
    }
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: DoctorCarePlanRpmPage(session: widget.session, locale: locale, patientId: patientId),
    )));
  }

  Future<void> _openProcedures() async {
    final patientId = _map(widget.appointment['patient'])['id']?.toString();
    if (patientId == null || patientId.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(doctorProcedureText(locale, 'missingPatient'))));
      return;
    }
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: DoctorProceduresPage(session: widget.session, locale: locale, patientId: patientId),
    )));
  }

  Future<void> _openImmunizations() async {
    final patientId = _map(widget.appointment['patient'])['id']?.toString();
    if (patientId == null || patientId.isEmpty) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(doctorImmunizationText(locale, 'missingPatient'))));
      return;
    }
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: DoctorImmunizationsPage(session: widget.session, locale: locale, patientId: patientId),
    )));
  }

  Future<void> showPatientHistory() async {
    final patientId = _map(widget.appointment['patient'])['id']?.toString(); if (patientId == null || patientId.isEmpty) return;
    try {
      final result = await api.providerClinicalTimeline(patientId); if (!mounted) return; final items = _list(result['items']);
      await showModalBottomSheet<void>(context: context, isScrollControlled: true, builder: (_) => Directionality(textDirection: locale.textDirection, child: SafeArea(child: FractionallySizedBox(heightFactor: .82, child: Column(children: [ListTile(title: Text(clinicalText(locale, 'patientHistory'), style: const TextStyle(fontWeight: FontWeight.w800)), subtitle: Text('${clinicalText(locale, 'accessBasis')}: ${result['accessBasis'] ?? ''}'), trailing: IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close))), Expanded(child: items.isEmpty ? Center(child: Text(clinicalText(locale, 'noRecords'))) : ListView.builder(itemCount: items.length, itemBuilder: (_, index) => _historyCard(items[index])))])))));
    } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); }
  }

  Widget _historyCard(Map<String, dynamic> item) { final appointment = _map(item['appointment']); final provider = _map(appointment['provider']); final service = _map(appointment['service']); final data = _map(_map(item['latestRecord'])['data']); final starts = DateTime.tryParse(appointment['startsAt']?.toString() ?? '')?.toLocal(); return Card(margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 6), child: ListTile(title: Text(service['name']?.toString() ?? clinicalText(locale, 'clinicalChart'), style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text('${provider['displayName'] ?? ''}\n${_dateTime(starts)}\n${data['assessment'] ?? data['chiefComplaint'] ?? ''}'), isThreeLine: true)); }
}

Map<String, dynamic> _map(dynamic value) { if (value is Map<String, dynamic>) return value; if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item)); return <String, dynamic>{}; }
List<Map<String, dynamic>> _list(dynamic value) { if (value is! List) return const []; return value.map(_map).toList(growable: false); }
String _dateTime(DateTime? value) => value == null ? '—' : '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

String encounterTemplateText(CarePointLocale locale, String key) {
  const values = <CarePointLocale, Map<String, String>>{
    CarePointLocale.en: {
      'title':'Encounter template','select':'Template','structureOnly':'Templates change structure and guidance only. No clinical content is inserted automatically.','standard':'Use standard SOAP','none':'No published template matches this service/specialty. Standard SOAP remains available.','unavailable':'Encounter templates unavailable','required':'Complete required template field'
    },
    CarePointLocale.ar: {
      'title':'قالب الزيارة','select':'القالب','structureOnly':'تغيّر القوالب البنية والإرشادات فقط. لا تتم إضافة أي محتوى سريري تلقائياً.','standard':'استخدام SOAP القياسي','none':'لا يوجد قالب منشور مطابق للخدمة/التخصص. يبقى SOAP القياسي متاحاً.','unavailable':'قوالب الزيارة غير متاحة','required':'أكمل الحقل المطلوب في القالب'
    },
    CarePointLocale.fr: {
      'title':'Modèle de consultation','select':'Modèle','structureOnly':'Les modèles changent uniquement la structure et les conseils. Aucun contenu clinique n’est inséré automatiquement.','standard':'Utiliser SOAP standard','none':'Aucun modèle publié ne correspond au service/spécialité. SOAP standard reste disponible.','unavailable':'Modèles de consultation indisponibles','required':'Complétez le champ obligatoire du modèle'
    },
    CarePointLocale.es: {
      'title':'Plantilla de encuentro','select':'Plantilla','structureOnly':'Las plantillas cambian solo la estructura y las guías. No insertan contenido clínico automáticamente.','standard':'Usar SOAP estándar','none':'No hay plantilla publicada para este servicio/especialidad. SOAP estándar sigue disponible.','unavailable':'Plantillas de encuentro no disponibles','required':'Completa el campo obligatorio de la plantilla'
    },
  };
  return values[locale]?[key] ?? values[CarePointLocale.en]![key] ?? key;
}

String _localizedTemplate(dynamic value, CarePointLocale locale, String fallback) {
  final map = _map(value);
  final code = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  final localized = map[code]?.toString().trim() ?? '';
  if (localized.isNotEmpty) return localized;
  final english = map['en']?.toString().trim() ?? '';
  return english.isNotEmpty ? english : fallback;
}
