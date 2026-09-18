import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';
import 'care_journeys_widgets.dart';
import 'availability_requests_models.dart';
import 'availability_demand_localization.dart';

class ProviderAvailabilityDemandPage extends StatefulWidget {
  const ProviderAvailabilityDemandPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<ProviderAvailabilityDemandPage> createState() => _ProviderAvailabilityDemandPageState();
}

class _ProviderAvailabilityDemandPageState extends State<ProviderAvailabilityDemandPage> {
  final epoch = JourneyRequestEpoch();
  List<JourneyMap> items = [];
  bool loading = false, truncated = false;
  int? nextPage;
  int failedPage = 1;
  String? error;
  dynamic checkedAt;
  bool get allowed => ['DOCTOR', 'OTHER_PROVIDER'].contains(widget.session.role);
  String t(String key) => availabilityDemandText(widget.locale, key);
  @override
  void initState() { super.initState(); load(); }
  @override
  void didUpdateWidget(covariant ProviderAvailabilityDemandPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session != widget.session) { epoch.invalidate(); items = []; load(); }
  }
  @override
  void dispose() { epoch.invalidate(); super.dispose(); }

  Future<void> load({int page = 1}) async {
    if (!allowed) return;
    final ticket = epoch.begin();
    setState(() {
      loading = true; error = null; failedPage = page;
      if (page == 1) { items = []; nextPage = null; checkedAt = null; truncated = false; }
    });
    try {
      final data = await widget.session.api.providerAvailabilityDemand(page: page).timeout(const Duration(seconds: 30));
      if (!mounted || !epoch.isCurrent(ticket)) return;
      setState(() {
        items = {
          for (final row in items) '${row['serviceId']}|${row['modality']}': row,
          for (final row in journeyList(data['items'])) '${row['serviceId']}|${row['modality']}': row,
        }.values.toList();
        final next = data['nextPage'];
        nextPage = next is int && next > page && next <= 1000 ? next : null;
        checkedAt = data['checkedAt']; truncated = data['truncated'] == true;
      });
    } catch (e) {
      if (!mounted || !epoch.isCurrent(ticket)) return;
      setState(() {
        error = journeyError(widget.locale, e);
        if (e is CarePointApiException && [401, 403].contains(e.statusCode)) { items = []; nextPage = null; checkedAt = null; }
      });
    } finally { if (mounted && epoch.isCurrent(ticket)) setState(() => loading = false); }
  }

  @override
  Widget build(BuildContext context) => Directionality(textDirection: widget.locale.textDirection, child: Scaffold(
    appBar: AppBar(title: Text(t('title'))),
    body: !allowed ? Center(child: Text(journeyText(widget.locale, 'denied'))) : SafeArea(child: RefreshIndicator(
      onRefresh: () => load(),
      child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
        Text(t('policy')),
        if (checkedAt != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text('${t('checked')}: ${journeyDateTime(checkedAt)}')),
        TextButton(onPressed: loading ? null : () => load(), child: Text(t('refresh'))),
        if (error != null) JourneyFailure(locale: widget.locale, message: error!, onRetry: () => load(page: failedPage)),
        if (!loading && error == null && items.isEmpty) Text(t('empty')),
        for (final row in items) Card(key: ValueKey('demand-${row['serviceId']}-${row['modality']}'), child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(row['serviceName']?.toString() ?? '', style: Theme.of(context).textTheme.titleMedium),
            Text(journeyText(widget.locale, row['modality'].toString())),
            Text('${t('count')}: ${row['requestCount']}'),
            Text('${t('range')}: ${availabilityWindowLabel({'fromAt': row['earliestRequestedAt'], 'toAt': row['latestRequestedAt']})}'),
            if (row['serviceActive'] != true || row['modalityActive'] != true) Text(t('inactive')),
          ]),
        )),
        if (loading) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
        if (!loading && error == null && nextPage != null) OutlinedButton(onPressed: () => load(page: nextPage!), child: Text(t('more'))),
        if (truncated) Text(t('limit')),
      ]),
    )),
  ));
}
