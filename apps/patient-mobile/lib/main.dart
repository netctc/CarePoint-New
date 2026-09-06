import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:flutter/material.dart';

void main() => runApp(const CarePointPatientApp());

class CarePointPatientApp extends StatefulWidget {
  const CarePointPatientApp({super.key});
  @override
  State<CarePointPatientApp> createState() => _CarePointPatientAppState();
}

class _CarePointPatientAppState extends State<CarePointPatientApp> {
  CarePointLocale locale = CarePointLocale.en;

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        locale: locale.locale,
        theme: ThemeData(useMaterial3: true, scaffoldBackgroundColor: const Color(0xFFF8FAFC), colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0EA5E9))),
        home: Directionality(
          textDirection: locale.textDirection,
          child: Scaffold(
            body: Stack(children: [
              CarePointLoginGate(
                locale: locale,
                expectedRole: 'PATIENT',
                title: 'CarePoint Patient',
                builder: (_, session, signOut) => PatientShell(session: session, locale: locale, onSignOut: signOut),
              ),
              PositionedDirectional(
                top: 10,
                end: 10,
                child: SafeArea(
                  child: PopupMenuButton<CarePointLocale>(
                    initialValue: locale,
                    onSelected: (value) => setState(() => locale = value),
                    itemBuilder: (_) => CarePointLocale.values.map((item) => PopupMenuItem(value: item, child: Text(item.label))).toList(),
                  ),
                ),
              ),
            ]),
          ),
        ),
      );
}

class PatientShell extends StatefulWidget {
  const PatientShell({super.key, required this.session, required this.locale, required this.onSignOut});
  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onSignOut;

  @override
  State<PatientShell> createState() => _PatientShellState();
}

class _PatientShellState extends State<PatientShell> {
  int tab = 0;
  int visitsVersion = 0;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('CarePoint'),
          actions: [
            PopupMenuButton<String>(
              onSelected: (value) { if (value == 'logout') widget.onSignOut(); },
              itemBuilder: (_) => [PopupMenuItem(value: 'logout', child: Text(cpText(widget.locale, 'auth.signOut')))],
            ),
          ],
        ),
        body: IndexedStack(
          index: tab,
          children: [
            PatientSearchPage(session: widget.session, locale: widget.locale, onBooked: () => setState(() => visitsVersion += 1)),
            PatientAppointmentsPage(key: ValueKey(visitsVersion), session: widget.session, locale: widget.locale),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (value) => setState(() => tab = value),
          destinations: [
            NavigationDestination(icon: const Icon(Icons.search_outlined), selectedIcon: const Icon(Icons.search), label: cpText(widget.locale, 'patient.search')),
            NavigationDestination(icon: const Icon(Icons.event_note_outlined), selectedIcon: const Icon(Icons.event_note), label: cpText(widget.locale, 'patient.myVisits')),
          ],
        ),
      );
}

class PatientSearchPage extends StatefulWidget {
  const PatientSearchPage({super.key, required this.session, required this.locale, required this.onBooked});
  final CarePointSession session;
  final CarePointLocale locale;
  final VoidCallback onBooked;

  @override
  State<PatientSearchPage> createState() => _PatientSearchPageState();
}

class _PatientSearchPageState extends State<PatientSearchPage> {
  final query = TextEditingController();
  String? modality;
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  @override
  void initState() {
    super.initState();
    search();
  }

  @override
  void dispose() {
    query.dispose();
    super.dispose();
  }

  Future<void> search() async {
    setState(() { busy = true; error = null; });
    try {
      final next = await widget.session.api.searchServices(query: query.text, modality: modality);
      if (mounted) setState(() => items = next);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void emergency() => showModalBottomSheet<void>(
        context: context,
        builder: (_) => Directionality(
          textDirection: widget.locale.textDirection,
          child: SafeArea(child: Padding(padding: const EdgeInsets.all(22), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(cpText(widget.locale, 'patient.emergencyTitle'), style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Text(cpText(widget.locale, 'patient.emergencyText')),
            const SizedBox(height: 18),
            FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE11D48)), onPressed: () => Navigator.pop(context), icon: const Icon(Icons.emergency_outlined), label: Text(cpText(widget.locale, 'patient.requestNow'))),
          ]))),
        ),
      );

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: search,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(cpText(widget.locale, 'patient.greeting'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
            Text(cpText(widget.locale, 'patient.prompt'), style: const TextStyle(color: Color(0xFF64748B))),
            const SizedBox(height: 16),
            InkWell(
              onTap: emergency,
              borderRadius: BorderRadius.circular(20),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: const Color(0xFFFFF1F2), border: Border.all(color: const Color(0xFFFDA4AF)), borderRadius: BorderRadius.circular(20)),
                child: Row(children: [const CircleAvatar(backgroundColor: Color(0xFFE11D48), child: Icon(Icons.emergency_share_outlined, color: Colors.white)), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(cpText(widget.locale, 'patient.emergency'), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Color(0xFFBE123C))), Text(cpText(widget.locale, 'patient.emergencyAction'), style: const TextStyle(fontWeight: FontWeight.w800)), Text(cpText(widget.locale, 'patient.emergencyHint'), style: const TextStyle(fontSize: 11, color: Color(0xFF9F1239)))]))]),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: query,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => search(),
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), labelText: cpText(widget.locale, 'patient.searchHint'), border: const OutlineInputBorder(), suffixIcon: IconButton(onPressed: search, icon: const Icon(Icons.arrow_forward_rounded))),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String?>(
              initialValue: modality,
              decoration: const InputDecoration(border: OutlineInputBorder()),
              items: [
                DropdownMenuItem<String?>(value: null, child: Text(cpText(widget.locale, 'patient.allModalities'))),
                const DropdownMenuItem(value: 'CLINIC', child: Text('Clinic')),
                const DropdownMenuItem(value: 'TELEMEDICINE', child: Text('Telemedicine')),
                const DropdownMenuItem(value: 'HOME_VISIT', child: Text('Home visit')),
              ],
              onChanged: (value) { setState(() => modality = value); search(); },
            ),
            const SizedBox(height: 18),
            Text(cpText(widget.locale, 'patient.results'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            if (busy) const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
            else if (error != null) _InlineError(message: error!, onRetry: search, locale: widget.locale)
            else if (items.isEmpty) Padding(padding: const EdgeInsets.all(30), child: Center(child: Text(cpText(widget.locale, 'common.none'))))
            else ...items.map(_serviceCard),
          ],
        ),
      );

  Widget _serviceCard(Map<String, dynamic> service) {
    final provider = _map(service['provider']);
    final modalities = _list(service['modalities']);
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openService(service),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text(_localized(service['labels'], service['name']?.toString() ?? 'Service'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800))), const Icon(Icons.verified_rounded, color: Color(0xFF10B981))]),
            const SizedBox(height: 5),
            Text(provider['displayName']?.toString() ?? '', style: const TextStyle(color: Color(0xFF475569))),
            const SizedBox(height: 10),
            Wrap(spacing: 7, runSpacing: 7, children: modalities.map((m) => Chip(avatar: Icon(_modalityIcon(m['modality']?.toString()), size: 18), label: Text('${m['modality']} · ${_money(m['priceMinor'], service['currency'])}'))).toList()),
          ]),
        ),
      ),
    );
  }

  Future<void> _openService(Map<String, dynamic> service) async {
    final modalities = _list(service['modalities']);
    if (modalities.isEmpty) return;
    String selected = modalities.first['modality'].toString();
    if (modalities.length > 1 && modality == null) {
      final value = await showModalBottomSheet<String>(
        context: context,
        builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: modalities.map((m) {
          final name = m['modality'].toString();
          return ListTile(leading: Icon(_modalityIcon(name)), title: Text(name), subtitle: Text('${m['durationMinutes']} min · ${_money(m['priceMinor'], service['currency'])}'), onTap: () => Navigator.pop(context, name));
        }).toList())),
      );
      if (value == null) return;
      selected = value;
    } else if (modality != null) {
      selected = modality!;
    }
    if (!mounted) return;
    final booked = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: PatientSlotsPage(session: widget.session, locale: widget.locale, service: service, modality: selected))));
    if (booked == true) widget.onBooked();
  }

  String _localized(dynamic labels, String fallback) {
    final map = _map(labels);
    final value = map[widget.locale.name]?.toString();
    return value?.trim().isNotEmpty == true ? value! : fallback;
  }
}

class PatientSlotsPage extends StatefulWidget {
  const PatientSlotsPage({super.key, required this.session, required this.locale, required this.service, required this.modality});
  final CarePointSession session;
  final CarePointLocale locale;
  final Map<String, dynamic> service;
  final String modality;

  @override
  State<PatientSlotsPage> createState() => _PatientSlotsPageState();
}

class _PatientSlotsPageState extends State<PatientSlotsPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> slots = const [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final now = DateTime.now();
      final value = await widget.session.api.availability(serviceId: widget.service['id'].toString(), modality: widget.modality, from: now, to: now.add(const Duration(days: 30)));
      if (mounted) setState(() => slots = value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(cpText(widget.locale, 'patient.slots'))),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? _InlineError(message: error!, onRetry: load, locale: widget.locale)
                : slots.isEmpty
                    ? Center(child: Padding(padding: const EdgeInsets.all(28), child: Text(cpText(widget.locale, 'patient.noSlots'), textAlign: TextAlign.center)))
                    : RefreshIndicator(
                        onRefresh: load,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: slots.length,
                          itemBuilder: (_, index) {
                            final slot = slots[index];
                            final start = DateTime.tryParse(slot['startsAt']?.toString() ?? '')?.toLocal();
                            final end = DateTime.tryParse(slot['endsAt']?.toString() ?? '')?.toLocal();
                            return Card(child: ListTile(
                              leading: CircleAvatar(child: Icon(_modalityIcon(widget.modality))),
                              title: Text(_dateTime(start), style: const TextStyle(fontWeight: FontWeight.w800)),
                              subtitle: Text('${_time(end)} · ${slot['remainingCapacity'] ?? ''} available'),
                              trailing: FilledButton(onPressed: () => book(slot), child: Text(cpText(widget.locale, 'patient.bookNow'))),
                            ));
                          },
                        ),
                      ),
      );

  Future<void> book(Map<String, dynamic> slot) async {
    final confirmed = await showDialog<bool>(context: context, builder: (_) => AlertDialog(title: Text(cpText(widget.locale, 'patient.bookNow')), content: Text('${widget.service['name']}\n${_dateTime(DateTime.tryParse(slot['startsAt']?.toString() ?? '')?.toLocal())}'), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(widget.locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(cpText(widget.locale, 'patient.bookNow')))]));
    if (confirmed != true) return;
    try {
      final key = 'mobile-${DateTime.now().microsecondsSinceEpoch}-${slot['id']}';
      await widget.session.api.book(slotId: slot['id'].toString(), idempotencyKey: key);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(cpText(widget.locale, 'patient.booked'))));
      Navigator.pop(context, true);
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
      await load();
    }
  }
}

class PatientAppointmentsPage extends StatefulWidget {
  const PatientAppointmentsPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientAppointmentsPage> createState() => _PatientAppointmentsPageState();
}

class _PatientAppointmentsPageState extends State<PatientAppointmentsPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> items = const [];

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final value = await widget.session.api.myAppointments();
      if (mounted) setState(() => items = value);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (busy) return const Center(child: CircularProgressIndicator());
    if (error != null) return _InlineError(message: error!, onRetry: load, locale: widget.locale);
    if (items.isEmpty) return Center(child: Text(cpText(widget.locale, 'patient.noVisits')));
    return RefreshIndicator(
      onRefresh: load,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        itemBuilder: (_, index) {
          final item = items[index];
          final service = _map(item['service']);
          final provider = _map(item['provider']);
          final start = DateTime.tryParse(item['startsAt']?.toString() ?? '')?.toLocal();
          final active = item['status'] == 'CONFIRMED' || item['status'] == 'REQUESTED';
          return Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text(service['name']?.toString() ?? 'Appointment', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))), Chip(label: Text(item['status']?.toString() ?? ''))]),
            Text(provider['displayName']?.toString() ?? ''),
            const SizedBox(height: 6),
            Text('${_dateTime(start)} · ${item['modality'] ?? ''}', style: const TextStyle(color: Color(0xFF475569))),
            if (active) ...[const SizedBox(height: 10), OutlinedButton.icon(onPressed: () => cancel(item), icon: const Icon(Icons.cancel_outlined), label: Text(cpText(widget.locale, 'patient.cancelVisit')))],
          ])));
        },
      ),
    );
  }

  Future<void> cancel(Map<String, dynamic> item) async {
    final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(title: Text(cpText(widget.locale, 'patient.cancelVisit')), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(widget.locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(cpText(widget.locale, 'patient.cancelVisit')))]));
    if (ok != true) return;
    try {
      await widget.session.api.cancelAppointment(item['id'].toString(), reason: 'Cancelled from patient mobile app');
      await load();
    } catch (value) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString()))); }
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message, required this.onRetry, required this.locale});
  final String message;
  final VoidCallback onRetry;
  final CarePointLocale locale;
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(28), child: Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.error_outline, size: 42, color: Color(0xFFDC2626)), const SizedBox(height: 10), Text(message, textAlign: TextAlign.center), const SizedBox(height: 12), FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(cpText(locale, 'common.retry')))])));
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

IconData _modalityIcon(String? value) => switch (value) { 'TELEMEDICINE' => Icons.video_call_outlined, 'HOME_VISIT' => Icons.home_outlined, _ => Icons.local_hospital_outlined };
String _money(dynamic minor, dynamic currency) => '${((minor is num ? minor.toInt() : int.tryParse(minor?.toString() ?? '') ?? 0) / 100).toStringAsFixed(2)} ${currency ?? ''}';
String _dateTime(DateTime? value) => value == null ? '—' : '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')} ${_time(value)}';
String _time(DateTime? value) => value == null ? '—' : '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
