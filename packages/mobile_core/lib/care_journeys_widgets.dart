import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';

Future<bool> confirmJourney(BuildContext context, CarePointLocale locale, String title, String detail) async =>
    await showDialog<bool>(context: context, builder: (_) => Directionality(textDirection: locale.textDirection, child: AlertDialog(
      title: Text(title), scrollable: true, content: Text(detail),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(journeyText(locale, 'cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(journeyText(locale, 'confirm')))],
    ))) == true;

String journeyError(CarePointLocale locale, Object error) {
  final status = error is CarePointApiException ? error.statusCode : null;
  return journeyText(locale, status == 401 || status == 403 ? 'denied' : status == 400 || status == 409 || status == 422 ? 'conflict' : 'error');
}
class JourneyFailure extends StatelessWidget {
  const JourneyFailure({super.key, required this.locale, required this.message, required this.onRetry});
  final CarePointLocale locale;
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Icon(Icons.error_outline), const SizedBox(height: 8), Text(message, textAlign: TextAlign.center),
    TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(journeyText(locale, 'retry'))),
  ]));
}
class JourneySelect extends StatelessWidget {
  const JourneySelect({super.key, required this.label, required this.value, required this.options, required this.onChanged});
  final String label, value;
  final Map<String, String> options;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<String>(
    key: ValueKey('$label:$value'), initialValue: options.containsKey(value) ? value : null, isExpanded: true,
    decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
    items: options.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))).toList(),
    onChanged: (v) { if (v != null) onChanged(v); },
  );
}
class JourneyVisitContext extends StatelessWidget {
  const JourneyVisitContext({super.key, required this.locale, required this.value});
  final CarePointLocale locale;
  final JourneyMap value;
  @override
  Widget build(BuildContext context) {
    if (value.isEmpty) return const SizedBox.shrink();
    final address = ['addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'countryCode'].map((k) => value[k]?.toString() ?? '').where((v) => v.isNotEmpty).join(', ');
    return Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(address),
      if (value['instructions']?.toString().isNotEmpty == true) Text(value['instructions'].toString()),
      if (value['contactPhone'] != null) Text('${journeyText(locale, 'contact')}: ${value['contactPhone']}'),
      if (value['latitude'] != null && value['longitude'] != null) SelectableText('${value['latitude']}, ${value['longitude']}'),
    ]));
  }
}
