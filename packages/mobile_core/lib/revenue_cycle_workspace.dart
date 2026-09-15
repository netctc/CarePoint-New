import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'provider_workspace.dart';
import 'revenue_cycle_localization.dart';

class PatientRevenueCyclePage extends StatefulWidget {
  const PatientRevenueCyclePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientRevenueCyclePage> createState() => _PatientRevenueCyclePageState();
}

class _PatientRevenueCyclePageState extends State<PatientRevenueCyclePage> {
  bool busy = true;
  String? error;
  Map<String, dynamic> revenue = const {};

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() { busy = true; error = null; });
    try {
      final value = await widget.session.api.patientRevenueCycle();
      if (mounted) setState(() => revenue = value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(revenueText(widget.locale, 'title')),
          actions: [IconButton(onPressed: refresh, icon: const Icon(Icons.refresh_rounded))],
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? _RevenueError(message: error!, onRetry: refresh, locale: widget.locale)
                : _patientBody(),
      );

  Widget _patientBody() {
    final claims = _list(revenue['claims']);
    final eobs = _list(revenue['eobs']);
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(revenueText(widget.locale, 'claims'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (claims.isEmpty) _empty(revenueText(widget.locale, 'noClaims'), Icons.assignment_outlined),
          ...claims.map((claim) => _ClaimCard(claim: claim, locale: widget.locale)),
          const SizedBox(height: 20),
          Text(revenueText(widget.locale, 'eob'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (eobs.isEmpty) _empty(revenueText(widget.locale, 'noEob'), Icons.description_outlined),
          ...eobs.map((eob) => _EobCard(eob: eob, locale: widget.locale)),
        ],
      ),
    );
  }
}

class ProviderWorkspaceWithRevenueCycle extends StatelessWidget {
  const ProviderWorkspaceWithRevenueCycle({
    super.key,
    required this.session,
    required this.locale,
    required this.title,
    required this.accent,
    required this.onSignOut,
    this.dark = false,
  });
  final CarePointSession session;
  final CarePointLocale locale;
  final String title;
  final Color accent;
  final VoidCallback onSignOut;
  final bool dark;

  @override
  Widget build(BuildContext context) => Stack(
        children: [
          ProviderWorkspace(session: session, locale: locale, title: title, accent: accent, onSignOut: onSignOut, dark: dark),
          PositionedDirectional(
            end: 18,
            bottom: 92,
            child: FloatingActionButton.small(
              heroTag: 'revenue-cycle-$title',
              backgroundColor: accent,
              foregroundColor: dark ? Colors.black : Colors.white,
              tooltip: revenueText(locale, 'title'),
              onPressed: () => Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (_) => Directionality(
                    textDirection: locale.textDirection,
                    child: ProviderRevenueCyclePage(session: session, locale: locale, accent: accent),
                  ),
                ),
              ),
              child: const Icon(Icons.request_quote_outlined),
            ),
          ),
        ],
      );
}

class ProviderRevenueCyclePage extends StatefulWidget {
  const ProviderRevenueCyclePage({super.key, required this.session, required this.locale, required this.accent});
  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;

  @override
  State<ProviderRevenueCyclePage> createState() => _ProviderRevenueCyclePageState();
}

class _ProviderRevenueCyclePageState extends State<ProviderRevenueCyclePage> {
  bool busy = true;
  String? error;
  Map<String, dynamic> revenue = const {};
  List<Map<String, dynamic>> appointments = const [];

  CarePointApi get api => widget.session.api;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() { busy = true; error = null; });
    try {
      final now = DateTime.now();
      final values = await Future.wait<dynamic>([
        api.providerRevenueCycle(),
        api.providerAppointments(from: now.subtract(const Duration(days: 3650)), to: now.add(const Duration(days: 60))),
      ]);
      if (!mounted) return;
      setState(() {
        revenue = _map(values[0]);
        appointments = _list(values[1]);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(revenueText(widget.locale, 'title')),
          actions: [IconButton(onPressed: refresh, icon: const Icon(Icons.refresh_rounded))],
        ),
        floatingActionButton: busy || error != null
            ? null
            : FloatingActionButton.extended(
                onPressed: _submitClaim,
                backgroundColor: widget.accent,
                icon: const Icon(Icons.add_task_outlined),
                label: Text(revenueText(widget.locale, 'submitClaim')),
              ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? _RevenueError(message: error!, onRetry: refresh, locale: widget.locale)
                : _providerBody(),
      );

  Widget _providerBody() {
    final claims = _list(revenue['claims']);
    final eobs = _list(revenue['eobs']);
    final remittances = _list(revenue['remittances']);
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          Text(revenueText(widget.locale, 'claims'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (claims.isEmpty) _empty(revenueText(widget.locale, 'noClaims'), Icons.assignment_outlined),
          ...claims.map((claim) => _providerClaimCard(claim)),
          const SizedBox(height: 20),
          Text(revenueText(widget.locale, 'eob'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (eobs.isEmpty) _empty(revenueText(widget.locale, 'noEob'), Icons.description_outlined),
          ...eobs.map((eob) => _EobCard(eob: eob, locale: widget.locale)),
          const SizedBox(height: 20),
          Text(revenueText(widget.locale, 'remittances'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          ...remittances.map((item) => Card(
                child: ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.account_balance_outlined)),
                  title: Text(_money(item['amountMinor'], item['currency']), style: const TextStyle(fontWeight: FontWeight.w800)),
                  subtitle: Text('${item['status'] ?? ''} · ${_dateTime(item['appliedAt'])}'),
                ),
              )),
        ],
      ),
    );
  }

  Widget _providerClaimCard(Map<String, dynamic> claim) {
    final status = claim['status']?.toString() ?? '';
    final terminal = status == 'PAID' || status == 'VOID';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _ClaimCard(claim: claim, locale: widget.locale, embedded: true),
          if (!terminal && status != 'DENIED') ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(onPressed: () => _refreshClaim(claim), icon: const Icon(Icons.sync_rounded), label: Text(revenueText(widget.locale, 'refreshClaim'))),
          ],
          if (status == 'DENIED') ...[
            const SizedBox(height: 8),
            FilledButton.tonalIcon(onPressed: () => _reworkClaim(claim), icon: const Icon(Icons.edit_note_outlined), label: Text(revenueText(widget.locale, 'reworkClaim'))),
          ],
        ]),
      ),
    );
  }

  Future<void> _submitClaim() async {
    final candidates = appointments.where((item) => item['status'] == 'COMPLETED').toList();
    if (candidates.isEmpty) {
      _showError(revenueText(widget.locale, 'missingCoverage'));
      return;
    }
    String appointmentId = candidates.first['id'].toString();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(builder: (_, setDialogState) => AlertDialog(
            title: Text(revenueText(widget.locale, 'submitClaim')),
            content: DropdownButtonFormField<String>(
              initialValue: appointmentId,
              decoration: InputDecoration(labelText: revenueText(widget.locale, 'selectAppointment')),
              items: candidates.map((item) => DropdownMenuItem(value: item['id'].toString(), child: Text(_appointmentLabel(item)))).toList(),
              onChanged: (value) => setDialogState(() => appointmentId = value ?? appointmentId),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: Text(revenueText(widget.locale, 'cancel'))),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(revenueText(widget.locale, 'continue'))),
            ],
          )),
    );
    if (accepted != true) return;
    try {
      final finance = await api.providerAppointmentFinance(appointmentId);
      final eligibility = _list(finance['eligibility']).where((item) => item['status'] == 'ELIGIBLE').toList();
      if (eligibility.isEmpty || eligibility.first['coverageId'] == null) {
        _showError(revenueText(widget.locale, 'missingCoverage'));
        return;
      }
      await api.submitInsuranceClaim(
        appointmentId,
        coverageId: eligibility.first['coverageId'].toString(),
        idempotencyKey: 'mobile-claim-${DateTime.now().microsecondsSinceEpoch}-$appointmentId',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(revenueText(widget.locale, 'claimSubmitted'))));
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  Future<void> _refreshClaim(Map<String, dynamic> claim) async {
    try {
      await api.refreshProviderClaim(claim['id'].toString());
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  Future<void> _reworkClaim(Map<String, dynamic> claim) async {
    final reason = TextEditingController(text: 'CORRECTED_CLAIM');
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(revenueText(widget.locale, 'reworkClaim')),
        content: TextField(controller: reason, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: revenueText(widget.locale, 'reasonCode'))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(revenueText(widget.locale, 'cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(revenueText(widget.locale, 'continue'))),
        ],
      ),
    );
    if (accepted != true) return;
    try {
      await api.reworkProviderClaim(
        claim['id'].toString(),
        idempotencyKey: 'mobile-claim-rework-${DateTime.now().microsecondsSinceEpoch}-${claim['id']}',
        reasonCode: reason.text.trim(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(revenueText(widget.locale, 'claimReworked'))));
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  void _showError(Object value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
  }
}

class _ClaimCard extends StatelessWidget {
  const _ClaimCard({required this.claim, required this.locale, this.embedded = false});
  final Map<String, dynamic> claim;
  final CarePointLocale locale;
  final bool embedded;

  @override
  Widget build(BuildContext context) {
    final content = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: Text('${revenueText(locale, 'claims')} · ${revenueText(locale, 'version')} ${claim['version'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w800))),
        Chip(label: Text(claim['status']?.toString() ?? '—'), visualDensity: VisualDensity.compact),
      ]),
      _row(revenueText(locale, 'submittedAmount'), claim['submittedAmountMinor'], claim['currency']),
      if (claim['allowedMinor'] != null) _row(revenueText(locale, 'allowed'), claim['allowedMinor'], claim['currency']),
      if (claim['insurerPaidMinor'] != null) _row(revenueText(locale, 'insurerPaid'), claim['insurerPaidMinor'], claim['currency']),
      if (claim['patientResponsibilityMinor'] != null) _row(revenueText(locale, 'patientResponsibility'), claim['patientResponsibilityMinor'], claim['currency']),
      if (claim['adjustmentMinor'] != null) _row(revenueText(locale, 'adjustment'), claim['adjustmentMinor'], claim['currency']),
      Text('${revenueText(locale, 'reconciliation')}: ${claim['reconciliationStatus'] ?? '—'}', style: const TextStyle(color: Color(0xFF64748B))),
      if (claim['denialPublicMessage'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('${revenueText(locale, 'denial')}: ${claim['denialPublicMessage']}', style: const TextStyle(color: Colors.redAccent))),
    ]);
    return embedded ? content : Card(child: Padding(padding: const EdgeInsets.all(14), child: content));
  }
}

class _EobCard extends StatelessWidget {
  const _EobCard({required this.eob, required this.locale});
  final Map<String, dynamic> eob;
  final CarePointLocale locale;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [const Icon(Icons.description_outlined), const SizedBox(width: 8), Expanded(child: Text('${eob['payerCode'] ?? ''} · ${_dateTime(eob['releasedAt'])}', style: const TextStyle(fontWeight: FontWeight.w800)))]),
            const SizedBox(height: 8),
            _row(revenueText(locale, 'submittedAmount'), eob['billedMinor'], eob['currency']),
            _row(revenueText(locale, 'allowed'), eob['allowedMinor'], eob['currency']),
            _row(revenueText(locale, 'insurerPaid'), eob['insurerPaidMinor'], eob['currency']),
            _row(revenueText(locale, 'patientResponsibility'), eob['patientResponsibilityMinor'], eob['currency']),
            _row(revenueText(locale, 'adjustment'), eob['adjustmentMinor'], eob['currency']),
            if (eob['denialPublicMessage'] != null) Text('${revenueText(locale, 'denial')}: ${eob['denialPublicMessage']}', style: const TextStyle(color: Colors.redAccent)),
          ]),
        ),
      );
}

class _RevenueError extends StatelessWidget {
  const _RevenueError({required this.message, required this.onRetry, required this.locale});
  final String message;
  final Future<void> Function() onRetry;
  final CarePointLocale locale;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.error_outline_rounded, size: 44),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh_rounded), label: Text(revenueText(locale, 'refresh'))),
          ]),
        ),
      );
}

Widget _row(String label, dynamic minor, dynamic currency) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [Expanded(child: Text(label)), Text(_money(minor, currency), style: const TextStyle(fontWeight: FontWeight.w700))]),
    );

Widget _empty(String text, IconData icon) => Padding(
      padding: const EdgeInsets.all(28),
      child: Column(children: [Icon(icon, size: 42, color: const Color(0xFF94A3B8)), const SizedBox(height: 10), Text(text, textAlign: TextAlign.center)]),
    );

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

int _minor(dynamic value) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;
String _money(dynamic minor, dynamic currency) => '${(_minor(minor) / 100).toStringAsFixed(2)} ${currency ?? ''}';
String _dateTime(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '—';
  return '${parsed.year.toString().padLeft(4, '0')}-${parsed.month.toString().padLeft(2, '0')}-${parsed.day.toString().padLeft(2, '0')} ${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
}

String _appointmentLabel(Map<String, dynamic> item) {
  final service = _map(item['service']);
  final patient = _map(item['patient']);
  final name = [patient['firstName'], patient['lastName']].whereType<String>().where((value) => value.isNotEmpty).join(' ');
  final serviceName = service['name']?.toString() ?? item['modality']?.toString() ?? 'Appointment';
  return name.isEmpty ? serviceName : '$name · $serviceName';
}
