import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'financial_localization.dart';

Uri? secureHostedPaymentUri(dynamic value) {
  final uri = Uri.tryParse(value?.toString() ?? '');
  if (uri == null || uri.scheme.toLowerCase() != 'https' || uri.host.isEmpty) return null;
  return uri;
}

class PatientFinancialWorkspace extends StatefulWidget {
  const PatientFinancialWorkspace({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientFinancialWorkspace> createState() => _PatientFinancialWorkspaceState();
}

class _PatientFinancialWorkspaceState extends State<PatientFinancialWorkspace> {
  bool busy = true;
  String? error;
  Map<String, dynamic> billing = const {};
  Map<String, dynamic> activity = const {};
  List<Map<String, dynamic>> coverages = const [];
  List<Map<String, dynamic>> appointments = const [];

  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final values = await Future.wait<dynamic>([
        api.patientBilling(),
        api.patientInsuranceCoverages(),
        api.insuranceActivity(),
        api.myAppointments(),
      ]);
      if (!mounted) return;
      setState(() {
        billing = _map(values[0]);
        coverages = _list(values[1]);
        activity = _map(values[2]);
        appointments = _list(values[3]);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null) return _FinancialError(message: error!, onRetry: refresh, locale: locale);
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: Row(
              children: [
                Expanded(
                  child: TabBar(tabs: [
                    Tab(icon: const Icon(Icons.receipt_long_outlined), text: financeText(locale, 'billing')),
                    Tab(icon: const Icon(Icons.shield_outlined), text: financeText(locale, 'insurance')),
                  ]),
                ),
                IconButton(onPressed: refresh, icon: const Icon(Icons.refresh_rounded), tooltip: financeText(locale, 'refresh')),
              ],
            ),
          ),
          Expanded(child: TabBarView(children: [_billingView(), _insuranceView()])),
        ],
      ),
    );
  }

  Widget _billingView() {
    final invoices = _list(billing['invoices']);
    final receipts = _list(billing['receipts']);
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _SecurityNotice(locale: locale),
          const SizedBox(height: 16),
          _sectionTitle(financeText(locale, 'invoices')),
          if (invoices.isEmpty) _empty(financeText(locale, 'noInvoices'), Icons.receipt_long_outlined),
          ...invoices.map(_invoiceCard),
          const SizedBox(height: 18),
          _sectionTitle(financeText(locale, 'receipts')),
          if (receipts.isEmpty) _empty(financeText(locale, 'noReceipts'), Icons.receipt_outlined),
          ...receipts.map((receipt) => Card(
                child: ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.check_rounded)),
                  title: Text(receipt['number']?.toString() ?? 'Receipt', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${_money(receipt['amountMinor'], receipt['currency'])}\n${_dateTime(receipt['issuedAt'])}'),
                  isThreeLine: true,
                ),
              )),
        ],
      ),
    );
  }

  Widget _invoiceCard(Map<String, dynamic> invoice) {
    final status = invoice['status']?.toString() ?? '';
    final balance = _minor(invoice['balanceDueMinor']);
    final pending = _list(billing['paymentIntents']).where((item) {
      if (item['invoiceId']?.toString() != invoice['id']?.toString()) return false;
      final state = item['status']?.toString();
      return state == 'PENDING' || state == 'PROCESSING' || state == 'REQUIRES_ACTION';
    }).toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(invoice['number']?.toString() ?? 'Invoice', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            _StatusChip(status: status),
          ]),
          const SizedBox(height: 12),
          _moneyRow(financeText(locale, 'total'), invoice['totalMinor'], invoice['currency']),
          _moneyRow(financeText(locale, 'patientShare'), invoice['patientResponsibilityMinor'], invoice['currency']),
          _moneyRow(financeText(locale, 'insurerShare'), invoice['insurerResponsibilityMinor'], invoice['currency']),
          _moneyRow(financeText(locale, 'paid'), invoice['amountPaidMinor'], invoice['currency']),
          _moneyRow(financeText(locale, 'balance'), invoice['balanceDueMinor'], invoice['currency'], emphasize: true),
          if (balance > 0 && status != 'VOID' && status != 'REFUNDED') ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => _pay(invoice),
              icon: const Icon(Icons.lock_outline),
              label: Text(financeText(locale, 'payNow')),
            ),
          ],
          if (pending.isNotEmpty) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => _checkPayment(pending.first),
              icon: const Icon(Icons.sync_rounded),
              label: Text(financeText(locale, 'checkPayment')),
            ),
          ],
        ]),
      ),
    );
  }

  Future<void> _pay(Map<String, dynamic> invoice) async {
    try {
      final result = await api.createPaymentIntent(
        invoice['id'].toString(),
        idempotencyKey: 'mobile-pay-${DateTime.now().microsecondsSinceEpoch}-${invoice['id']}',
        amountMinor: _minor(invoice['balanceDueMinor']),
      );
      if (!mounted) return;
      if (result['status'] == 'SUCCEEDED') {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(financeText(locale, 'paymentSettled'))));
        await refresh();
        return;
      }
      final uri = secureHostedPaymentUri(result['actionUrl']);
      if (uri != null) {
        await _showHostedPayment(result, uri);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(financeText(locale, 'paymentPending'))));
      }
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  Future<void> _showHostedPayment(Map<String, dynamic> intent, Uri uri) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Icon(Icons.verified_user_outlined, size: 42),
            const SizedBox(height: 12),
            Text(financeText(locale, 'openSecurePayment'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Text(financeText(locale, 'hostedNotice')),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: () async {
                final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
                if (!opened && mounted) _showError(financeText(locale, 'invalidHostedUrl'));
              },
              icon: const Icon(Icons.open_in_new_rounded),
              label: Text(financeText(locale, 'openSecurePayment')),
            ),
            TextButton(
              onPressed: () async {
                Navigator.pop(sheetContext);
                await _checkPayment(intent);
              },
              child: Text(financeText(locale, 'checkPayment')),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _checkPayment(Map<String, dynamic> intent) async {
    try {
      final result = await api.refreshPaymentIntent(intent['id'].toString());
      if (!mounted) return;
      final settled = result['status'] == 'SUCCEEDED';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(financeText(locale, settled ? 'paymentSettled' : 'paymentPending'))));
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  Widget _insuranceView() {
    final eligibility = _list(activity['eligibility']);
    final priorAuthorizations = _list(activity['priorAuthorizations']);
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          Row(children: [
            Expanded(child: _sectionTitle(financeText(locale, 'coverages'))),
            FilledButton.tonalIcon(onPressed: _addCoverage, icon: const Icon(Icons.add), label: Text(financeText(locale, 'addCoverage'))),
          ]),
          if (coverages.isEmpty) _empty(financeText(locale, 'noCoverage'), Icons.shield_outlined),
          ...coverages.map(_coverageCard),
          const SizedBox(height: 18),
          _sectionTitle(financeText(locale, 'activity')),
          ...eligibility.map((item) => Card(child: ListTile(
                leading: const Icon(Icons.fact_check_outlined),
                title: Text('${financeText(locale, 'eligibility')} · ${item['status'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${_money(item['estimatedPatientMinor'], item['currency'])} ${financeText(locale, 'patientShare')}\n${_dateTime(item['checkedAt'])}'),
                isThreeLine: true,
              ))),
          ...priorAuthorizations.map((item) => Card(child: ListTile(
                leading: const Icon(Icons.approval_outlined),
                title: Text('${financeText(locale, 'priorAuthorization')} · ${item['status'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text(_dateTime(item['createdAt'])),
              ))),
          if (eligibility.isEmpty && priorAuthorizations.isEmpty) _empty(financeText(locale, 'noLedger'), Icons.history_rounded),
        ],
      ),
    );
  }

  Widget _coverageCard(Map<String, dynamic> coverage) {
    final active = coverage['status'] == 'ACTIVE';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(coverage['displayLabel']?.toString().trim().isNotEmpty == true ? coverage['displayLabel'].toString() : coverage['payerName']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
            _StatusChip(status: coverage['status']?.toString() ?? ''),
          ]),
          const SizedBox(height: 6),
          Text('${coverage['payerName'] ?? ''} · ${coverage['payerCode'] ?? ''}'),
          if (coverage['effectiveFrom'] != null || coverage['effectiveUntil'] != null)
            Text('${_dateOnly(coverage['effectiveFrom'])} — ${_dateOnly(coverage['effectiveUntil'])}', style: const TextStyle(color: Color(0xFF64748B))),
          const SizedBox(height: 12),
          if (active) Wrap(spacing: 8, runSpacing: 8, children: [
            FilledButton.tonalIcon(onPressed: () => _checkEligibility(coverage), icon: const Icon(Icons.fact_check_outlined), label: Text(financeText(locale, 'checkEligibility'))),
            OutlinedButton(onPressed: () => _deactivateCoverage(coverage), child: Text(financeText(locale, 'deactivate'))),
          ]),
        ]),
      ),
    );
  }

  Future<void> _addCoverage() async {
    final payerCode = TextEditingController();
    final payerName = TextEditingController();
    final policyRef = TextEditingController();
    final displayLabel = TextEditingController();
    final effectiveFrom = TextEditingController();
    final effectiveUntil = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(financeText(locale, 'addCoverage')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: payerCode, decoration: InputDecoration(labelText: financeText(locale, 'payerCode'))),
          TextField(controller: payerName, decoration: InputDecoration(labelText: financeText(locale, 'payerName'))),
          TextField(controller: policyRef, decoration: InputDecoration(labelText: financeText(locale, 'policyReference'), helperText: financeText(locale, 'policyHelp'))),
          TextField(controller: displayLabel, decoration: InputDecoration(labelText: financeText(locale, 'displayLabel'))),
          TextField(controller: effectiveFrom, decoration: InputDecoration(labelText: financeText(locale, 'effectiveFrom'))),
          TextField(controller: effectiveUntil, decoration: InputDecoration(labelText: financeText(locale, 'effectiveUntil'))),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(financeText(locale, 'cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(financeText(locale, 'save'))),
        ],
      ),
    );
    if (accepted != true) return;
    try {
      await api.createInsuranceCoverage(
        payerCode: payerCode.text.trim(),
        payerName: payerName.text.trim(),
        externalPolicyRef: policyRef.text.trim(),
        displayLabel: displayLabel.text.trim(),
        effectiveFrom: effectiveFrom.text.trim(),
        effectiveUntil: effectiveUntil.text.trim(),
      );
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  Future<void> _deactivateCoverage(Map<String, dynamic> coverage) async {
    try {
      await api.deactivateInsuranceCoverage(coverage['id'].toString());
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  Future<void> _checkEligibility(Map<String, dynamic> coverage) async {
    final candidates = appointments.where((item) => item['status'] != 'CANCELLED').toList();
    if (candidates.isEmpty) {
      _showError(financeText(locale, 'noEligibleAppointment'));
      return;
    }
    String appointmentId = candidates.first['id'].toString();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(builder: (_, setDialogState) => AlertDialog(
            title: Text(financeText(locale, 'checkEligibility')),
            content: DropdownButtonFormField<String>(
              initialValue: appointmentId,
              decoration: InputDecoration(labelText: financeText(locale, 'selectAppointment')),
              items: candidates.map((item) => DropdownMenuItem(value: item['id'].toString(), child: Text(_appointmentLabel(item)))).toList(),
              onChanged: (value) => setDialogState(() => appointmentId = value ?? appointmentId),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: Text(financeText(locale, 'cancel'))),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(financeText(locale, 'checkEligibility'))),
            ],
          )),
    );
    if (accepted != true) return;
    try {
      final result = await api.checkInsuranceEligibility(
        appointmentId,
        coverageId: coverage['id'].toString(),
        idempotencyKey: 'mobile-eligibility-${DateTime.now().microsecondsSinceEpoch}-$appointmentId',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${financeText(locale, 'eligibility')}: ${result['status'] ?? ''}')));
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  void _showError(Object value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
  }

  Widget _sectionTitle(String value) => Text(value, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900));
}

class ProviderFinancialWorkspace extends StatefulWidget {
  const ProviderFinancialWorkspace({super.key, required this.session, required this.locale, required this.accent});
  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;

  @override
  State<ProviderFinancialWorkspace> createState() => _ProviderFinancialWorkspaceState();
}

class _ProviderFinancialWorkspaceState extends State<ProviderFinancialWorkspace> {
  bool busy = true;
  String? error;
  Map<String, dynamic> summary = const {};
  List<Map<String, dynamic>> ledger = const [];
  List<Map<String, dynamic>> appointments = const [];

  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final now = DateTime.now();
      final values = await Future.wait<dynamic>([
        api.providerFinanceSummary(),
        api.providerFinanceLedger(),
        api.providerAppointments(from: now.subtract(const Duration(days: 30)), to: now.add(const Duration(days: 60))),
      ]);
      if (!mounted) return;
      setState(() {
        summary = _map(values[0]);
        ledger = _list(values[1]);
        appointments = _list(values[2]);
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null) return _FinancialError(message: error!, onRetry: refresh, locale: locale);
    final balances = _map(summary['availableBalanceMinorByCurrency']);
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          Row(children: [
            Expanded(child: Text(financeText(locale, 'financialSummary'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900))),
            IconButton(onPressed: refresh, icon: const Icon(Icons.refresh_rounded)),
          ]),
          const SizedBox(height: 10),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(financeText(locale, 'availableBalance'), style: const TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 10),
                if (balances.isEmpty) const Text('—')
                else Wrap(spacing: 8, runSpacing: 8, children: balances.entries.map((entry) => Chip(avatar: const Icon(Icons.account_balance_wallet_outlined, size: 18), label: Text(_money(entry.value, entry.key)))).toList()),
              ]),
            ),
          ),
          const SizedBox(height: 18),
          Text(financeText(locale, 'appointmentFinance'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (appointments.isEmpty) _empty(financeText(locale, 'noEligibleAppointment'), Icons.event_busy_outlined),
          ...appointments.take(20).map((item) => Card(
                child: ListTile(
                  leading: CircleAvatar(backgroundColor: widget.accent.withValues(alpha: .15), child: Icon(Icons.payments_outlined, color: widget.accent)),
                  title: Text(_appointmentLabel(item), style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('${item['status'] ?? ''} · ${item['modality'] ?? ''}'),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => _showAppointmentFinance(item),
                ),
              )),
          const SizedBox(height: 18),
          Text(financeText(locale, 'ledger'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 8),
          if (ledger.isEmpty) _empty(financeText(locale, 'noLedger'), Icons.account_balance_outlined),
          ...ledger.map(_ledgerCard),
        ],
      ),
    );
  }

  Widget _ledgerCard(Map<String, dynamic> entry) {
    final type = entry['type']?.toString() ?? '';
    final amount = _minor(entry['amountMinor']);
    final refundable = type == 'CHARGE' && entry['paymentIntentId'] != null && amount > 0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(type, style: const TextStyle(fontWeight: FontWeight.w800))),
            Text(_money(amount, entry['currency']), style: TextStyle(fontWeight: FontWeight.w900, color: amount < 0 ? Colors.redAccent : null)),
          ]),
          if (entry['reference'] != null) Text('${financeText(locale, 'reference')}: ${entry['reference']}', style: const TextStyle(color: Color(0xFF64748B))),
          Text(_dateTime(entry['createdAt']), style: const TextStyle(color: Color(0xFF64748B))),
          if (refundable) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(onPressed: () => _refund(entry), icon: const Icon(Icons.undo_rounded), label: Text(financeText(locale, 'refundCharge'))),
          ],
        ]),
      ),
    );
  }

  Future<void> _showAppointmentFinance(Map<String, dynamic> appointment) async {
    try {
      final finance = await api.providerAppointmentFinance(appointment['id'].toString());
      if (!mounted) return;
      final invoice = _map(finance['invoice']);
      final snapshot = _map(finance['pricingSnapshot']);
      final eligibility = _list(finance['eligibility']);
      final prior = _list(finance['priorAuthorizations']);
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (sheetContext) => SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(22),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(financeText(locale, 'appointmentFinance'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900)),
              const SizedBox(height: 12),
              Text(_appointmentLabel(appointment), style: const TextStyle(fontWeight: FontWeight.w700)),
              if (snapshot.isNotEmpty) Text('${financeText(locale, 'total')}: ${_money(snapshot['totalMinor'], snapshot['currency'])}'),
              if (invoice.isNotEmpty) ...[
                const SizedBox(height: 8),
                Row(children: [Expanded(child: Text(invoice['number']?.toString() ?? '')), _StatusChip(status: invoice['status']?.toString() ?? '')]),
                _moneyRow(financeText(locale, 'patientShare'), invoice['patientResponsibilityMinor'], invoice['currency']),
                _moneyRow(financeText(locale, 'insurerShare'), invoice['insurerResponsibilityMinor'], invoice['currency']),
                _moneyRow(financeText(locale, 'paid'), invoice['amountPaidMinor'], invoice['currency']),
              ],
              const SizedBox(height: 14),
              Text(financeText(locale, 'eligibility'), style: const TextStyle(fontWeight: FontWeight.w800)),
              if (eligibility.isEmpty) const Text('—')
              else ...eligibility.take(5).map((item) => ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.fact_check_outlined), title: Text(item['status']?.toString() ?? ''), subtitle: Text(_dateTime(item['checkedAt'])))),
              const SizedBox(height: 8),
              Text(financeText(locale, 'priorAuthorization'), style: const TextStyle(fontWeight: FontWeight.w800)),
              if (prior.isEmpty) const Text('—')
              else ...prior.take(5).map((item) => ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.approval_outlined), title: Text(item['status']?.toString() ?? ''), subtitle: Text(_dateTime(item['createdAt'])))),
              if (eligibility.isNotEmpty) ...[
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () async {
                    Navigator.pop(sheetContext);
                    await _requestPriorAuthorization(appointment, eligibility.first);
                  },
                  icon: const Icon(Icons.approval_outlined),
                  label: Text(financeText(locale, 'requestPriorAuthorization')),
                ),
              ],
              const SizedBox(height: 8),
              TextButton(onPressed: () => Navigator.pop(sheetContext), child: Text(financeText(locale, 'close'))),
            ]),
          ),
        ),
      );
    } catch (value) {
      _showError(value);
    }
  }

  Future<void> _requestPriorAuthorization(Map<String, dynamic> appointment, Map<String, dynamic> eligibility) async {
    final coverageId = eligibility['coverageId']?.toString();
    if (coverageId == null || coverageId.isEmpty) {
      _showError('Missing coverage reference.');
      return;
    }
    try {
      await api.requestPriorAuthorization(
        appointment['id'].toString(),
        coverageId: coverageId,
        eligibilityCheckId: eligibility['id']?.toString(),
        idempotencyKey: 'mobile-prior-auth-${DateTime.now().microsecondsSinceEpoch}-${appointment['id']}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(financeText(locale, 'priorAuthSubmitted'))));
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  Future<void> _refund(Map<String, dynamic> entry) async {
    final amount = TextEditingController(text: _minor(entry['amountMinor']).toString());
    final reason = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(financeText(locale, 'refundCharge')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: amount, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: financeText(locale, 'amountMinor'))),
          TextField(controller: reason, maxLength: 500, decoration: InputDecoration(labelText: financeText(locale, 'reason'))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(financeText(locale, 'cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(financeText(locale, 'refund'))),
        ],
      ),
    );
    if (accepted != true) return;
    try {
      await api.refundProviderPayment(
        entry['paymentIntentId'].toString(),
        amountMinor: int.parse(amount.text.trim()),
        idempotencyKey: 'mobile-refund-${DateTime.now().microsecondsSinceEpoch}-${entry['paymentIntentId']}',
        reason: reason.text.trim(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(financeText(locale, 'refundSubmitted'))));
      await refresh();
    } catch (value) {
      _showError(value);
    }
  }

  void _showError(Object value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
  }
}

class _SecurityNotice extends StatelessWidget {
  const _SecurityNotice({required this.locale});
  final CarePointLocale locale;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Theme.of(context).colorScheme.primary.withValues(alpha: .30)),
          color: Theme.of(context).colorScheme.primary.withValues(alpha: .06),
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.lock_outline),
          const SizedBox(width: 10),
          Expanded(child: Text(financeText(locale, 'hostedNotice'))),
        ]),
      );
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) => Chip(label: Text(status.isEmpty ? '—' : status), visualDensity: VisualDensity.compact);
}

class _FinancialError extends StatelessWidget {
  const _FinancialError({required this.message, required this.onRetry, required this.locale});
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
            FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh_rounded), label: Text(financeText(locale, 'refresh'))),
          ]),
        ),
      );
}

Widget _moneyRow(String label, dynamic minor, dynamic currency, {bool emphasize = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [
        Expanded(child: Text(label)),
        Text(_money(minor, currency), style: TextStyle(fontWeight: emphasize ? FontWeight.w900 : FontWeight.w600)),
      ]),
    );

Widget _empty(String text, IconData icon) => Padding(
      padding: const EdgeInsets.all(28),
      child: Column(children: [Icon(icon, size: 42, color: const Color(0xFF94A3B8)), const SizedBox(height: 10), Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B)))]),
    );

String _appointmentLabel(Map<String, dynamic> item) {
  final service = _map(item['service']);
  final patient = _map(item['patient']);
  final provider = _map(item['provider']);
  final patientName = [patient['firstName'], patient['lastName']].whereType<String>().where((value) => value.trim().isNotEmpty).join(' ');
  final serviceName = service['name']?.toString() ?? item['modality']?.toString() ?? 'Appointment';
  final counterparty = patientName.isNotEmpty ? patientName : provider['displayName']?.toString() ?? '';
  final starts = _dateTime(item['startsAt']);
  return [counterparty, serviceName, starts].where((value) => value.isNotEmpty && value != '—').join(' · ');
}

String _dateTime(dynamic value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (date == null) return '—';
  return '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

String _dateOnly(dynamic value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (date == null) return '—';
  return '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
}

int _minor(dynamic value) => value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;
String _money(dynamic minor, dynamic currency) => '${(_minor(minor) / 100).toStringAsFixed(2)} ${currency ?? ''}'.trim();
Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}
List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}
