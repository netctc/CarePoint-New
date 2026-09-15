import 'package:flutter/material.dart';
import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'care_journeys_models.dart';
import 'care_journeys_localization.dart';
import 'care_journeys_widgets.dart';
import 'care_booking.dart';

class CareDiscoveryPage extends StatefulWidget {
  const CareDiscoveryPage({super.key, required this.session, required this.locale, required this.onBooked, this.header});
  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onBooked;
  final Widget? header;
  @override
  State<CareDiscoveryPage> createState() => _CareDiscoveryPageState();
}
class _CareDiscoveryPageState extends State<CareDiscoveryPage> {
  final query = TextEditingController(), location = TextEditingController(), service = TextEditingController();
  final epoch = JourneyRequestEpoch();
  String providerClass = '', specialty = '', category = '', modality = '';
  List<JourneyMap> specialties = [], categories = [], items = [];
  Map<String, String> applied = {};
  int? nextPage;
  bool busy = true, catalogFailed = false;
  String? error;
  String t(String key) => journeyText(widget.locale, key);
  @override
  void initState() { super.initState(); loadCatalogs(); search(); }
  @override
  void dispose() { epoch.invalidate(); query.dispose(); location.dispose(); service.dispose(); super.dispose(); }
  Future<void> loadCatalogs() async {
    try {
      final values = await Future.wait([widget.session.api.doctorSpecialties(), widget.session.api.otherProviderCategories()]);
      if (mounted) setState(() { specialties = values[0]; categories = values[1]; catalogFailed = false; });
    } catch (_) { if (mounted) setState(() => catalogFailed = true); }
  }
  Future<void> search({int? page}) async {
    final ticket = epoch.begin();
    final filters = page == null ? <String, String>{'q': query.text, 'location': location.text, 'service': service.text, 'providerClass': providerClass, 'specialty': specialty, 'providerCategory': category, 'modality': modality} : Map<String, String>.of(applied);
    setState(() { busy = true; error = null; if (page == null) { items = []; nextPage = null; applied = filters; } });
    try {
      final response = await widget.session.api.discoverCare(filters, page: page ?? 1);
      if (!mounted || !epoch.isCurrent(ticket)) return;
      final received = journeyList(response['items']);
      final next = response['nextPage'];
      setState(() {
        final merged = <String, JourneyMap>{for (final row in items) row['id'].toString(): row, for (final row in received) row['id'].toString(): row};
        items = merged.values.toList();
        nextPage = next is int && next > (page ?? 1) && next <= 1000 ? next : null;
      });
    } catch (e) { if (mounted && epoch.isCurrent(ticket)) setState(() => error = journeyError(widget.locale, e)); }
    finally { if (mounted && epoch.isCurrent(ticket)) setState(() => busy = false); }
  }
  void reset() {
    query.clear(); location.clear(); service.clear();
    setState(() { providerClass = ''; specialty = ''; category = ''; modality = ''; });
    search();
  }
  String label(JourneyMap item, String fallback) => journeyMap(item['labels'])[widget.locale.name]?.toString() ?? item[fallback]?.toString() ?? '';
  Widget select(String key, String value, Map<String, String> values, ValueChanged<String> change) => Padding(
    padding: const EdgeInsets.only(bottom: 12), child: JourneySelect(label: t(key), value: value, options: {'': t('all'), ...values}, onChanged: (v) { setState(() => change(v)); search(); }),
  );
  Future<void> open(JourneyMap row, String selected) async {
    final booked = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => Directionality(
      textDirection: widget.locale.textDirection, child: CareSlotsPage(session: widget.session, locale: widget.locale, service: row, modality: selected),
    )));
    if (booked == true && mounted) widget.onBooked();
  }
  @override
  Widget build(BuildContext context) => RefreshIndicator(onRefresh: () => search(), child: ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
    if (widget.header != null) widget.header!,
    Text(t('search'), style: Theme.of(context).textTheme.headlineSmall), const SizedBox(height: 12),
    TextField(key: const ValueKey('care-query'), controller: query, textInputAction: TextInputAction.search, onSubmitted: (_) => search(), decoration: InputDecoration(labelText: t('query'), border: const OutlineInputBorder(), suffixIcon: IconButton(tooltip: t('search'), onPressed: () => search(), icon: const Icon(Icons.search)))),
    const SizedBox(height: 12),
    ExpansionTile(title: Text(t('filters')), initiallyExpanded: true, children: [
      select('providerClass', providerClass, {'DOCTOR': t('DOCTOR'), 'OTHER_PROVIDER': t('OTHER_PROVIDER')}, (v) { providerClass = v; if (v != 'DOCTOR') specialty = ''; if (v != 'OTHER_PROVIDER') category = ''; }),
      if (providerClass != 'OTHER_PROVIDER') select('specialty', specialty, {for (final s in specialties) s['id'].toString(): label(s, 'code')}, (v) { specialty = v; if (v.isNotEmpty) { providerClass = 'DOCTOR'; category = ''; } }),
      if (providerClass != 'DOCTOR') select('category', category, {for (final c in categories) c['id'].toString(): label(c, 'slug')}, (v) { category = v; if (v.isNotEmpty) { providerClass = 'OTHER_PROVIDER'; specialty = ''; } }),
      select('modality', modality, {for (final m in ['CLINIC', 'TELEMEDICINE', 'HOME_VISIT']) m: t(m)}, (v) => modality = v),
      TextField(controller: service, onSubmitted: (_) => search(), decoration: InputDecoration(labelText: t('serviceFilter'), border: const OutlineInputBorder())), const SizedBox(height: 12),
      TextField(controller: location, onSubmitted: (_) => search(), decoration: InputDecoration(labelText: t('location'), border: const OutlineInputBorder())),
      Row(children: [TextButton(onPressed: reset, child: Text(t('reset'))), const Spacer(), FilledButton(onPressed: () => search(), child: Text(t('search')))]),
    ]),
    if (catalogFailed) JourneyFailure(locale: widget.locale, message: t('error'), onRetry: loadCatalogs),
    if (error != null) JourneyFailure(locale: widget.locale, message: error!, onRetry: () => search(page: items.isNotEmpty ? nextPage : null)),
    if (!busy && items.isEmpty && error == null) Padding(padding: const EdgeInsets.all(24), child: Text(t('empty'))),
    for (final row in items) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label(row, 'name'), style: Theme.of(context).textTheme.titleMedium),
      Text(journeyMap(row['provider'])['displayName']?.toString() ?? ''), const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: journeyList(row['modalities']).map((m) => OutlinedButton(
        onPressed: () => open(row, m['modality'].toString()),
        child: Text('${t(m['modality'].toString())} · ${journeyMoney(m['priceMinor'], row['currency'])}'),
      )).toList()),
    ]))),
    if (busy) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
    if (!busy && nextPage != null) OutlinedButton(onPressed: () => search(page: nextPage), child: Text(t('more'))),
  ]));
}
