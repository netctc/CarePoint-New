import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';

class ProviderWorkspace extends StatefulWidget {
  const ProviderWorkspace({
    super.key,
    required this.session,
    required this.locale,
    required this.title,
    required this.accent,
    required this.onSignOut,
    this.dark = false,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String title;
  final Color accent;
  final VoidCallback onSignOut;
  final bool dark;

  @override
  State<ProviderWorkspace> createState() => _ProviderWorkspaceState();
}

class _ProviderWorkspaceState extends State<ProviderWorkspace> {
  int tab = 0;
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> appointments = const [];
  List<Map<String, dynamic>> services = const [];
  List<Map<String, dynamic>> rules = const [];

  CarePointApi get api => widget.session.api;
  CarePointLocale get locale => widget.locale;

  @override
  void initState() {
    super.initState();
    refreshAll();
  }

  Future<void> refreshAll() async {
    setState(() { busy = true; error = null; });
    try {
      final now = DateTime.now();
      final values = await Future.wait([
        api.providerAppointments(from: now.subtract(const Duration(days: 1)), to: now.add(const Duration(days: 31))),
        api.providerServices(),
        api.availabilityRules(),
      ]);
      if (!mounted) return;
      setState(() {
        appointments = values[0];
        services = values[1];
        rules = values[2];
      });
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: widget.dark ? const Color(0xFF0F172A) : null,
        appBar: AppBar(
          title: Text(widget.title),
          actions: [
            IconButton(onPressed: refreshAll, icon: const Icon(Icons.refresh_rounded), tooltip: cpText(locale, 'common.refresh')),
            PopupMenuButton<String>(
              onSelected: (value) { if (value == 'logout') widget.onSignOut(); },
              itemBuilder: (_) => [PopupMenuItem(value: 'logout', child: Text(cpText(locale, 'auth.signOut')))],
            ),
          ],
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? _ErrorPanel(message: error!, onRetry: refreshAll, locale: locale)
                : IndexedStack(index: tab, children: [_agenda(), _services(), _availability()]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (value) => setState(() => tab = value),
          destinations: [
            NavigationDestination(icon: const Icon(Icons.calendar_today_outlined), selectedIcon: const Icon(Icons.calendar_today), label: cpText(locale, 'workspace.agenda')),
            NavigationDestination(icon: const Icon(Icons.medical_services_outlined), selectedIcon: const Icon(Icons.medical_services), label: cpText(locale, 'workspace.services')),
            NavigationDestination(icon: const Icon(Icons.schedule_outlined), selectedIcon: const Icon(Icons.schedule), label: cpText(locale, 'workspace.availability')),
          ],
        ),
        floatingActionButton: tab == 1
            ? FloatingActionButton.extended(onPressed: _createService, icon: const Icon(Icons.add), label: Text(cpText(locale, 'workspace.newService')))
            : tab == 2
                ? FloatingActionButton.extended(onPressed: services.isEmpty ? null : _createRule, icon: const Icon(Icons.add), label: Text(cpText(locale, 'workspace.newRule')))
                : null,
      );

  Widget _agenda() {
    if (appointments.isEmpty) return _empty(cpText(locale, 'workspace.noAppointments'), Icons.event_busy_outlined);
    return RefreshIndicator(
      onRefresh: refreshAll,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: appointments.length,
        itemBuilder: (_, index) {
          final item = appointments[index];
          final service = _map(item['service']);
          final patient = _map(item['patient']);
          final starts = DateTime.tryParse(item['startsAt']?.toString() ?? '')?.toLocal();
          final patientName = [patient['firstName'], patient['lastName']].whereType<String>().where((v) => v.isNotEmpty).join(' ');
          return Card(
            child: ListTile(
              leading: CircleAvatar(backgroundColor: widget.accent.withValues(alpha: .14), child: Icon(_modalityIcon(item['modality']?.toString()), color: widget.accent)),
              title: Text(patientName.isEmpty ? service['name']?.toString() ?? 'Appointment' : patientName, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${_dateTime(starts)} · ${service['name'] ?? item['modality'] ?? ''}\n${item['status'] ?? ''}'),
              isThreeLine: true,
            ),
          );
        },
      ),
    );
  }

  Widget _services() {
    if (services.isEmpty) return _empty(cpText(locale, 'workspace.noServices'), Icons.medical_services_outlined);
    return RefreshIndicator(
      onRefresh: refreshAll,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: services.length,
        itemBuilder: (_, index) {
          final item = services[index];
          final modalities = _list(item['modalities']);
          return Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [Expanded(child: Text(_localized(item['labels'], item['name']?.toString() ?? ''), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800))), if (item['active'] == true) const Icon(Icons.verified_rounded, color: Color(0xFF10B981))]),
                const SizedBox(height: 10),
                Wrap(spacing: 8, runSpacing: 8, children: modalities.map((m) => Chip(label: Text('${m['modality']} · ${m['durationMinutes']} min · ${_money(m['priceMinor'], item['currency'])}'))).toList()),
              ]),
            ),
          );
        },
      ),
    );
  }

  Widget _availability() {
    return RefreshIndicator(
      onRefresh: refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(cpText(locale, 'workspace.activeOnly'), style: const TextStyle(color: Color(0xFF64748B))),
                const SizedBox(height: 12),
                FilledButton.icon(onPressed: rules.isEmpty ? null : _generate, icon: const Icon(Icons.auto_awesome_outlined), label: Text(cpText(locale, 'workspace.generate'))),
              ]),
            ),
          ),
          const SizedBox(height: 10),
          if (rules.isEmpty) _empty(cpText(locale, 'workspace.noRules'), Icons.schedule_outlined, embedded: true),
          ...rules.map((item) {
            final service = _map(item['service']);
            return Card(
              child: ListTile(
                leading: CircleAvatar(child: Text('${item['weekday'] ?? '?'}')),
                title: Text(service['name']?.toString() ?? 'Service', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${item['modality']} · ${_minutes(item['startMinute'])}–${_minutes(item['endMinute'])}\n${item['timezone']} · ${item['intervalMinutes']} min'),
                isThreeLine: true,
              ),
            );
          }),
        ],
      ),
    );
  }

  Future<void> _createService() async {
    final name = TextEditingController();
    final duration = TextEditingController(text: '30');
    final price = TextEditingController(text: '5000');
    final currency = TextEditingController(text: 'USD');
    String modality = 'CLINIC';
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(builder: (context, setModalState) => AlertDialog(
        title: Text(cpText(locale, 'workspace.newService')),
        content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: InputDecoration(labelText: cpText(locale, 'workspace.serviceName'))),
          DropdownButtonFormField<String>(value: modality, decoration: InputDecoration(labelText: cpText(locale, 'workspace.modality')), items: _modalities.map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(), onChanged: (v) => setModalState(() => modality = v ?? modality)),
          TextField(controller: duration, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: cpText(locale, 'workspace.duration'))),
          TextField(controller: price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: cpText(locale, 'workspace.priceMinor'))),
          TextField(controller: currency, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: cpText(locale, 'workspace.currency'))),
        ])),
        actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(cpText(locale, 'common.save')))],
      )),
    );
    if (accepted != true) return;
    try {
      await api.createProviderService(name: name.text.trim(), modality: modality, durationMinutes: int.parse(duration.text), priceMinor: int.parse(price.text), currency: currency.text.trim());
      await refreshAll();
    } catch (value) { _showError(value); }
  }

  Future<void> _createRule() async {
    String serviceId = services.first['id'].toString();
    String modality = _firstModality(services.first);
    String timezone = const String.fromEnvironment('CAREPOINT_TIMEZONE', defaultValue: 'Asia/Beirut');
    int weekday = DateTime.now().weekday % 7;
    final start = TextEditingController(text: '09:00');
    final end = TextEditingController(text: '17:00');
    final interval = TextEditingController(text: '30');
    final tz = TextEditingController(text: timezone);
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(builder: (context, setModalState) {
        final selected = services.firstWhere((s) => s['id'].toString() == serviceId, orElse: () => services.first);
        final availableModalities = _list(selected['modalities']).map((m) => m['modality'].toString()).toList();
        if (!availableModalities.contains(modality)) modality = availableModalities.first;
        return AlertDialog(
          title: Text(cpText(locale, 'workspace.newRule')),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(value: serviceId, items: services.map((s) => DropdownMenuItem(value: s['id'].toString(), child: Text(s['name']?.toString() ?? 'Service'))).toList(), onChanged: (v) => setModalState(() { serviceId = v ?? serviceId; modality = _firstModality(services.firstWhere((s) => s['id'].toString() == serviceId)); })),
            DropdownButtonFormField<String>(value: modality, decoration: InputDecoration(labelText: cpText(locale, 'workspace.modality')), items: availableModalities.map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(), onChanged: (v) => setModalState(() => modality = v ?? modality)),
            TextField(controller: tz, decoration: InputDecoration(labelText: cpText(locale, 'workspace.timezone'))),
            DropdownButtonFormField<int>(value: weekday, decoration: InputDecoration(labelText: cpText(locale, 'workspace.weekday')), items: List.generate(7, (i) => DropdownMenuItem(value: i, child: Text('$i'))), onChanged: (v) => setModalState(() => weekday = v ?? weekday)),
            TextField(controller: start, decoration: InputDecoration(labelText: cpText(locale, 'workspace.startTime'))),
            TextField(controller: end, decoration: InputDecoration(labelText: cpText(locale, 'workspace.endTime'))),
            TextField(controller: interval, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: cpText(locale, 'workspace.interval'))),
          ])),
          actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(cpText(locale, 'common.save')))],
        );
      }),
    );
    if (accepted != true) return;
    try {
      await api.createAvailabilityRule(
        serviceId: serviceId,
        modality: modality,
        timezone: tz.text.trim(),
        weekday: weekday,
        startMinute: _parseTime(start.text),
        endMinute: _parseTime(end.text),
        intervalMinutes: int.parse(interval.text),
        effectiveFrom: _date(DateTime.now()),
      );
      await refreshAll();
    } catch (value) { _showError(value); }
  }

  Future<void> _generate() async {
    final now = DateTime.now();
    try {
      final result = await api.generateAvailability(fromDate: _date(now), toDate: _date(now.add(const Duration(days: 29))));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${cpText(locale, 'workspace.generated')}: ${result['createdCount'] ?? 0}')));
    } catch (value) { _showError(value); }
  }

  Widget _empty(String text, IconData icon, {bool embedded = false}) => Center(
        child: Padding(
          padding: EdgeInsets.all(embedded ? 28 : 48),
          child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 46, color: const Color(0xFF94A3B8)), const SizedBox(height: 12), Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B)))]),
        ),
      );

  void _showError(Object value) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
  }

  String _localized(dynamic labels, String fallback) {
    final map = _map(labels);
    return map[locale.name]?.toString().trim().isNotEmpty == true ? map[locale.name].toString() : fallback;
  }

  String _firstModality(Map<String, dynamic> service) {
    final items = _list(service['modalities']);
    return items.isEmpty ? 'CLINIC' : items.first['modality'].toString();
  }

  int _parseTime(String text) {
    final parts = text.trim().split(':');
    if (parts.length != 2) throw const CarePointApiException('Time must use HH:MM.');
    final h = int.parse(parts[0]);
    final m = int.parse(parts[1]);
    if (h < 0 || h > 23 || m < 0 || m > 59) throw const CarePointApiException('Invalid time.');
    return h * 60 + m;
  }

  String _minutes(dynamic value) {
    final total = value is int ? value : int.tryParse(value?.toString() ?? '') ?? 0;
    return '${(total ~/ 60).toString().padLeft(2, '0')}:${(total % 60).toString().padLeft(2, '0')}';
  }

  String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
  String _dateTime(DateTime? value) => value == null ? '—' : '${_date(value)} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
  String _money(dynamic minor, dynamic currency) => '${((minor is num ? minor.toInt() : int.tryParse(minor?.toString() ?? '') ?? 0) / 100).toStringAsFixed(2)} ${currency ?? ''}';
  IconData _modalityIcon(String? value) => switch (value) { 'TELEMEDICINE' => Icons.video_call_outlined, 'HOME_VISIT' => Icons.home_outlined, _ => Icons.local_hospital_outlined };
}

const _modalities = ['CLINIC', 'TELEMEDICINE', 'HOME_VISIT'];

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _list(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.message, required this.onRetry, required this.locale});
  final String message;
  final VoidCallback onRetry;
  final CarePointLocale locale;
  @override
  Widget build(BuildContext context) => Center(child: Padding(padding: const EdgeInsets.all(28), child: Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.error_outline, size: 48, color: Color(0xFFDC2626)), const SizedBox(height: 12), Text(message, textAlign: TextAlign.center), const SizedBox(height: 16), FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(cpText(locale, 'common.retry')))])));
}
