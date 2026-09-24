import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class ProviderJobFinancialSummaryPage extends StatefulWidget {
  const ProviderJobFinancialSummaryPage({
    super.key,
    required this.session,
    required this.locale,
    required this.accent,
    required this.jobId,
    required this.kind,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;
  final String jobId;
  final String kind;

  @override
  State<ProviderJobFinancialSummaryPage> createState() => _ProviderJobFinancialSummaryPageState();
}

class _ProviderJobFinancialSummaryPageState extends State<ProviderJobFinancialSummaryPage> {
  bool loading = true;
  String? error;
  Map<String, dynamic> payload = const {};

  String t(String key) => providerJobFinanceText(widget.locale, key);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() { loading = true; error = null; });
    try {
      final next = await widget.session.api.providerJobFinancialSummary(widget.jobId);
      if (mounted) setState(() => payload = next);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = payload['state']?.toString() ?? '';
    final linkState = payload['billingLinkState']?.toString() ?? '';
    final invoice = _map(payload['invoice']);
    final ledger = _maps(payload['ledgerEntries']);
    final payouts = _maps(payload['payouts']);
    final net = _map(payload['ledgerNetMinorByCurrency']);

    return Scaffold(
      appBar: AppBar(
        title: Text(t('title')),
        actions: [
          IconButton(onPressed: _load, tooltip: t('refresh'), icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(error!, textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: Text(t('retry'))),
                  ]),
                ))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _stateCard(state, linkState),
                      if (state == 'READY' && invoice.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        _invoiceCard(invoice),
                        const SizedBox(height: 14),
                        _netCard(net),
                        const SizedBox(height: 14),
                        _ledgerCard(ledger),
                        const SizedBox(height: 14),
                        _payoutCard(payouts),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _stateCard(String state, String linkState) {
    final notBilled = state == 'NOT_BILLED';
    final transportUnlinked = linkState == 'NO_CANONICAL_BILLING_LINK';
    final message = notBilled
        ? (transportUnlinked ? t('transportNotBilled') : t('notBilled'))
        : t('ready');
    return Card(child: Padding(
      padding: const EdgeInsets.all(16),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(notBilled ? Icons.info_outline : Icons.account_balance_wallet_outlined, color: widget.accent),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_kindLabel(widget.kind), style: const TextStyle(fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text(message),
          const SizedBox(height: 4),
          Text('${t('linkState')}: $linkState', style: const TextStyle(color: Color(0xFF64748B))),
        ])),
      ]),
    ));
  }

  Widget _invoiceCard(Map<String, dynamic> invoice) => Card(child: Padding(
    padding: const EdgeInsets.all(16),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('invoice'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
      const SizedBox(height: 10),
      _row(t('invoiceNumber'), invoice['number']),
      _row(t('status'), invoice['status']),
      _row(t('total'), _money(invoice['totalMinor'], invoice['currency'])),
      _row(t('patientResponsibility'), _money(invoice['patientResponsibilityMinor'], invoice['currency'])),
      _row(t('insurerResponsibility'), _money(invoice['insurerResponsibilityMinor'], invoice['currency'])),
      _row(t('paid'), _money(invoice['amountPaidMinor'], invoice['currency'])),
      _row(t('refunded'), _money(invoice['amountRefundedMinor'], invoice['currency'])),
      _row(t('balance'), _money(invoice['balanceDueMinor'], invoice['currency'])),
      _row(t('issued'), _dateTime(invoice['issuedAt'])),
    ]),
  ));

  Widget _netCard(Map<String, dynamic> net) => Card(child: Padding(
    padding: const EdgeInsets.all(16),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('providerLedgerNet'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
      const SizedBox(height: 10),
      if (net.isEmpty)
        Text(t('noLedger'))
      else
        ...net.entries.map((entry) => _row(entry.key, _money(entry.value, entry.key))),
    ]),
  ));

  Widget _ledgerCard(List<Map<String, dynamic>> items) => Card(child: Padding(
    padding: const EdgeInsets.all(16),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('ledger'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
      const SizedBox(height: 8),
      if (items.isEmpty)
        Text(t('noLedger'))
      else
        ...items.map((item) => ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.receipt_long_outlined),
          title: Text(item['type']?.toString() ?? '—', style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(_dateTime(item['createdAt'])),
          trailing: Text(_money(item['amountMinor'], item['currency']), style: const TextStyle(fontWeight: FontWeight.w900)),
        )),
    ]),
  ));

  Widget _payoutCard(List<Map<String, dynamic>> items) => Card(child: Padding(
    padding: const EdgeInsets.all(16),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t('payouts'), style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
      const SizedBox(height: 8),
      if (items.isEmpty)
        Text(t('noPayoutLink'))
      else
        ...items.map((item) => ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.payments_outlined),
          title: Text(item['status']?.toString() ?? '—', style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(item['paidAt'] == null ? _dateTime(item['createdAt']) : '${t('paidAt')}: ${_dateTime(item['paidAt'])}'),
          trailing: Text(_money(item['amountMinor'], item['currency']), style: const TextStyle(fontWeight: FontWeight.w900)),
        )),
    ]),
  ));

  Widget _row(String label, dynamic value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(width: 150, child: Text(label, style: const TextStyle(color: Color(0xFF64748B)))),
      Expanded(child: Text(value?.toString() ?? '—', textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w700))),
    ]),
  );

  String _kindLabel(String kind) => kind == 'MEDICAL_TRANSPORT' ? t('transport') : t('homeVisit');

  String _money(dynamic minor, dynamic currency) {
    final amount = minor is num ? minor.toInt() : int.tryParse(minor?.toString() ?? '') ?? 0;
    return '${(amount / 100).toStringAsFixed(2)} ${currency ?? ''}';
  }

  String _dateTime(dynamic value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    if (parsed == null) return '—';
    final local = parsed.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
  }
}

String providerJobFinanceText(CarePointLocale locale, String key) {
  const values = <String, Map<String, String>>{
    'title': {'en':'Job financial summary','ar':'الملخص المالي للمهمة','fr':'Résumé financier de la mission','es':'Resumen financiero del trabajo'},
    'refresh': {'en':'Refresh','ar':'تحديث','fr':'Actualiser','es':'Actualizar'},
    'retry': {'en':'Retry','ar':'إعادة المحاولة','fr':'Réessayer','es':'Reintentar'},
    'ready': {'en':'This job has a canonical invoice link. Amounts and status come directly from the provider ledger.','ar':'ترتبط هذه المهمة بفاتورة معتمدة وتأتي المبالغ والحالة مباشرة من دفتر مقدم الخدمة.','fr':'Cette mission est liée à une facture canonique. Les montants et statuts proviennent directement du grand livre du prestataire.','es':'Este trabajo tiene una factura canónica. Los importes y estados proceden directamente del ledger del proveedor.'},
    'notBilled': {'en':'No invoice is linked to this job yet. No amount is inferred.','ar':'لا توجد فاتورة مرتبطة بهذه المهمة بعد، ولا يتم استنتاج أي مبلغ.','fr':'Aucune facture n’est encore liée à cette mission. Aucun montant n’est déduit.','es':'Todavía no hay factura vinculada a este trabajo. No se infiere ningún importe.'},
    'transportNotBilled': {'en':'Medical Transport has no canonical billing link in the current model. This screen intentionally shows no inferred amount.','ar':'لا يوجد حالياً رابط فوترة معتمد للنقل الطبي، لذلك لا تعرض الشاشة أي مبلغ مستنتج.','fr':'Le transport médical n’a pas encore de lien de facturation canonique. Aucun montant inféré n’est affiché.','es':'Medical Transport aún no tiene un vínculo de facturación canónico. La pantalla no muestra importes inferidos.'},
    'linkState': {'en':'Billing link','ar':'رابط الفوترة','fr':'Lien de facturation','es':'Vínculo de facturación'},
    'invoice': {'en':'Invoice','ar':'الفاتورة','fr':'Facture','es':'Factura'},
    'invoiceNumber': {'en':'Number','ar':'الرقم','fr':'Numéro','es':'Número'},
    'status': {'en':'Status','ar':'الحالة','fr':'Statut','es':'Estado'},
    'total': {'en':'Total','ar':'الإجمالي','fr':'Total','es':'Total'},
    'patientResponsibility': {'en':'Patient responsibility','ar':'مسؤولية المريض','fr':'Part patient','es':'Responsabilidad del paciente'},
    'insurerResponsibility': {'en':'Insurer responsibility','ar':'مسؤولية التأمين','fr':'Part assureur','es':'Responsabilidad del asegurador'},
    'paid': {'en':'Paid','ar':'المدفوع','fr':'Payé','es':'Pagado'},
    'refunded': {'en':'Refunded','ar':'المسترد','fr':'Remboursé','es':'Reembolsado'},
    'balance': {'en':'Balance due','ar':'الرصيد المستحق','fr':'Solde dû','es':'Saldo pendiente'},
    'issued': {'en':'Issued','ar':'تاريخ الإصدار','fr':'Émise','es':'Emitida'},
    'providerLedgerNet': {'en':'Provider ledger net for this job','ar':'صافي دفتر مقدم الخدمة لهذه المهمة','fr':'Net du grand livre pour cette mission','es':'Neto del ledger del proveedor para este trabajo'},
    'ledger': {'en':'Ledger entries','ar':'قيود الدفتر','fr':'Écritures du grand livre','es':'Movimientos del ledger'},
    'noLedger': {'en':'No provider ledger entry is linked to this invoice yet.','ar':'لا توجد قيود في دفتر مقدم الخدمة مرتبطة بهذه الفاتورة بعد.','fr':'Aucune écriture du grand livre n’est encore liée à cette facture.','es':'Todavía no hay movimientos del ledger vinculados a esta factura.'},
    'payouts': {'en':'Linked payouts','ar':'الدفعات المرتبطة','fr':'Versements liés','es':'Payouts vinculados'},
    'noPayoutLink': {'en':'No payout is directly linked to this job ledger yet.','ar':'لا توجد دفعة مرتبطة مباشرة بدفتر هذه المهمة بعد.','fr':'Aucun versement n’est directement lié au grand livre de cette mission.','es':'Todavía no hay payout vinculado directamente al ledger de este trabajo.'},
    'paidAt': {'en':'Paid','ar':'تم الدفع','fr':'Payé','es':'Pagado'},
    'homeVisit': {'en':'Home visit','ar':'زيارة منزلية','fr':'Visite à domicile','es':'Visita domiciliaria'},
    'transport': {'en':'Medical transport','ar':'نقل طبي','fr':'Transport médical','es':'Transporte médico'},
  };
  final language = switch (locale) {
    CarePointLocale.ar => 'ar',
    CarePointLocale.fr => 'fr',
    CarePointLocale.es => 'es',
    _ => 'en',
  };
  return values[key]?[language] ?? values[key]?['en'] ?? key;
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return const {};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}
