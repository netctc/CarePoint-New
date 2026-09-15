import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'patient_consents_localization.dart';

class PatientConsentLifecyclePage extends StatefulWidget {
  const PatientConsentLifecyclePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<PatientConsentLifecyclePage> createState() => _PatientConsentLifecyclePageState();
}

class _PatientConsentLifecyclePageState extends State<PatientConsentLifecyclePage> {
  List<Map<String, dynamic>> rows = const [];
  bool loading = false;
  String? busyId, error;
  bool get allowed => widget.session.role == 'PATIENT';
  String t(String key) => patientConsentText(widget.locale, key);
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    if (!allowed) return;
    setState(() { loading = true; error = null; });
    try {
      final value = await widget.session.api.patientConsents().timeout(const Duration(seconds: 30));
      if (mounted) setState(() => rows = value);
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<bool> confirm(String body) async => await showDialog<bool>(context: context, barrierDismissible: false, builder: (_) => Directionality(
    textDirection: widget.locale.textDirection,
    child: AlertDialog(title: Text(t('title')), content: Text(body), actions: [
      TextButton(onPressed: () => Navigator.pop(context, false), child: Text(t('cancel'))),
      FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(t('confirm'))),
    ]),
  )) == true;
  Future<void> act(Map<String, dynamic> row, {required bool regrant}) async {
    final id = row['id']?.toString() ?? '';
    if (id.isEmpty || busyId != null) return;
    if (!await confirm(t(regrant ? 'regrantConfirm' : 'revokeConfirm'))) return;
    setState(() => busyId = id);
    try {
      if (regrant) { await widget.session.api.regrantPatientConsent(id); }
      else { await widget.session.api.revokePatientConsent(id); }
      await load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally { if (mounted) setState(() => busyId = null); }
  }
  String date(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (parsed == null) return '-';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(parsed.day)}/${two(parsed.month)}/${parsed.year}';
  }
  String state(Map<String, dynamic> row) {
    final key = (row['effectiveState'] ?? row['state'] ?? '').toString();
    return switch (key) { 'GRANTED' => t('granted'), 'REVOKED' => t('revoked'), 'EXPIRED' => t('expired'), _ => key };
  }
  @override
  Widget build(BuildContext context) => Directionality(textDirection: widget.locale.textDirection, child: Scaffold(
    appBar: AppBar(title: Text(t('title'))),
    body: !allowed ? Center(child: Text(t('denied'))) : RefreshIndicator(
      onRefresh: load,
      child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
        Text(t('subtitle')),
        const SizedBox(height: 12),
        if (loading) const LinearProgressIndicator(),
        if (error != null) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [Text(error!), TextButton(onPressed: load, child: Text(t('refresh')))]))),
        if (!loading && error == null && rows.isEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 32), child: Text(t('empty'), textAlign: TextAlign.center)),
        for (final row in rows) _card(row),
      ]),
    ),
  ));
  Widget _card(Map<String, dynamic> row) {
    final effective = (row['effectiveState'] ?? row['state']).toString();
    final regrantable = row['regrantable'] == true;
    final id = row['id']?.toString() ?? '';
    final busy = busyId == id;
    return Card(key: ValueKey('consent-$id'), child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [Expanded(child: Text(row['scope']?.toString() ?? '', style: Theme.of(context).textTheme.titleMedium)), Chip(label: Text(state(row)))]),
      Text('${t('version')}: ${row['version'] ?? '-'}'),
      Text('${t('provider')}: ${row['providerName'] ?? t('allCare')}'),
      Text('${t('grantedAt')}: ${date(row['grantedAt'])}'),
      Text(row['expiresAt'] == null ? t('noExpiry') : '${t('expiresAt')}: ${date(row['expiresAt'])}'),
      if (effective == 'EXPIRED') Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('expiredHint'))),
      if (effective == 'REVOKED' && !regrantable) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t('notRegrantable'))),
      const SizedBox(height: 8),
      if (busy) const LinearProgressIndicator(),
      if (effective == 'GRANTED') OutlinedButton(onPressed: busy ? null : () => act(row, regrant: false), child: Text(t('revoke'))),
      if (effective == 'REVOKED' && regrantable) FilledButton(onPressed: busy ? null : () => act(row, regrant: true), child: Text(t('regrant'))),
    ])));
  }
}
