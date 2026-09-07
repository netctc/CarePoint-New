import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/clinical_documents.dart';
import 'package:carepoint_mobile_core/clinical_localization.dart';
import 'package:carepoint_mobile_core/clinical_orders.dart';
import 'package:carepoint_mobile_core/revenue_cycle_localization.dart';
import 'package:carepoint_mobile_core/revenue_cycle_workspace.dart';
import 'package:flutter/material.dart';

class PatientClinicalTimelinePage extends StatefulWidget {
  const PatientClinicalTimelinePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override State<PatientClinicalTimelinePage> createState() => _PatientClinicalTimelinePageState();
}

class _PatientClinicalTimelinePageState extends State<PatientClinicalTimelinePage> {
  bool busy = true; String? error; List<Map<String, dynamic>> items = const []; List<Map<String, dynamic>> orders = const [];
  @override void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final values = await Future.wait([widget.session.api.patientClinicalTimeline(), widget.session.api.patientClinicalOrders()]);
      if (mounted) setState(() { items = _list(values[0]['items']); orders = _list(values[1]['items']); });
    } catch (value) { if (mounted) setState(() => error = value.toString()); } finally { if (mounted) setState(() => busy = false); }
  }

  @override Widget build(BuildContext context) {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null) return Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [Text(error!, textAlign: TextAlign.center), const SizedBox(height: 12), FilledButton(onPressed: load, child: Text(cpText(widget.locale, 'common.retry')))])));
    return RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.all(16), children: [
      Text(clinicalText(widget.locale, 'healthRecord'), style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900)), const SizedBox(height: 4),
      Row(children: [const Icon(Icons.lock_outline, size: 17, color: Color(0xFF10B981)), const SizedBox(width: 6), Text(clinicalText(widget.locale, 'encrypted'), style: const TextStyle(color: Color(0xFF475569)))]),
      const SizedBox(height: 12),
      OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: PatientClinicalDocumentsPage(session: widget.session, locale: widget.locale)))),
        icon: const Icon(Icons.folder_shared_outlined), label: Text(documentText(widget.locale, 'title')),
      ),
      const SizedBox(height: 8),
      OutlinedButton.icon(
        onPressed: () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: PatientRevenueCyclePage(session: widget.session, locale: widget.locale)))),
        icon: const Icon(Icons.request_quote_outlined), label: Text(revenueText(widget.locale, 'title')),
      ),
      if (items.isEmpty && orders.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text(clinicalText(widget.locale, 'noRecords'), textAlign: TextAlign.center)),
      if (items.isNotEmpty) ...[const SizedBox(height: 16), ...items.map(_clinicalCard)],
      const SizedBox(height: 22), Row(children: [const Icon(Icons.receipt_long_outlined), const SizedBox(width: 8), Expanded(child: Text(orderText(widget.locale, 'title'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900)))]), const SizedBox(height: 10),
      if (orders.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 22), child: Center(child: Text(orderText(widget.locale, 'noOrders')))) else ...orders.map(_orderCard),
    ]));
  }

  Widget _clinicalCard(Map<String, dynamic> item) {
    final appointment = _map(item['appointment']); final provider = _map(appointment['provider']); final service = _map(appointment['service']); final record = _map(item['latestRecord']); final data = _map(record['data']); final diagnoses = _list(data['diagnoses']); final starts = DateTime.tryParse(appointment['startsAt']?.toString() ?? '')?.toLocal();
    return Card(child: ExpansionTile(leading: const CircleAvatar(child: Icon(Icons.medical_services_outlined)), title: Text(service['name']?.toString() ?? clinicalText(widget.locale, 'healthRecord'), style: const TextStyle(fontWeight: FontWeight.w800)), subtitle: Text('${provider['displayName'] ?? ''} · ${_date(starts)}'), childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [_section(clinicalText(widget.locale, 'chiefComplaint'), data['chiefComplaint']), _section(clinicalText(widget.locale, 'assessment'), data['assessment']), _section(clinicalText(widget.locale, 'plan'), data['plan']), if (diagnoses.isNotEmpty) _section(clinicalText(widget.locale, 'diagnoses'), diagnoses.map((value) => value['display']).whereType<String>().join(', ')), Align(alignment: AlignmentDirectional.centerStart, child: Text('${clinicalText(widget.locale, 'revision')}: ${record['revision'] ?? '—'}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))))]));
  }

  Widget _orderCard(Map<String, dynamic> order) {
    final data = _map(order['data']); final labResult = _map(order['labResult']); final prescription = order['type'] == 'PRESCRIPTION'; final medication = _map(data['medication']); final tests = _list(data['tests']);
    final title = prescription ? (medication['name']?.toString() ?? orderText(widget.locale, 'prescription')) : (tests.isEmpty ? orderText(widget.locale, 'laboratory') : tests.map((e) => e['display']).whereType<String>().join(', '));
    return Card(child: ExpansionTile(leading: CircleAvatar(child: Icon(prescription ? Icons.medication_outlined : Icons.science_outlined)), title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)), subtitle: Text('${orderText(widget.locale, 'status')}: ${order['status'] ?? ''}'), childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: [if (data['reason'] != null) _section(orderText(widget.locale, 'reason'), data['reason']), if (prescription && data['dosageInstruction'] != null) _section(orderText(widget.locale, 'instruction'), data['dosageInstruction']), if (!prescription && labResult.isNotEmpty) ...[_section(orderText(widget.locale, 'result'), labResult['status']), if (labResult['released'] == true && labResult['data'] != null) _releasedResult(_map(labResult['data'])) else Padding(padding: const EdgeInsets.only(bottom: 8), child: Align(alignment: AlignmentDirectional.centerStart, child: Text(orderText(widget.locale, 'resultHidden'), style: const TextStyle(color: Color(0xFF64748B)))))], Align(alignment: AlignmentDirectional.centerStart, child: Row(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.verified_user_outlined, size: 16, color: Color(0xFF10B981)), const SizedBox(width: 5), Text(orderText(widget.locale, 'attested'), style: const TextStyle(fontSize: 12, color: Color(0xFF475569)))]))]));
  }

  Widget _releasedResult(Map<String, dynamic> data) { final observations = _list(data['observations']); return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [...observations.map((item) => _section(item['display']?.toString() ?? orderText(widget.locale, 'observation'), '${item['value'] ?? ''}${item['unit'] == null ? '' : ' ${item['unit']}'}')), if (data['conclusion'] != null) _section(orderText(widget.locale, 'conclusion'), data['conclusion']), Align(alignment: AlignmentDirectional.centerStart, child: Row(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.check_circle_outline, size: 16, color: Color(0xFF10B981)), const SizedBox(width: 5), Text(orderText(widget.locale, 'released'))])), const SizedBox(height: 8)]); }
  Widget _section(String label, dynamic value) { final text = value?.toString().trim() ?? ''; if (text.isEmpty) return const SizedBox.shrink(); return Padding(padding: const EdgeInsets.only(bottom: 10), child: Align(alignment: AlignmentDirectional.centerStart, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontWeight: FontWeight.w800)), const SizedBox(height: 3), Text(text)]))); }
}

Map<String, dynamic> _map(dynamic value) { if (value is Map<String, dynamic>) return value; if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item)); return <String, dynamic>{}; }
List<Map<String, dynamic>> _list(dynamic value) { if (value is! List) return const []; return value.map(_map).toList(growable: false); }
String _date(DateTime? value) => value == null ? '—' : '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
