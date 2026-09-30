import 'dart:convert';
import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_widgets.dart';
import 'care_journeys_localization.dart';
import 'care_planning_models.dart';
import 'availability_requests_localization.dart';

Future<bool> askAvailabilityRequest(BuildContext context, {required CarePointSession session, required CarePointLocale locale, required JourneyMap service, required String modality}) async {
  if (session.account['role'] != 'PATIENT') return false;
  return await showDialog<bool>(context: context, barrierDismissible: false, builder: (_) => AvailabilityRequestDialog(session: session, locale: locale, service: service, modality: modality)) == true;
}
class AvailabilityRequestDialog extends StatefulWidget {
  const AvailabilityRequestDialog({super.key, required this.session, required this.locale, required this.service, required this.modality});
  final CarePointSession session;
  final CarePointLocale locale;
  final JourneyMap service;
  final String modality;
  @override
  State<AvailabilityRequestDialog> createState() => _AvailabilityRequestDialogState();
}
class _AvailabilityRequestDialogState extends State<AvailabilityRequestDialog> {
  late final from = TextEditingController(text: journeyDate(DateTime.now().add(const Duration(days: 1))));
  late final to = TextEditingController(text: journeyDate(DateTime.now().add(const Duration(days: 14))));
  bool consent = false, busy = false;
  String? pending, error;
  String t(String key) => availabilityText(widget.locale, key);
  @override
  void dispose() { from.dispose(); to.dispose(); super.dispose(); }
  Future<void> save() async {
    if (busy || widget.session.account['role'] != 'PATIENT') return;
    if (pending == null) {
      final window = planningWindow(from.text, to.text, maxDays: 62), now = DateTime.now();
      if (!consent || window == null) { setState(() => error = t('invalid')); return; }
      final start = DateTime.parse(window['from']!), end = DateTime.parse(window['to']!);
      if (!end.isAfter(now) || start.isBefore(now.subtract(const Duration(days: 1))) || end.isAfter(now.add(const Duration(days: 366)))) {
        setState(() => error = t('invalid')); return;
      }
      pending = jsonEncode({'serviceId': widget.service['id'], 'modality': widget.modality, ...window, 'inAppNotices': true});
    }
    setState(() { busy = true; error = null; });
    try {
      await widget.session.api.joinAvailabilityRequest(journeyMap(jsonDecode(pending!))).timeout(const Duration(seconds: 30));
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      final status = e is CarePointApiException ? e.statusCode : null;
      final rejected = status != null && status >= 400 && status < 500 && status != 408;
      setState(() { if (rejected) pending = null; error = rejected ? journeyError(widget.locale, e) : t('uncertain'); });
    } finally { if (mounted) setState(() => busy = false); }
  }
  @override
  Widget build(BuildContext context) => Directionality(textDirection: widget.locale.textDirection, child: PopScope<bool>(canPop: !busy, child: AlertDialog(
    title: Text(t('join')), scrollable: true,
    content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(widget.service['name']?.toString() ?? ''),
      Text('${journeyMap(widget.service['provider'])['displayName'] ?? ''} - ${journeyText(widget.locale, widget.modality)}'),
      Text(t('policy')), const SizedBox(height: 12),
      TextField(key: const ValueKey('availability-from'), controller: from, enabled: !busy && pending == null, decoration: InputDecoration(labelText: t('from'))),
      TextField(key: const ValueKey('availability-to'), controller: to, enabled: !busy && pending == null, decoration: InputDecoration(labelText: t('to'))),
      CheckboxListTile(key: const ValueKey('availability-consent'), contentPadding: EdgeInsets.zero, value: consent, onChanged: busy || pending != null ? null : (v) => setState(() => consent = v == true), title: Text(t('consent'))),
      Text(t('onDemand')),
      if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!)),
      if (busy) const LinearProgressIndicator(),
    ]),
    actions: [
      TextButton(onPressed: busy ? null : () => Navigator.pop(context, false), child: Text(journeyText(widget.locale, 'cancel'))),
      FilledButton(onPressed: busy ? null : save, child: Text(pending == null ? t('join') : journeyText(widget.locale, 'retry'))),
    ],
  )));
}
