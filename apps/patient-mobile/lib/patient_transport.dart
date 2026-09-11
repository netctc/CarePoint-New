import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_emergency.dart';
import 'package:carepoint_mobile_core/transport_localization.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

Future<void> openEmergencyAmbulanceFlow(
  BuildContext context, {
  required CarePointSession session,
  required CarePointLocale locale,
}) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (_) => Directionality(
      textDirection: locale.textDirection,
      child: AlertDialog(
        icon: const Icon(Icons.emergency_share_outlined, color: Color(0xFFE11D48), size: 38),
        title: Text(transportText(locale, 'emergencyConfirm')),
        content: Text(transportText(locale, 'emergencyWarning')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(cpText(locale, 'common.cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE11D48), foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(context, true),
            child: Text(transportText(locale, 'requestEmergency')),
          ),
        ],
      ),
    ),
  );
  if (confirmed != true || !context.mounted) return;

  final messenger = ScaffoldMessenger.of(context);
  try {
    messenger.showSnackBar(SnackBar(content: Text(transportText(locale, 'locating'))));
    final position = await _currentPosition(locale);
    final response = await session.api.requestEmergencyAmbulance(
      clientRequestId: 'mobile-emergency-${DateTime.now().microsecondsSinceEpoch}',
      latitude: position.latitude,
      longitude: position.longitude,
    );
    if (!context.mounted) return;
    messenger.hideCurrentSnackBar();
    final requestId = _map(response['request'])['id']?.toString() ?? '';
    await Navigator.of(context).push<void>(MaterialPageRoute(
      builder: (_) => PatientEmergencyStatusPage(
        session: session,
        locale: locale,
        requestId: requestId,
        initial: response,
      ),
    ));
  } catch (value) {
    if (!context.mounted) return;
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(content: Text(value.toString()), backgroundColor: const Color(0xFFE11D48)));
  }
}

Future<Position> _currentPosition(CarePointLocale locale) async {
  if (!await Geolocator.isLocationServiceEnabled()) {
    throw CarePointApiException(transportText(locale, 'locationDenied'));
  }
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
  if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
    throw CarePointApiException(transportText(locale, 'locationDenied'));
  }
  return Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
}

class PatientMedicalTransportPage extends StatefulWidget {
  const PatientMedicalTransportPage({super.key, required this.session, required this.locale});
  final CarePointSession session;
  final CarePointLocale locale;

  @override
  State<PatientMedicalTransportPage> createState() => _PatientMedicalTransportPageState();
}

class _PatientMedicalTransportPageState extends State<PatientMedicalTransportPage> {
  bool busy = true;
  String? error;
  List<Map<String, dynamic>> requests = const [];

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    setState(() { busy = true; error = null; });
    try {
      final next = await widget.session.api.medicalTransportRequests();
      if (mounted) setState(() => requests = next);
    } catch (value) {
      if (mounted) setState(() => error = value.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(transportText(widget.locale, 'title')),
          actions: [IconButton(onPressed: refresh, icon: const Icon(Icons.refresh_rounded))],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _create,
          icon: const Icon(Icons.add_road_outlined),
          label: Text(transportText(widget.locale, 'schedule')),
        ),
        body: busy
            ? const Center(child: CircularProgressIndicator())
            : error != null
                ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(error!, textAlign: TextAlign.center)))
                : RefreshIndicator(
                    onRefresh: refresh,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                      children: requests.isEmpty
                          ? [Padding(padding: const EdgeInsets.all(32), child: Text(transportText(widget.locale, 'noRequests'), textAlign: TextAlign.center))]
                          : requests.map(_card).toList(),
                    ),
                  ),
      );

  Widget _card(Map<String, dynamic> item) {
    final status = item['status']?.toString() ?? '';
    final provider = _map(item['assignedProvider']);
    final cancellable = status == 'REQUESTED' || status == 'ASSIGNED';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            CircleAvatar(child: Icon(item['mode'] == 'AIR' ? Icons.flight_outlined : Icons.local_shipping_outlined)),
            const SizedBox(width: 10),
            Expanded(child: Text(item['mode'] == 'AIR' ? transportText(widget.locale, 'air') : transportText(widget.locale, 'ground'), style: const TextStyle(fontWeight: FontWeight.w900))),
            Chip(label: Text(status)),
          ]),
          const SizedBox(height: 8),
          Text('${transportText(widget.locale, 'scheduledFor')}: ${_displayDate(item['scheduledFor']?.toString() ?? '')}'),
          Text('${transportText(widget.locale, 'pickup')}: ${item['pickupAddress'] ?? '${item['pickupLatitude']}, ${item['pickupLongitude']}'}'),
          Text('${transportText(widget.locale, 'destination')}: ${item['destinationAddress'] ?? '${item['destinationLatitude']}, ${item['destinationLongitude']}'}'),
          if (provider['displayName'] != null) Text(provider['displayName'].toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
          if (item['etaMinutes'] != null) Text('${transportText(widget.locale, 'eta')}: ${item['etaMinutes']} ${transportText(widget.locale, 'minutes')}'),
          if (cancellable) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => _cancel(item['id']?.toString() ?? ''),
              icon: const Icon(Icons.cancel_outlined),
              label: Text(transportText(widget.locale, 'cancel')),
            ),
          ],
        ]),
      ),
    );
  }

  Future<void> _cancel(String id) async {
    if (id.isEmpty) return;
    try {
      await widget.session.api.cancelMedicalTransport(id, reason: 'Cancelled by Patient from mobile app');
      await refresh();
    } catch (value) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
    }
  }

  Future<void> _create() async {
    final result = await showDialog<_TransportDraft>(
      context: context,
      builder: (_) => Directionality(textDirection: widget.locale.textDirection, child: _TransportDialog(locale: widget.locale)),
    );
    if (result == null || !mounted) return;
    try {
      setState(() => busy = true);
      final pickup = await _currentPosition(widget.locale);
      await widget.session.api.createMedicalTransport(
        clientRequestId: 'mobile-transport-${DateTime.now().microsecondsSinceEpoch}',
        mode: result.mode,
        scheduledFor: result.scheduledFor,
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        pickupAddress: result.pickupAddress,
        destinationLatitude: result.destinationLatitude,
        destinationLongitude: result.destinationLongitude,
        destinationAddress: result.destinationAddress,
        assistance: result.assistance,
      );
      await refresh();
    } catch (value) {
      if (mounted) {
        setState(() => busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value.toString())));
      }
    }
  }
}

class _TransportDraft {
  const _TransportDraft({
    required this.mode,
    required this.assistance,
    required this.scheduledFor,
    required this.destinationLatitude,
    required this.destinationLongitude,
    this.pickupAddress,
    this.destinationAddress,
  });
  final String mode;
  final String assistance;
  final DateTime scheduledFor;
  final double destinationLatitude;
  final double destinationLongitude;
  final String? pickupAddress;
  final String? destinationAddress;
}

class _TransportDialog extends StatefulWidget {
  const _TransportDialog({required this.locale});
  final CarePointLocale locale;

  @override
  State<_TransportDialog> createState() => _TransportDialogState();
}

class _TransportDialogState extends State<_TransportDialog> {
  final pickupAddress = TextEditingController();
  final destinationAddress = TextEditingController();
  final destinationLatitude = TextEditingController();
  final destinationLongitude = TextEditingController();
  String mode = 'GROUND';
  String assistance = 'STANDARD';
  DateTime scheduledFor = DateTime.now().add(const Duration(hours: 2));

  @override
  void dispose() {
    pickupAddress.dispose();
    destinationAddress.dispose();
    destinationLatitude.dispose();
    destinationLongitude.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(transportText(widget.locale, 'schedule')),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              DropdownButtonFormField<String>(
                initialValue: mode,
                decoration: InputDecoration(labelText: transportText(widget.locale, 'mode')),
                items: [
                  DropdownMenuItem(value: 'GROUND', child: Text(transportText(widget.locale, 'ground'))),
                  DropdownMenuItem(value: 'AIR', child: Text(transportText(widget.locale, 'air'))),
                ],
                onChanged: (value) => setState(() => mode = value ?? mode),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: assistance,
                decoration: InputDecoration(labelText: transportText(widget.locale, 'assistance')),
                items: [
                  DropdownMenuItem(value: 'STANDARD', child: Text(transportText(widget.locale, 'standard'))),
                  DropdownMenuItem(value: 'WHEELCHAIR', child: Text(transportText(widget.locale, 'wheelchair'))),
                  DropdownMenuItem(value: 'STRETCHER', child: Text(transportText(widget.locale, 'stretcher'))),
                ],
                onChanged: (value) => setState(() => assistance = value ?? assistance),
              ),
              const SizedBox(height: 10),
              TextField(controller: pickupAddress, decoration: InputDecoration(labelText: '${transportText(widget.locale, 'pickup')} · ${transportText(widget.locale, 'address')}')),
              const SizedBox(height: 10),
              TextField(controller: destinationAddress, decoration: InputDecoration(labelText: '${transportText(widget.locale, 'destination')} · ${transportText(widget.locale, 'address')}')),
              const SizedBox(height: 10),
              TextField(controller: destinationLatitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'destination')} · ${transportText(widget.locale, 'latitude')}')),
              const SizedBox(height: 10),
              TextField(controller: destinationLongitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'destination')} · ${transportText(widget.locale, 'longitude')}')),
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.schedule_outlined),
                title: Text(transportText(widget.locale, 'scheduledFor')),
                subtitle: Text(_displayDate(scheduledFor.toIso8601String())),
                onTap: _pickDateTime,
              ),
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(cpText(widget.locale, 'common.cancel'))),
          FilledButton(onPressed: _submit, child: Text(transportText(widget.locale, 'request'))),
        ],
      );

  Future<void> _pickDateTime() async {
    final date = await showDatePicker(context: context, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: scheduledFor);
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(scheduledFor));
    if (time == null) return;
    setState(() => scheduledFor = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  void _submit() {
    final lat = double.tryParse(destinationLatitude.text.trim());
    final lng = double.tryParse(destinationLongitude.text.trim());
    if (lat == null || lat < -90 || lat > 90 || lng == null || lng < -180 || lng > 180) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Valid destination coordinates are required.')));
      return;
    }
    Navigator.pop(context, _TransportDraft(
      mode: mode,
      assistance: assistance,
      scheduledFor: scheduledFor,
      destinationLatitude: lat,
      destinationLongitude: lng,
      pickupAddress: pickupAddress.text.trim().isEmpty ? null : pickupAddress.text.trim(),
      destinationAddress: destinationAddress.text.trim().isEmpty ? null : destinationAddress.text.trim(),
    ));
  }
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