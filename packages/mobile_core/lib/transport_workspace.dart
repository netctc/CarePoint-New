import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_localization.dart';
import 'transport_handoff.dart';
import 'transport_incidents.dart';
import 'transport_localization.dart';

class ProviderTransportWorkspace extends StatefulWidget {
  const ProviderTransportWorkspace({super.key, required this.session, required this.locale, required this.accent});
  final CarePointSession session;
  final CarePointLocale locale;
  final Color accent;

  @override
  State<ProviderTransportWorkspace> createState() => _ProviderTransportWorkspaceState();
}

class _ProviderTransportWorkspaceState extends State<ProviderTransportWorkspace> {
  bool busy = true;
  String? error;
  bool emergencyEnabled = false;
  bool scheduledEnabled = false;
  List<Map<String, dynamic>> emergencyJobs = const [];
  List<Map<String, dynamic>> available = const [];
  List<Map<String, dynamic>> assigned = const [];

  CarePointApi get api => widget.session.api;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() { busy = true; error = null; });
    try {
      List<Map<String, dynamic>> nextEmergency = const [];
      List<Map<String, dynamic>> nextAvailable = const [];
      List<Map<String, dynamic>> nextAssigned = const [];
      var emergency = false;
      var scheduled = false;
      try {
        nextEmergency = await api.providerEmergencyAmbulanceJobs();
        emergency = true;
      } on CarePointApiException catch (value) {
        if (value.statusCode != 403) rethrow;
      }
      try {
        final values = await Future.wait<List<Map<String, dynamic>>>([
          api.providerAvailableMedicalTransport(),
          api.providerMedicalTransportJobs(),
        ]);
        nextAvailable = values[0];
        nextAssigned = values[1];
        scheduled = true;
      } on CarePointApiException catch (value) {
        if (value.statusCode != 403) rethrow;
      }
      if (mounted) {
        setState(() {
          emergencyEnabled = emergency;
          scheduledEnabled = scheduled;
          emergencyJobs = nextEmergency;
          available = nextAvailable;
          assigned = nextAssigned;
        });
      }
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(transportText(widget.locale, 'providerTitle')),
          actions: [IconButton(onPressed: refresh, icon: const Icon(Icons.refresh_rounded))],
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? _error(error!)
                : !emergencyEnabled && !scheduledEnabled
                    ? _notEnabled()
                    : RefreshIndicator(onRefresh: refresh, child: _body()),
      );

  Widget _body() => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (emergencyEnabled) ...[
            _sectionTitle(transportText(widget.locale, 'emergency'), Icons.emergency_share_outlined),
            if (emergencyJobs.isEmpty) _empty(transportText(widget.locale, 'noJobs')),
            ...emergencyJobs.map((job) => _jobCard(job, emergency: true)),
          ],
          if (scheduledEnabled) ...[
            _sectionTitle(transportText(widget.locale, 'available'), Icons.local_shipping_outlined),
            if (available.isEmpty) _empty(transportText(widget.locale, 'noJobs')),
            ...available.map(_availableCard),
            const SizedBox(height: 18),
            _sectionTitle(transportText(widget.locale, 'assigned'), Icons.assignment_turned_in_outlined),
            if (assigned.isEmpty) _empty(transportText(widget.locale, 'noJobs')),
            ...assigned.map((job) => _jobCard(job, emergency: false)),
          ],
        ],
      );

  Widget _sectionTitle(String text, IconData icon) => Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 6),
        child: Row(children: [Icon(icon), const SizedBox(width: 8), Expanded(child: Text(text, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)))]),
      );

  Widget _availableCard(Map<String, dynamic> request) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _requestSummary(request),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: () => _accept(request['id']?.toString() ?? ''),
              icon: const Icon(Icons.task_alt_rounded),
              label: Text(transportText(widget.locale, 'accept')),
            ),
          ]),
        ),
      );

  Widget _jobCard(Map<String, dynamic> request, {required bool emergency}) {
    final status = request['status']?.toString() ?? '';
    final next = _nextStatus(status);
    final requestId = request['id']?.toString() ?? '';
    final incidentEnabled = const {'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'TRANSPORTING'}.contains(status);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _requestSummary(request, emergency: emergency),
          if (!emergency) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: requestId.isEmpty ? null : () => _resources(requestId),
              icon: const Icon(Icons.groups_2_outlined),
              label: Text(transportText(widget.locale, 'crewUnit')),
            ),
            if (incidentEnabled) ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: requestId.isEmpty ? null : () => _incidents(requestId),
                icon: const Icon(Icons.report_problem_outlined),
                label: Text(transportIncidentText(widget.locale, 'action')),
              ),
            ],
            if (status == 'TRANSPORTING' || status == 'COMPLETED') ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: requestId.isEmpty ? null : () => _handoff(requestId, status),
                icon: const Icon(Icons.how_to_reg_outlined),
                label: Text(transportHandoffText(widget.locale, 'action')),
              ),
            ],
          ],
          if (next != null) ...[
            const SizedBox(height: 10),
            FilledButton.tonalIcon(
              onPressed: () => _advance(requestId, next, emergency: emergency),
              icon: const Icon(Icons.navigate_next_rounded),
              label: Text('${transportText(widget.locale, 'advance')} · $next'),
            ),
          ],
        ]),
      ),
    );
  }

  Widget _requestSummary(Map<String, dynamic> request, {bool emergency = false}) {
    final patient = _map(request['patient']);
    final patientName = '${patient['firstName'] ?? ''} ${patient['lastName'] ?? ''}'.trim();
    final eta = request['etaMinutes'];
    final scheduled = request['scheduledFor']?.toString();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        CircleAvatar(child: Icon(emergency ? Icons.emergency_outlined : Icons.local_shipping_outlined)),
        const SizedBox(width: 10),
        Expanded(child: Text(patientName.isEmpty ? (request['mode']?.toString() ?? transportText(widget.locale, 'title')) : patientName, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16))),
        Chip(label: Text(request['status']?.toString() ?? '')),
      ]),
      const SizedBox(height: 8),
      if (!emergency && scheduled != null) Text('${transportText(widget.locale, 'scheduledFor')}: ${_displayDate(scheduled)}'),
      if (!emergency) Text('${transportText(widget.locale, 'pickup')}: ${request['pickupAddress'] ?? '${request['pickupLatitude']}, ${request['pickupLongitude']}'}'),
      if (!emergency) Text('${transportText(widget.locale, 'destination')}: ${request['destinationAddress'] ?? '${request['destinationLatitude']}, ${request['destinationLongitude']}'}'),
      if (!emergency) Text('${transportText(widget.locale, 'companions')}: ${request['companionCount'] ?? 0}'),
      if (!emergency) Text('${transportText(widget.locale, 'equipment')}: ${_equipmentText(request['equipment'])}'),
      if (emergency) Text('${transportText(widget.locale, 'pickup')}: ${request['pickupAddress'] ?? '${request['latitude']}, ${request['longitude']}'}'),
      if (eta != null) Text('${transportText(widget.locale, 'eta')}: $eta ${transportText(widget.locale, 'minutes')}'),
    ]);
  }

  String _equipmentText(dynamic raw) {
    final values = raw is List ? raw.map((value) => value.toString()).toList(growable: false) : const <String>[];
    if (values.isEmpty) return transportText(widget.locale, 'none');
    return values.map((value) => switch (value) {
      'OXYGEN' => transportText(widget.locale, 'oxygen'),
      'MONITORING' => transportText(widget.locale, 'monitoring'),
      'VENTILATION' => transportText(widget.locale, 'ventilation'),
      _ => value,
    }).join(', ');
  }

  Future<void> _accept(String requestId) async {
    if (requestId.isEmpty) return;
    await _run(() => api.acceptMedicalTransport(requestId));
  }

  Future<void> _advance(String requestId, String status, {required bool emergency}) async {
    if (requestId.isEmpty) return;
    await _run(() => emergency
        ? api.updateProviderEmergencyAmbulanceStatus(requestId, status: status)
        : api.updateProviderMedicalTransportStatus(requestId, status: status));
  }

  Future<void> _resources(String requestId) async {
    try {
      final data = await api.providerMedicalTransportResources(requestId);
      if (!mounted) return;
      final changed = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (_) => _TransportResourcesSheet(
          api: api,
          requestId: requestId,
          locale: widget.locale,
          accent: widget.accent,
          data: data,
        ),
      );
      if (changed == true) await refresh();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Future<void> _incidents(String requestId) async {
    try {
      await showTransportIncidentsSheet(
        context: context,
        api: api,
        requestId: requestId,
        locale: widget.locale,
      );
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Future<void> _handoff(String requestId, String status) async {
    try {
      final changed = await showTransportHandoffSheet(
        context: context,
        api: api,
        requestId: requestId,
        status: status,
        locale: widget.locale,
      );
      if (changed == true) await refresh();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Future<void> _run(Future<Map<String, dynamic>> Function() action) async {
    try {
      await action();
      await refresh();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  String? _nextStatus(String status) => switch (status) {
        'ASSIGNED' => 'EN_ROUTE',
        'EN_ROUTE' => 'ARRIVED',
        'ARRIVED' => 'TRANSPORTING',
        'TRANSPORTING' => 'COMPLETED',
        _ => null,
      };

  Widget _notEnabled() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.no_transfer_outlined, size: 50),
            const SizedBox(height: 12),
            Text(transportText(widget.locale, 'notTransportProvider'), textAlign: TextAlign.center),
          ]),
        ),
      );

  Widget _error(String message) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: refresh, child: Text(transportText(widget.locale, 'refresh'))),
          ]),
        ),
      );

  Widget _empty(String text) => Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Text(text, textAlign: TextAlign.center));
}

class _TransportResourcesSheet extends StatefulWidget {
  const _TransportResourcesSheet({
    required this.api,
    required this.requestId,
    required this.locale,
    required this.accent,
    required this.data,
  });

  final CarePointApi api;
  final String requestId;
  final CarePointLocale locale;
  final Color accent;
  final Map<String, dynamic> data;

  @override
  State<_TransportResourcesSheet> createState() => _TransportResourcesSheetState();
}

class _TransportResourcesSheetState extends State<_TransportResourcesSheet> {
  late final List<Map<String, dynamic>> units;
  late final List<Map<String, dynamic>> crew;
  late String? selectedUnitId;
  late Set<String> selectedCrewIds;
  bool saving = false;
  String? error;

  @override
  void initState() {
    super.initState();
    final options = _map(widget.data['options']);
    units = _maps(options['units']);
    crew = _maps(options['crew']);
    final current = _map(widget.data['current']);
    final currentUnitId = _map(current['transportUnit'])['id']?.toString();
    final unitIds = units.map((unit) => unit['id']?.toString() ?? '').where((id) => id.isNotEmpty).toSet();
    selectedUnitId = currentUnitId != null && unitIds.contains(currentUnitId)
        ? currentUnitId
        : units.isNotEmpty
            ? units.first['id']?.toString()
            : null;
    final crewIds = crew.map((provider) => provider['id']?.toString() ?? '').where((id) => id.isNotEmpty).toSet();
    selectedCrewIds = _maps(current['crew'])
        .map((provider) => provider['id']?.toString() ?? '')
        .where((id) => crewIds.contains(id))
        .toSet();
  }

  bool get mutable => widget.data['mutable'] == true;

  @override
  Widget build(BuildContext context) {
    final current = _map(widget.data['current']);
    final revision = current['revision'];
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.82,
      minChildSize: 0.55,
      maxChildSize: 0.96,
      builder: (context, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
        children: [
          Center(child: Container(width: 44, height: 4, decoration: BoxDecoration(color: Theme.of(context).dividerColor, borderRadius: BorderRadius.circular(8)))),
          const SizedBox(height: 18),
          Text(transportText(widget.locale, 'resourcesTitle'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          if (revision != null) ...[
            const SizedBox(height: 4),
            Text('${transportText(widget.locale, 'assignmentRevision')}: $revision'),
          ],
          const SizedBox(height: 18),
          Text(transportText(widget.locale, 'unit'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (units.isEmpty)
            _notice(transportText(widget.locale, 'noCompatibleUnit'))
          else
            DropdownButtonFormField<String>(
              initialValue: selectedUnitId,
              decoration: InputDecoration(border: const OutlineInputBorder(), labelText: transportText(widget.locale, 'unit')),
              items: units.map((unit) {
                final id = unit['id']?.toString() ?? '';
                final code = unit['code']?.toString() ?? id;
                final registration = unit['registrationCode']?.toString() ?? '';
                return DropdownMenuItem(value: id, child: Text(registration.isEmpty ? code : '$code · $registration'));
              }).toList(growable: false),
              onChanged: mutable && !saving ? (value) => setState(() => selectedUnitId = value) : null,
            ),
          const SizedBox(height: 18),
          Text(transportText(widget.locale, 'crew'), style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          if (crew.isEmpty)
            _notice(transportText(widget.locale, 'noCompatibleCrew'))
          else
            ...crew.map((provider) {
              final id = provider['id']?.toString() ?? '';
              final name = provider['displayName']?.toString() ?? id;
              return CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: selectedCrewIds.contains(id),
                title: Text(name),
                controlAffinity: ListTileControlAffinity.leading,
                onChanged: mutable && !saving
                    ? (checked) => setState(() {
                          if (checked == true) {
                            if (selectedCrewIds.length < 8) selectedCrewIds.add(id);
                          } else {
                            selectedCrewIds.remove(id);
                          }
                        })
                    : null,
              );
            }),
          if (!mutable) ...[
            const SizedBox(height: 12),
            _notice(transportText(widget.locale, 'resourcesLocked')),
          ],
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: mutable && !saving && selectedUnitId != null && selectedCrewIds.isNotEmpty ? _save : null,
            icon: saving
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save_outlined),
            label: Text(transportText(widget.locale, 'saveResources')),
          ),
        ],
      ),
    );
  }

  Widget _notice(String text) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(text),
      );

  Future<void> _save() async {
    final unitId = selectedUnitId;
    if (unitId == null || selectedCrewIds.isEmpty) return;
    setState(() { saving = true; error = null; });
    try {
      await widget.api.updateProviderMedicalTransportResources(
        widget.requestId,
        transportUnitId: unitId,
        crewProviderIds: selectedCrewIds.toList(growable: false),
        idempotencyKey: 'transport-resources-${widget.requestId}-${DateTime.now().microsecondsSinceEpoch}',
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _maps(dynamic value) {
  if (value is! List) return const [];
  return value.map(_map).toList(growable: false);
}

String _displayDate(String raw) {
  final parsed = DateTime.tryParse(raw)?.toLocal();
  if (parsed == null) return raw;
  String two(int value) => value.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
