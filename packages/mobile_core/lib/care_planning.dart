import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_widgets.dart';
import 'care_planning_models.dart';
import 'care_planning_localization.dart';

Future<Map<String, String>?> askPlanningWindow(BuildContext context, CarePointLocale locale, {DateTime? before, int maxDays = 31}) async {
  final now = DateTime.now();
  final start = TextEditingController(text: journeyDate(now));
  final end = TextEditingController(text: journeyDate(before?.toLocal() ?? now.add(const Duration(days: 14))));
  String? error;
  String t(String key) => planningText(locale, key);
  try {
    return await showDialog<Map<String, String>>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (_, update) => AlertDialog(
      title: Text(t('window')),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(key: const ValueKey('planning-from'), controller: start, keyboardType: TextInputType.datetime, decoration: InputDecoration(labelText: t('from'))),
        const SizedBox(height: 12),
        TextField(key: const ValueKey('planning-to'), controller: end, keyboardType: TextInputType.datetime, decoration: InputDecoration(labelText: t('to'))),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!)),
      ])),
      actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(t('cancel'))), FilledButton(onPressed: () {
        final result = planningWindow(start.text, end.text, before: before, maxDays: maxDays);
        if (result == null) { update(() => error = t('invalidWindow')); return; }
        Navigator.pop(dialogContext, result);
      }, child: Text(t('apply')))],
    )));
  } finally { start.dispose(); end.dispose(); }
}

class CareReschedulePage extends StatefulWidget {
  const CareReschedulePage({super.key, required this.session, required this.locale, required this.appointmentId, this.waitlistEntryId});
  final CarePointSession session;
  final CarePointLocale locale;
  final String appointmentId;
  final String? waitlistEntryId;
  @override
  State<CareReschedulePage> createState() => _CareReschedulePageState();
}
class _CareReschedulePageState extends State<CareReschedulePage> {
  JourneyMap data = {};
  bool busy = true, done = false;
  String? error;
  Map<String, String>? window;
  CareRescheduleIntent? pending;
  String t(String key) => planningText(widget.locale, key);
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    if (pending != null) return;
    setState(() { busy = true; error = null; });
    try {
      if (widget.session.role != 'PATIENT') throw const CarePointApiException('Patient access required.', statusCode: 403);
      final next = widget.waitlistEntryId == null
        ? await widget.session.api.rescheduleOptions(widget.appointmentId, window: window).timeout(const Duration(seconds: 30))
        : await widget.session.api.earlierMatches(widget.waitlistEntryId!).timeout(const Duration(seconds: 30));
      if (mounted) setState(() => data = next);
    } catch (e) { if (mounted) setState(() { data = {}; error = journeyError(widget.locale, e); }); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> chooseWindow() async {
    final selected = await askPlanningWindow(context, widget.locale);
    if (!mounted || selected == null) return;
    window = selected; await load();
  }
  Future<void> join() async {
    final appointment = journeyMap(data['appointment']);
    final before = DateTime.tryParse(appointment['startsAt']?.toString() ?? '');
    if (before == null || appointment['updatedAt'] == null) return;
    final chosen = await askPlanningWindow(context, widget.locale, before: before, maxDays: 62);
    if (!mounted || chosen == null) return;
    if (!await confirmJourney(context, widget.locale, t('join'), '${t('noGuarantee')}\n${journeyDateTime(chosen['from'])} - ${journeyDateTime(chosen['to'])}') || !mounted) return;
    setState(() { busy = true; error = null; });
    try {
      await widget.session.api.joinEarlierWaitlist(widget.appointmentId, {...chosen, 'expectedUpdatedAt': appointment['updatedAt']}).timeout(const Duration(seconds: 30));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('joined'))));
    } catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> prepare(JourneyMap slot) async {
    if (busy || pending != null) return;
    final appointment = journeyMap(data['appointment']);
    setState(() => busy = true);
    try {
      final detail = '${journeyMap(appointment['service'])['name']}\n${journeyMap(appointment['provider'])['displayName']}\n${t('current')}: ${journeyDateTime(appointment['startsAt'])}\n${t('newTime')}: ${journeyDateTime(slot['startsAt'])}\n${t('preserved')}';
      if (!await confirmJourney(context, widget.locale, t('confirm'), detail) || !mounted) return;
      setState(() => pending = CareRescheduleIntent(slotId: slot['slotId'].toString(), expectedUpdatedAt: appointment['updatedAt'].toString(), waitlistEntryId: widget.waitlistEntryId));
      await submit();
    } finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> submit() async {
    final intent = pending;
    if (intent == null) return;
    setState(() { busy = true; error = null; });
    try {
      await widget.session.api.rescheduleCare(widget.appointmentId, intent.body).timeout(const Duration(seconds: 30));
      if (!mounted) return;
      setState(() { pending = null; done = true; busy = false; });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('changed'))));
      WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) Navigator.pop(context, true); });
    } catch (e) {
      if (!mounted) return;
      final code = e is CarePointApiException ? e.statusCode : null;
      final definitive = code != null && code >= 400 && code < 500 && code != 408;
      setState(() { if (definitive) pending = null; error = definitive ? journeyError(widget.locale, e) : t('pending'); });
    } finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final appointment = journeyMap(data['appointment']);
    return PopScope<bool>(canPop: done || (!busy && pending == null),
      onPopInvokedWithResult: (didPop, _) { if (!didPop && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('pending')))); },
      child: Scaffold(appBar: AppBar(title: Text(t('reschedule'))), body: SafeArea(child: ListView(padding: const EdgeInsets.all(16), children: [
        if (appointment.isNotEmpty) ...[
          Text(journeyMap(appointment['service'])['name']?.toString() ?? '', style: Theme.of(context).textTheme.titleLarge),
          Text(journeyMap(appointment['provider'])['displayName']?.toString() ?? ''),
          Text('${t('current')}: ${journeyDateTime(appointment['startsAt'])}'),
          const SizedBox(height: 12), Text(t('preserved')),
          JourneyVisitContext(locale: widget.locale, value: journeyMap(appointment['visitContext'])),
        ],
        if (widget.waitlistEntryId != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(t('noGuarantee'))),
        if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!)),
        if (pending != null) FilledButton(key: const ValueKey('planning-retry'), onPressed: busy ? null : submit, child: Text(t('retry')))
        else ...[
          Wrap(spacing: 8, children: [
            TextButton.icon(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), label: Text(t('refresh'))),
            if (widget.waitlistEntryId == null) TextButton(onPressed: busy ? null : chooseWindow, child: Text(t('window'))),
          ]),
          if (appointment.isNotEmpty && widget.waitlistEntryId == null) OutlinedButton.icon(onPressed: busy ? null : join, icon: const Icon(Icons.schedule_send), label: Text(t('join'))),
          if (!busy && error == null && journeyList(data['items']).isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(t('empty'))),
          for (final slot in journeyList(data['items'])) Card(child: ListTile(
            title: Text(journeyDateTime(slot['startsAt'])), subtitle: Text(journeyDateTime(slot['endsAt'])),
            trailing: FilledButton(onPressed: busy ? null : () => prepare(slot), child: Text(t('reschedule'))),
          )),
          if (data['truncated'] == true) Text(t('more')),
        ],
        if (busy) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
      ]))),
    );
  }
}

class CareWaitlistPage extends StatefulWidget {
  const CareWaitlistPage({super.key, required this.session, required this.locale, this.provider = false});
  final CarePointSession session;
  final CarePointLocale locale;
  final bool provider;
  @override
  State<CareWaitlistPage> createState() => _CareWaitlistPageState();
}
class _CareWaitlistPageState extends State<CareWaitlistPage> {
  JourneyMap data = {};
  bool busy = true;
  String? error;
  String t(String key) => planningText(widget.locale, key);
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final next = await (widget.provider ? widget.session.api.providerWaitlistDemand() : widget.session.api.earlierWaitlist()).timeout(const Duration(seconds: 30));
      if (mounted) setState(() => data = next);
    } catch (e) { if (mounted) setState(() { data = {}; error = journeyError(widget.locale, e); }); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> withdraw(JourneyMap entry) async {
    if (busy) return;
    if (!await confirmJourney(context, widget.locale, t('withdraw'), '${entry['serviceName']}\n${entry['providerName']}\n${t('noGuarantee')}') || !mounted) return;
    setState(() => busy = true);
    try { await widget.session.api.withdrawEarlierWaitlist(entry['id'].toString()).timeout(const Duration(seconds: 30)); if (mounted) await load(); }
    catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> matches(JourneyMap entry) async {
    await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: CareReschedulePage(session: widget.session, locale: widget.locale, appointmentId: entry['appointmentId'].toString(), waitlistEntryId: entry['id'].toString()))));
    if (mounted) await load();
  }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(t(widget.provider ? 'demand' : 'waitlist'))), body: RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
    Text(t(widget.provider ? 'privacy' : 'noGuarantee')),
    TextButton.icon(onPressed: busy ? null : load, icon: const Icon(Icons.refresh), label: Text(t('refresh'))),
    if (busy) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
    if (error != null) Text(error!),
    if (!busy && error == null && journeyList(data['items']).isEmpty) Text(t('empty')),
    for (final entry in journeyList(data['items'])) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(entry['serviceName']?.toString() ?? '', style: Theme.of(context).textTheme.titleMedium),
      if (widget.provider) ...[
        Text('${entry['modality']} · ${t('count')}: ${entry['waitingCount']}'),
        Text('${journeyDateTime(entry['earliestRequestedAt'])} - ${journeyDateTime(entry['latestRequestedAt'])}'),
      ] else ...[
        Text(entry['providerName']?.toString() ?? ''),
        Text('${t('current')}: ${journeyDateTime(entry['originalStartsAt'])}'),
        Text('${journeyDateTime(entry['fromAt'])} - ${journeyDateTime(entry['toAt'])}'),
        Chip(label: Text(t(entry['status'].toString()))),
        if (entry['status'] == 'WAITING') Wrap(spacing: 8, children: [
          FilledButton(onPressed: busy ? null : () => matches(entry), child: Text(t('matches'))),
          TextButton(onPressed: busy ? null : () => withdraw(entry), child: Text(t('withdraw'))),
        ]),
      ],
    ]))),
    if (data['truncated'] == true) Text(t('recent')),
  ])));
}

class CareChangeHistoryPage extends StatefulWidget {
  const CareChangeHistoryPage({super.key, required this.session, required this.locale, required this.appointmentId});
  final CarePointSession session;
  final CarePointLocale locale;
  final String appointmentId;
  @override
  State<CareChangeHistoryPage> createState() => _CareChangeHistoryPageState();
}
class _CareChangeHistoryPageState extends State<CareChangeHistoryPage> {
  JourneyMap data = {};
  bool busy = true;
  String? error;
  String t(String key) => planningText(widget.locale, key);
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try { final next = await widget.session.api.rescheduleHistory(widget.appointmentId).timeout(const Duration(seconds: 30)); if (mounted) setState(() => data = next); }
    catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(t('history'))), body: ListView(padding: const EdgeInsets.all(16), children: [
    TextButton(onPressed: busy ? null : load, child: Text(t('refresh'))),
    if (busy) const Center(child: CircularProgressIndicator()),
    if (error != null) Text(error!),
    if (!busy && error == null && journeyList(data['items']).isEmpty) Text(t('empty')),
    for (final change in journeyList(data['items'])) Card(child: ListTile(
      title: Text('${journeyDateTime(change['fromStartsAt'])} → ${journeyDateTime(change['toStartsAt'])}'),
      subtitle: Text('${journeyDateTime(change['createdAt'])}${change['fromWaitlist'] == true ? '\n${t('FULFILLED')}' : ''}'),
    )),
    if (data['truncated'] == true) Text(t('recent')),
  ]));
}
