import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';
import 'care_journeys_widgets.dart';
import 'care_journeys_form.dart';
part 'care_provider_forms.dart';

class CareProviderSchedule extends StatefulWidget {
  const CareProviderSchedule({super.key, required this.session, required this.locale, required this.allowedModalities});
  final CarePointSession session;
  final CarePointLocale locale;
  final List<String> allowedModalities;
  @override
  State<CareProviderSchedule> createState() => _CareProviderScheduleState();
}
class _CareProviderScheduleState extends State<CareProviderSchedule> {
  List<JourneyMap> locations = [], services = [], rules = [], exceptions = [], slots = [];
  bool busy = true, writing = false, slotBusy = false;
  String? error, slotError;
  int? nextSlotPage;
  final slotEpoch = JourneyRequestEpoch();
  late DateTime from, to;
  CarePointApi get api => widget.session.api;
  String t(String key) => journeyText(widget.locale, key);
  bool get allowed => widget.session.role == 'DOCTOR' || widget.session.role == 'OTHER_PROVIDER';
  bool hasModality(JourneyMap service, String mode) => widget.allowedModalities.contains(mode) && journeyList(service['modalities']).any((m) => m['modality'] == mode && m['active'] != false);
  @override
  void initState() {
    super.initState();
    final now = DateTime.now(); from = DateTime(now.year, now.month, now.day); to = from.add(const Duration(days: 14));
    if (allowed) { load(); loadSlots(); } else { busy = false; }
  }
  @override
  void dispose() { slotEpoch.invalidate(); super.dispose(); }
  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final data = await Future.wait([api.careLocations(), api.providerServices(), api.availabilityRules(), api.careExceptions()]);
      if (mounted) setState(() { locations = data[0]; services = data[1]; rules = data[2]; exceptions = data[3]; });
    } catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> loadSlots({int? page}) async {
    final ticket = slotEpoch.begin();
    setState(() { slotBusy = true; slotError = null; if (page == null) { slots = []; nextSlotPage = null; } });
    try {
      final result = await api.careSlotInventory(from: from, to: to, page: page ?? 1);
      if (mounted && slotEpoch.isCurrent(ticket)) setState(() {
        final merged = <String, JourneyMap>{for (final r in slots) r['id'].toString(): r, for (final r in journeyList(result['items'])) r['id'].toString(): r};
        slots = merged.values.toList();
        final next = result['nextPage']; nextSlotPage = next is int && next > (page ?? 1) ? next : null;
      });
    } catch (e) { if (mounted && slotEpoch.isCurrent(ticket)) setState(() => slotError = journeyError(widget.locale, e)); }
    finally { if (mounted && slotEpoch.isCurrent(ticket)) setState(() => slotBusy = false); }
  }
  Future<void> change(String title, String detail, Future<dynamic> Function() operation) async {
    if (writing || !allowed) return;
    setState(() => writing = true);
    try {
      if (!await confirmJourney(context, widget.locale, title, detail) || !mounted) return;
      await operation();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('saved'))));
      await load();
      if (mounted) await loadSlots();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${journeyError(widget.locale, e)}\n${t('conflict')}')));
    } finally { if (mounted) setState(() => writing = false); }
  }
  Widget action(String title, VoidCallback call) => Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: OutlinedButton(onPressed: writing ? null : call, child: Text(t(title))));
  Widget panel(List<Widget> children) => ListView(padding: const EdgeInsets.all(16), children: children);
  String serviceName(JourneyMap row) => services.where((s) => s['id'] == row['serviceId']).map((s) => s['name'].toString()).firstOrNull ?? journeyMap(row['service'])['name']?.toString() ?? '';
  @override
  Widget build(BuildContext context) {
    if (!allowed) return Scaffold(appBar: AppBar(title: Text(t('schedule'))), body: Center(child: Text(t('denied'))));
    return DefaultTabController(length: 5, child: Scaffold(
      appBar: AppBar(title: Text(t('schedule')), actions: [IconButton(tooltip: t('retry'), onPressed: writing ? null : load, icon: const Icon(Icons.refresh))], bottom: TabBar(isScrollable: true, tabs: ['locations', 'services', 'rules', 'exceptions', 'inventory'].map((k) => Tab(text: t(k))).toList())),
      body: busy ? const Center(child: CircularProgressIndicator()) : error != null ? JourneyFailure(locale: widget.locale, message: error!, onRetry: load) : TabBarView(children: [
        panel([
          action('newLocation', addLocation),
          if (locations.isEmpty) Text(t('empty')),
          for (final row in locations) Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(row['label']?.toString() ?? '', style: Theme.of(context).textTheme.titleMedium), Text(t(row['active'] == true ? 'active' : 'inactive')),
            JourneyVisitContext(locale: widget.locale, value: {...row, 'instructions': row['arrivalInstructions']}),
            action(row['active'] == true ? 'deactivate' : 'activate', () => change(t('locations'), row['label']?.toString() ?? '', () => api.setCareLocationActive(row['id'].toString(), row['active'] != true))),
          ]))),
        ]),
        panel([
          if (services.isEmpty) Text(t('empty')),
          for (final row in services) Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(row['name']?.toString() ?? '', style: Theme.of(context).textTheme.titleMedium),
            for (final m in journeyList(row['modalities'])) Text('${t(m['modality'].toString())} · ${journeyMoney(m['priceMinor'], row['currency'])}'),
            if (hasModality(row, 'CLINIC')) action('clinicSettings', () => configureClinic(row)),
            if (hasModality(row, 'HOME_VISIT')) action('coverage', () => configureCoverage(row)),
          ]))),
        ]),
        panel([
          Text(t('bufferHint')), action('newRule', addRule), action('generate', generate),
          if (rules.isEmpty) Text(t('empty')),
          for (final row in rules) Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(serviceName(row), style: Theme.of(context).textTheme.titleMedium),
            Text('${t(row['modality'].toString())} · ${row['timezone']}'),
            Text('${t('weekday')}: ${row['weekday']} · ${row['startMinute']}–${row['endMinute']} min'),
            Text('${t('before')}: ${row['bufferBeforeMinutes']} · ${t('after')}: ${row['bufferAfterMinutes']}'),
          ]))),
        ]),
        panel([
          Text(t('exceptionHint')), action('newException', addException),
          if (exceptions.isEmpty) Text(t('empty')),
          for (final row in exceptions) Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${t(row['kind'].toString())} · ${t(row['active'] == true ? 'active' : 'inactive')}'),
            Text('${journeyDateTime(row['startsAt'])} – ${journeyDateTime(row['endsAt'])}'),
            Text(serviceName(row)),
            action(row['active'] == true ? 'deactivate' : 'activate', () => change(t('exceptions'), '${journeyDateTime(row['startsAt'])}\n${t('exceptionHint')}', () => api.setCareExceptionActive(row['id'].toString(), row['active'] != true))),
          ]))),
        ]),
        panel([
          Text('${journeyDate(from)} – ${journeyDate(to.subtract(const Duration(days: 1)))}'), action('filters', selectRange),
          if (slotError != null) JourneyFailure(locale: widget.locale, message: slotError!, onRetry: () => loadSlots(page: slots.isNotEmpty ? nextSlotPage : null)),
          if (!slotBusy && slots.isEmpty && slotError == null) Text(t('empty')),
          for (final row in slots) Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(serviceName(row), style: Theme.of(context).textTheme.titleMedium), Text('${journeyDateTime(row['startsAt'])} – ${journeyDateTime(row['endsAt'])}'),
            Text('${t(row['status'].toString())} · ${row['bookedCount']}/${row['capacity']}'),
            if (row['bookedCount'] == 0 && (row['status'] == 'OPEN' || row['status'] == 'BLOCKED'))
              action(row['status'] == 'OPEN' ? 'block' : 'unblock', () => change(t('inventory'), '${serviceName(row)}\n${journeyDateTime(row['startsAt'])}\n${t('exceptionHint')}', () => api.setCareSlotBlocked(row['id'].toString(), row['status'] == 'OPEN'))),
          ]))),
          if (slotBusy) const Center(child: CircularProgressIndicator()),
          if (!slotBusy && nextSlotPage != null) action('more', () => loadSlots(page: nextSlotPage)),
        ]),
      ]),
    ));
  }
}
