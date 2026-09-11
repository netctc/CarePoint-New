import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';
import 'care_journeys_widgets.dart';
import 'care_journeys_form.dart';

class CareSlotsPage extends StatefulWidget {
  const CareSlotsPage({super.key, required this.session, required this.locale, required this.service, required this.modality});
  final CarePointSession session;
  final CarePointLocale locale;
  final JourneyMap service;
  final String modality;
  @override
  State<CareSlotsPage> createState() => _CareSlotsPageState();
}
class _CareSlotsPageState extends State<CareSlotsPage> {
  List<JourneyMap> slots = [];
  bool loading = true, submitting = false, done = false;
  String? error;
  CareBookingIntent? intent;
  String t(String key) => journeyText(widget.locale, key);
  JourneyMap get modalityData => journeyList(widget.service['modalities']).firstWhere((m) => m['modality'] == widget.modality, orElse: () => {});
  @override
  void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final now = DateTime.now();
      final value = await widget.session.api.availability(serviceId: widget.service['id'].toString(), modality: widget.modality, from: now, to: now.add(const Duration(days: 30)));
      if (mounted) setState(() => slots = value);
    } catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> prepare(JourneyMap slot) async {
    if (submitting || intent != null) return;
    setState(() => submitting = true);
    JourneyMap? home;
    try {
      if (widget.modality == 'HOME_VISIT') {
        home = await askJourneyForm(context, widget.locale, t('HOME_VISIT'), journeyAddressFields(home: true));
        if (!mounted || home == null) return;
        home['countryCode'] = home['countryCode'].toString().toUpperCase();
      }
      if (!mounted) return;
      final clinic = journeyClinic(widget.service);
      final physical = home ?? journeyMap(clinic['location']);
      final detail = [
        widget.service['name']?.toString() ?? '',
        journeyMap(widget.service['provider'])['displayName']?.toString() ?? '',
        t(widget.modality), journeyDateTime(slot['startsAt']),
        journeyMoney(modalityData['priceMinor'], widget.service['currency']),
        if (physical.isNotEmpty) '${physical['addressLine1']}, ${physical['city']}, ${physical['countryCode']}',
        if (home != null) '${t('contact')}: ${home['contactPhone']}',
        if (home?['instructions'] != null) home!['instructions'].toString(),
        if (clinic['arrivalInstructions'] != null) clinic['arrivalInstructions'].toString(),
      ].join('\n');
      if (!await confirmJourney(context, widget.locale, t('review'), detail) || !mounted) return;
      setState(() => intent = CareBookingIntent(slotId: slot['id'].toString(), homeVisit: home));
      await submit();
    } finally { if (mounted) setState(() => submitting = false); }
  }
  Future<void> submit() async {
    final current = intent;
    if (current == null) return;
    setState(() { submitting = true; error = null; });
    try {
      await widget.session.api.bookCare(current.body).timeout(const Duration(seconds: 30));
      if (mounted) complete();
    } catch (e) {
      if (!mounted) return;
      final status = e is CarePointApiException ? e.statusCode : null;
      // A definitive rejection can be corrected. A timeout/5xx/network loss
      // retains the exact body/key because the server may have committed it.
      final rejected = status != null && status >= 400 && status < 500 && status != 408;
      setState(() {
        if (rejected) intent = null;
        error = rejected ? journeyError(widget.locale, e) : t('pending');
      });
    } finally { if (mounted) setState(() => submitting = false); }
  }
  Future<void> reconcile() async {
    if (submitting || intent == null) return;
    setState(() => submitting = true);
    try {
      final visits = await widget.session.api.myAppointments();
      if (!mounted) return;
      final found = visits.any((v) => v['slotId'] == intent?.slotId && (v['status'] == 'REQUESTED' || v['status'] == 'CONFIRMED'));
      if (found) { complete(); }
      else { setState(() => error = t('pending')); }
    } catch (_) { if (mounted) setState(() => error = t('pending')); }
    finally { if (mounted) setState(() => submitting = false); }
  }
  void complete() {
    setState(() { intent = null; done = true; submitting = false; });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('booked'))));
    WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) Navigator.pop(context, true); });
  }
  @override
  Widget build(BuildContext context) {
    final clinic = journeyClinic(widget.service);
    final physical = {...journeyMap(clinic['location']), 'instructions': clinic['arrivalInstructions']};
    return PopScope<bool>(
      canPop: done || (!submitting && intent == null),
      onPopInvokedWithResult: (didPop, _) { if (!didPop && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('pending')))); },
      child: Scaffold(appBar: AppBar(title: Text(t('slots'))), body: SafeArea(child: ListView(padding: const EdgeInsets.all(16), children: [
        Text(widget.service['name']?.toString() ?? '', style: Theme.of(context).textTheme.titleLarge),
        Text('${t(widget.modality)} · ${journeyMoney(modalityData['priceMinor'], widget.service['currency'])}'),
        if (widget.modality == 'CLINIC' && clinic.isNotEmpty) JourneyVisitContext(locale: widget.locale, value: physical),
        if (error != null) Padding(padding: const EdgeInsets.all(16), child: Text(error!)),
        if (intent != null) ...[
          FilledButton(onPressed: submitting ? null : submit, child: Text(t('retry'))),
          OutlinedButton(onPressed: submitting ? null : reconcile, child: Text(t('checkVisits'))),
        ] else ...[
          if (!loading) TextButton.icon(onPressed: submitting ? null : load, icon: const Icon(Icons.refresh), label: Text(t('retry'))),
          if (!loading && slots.isEmpty) Text(t('empty')),
          for (final slot in slots) Card(child: ListTile(
            title: Text(journeyDateTime(slot['startsAt'])), subtitle: Text(journeyDateTime(slot['endsAt'])),
            trailing: FilledButton(onPressed: submitting ? null : () => prepare(slot), child: Text(t('book'))),
          )),
        ],
        if (loading || submitting) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
      ]))),
    );
  }
}
