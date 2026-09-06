import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/clinical_localization.dart';
import 'package:flutter/material.dart';

class PatientClinicalTimelinePage extends StatefulWidget {
  const PatientClinicalTimelinePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientClinicalTimelinePage> createState() => _PatientClinicalTimelinePageState();
}

class _PatientClinicalTimelinePageState extends State<PatientClinicalTimelinePage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  @override
  void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final result = await widget.session.api.patientClinicalTimeline();
      if (mounted) setState(() => items = _list(result['items']));
    } catch (value) { if (mounted) setState(() => error = value.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(error!, textAlign: TextAlign.center), const SizedBox(height: 12), FilledButton(onPressed: load, child: const Text('Retry'))])));
    if (items.isEmpty) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(clinicalText(widget.locale, 'noRecords'), textAlign: TextAlign.center)));
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        Text(clinicalText(widget.locale, 'healthRecord'), style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        Row(children: [const Icon(Icons.lock_outline, size: 17, color: Color(0xFF10B981)), const SizedBox(width: 6), Text(clinicalText(widget.locale, 'encrypted'), style: const TextStyle(color: Color(0xFF475569)))]),
        const SizedBox(height: 14),
        ...items.map(_card),
      ]),
    );
  }

  Widget _card(Map<String, dynamic> item) {
    final appointment = _map(item['appointment']);
    final provider = _map(appointment['provider']);
    final service = _map(appointment['service']);
    final record = _map(item['latestRecord']);
    final data = _map(record['data']);
    final diagnoses = _list(data['diagnoses']);
    final starts = DateTime.tryParse(appointment['startsAt']?.toString() ?? '')?.toLocal();
    return Card(child: ExpansionTile(
      leading: const CircleAvatar(child: Icon(Icons.clinical_notes_outlined)),
      title: Text(service['name']?.toString() ?? clinicalText(widget.locale, 'healthRecord'), style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text('${provider['displayName'] ?? ''} · ${_date(starts)}'),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        _section(clinicalText(widget.locale, 'chiefComplaint'), data['chiefComplaint']),
        _section(clinicalText(widget.locale, 'assessment'), data['assessment']),
        _section(clinicalText(widget.locale, 'plan'), data['plan']),
        if (diagnoses.isNotEmpty) _section(clinicalText(widget.locale, 'diagnoses'), diagnoses.map((value) => value['display']).whereType<String>().join(', ')),
        Align(alignment: AlignmentDirectional.centerStart, child: Text('${clinicalText(widget.locale, 'revision')}: ${record['revision'] ?? '—'}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)))),
      ],
    ));
  }

  Widget _section(String label, dynamic value) {
    final text = value?.toString().trim() ?? '';
    if (text.isEmpty) return const SizedBox.shrink();
    return Padding(padding: const EdgeInsets.only(bottom: 10), child: Align(alignment: AlignmentDirectional.centerStart, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 3), Text(text)])));
  }
}

Map<String, dynamic> _map(dynamic value) { if (value is Map<String, dynamic>) return value; if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item)); return <String, dynamic>{}; }
List<Map<String, dynamic>> _list(dynamic value) { if (value is! List) return const []; return value.map(_map).toList(growable: false); }
String _date(DateTime? value) => value == null ? '—' : '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
