import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'clinical_documents.dart';
import 'clinical_localization.dart';
import 'clinical_orders.dart';

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
  CarePointApi get api => widget.session.api; CarePointLocale get locale => widget.locale; String get appointmentId => widget.appointment['id'].toString(); bool get finalized => encounter?['finalized'] == true;

  @override void initState() { super.initState(); load(); }
  @override void dispose() { chiefComplaint.dispose(); subjective.dispose(); objective.dispose(); assessment.dispose(); plan.dispose(); heartRate.dispose(); systolic.dispose(); diastolic.dispose(); oxygen.dispose(); super.dispose(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final next = await api.clinicalEncounter(appointmentId); final data = _map(_map(next['latestRecord'])['data']); final vitals = _map(data['vitals']);
      chiefComplaint.text = data['chiefComplaint']?.toString() ?? ''; subjective.text = data['subjective']?.toString() ?? ''; objective.text = data['objective']?.toString() ?? ''; assessment.text = data['assessment']?.toString() ?? ''; plan.text = data['plan']?.toString() ?? '';
      heartRate.text = vitals['heartRateBpm']?.toString() ?? ''; systolic.text = vitals['systolicMmHg']?.toString() ?? ''; diastolic.text = vitals['diastolicMmHg']?.toString() ?? ''; oxygen.text = vitals['oxygenSaturationPct']?.toString() ?? '';
      if (mounted) setState(() => encounter = next);
    } catch (value) { if (mounted) setState(() => error = value.toString()); } finally { if (mounted) setState(() => busy = false); }
  }

  @override Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(clinicalText(locale, 'clinicalChart'))),
    body: busy ? const Center(child: CircularProgressIndicator()) : error != null ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center))) : ListView(padding: const EdgeInsets.all(16), children: [
      _summary(), const SizedBox(height: 12), _textField(chiefComplaint, 'chiefComplaint', 2), _textField(subjective, 'subjective', 4), _textField(objective, 'objective', 4), _textField(assessment, 'assessment', 4), _textField(plan, 'plan', 4), const SizedBox(height: 6),
      Text(clinicalText(locale, 'vitals'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)), const SizedBox(height: 8),
      Wrap(spacing: 10, runSpacing: 10, children: [_numberField(heartRate, 'heartRate'), _numberField(systolic, 'systolic'), _numberField(diastolic, 'diastolic'), _numberField(oxygen, 'oxygen')]), const SizedBox(height: 18),
      if (!finalized) FilledButton.icon(onPressed: saving ? null : save, icon: const Icon(Icons.lock_outline), label: Text(clinicalText(locale, 'saveRevision'))), if (!finalized) const SizedBox(height: 10),
      if (!finalized) OutlinedButton.icon(onPressed: saving ? null : finalize, icon: const Icon(Icons.task_alt), label: Text(clinicalText(locale, 'finalize'))), const SizedBox(height: 10),
      OutlinedButton.icon(onPressed: showPatientHistory, icon: const Icon(Icons.history), label: Text(clinicalText(locale, 'patientHistory'))), const SizedBox(height: 10),
      ClinicalOrdersActionButton(
        session: widget.session,
        locale: locale,
        appointment: widget.appointment,
        clinicalOrderCapabilities: widget.clinicalOrderCapabilities,
      ), const SizedBox(height: 10),
      ClinicalDocumentsActionButton(session: widget.session, locale: locale, appointment: widget.appointment),
    ]),
  );

  Widget _textField(TextEditingController controller, String key, int maxLines) => Padding(padding: const EdgeInsets.only(bottom: 12), child: TextField(enabled: !finalized, controller: controller, decoration: InputDecoration(labelText: clinicalText(locale, key), border: const OutlineInputBorder()), maxLines: maxLines));
  Widget _numberField(TextEditingController controller, String key) => SizedBox(width: 170, child: TextField(enabled: !finalized, controller: controller, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: clinicalText(locale, key), border: const OutlineInputBorder())));
  Widget _summary() { final latest = _map(encounter?['latestRecord']); return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(children: [const Icon(Icons.shield_outlined), const SizedBox(width: 8), Expanded(child: Text(clinicalText(locale, 'encrypted'), style: const TextStyle(fontWeight: FontWeight.w800))), if (finalized) Chip(label: Text(clinicalText(locale, 'finalized')))]), if (latest['revision'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${clinicalText(locale, 'revision')}: ${latest['revision']}')), if (encounter?['accessBasis'] != null) Text('${clinicalText(locale, 'accessBasis')}: ${encounter!['accessBasis']}')]))); }

  Future<void> save() async {
    final body = <String, dynamic>{}; void add(String key, TextEditingController controller) { if (controller.text.trim().isNotEmpty) body[key] = controller.text.trim(); }
    add('chiefComplaint', chiefComplaint); add('subjective', subjective); add('objective', objective); add('assessment', assessment); add('plan', plan);
    final vitals = <String, dynamic>{}; void vital(String key, TextEditingController controller) { final value = num.tryParse(controller.text.trim()); if (value != null) vitals[key] = value; }
    vital('heartRateBpm', heartRate); vital('systolicMmHg', systolic); vital('diastolicMmHg', diastolic); vital('oxygenSaturationPct', oxygen); if (vitals.isNotEmpty) body['vitals'] = vitals; if (body.isEmpty) return;
    setState(() => saving = true); try { await api.writeClinicalRecord(appointmentId, body); if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(clinicalText(locale, 'saved')))); await load(); } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); } finally { if (mounted) setState(() => saving = false); }
  }

  Future<void> finalize() async {
    final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(title: Text(clinicalText(locale, 'finalize')), content: Text(clinicalText(locale, 'finalizePrompt')), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(clinicalText(locale, 'finalize')))]));
    if (ok != true) return; setState(() => saving = true); try { encounter = await api.finalizeClinicalEncounter(appointmentId); if (mounted) setState(() {}); } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); } finally { if (mounted) setState(() => saving = false); }
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
