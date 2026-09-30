import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';
import 'care_journeys_widgets.dart';
import 'care_journeys_form.dart';
import 'availability_request_form.dart';
import 'availability_requests_models.dart';
import 'availability_requests_localization.dart';

class CareSlotsPage extends StatefulWidget {
  const CareSlotsPage({super.key, required this.session, required this.locale, required this.service, required this.modality, this.availabilityRequestId});
  final CarePointSession session;
  final CarePointLocale locale;
  final JourneyMap service;
  final String modality;
  final String? availabilityRequestId;
  @override
  State<CareSlotsPage> createState() => _CareSlotsPageState();
}
class _CareSlotsPageState extends State<CareSlotsPage> {
  List<JourneyMap> slots = [];
  late JourneyMap liveService;
  bool loading = true, submitting = false, done = false, truncated = false;
  String? error;
  CareBookingIntent? intent;
  String t(String key) => journeyText(widget.locale, key);
  String a(String key) => availabilityText(widget.locale, key);
  JourneyMap get modalityData => journeyList(liveService['modalities']).firstWhere((m) => m['modality'] == widget.modality, orElse: () => {});
  @override
  void initState() { super.initState(); liveService = widget.service; load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      if (widget.availabilityRequestId != null) {
        final result = await widget.session.api.availabilityRequestMatches(widget.availabilityRequestId!);
        if (mounted) setState(() { slots = journeyList(result['items']); truncated = result['truncated'] == true; if (journeyMap(result['service']).isNotEmpty) liveService = journeyMap(result['service']); });
      } else {
        final now = DateTime.now();
        final value = await widget.session.api.availability(serviceId: liveService['id'].toString(), modality: widget.modality, from: now, to: now.add(const Duration(days: 30)));
        if (mounted) setState(() => slots = value);
      }
    } catch (e) { if (mounted) setState(() { slots = []; error = journeyError(widget.locale, e); }); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> requestAvailability() async {
    if (submitting || intent != null) return;
    setState(() => submitting = true);
    try {
      final saved = await askAvailabilityRequest(context, session: widget.session, locale: widget.locale, service: liveService, modality: widget.modality);
      if (saved && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(a('saved'))));
    } finally { if (mounted) setState(() => submitting = false); }
  }
  Future<void> prepare(JourneyMap slot) async {
    if (submitting || intent != null) return;
    setState(() { submitting = true; error = null; });
    JourneyMap? home;
    var selected = slot;
    try {
      if (widget.availabilityRequestId != null) {
        // Observed notices never authorise a booking. Refresh the service,
        // price, location and requested slot before presenting confirmation.
        final current = await widget.session.api.availabilityRequestMatches(widget.availabilityRequestId!);
        if (!mounted) return;
        final matching = journeyList(current['items']).where((s) => s['id'] == slot['id']).toList();
        if (matching.isEmpty || journeyMap(current['service']).isEmpty) { setState(() => error = a('none')); return; }
        selected = matching.first;
        setState(() => liveService = journeyMap(current['service']));
      }
      if (widget.modality == 'HOME_VISIT') {
        home = await askJourneyForm(context, widget.locale, t('HOME_VISIT'), journeyAddressFields(home: true));
        if (!mounted || home == null) return;
        home['countryCode'] = home['countryCode'].toString().toUpperCase();
      }
      if (!mounted) return;
      final clinic = journeyClinic(liveService);
      final physical = home ?? journeyMap(clinic['location']);
      final detail = [
        liveService['name']?.toString() ?? '',
        journeyMap(liveService['provider'])['displayName']?.toString() ?? '',
        t(widget.modality), journeyDateTime(selected['startsAt']),
        journeyMoney(modalityData['priceMinor'], liveService['currency']),
        if (physical.isNotEmpty) '${physical['addressLine1']}, ${physical['city']}, ${physical['countryCode']}',
        if (home != null) '${t('contact')}: ${home['contactPhone']}',
        if (home?['instructions'] != null) home!['instructions'].toString(),
        if (clinic['arrivalInstructions'] != null) clinic['arrivalInstructions'].toString(),
      ].join('\n');
      if (!await confirmJourney(context, widget.locale, t('review'), detail) || !mounted) return;
      setState(() => intent = widget.availabilityRequestId == null
        ? CareBookingIntent(slotId: selected['id'].toString(), homeVisit: home)
        : AvailabilityBookingIntent(slotId: selected['id'].toString(), homeVisit: home, requestId: widget.availabilityRequestId!));
      await submit();
    } catch (e) { if (mounted) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted) setState(() => submitting = false); }
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
      final rejected = status != null && status >= 400 && status < 500 && status != 408;
      setState(() { if (rejected) intent = null; error = rejected ? journeyError(widget.locale, e) : t('pending'); });
    } finally { if (mounted) setState(() => submitting = false); }
  }
  Future<void> reconcile() async {
    if (submitting || intent == null) return;
    // F3 receipt replay checks the exact request/key/body. An unrelated booking
    // in the same slot must not be mistaken for this request's success.
    if (widget.availabilityRequestId != null) { await submit(); return; }
    setState(() => submitting = true);
    try {
      final visits = await widget.session.api.myAppointments();
      if (!mounted) return;
      final found = visits.any((v) => v['slotId'] == intent?.slotId && (v['status'] == 'REQUESTED' || v['status'] == 'CONFIRMED'));
      if (found) { complete(); } else { setState(() => error = t('pending')); }
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
    final clinic = journeyClinic(liveService);
    final physical = {...journeyMap(clinic['location']), 'instructions': clinic['arrivalInstructions']};
    return PopScope<bool>(
      canPop: done || (!submitting && intent == null),
      onPopInvokedWithResult: (didPop, _) { if (!didPop && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t('pending')))); },
      child: Scaffold(appBar: AppBar(title: Text(t('slots'))), body: SafeArea(child: ListView(padding: const EdgeInsets.all(16), children: [
        Text(liveService['name']?.toString() ?? '', style: Theme.of(context).textTheme.titleLarge),
        Text('${t(widget.modality)} · ${journeyMoney(modalityData['priceMinor'], liveService['currency'])}'),
        if (widget.modality == 'CLINIC' && clinic.isNotEmpty) JourneyVisitContext(locale: widget.locale, value: physical),
        if (widget.availabilityRequestId != null) Text(a('onDemand')),
        if (truncated) Text(a('limited')),
        if (error != null) Padding(padding: const EdgeInsets.all(16), child: Text(error!)),
        if (intent != null) ...[
          FilledButton(onPressed: submitting ? null : submit, child: Text(t('retry'))),
          OutlinedButton(onPressed: submitting ? null : reconcile, child: Text(t('checkVisits'))),
        ] else ...[
          if (!loading) TextButton.icon(onPressed: submitting ? null : load, icon: const Icon(Icons.refresh), label: Text(t('retry'))),
          if (!loading && slots.isEmpty) Text(t('empty')),
          if (!loading && widget.availabilityRequestId == null) OutlinedButton(onPressed: submitting ? null : requestAvailability, child: Text(a('join'))),
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
