import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_widgets.dart';
import 'care_journeys_localization.dart';
import 'care_booking.dart';
import 'availability_requests_localization.dart';
import 'availability_requests_models.dart';

class CareAvailabilityCentrePage extends StatefulWidget {
  const CareAvailabilityCentrePage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<CareAvailabilityCentrePage> createState() => _CareAvailabilityCentrePageState();
}
class _CareAvailabilityCentrePageState extends State<CareAvailabilityCentrePage> {
  final epoch = JourneyRequestEpoch();
  String view = 'requests';
  List<JourneyMap> items = [];
  bool loading = true, mutating = false;
  int? nextPage;
  String? error;
  String t(String key) => availabilityText(widget.locale, key);
  @override
  void initState() { super.initState(); if (widget.session.account['role'] == 'PATIENT') { load(); } else { loading = false; } }
  @override
  void dispose() { epoch.invalidate(); super.dispose(); }
  Future<void> load({int page = 1}) async {
    if (widget.session.account['role'] != 'PATIENT') return;
    final ticket = epoch.begin(), selected = view;
    setState(() { loading = true; error = null; if (page == 1) { items = []; nextPage = null; } });
    try {
      final result = await widget.session.api.availabilityRequests(page: page, view: selected);
      if (!mounted || !epoch.isCurrent(ticket)) return;
      setState(() {
        items = {for (final row in items) row['id'].toString(): row, for (final row in journeyList(result['items'])) row['id'].toString(): row}.values.toList();
        final next = result['nextPage']; nextPage = next is int && next > page && next <= 1000 ? next : null;
      });
    } catch (e) { if (mounted && epoch.isCurrent(ticket)) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted && epoch.isCurrent(ticket)) setState(() => loading = false); }
  }
  Future<void> action(JourneyMap row, String operation) async {
    if (mutating) return;
    setState(() { mutating = true; error = null; });
    try {
      final id = row['id'].toString();
      if (operation == 'withdraw') {
        if (!await confirmJourney(context, widget.locale, t('withdraw'), t('withdrawDetail')) || !mounted) return;
        await widget.session.api.withdrawAvailabilityRequest(id);
      } else if (operation == 'read') {
        await widget.session.api.markAvailabilityNoticeRead(id, journeyMap(row['notice'])['version'] as int);
      } else if (operation == 'view') {
        final available = await widget.session.api.availabilityRequestMatches(id);
        if (!mounted) return;
        if (journeyList(available['items']).isEmpty || journeyMap(available['service']).isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('none'))));
        } else {
          final booked = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: CareSlotsPage(session: widget.session, locale: widget.locale, service: journeyMap(available['service']), modality: row['modality'].toString(), availabilityRequestId: id))));
          if (!mounted) return;
          if (booked == true) { Navigator.pop(context, true); return; }
        }
      } else {
        final observed = await widget.session.api.checkAvailabilityRequest(id);
        if (mounted && journeyMap(observed['notice'])['active'] != true) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('none'))));
      }
      if (mounted) await load();
    } catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => mutating = false); }
  }
  @override
  Widget build(BuildContext context) {
    if (widget.session.account['role'] != 'PATIENT') return Scaffold(body: Center(child: Text(journeyText(widget.locale, 'denied'))));
    return Directionality(textDirection: widget.locale.textDirection, child: Scaffold(
      appBar: AppBar(title: Text(t('centre'))),
      body: SafeArea(child: RefreshIndicator(onRefresh: () => load(), child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
        Text(t('onDemand')),
        const SizedBox(height: 12),
        SegmentedButton<String>(segments: [ButtonSegment(value: 'requests', label: Text(t('requests'))), ButtonSegment(value: 'notices', label: Text(t('notices')))], selected: {view}, onSelectionChanged: mutating ? null : (v) { setState(() => view = v.first); load(); }),
        if (error != null) JourneyFailure(locale: widget.locale, message: error!, onRetry: () => load()),
        if (!loading && items.isEmpty && error == null) Padding(padding: const EdgeInsets.all(24), child: Text(journeyText(widget.locale, 'empty'))),
        for (final row in items) requestCard(row),
        if (loading || mutating) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
        if (!loading && nextPage != null) OutlinedButton(onPressed: mutating ? null : () => load(page: nextPage!), child: Text(journeyText(widget.locale, 'more'))),
      ]))),
    ));
  }
  Widget requestCard(JourneyMap row) {
    final notice = journeyMap(row['notice']), waiting = row['status'] == 'WAITING';
    return Card(key: ValueKey('availability-${row['id']}'), child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(row['serviceName']?.toString() ?? '', style: Theme.of(context).textTheme.titleMedium),
      Text('${row['providerName'] ?? ''} - ${journeyText(widget.locale, row['modality'].toString())}'),
      Text(availabilityWindowLabel(row)), Text(t(row['status'].toString())),
      if (notice.isNotEmpty) ...[
        Text('${t('checked')}: ${journeyDateTime(notice['checkedAt'])}'),
        if (notice['active'] == true) Text('${t('available')}: ${notice['matchCount']} - ${t(notice['readAt'] == null ? 'unread' : 'read')}'),
        if (notice['truncated'] == true) Text(t('limited')),
      ],
      if (waiting) Wrap(spacing: 8, runSpacing: 4, children: [
        OutlinedButton(onPressed: mutating ? null : () => action(row, 'check'), child: Text(t('check'))),
        OutlinedButton(onPressed: mutating ? null : () => action(row, 'view'), child: Text(t('view'))),
        if (notice['active'] == true && notice['readAt'] == null && notice['version'] is int) TextButton(onPressed: mutating ? null : () => action(row, 'read'), child: Text(t('markRead'))),
        TextButton(onPressed: mutating ? null : () => action(row, 'withdraw'), child: Text(t('withdraw'))),
      ]),
    ])));
  }
}
