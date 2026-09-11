import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'telehealth_room.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';
import 'care_journeys_widgets.dart';
import 'care_planning.dart';
import 'care_planning_localization.dart';
import 'patient_messages.dart';
import 'patient_messages_localization.dart';

class CareVisitsPage extends StatefulWidget {
  const CareVisitsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;
  @override
  State<CareVisitsPage> createState() => _CareVisitsPageState();
}
class _CareVisitsPageState extends State<CareVisitsPage> {
  List<JourneyMap> items = [];
  String bucket = 'upcoming', filter = '';
  bool busy = true;
  String? error;
  final mutating = <String>{};
  String t(String key) => journeyText(widget.locale, key);
  String p(String key) => planningText(widget.locale, key);
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try { final value = await widget.session.api.myAppointments(); if (mounted) setState(() => items = value); }
    catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> open(Widget page) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: page)));
    if (mounted) await load();
  }
  Future<void> cancel(JourneyMap visit) async {
    final id = visit['id'].toString();
    if (mutating.contains(id)) return;
    setState(() => mutating.add(id));
    try {
      final detail = '${journeyMap(visit['service'])['name']}\n${journeyMap(visit['provider'])['displayName']}\n${journeyDateTime(visit['startsAt'])}\n${t(visit['modality'].toString())}';
      if (!await confirmJourney(context, widget.locale, t('cancelVisit'), detail) || !mounted) return;
      await widget.session.api.cancelAppointment(id, reason: 'Patient confirmed cancellation in CarePoint mobile');
      if (mounted) await load();
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(journeyError(widget.locale, e)))); }
    finally { if (mounted) setState(() => mutating.remove(id)); }
  }
  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final visible = items.where((v) => journeyVisitBucket(v, now) == bucket).where((v) => '${journeyMap(v['service'])['name']} ${journeyMap(v['provider'])['displayName']}'.toLowerCase().contains(filter.toLowerCase())).toList();
    visible.sort((a, b) => bucket == 'upcoming' ? '${a['startsAt']}'.compareTo('${b['startsAt']}') : '${b['startsAt']}'.compareTo('${a['startsAt']}'));
    return RefreshIndicator(onRefresh: load, child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
      Text(t('visits'), style: Theme.of(context).textTheme.headlineSmall),
      OutlinedButton.icon(onPressed: busy ? null : () => open(CareWaitlistPage(session: widget.session, locale: widget.locale)), icon: const Icon(Icons.schedule_send), label: Text(p('waitlist'))),
      Wrap(spacing: 8, children: ['upcoming', 'history', 'cancelled'].map((v) => ChoiceChip(label: Text(t(v)), selected: bucket == v, onSelected: (_) => setState(() => bucket = v))).toList()),
      TextField(onChanged: (v) => setState(() => filter = v), decoration: InputDecoration(labelText: t('query'), prefixIcon: const Icon(Icons.search))),
      if (busy) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
      if (error != null) JourneyFailure(locale: widget.locale, message: error!, onRetry: load),
      if (!busy && error == null && visible.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Text(t('empty'))),
      for (final visit in visible) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(journeyMap(visit['service'])['name']?.toString() ?? '', style: Theme.of(context).textTheme.titleMedium),
        Text(journeyMap(visit['provider'])['displayName']?.toString() ?? ''),
        Text('${journeyDateTime(visit['startsAt'])} · ${t(visit['modality'].toString())}'),
        Chip(label: Text(t(visit['status'].toString()))),
        JourneyVisitContext(locale: widget.locale, value: journeyMap(visit['visitContext'])),
        if (visit['modality'] == 'TELEMEDICINE' && visit['status'] == 'CONFIRMED') TelehealthActionButton(session: widget.session, locale: widget.locale, appointment: visit),
        if (patientCareConversationEligibleStatus(visit['status'])) OutlinedButton.icon(
          key: ValueKey('visit-message-${visit['id']}'),
          onPressed: busy ? null : () => open(AppointmentCommunicationsPage(
            session: widget.session,
            locale: widget.locale,
            appointmentId: visit['id'].toString(),
            appointmentStatus: visit['status'].toString(),
            appointmentLabel: '${journeyMap(visit['service'])['name'] ?? ''} · ${journeyMap(visit['provider'])['displayName'] ?? ''} · ${journeyDateTime(visit['startsAt'])}',
          )),
          icon: const Icon(Icons.forum_outlined),
          label: Text(patientMessagesText(widget.locale, 'messageCareTeam')),
        ),
        TextButton.icon(onPressed: busy ? null : () => open(CareChangeHistoryPage(session: widget.session, locale: widget.locale, appointmentId: visit['id'].toString())), icon: const Icon(Icons.history), label: Text(p('history'))),
        if ((visit['status'] == 'REQUESTED' || visit['status'] == 'CONFIRMED') && (DateTime.tryParse(visit['startsAt']?.toString() ?? '')?.isAfter(now) ?? false)) OutlinedButton.icon(onPressed: busy || mutating.contains(visit['id'].toString()) ? null : () => open(CareReschedulePage(session: widget.session, locale: widget.locale, appointmentId: visit['id'].toString())), icon: const Icon(Icons.edit_calendar), label: Text(p('reschedule'))),
        if (visit['status'] == 'REQUESTED' || visit['status'] == 'CONFIRMED') OutlinedButton.icon(onPressed: mutating.contains(visit['id'].toString()) ? null : () => cancel(visit), icon: const Icon(Icons.cancel_outlined), label: Text(t('cancelVisit'))),
      ]))),
    ]));
  }
}
