import 'package:flutter/material.dart';

import 'carepoint_api.dart';
import 'carepoint_auth.dart';
import 'carepoint_localization.dart';
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _requestSummary(request, emergency: emergency),
          if (next != null) ...[
            const SizedBox(height: 10),
            FilledButton.tonalIcon(
              onPressed: () => _advance(request['id']?.toString() ?? '', next, emergency: emergency),
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
      if (emergency) Text('${transportText(widget.locale, 'pickup')}: ${request['pickupAddress'] ?? '${request['latitude']}, ${request['longitude']}'}'),
      if (eta != null) Text('${transportText(widget.locale, 'eta')}: $eta ${transportText(widget.locale, 'minutes')}'),
    ]);
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

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

String _displayDate(String raw) {
  final parsed = DateTime.tryParse(raw)?.toLocal();
  if (parsed == null) return raw;
  String two(int value) => value.toString().padLeft(2, '0');
  return '${parsed.year}-${two(parsed.month)}-${two(parsed.day)} ${two(parsed.hour)}:${two(parsed.minute)}';
}
