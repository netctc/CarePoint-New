import 'package:flutter/material.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';

enum JourneyInput { text, integer, decimal, date, time, confirmation }
class JourneyField {
  const JourneyField(this.id, this.label, {this.initial = '', this.kind = JourneyInput.text, this.required = true, this.min, this.max, this.maxLength = 300, this.options, this.pattern});
  final String id, label, initial;
  final JourneyInput kind;
  final bool required;
  final num? min, max;
  final int maxLength;
  final Map<String, String>? options;
  final RegExp? pattern;
}
Future<JourneyMap?> askJourneyForm(BuildContext context, CarePointLocale locale, String title, List<JourneyField> fields, {String? hint, String? Function(JourneyMap)? validate}) =>
    Navigator.of(context).push<JourneyMap>(MaterialPageRoute(builder: (_) => Directionality(textDirection: locale.textDirection, child: JourneyForm(locale: locale, title: title, fields: fields, hint: hint, validate: validate))));

class JourneyForm extends StatefulWidget {
  const JourneyForm({super.key, required this.locale, required this.title, required this.fields, this.hint, this.validate});
  final CarePointLocale locale;
  final String title;
  final List<JourneyField> fields;
  final String? hint;
  final String? Function(JourneyMap)? validate;
  @override
  State<JourneyForm> createState() => _JourneyFormState();
}
class _JourneyFormState extends State<JourneyForm> {
  final form = GlobalKey<FormState>();
  final controllers = <String, TextEditingController>{};
  final checks = <String, bool>{};
  String? error;
  @override
  void initState() {
    super.initState();
    for (final field in widget.fields) {
      controllers[field.id] = TextEditingController(text: field.initial);
      checks[field.id] = field.initial == 'true';
    }
  }
  @override
  void dispose() { for (final c in controllers.values) { c.dispose(); } super.dispose(); }
  String t(String key) => journeyText(widget.locale, key);
  String? check(JourneyField f, String? raw) {
    final text = raw?.trim() ?? '';
    if (text.isEmpty) return f.required ? t('required') : null;
    if (f.pattern != null && !f.pattern!.hasMatch(text)) return t('invalid');
    if (f.kind == JourneyInput.date && parseJourneyDate(text) == null) return t('invalid');
    if (f.kind == JourneyInput.time && parseJourneyMinute(text) == null) return t('invalid');
    if (f.kind == JourneyInput.integer || f.kind == JourneyInput.decimal) {
      final num? value = f.kind == JourneyInput.integer ? int.tryParse(text) : double.tryParse(text);
      if (value == null || !value.isFinite || (f.min != null && value < f.min!) || (f.max != null && value > f.max!)) return t('invalid');
    }
    return null;
  }
  void submit() {
    if (!form.currentState!.validate()) return;
    final result = <String, dynamic>{};
    for (final f in widget.fields) {
      final value = controllers[f.id]!.text.trim();
      if (f.kind == JourneyInput.confirmation) { result[f.id] = checks[f.id] == true; }
      else if (value.isNotEmpty) {
        result[f.id] = switch (f.kind) {
          JourneyInput.integer => int.parse(value), JourneyInput.decimal => double.parse(value), _ => value,
        };
      }
    }
    final problem = widget.validate?.call(result);
    if (problem != null) { setState(() => error = problem); return; }
    Navigator.pop(context, result);
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.title)),
    body: SafeArea(child: Form(key: form, child: ListView(padding: const EdgeInsets.all(20), children: [
      if (widget.hint != null) Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(widget.hint!)),
      for (final f in widget.fields) Padding(padding: const EdgeInsets.only(bottom: 16), child:
        f.kind == JourneyInput.confirmation ? FormField<bool>(
          initialValue: checks[f.id],
          validator: (_) => f.required && checks[f.id] != true ? t('required') : null,
          builder: (state) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            CheckboxListTile(contentPadding: EdgeInsets.zero, value: checks[f.id], title: Text(t(f.label)), onChanged: (v) { setState(() => checks[f.id] = v == true); state.didChange(v); }),
            if (state.hasError) Text(state.errorText!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ]),
        ) : f.options != null ? DropdownButtonFormField<String>(
          key: ValueKey('form-${f.id}'), initialValue: f.options!.containsKey(f.initial) ? f.initial : null,
          isExpanded: true, decoration: InputDecoration(labelText: t(f.label), border: const OutlineInputBorder()),
          items: f.options!.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))).toList(),
          validator: (v) => check(f, v), onChanged: (v) => controllers[f.id]!.text = v ?? '',
        ) : TextFormField(
          key: ValueKey('form-${f.id}'), controller: controllers[f.id], maxLength: f.maxLength,
          enableSuggestions: false, autocorrect: false,
          keyboardType: f.kind == JourneyInput.integer || f.kind == JourneyInput.decimal ? const TextInputType.numberWithOptions(decimal: true, signed: true) : TextInputType.text,
          decoration: InputDecoration(labelText: t(f.label), border: const OutlineInputBorder(), counterText: ''),
          validator: (v) => check(f, v),
        ),
      ),
      if (error != null) Padding(padding: const EdgeInsets.only(bottom: 16), child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      FilledButton(onPressed: submit, child: Text(t('review'))),
    ]))),
  );
}
List<JourneyField> journeyAddressFields({bool home = false}) => [
  if (!home) const JourneyField('label', 'label', maxLength: 120),
  const JourneyField('addressLine1', 'address'),
  const JourneyField('city', 'city', maxLength: 120),
  JourneyField('countryCode', 'country', maxLength: 2, pattern: RegExp(r'^[a-zA-Z]{2}$')),
  const JourneyField('latitude', 'latitude', kind: JourneyInput.decimal, min: -90, max: 90),
  const JourneyField('longitude', 'longitude', kind: JourneyInput.decimal, min: -180, max: 180),
  JourneyField(home ? 'instructions' : 'arrivalInstructions', 'instructions', required: !home, maxLength: 1000),
  if (home) const JourneyField('contactPhone', 'contact', maxLength: 80),
  const JourneyField('addressValidated', 'addressConfirmed', kind: JourneyInput.confirmation),
  if (home) const JourneyField('contactConfirmed', 'contactConfirmed', kind: JourneyInput.confirmation),
];
