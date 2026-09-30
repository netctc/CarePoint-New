import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_emergency.dart';
import 'package:carepoint_mobile_core/patient_medical_transport.dart';
import 'package:carepoint_mobile_core/transport_localization.dart';
import 'package:carepoint_mobile_core/transport_location.dart';
import 'package:flutter/material.dart';

import 'patient_transport_location.dart';

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
    final location = await _currentTransportLocation(locale);
    final response = await session.api.requestEmergencyAmbulance(
      clientRequestId: 'mobile-emergency-${DateTime.now().microsecondsSinceEpoch}',
      latitude: location.latitude,
      longitude: location.longitude,
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

const _deviceLocationProvider = GeolocatorTransportLocationProvider();

Future<TransportLocation> _currentTransportLocation(CarePointLocale locale) async {
  try {
    return await _deviceLocationProvider.currentLocation();
  } on TransportLocationUnavailableException {
    throw CarePointApiException(transportText(locale, 'locationDenied'));
  }
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
    final id = item['id']?.toString() ?? '';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            CircleAvatar(child: Icon(item['mode'] == 'AIR' ? Icons.flight_outlined : Icons.local_shipping_outlined)),
            const SizedBox(width: 10),
            Expanded(child: Text(patientMedicalTransportModeText(widget.locale, item['mode']), style: const TextStyle(fontWeight: FontWeight.w900))),
            Chip(label: Text(patientMedicalTransportStatusText(widget.locale, status))),
          ]),
          const SizedBox(height: 8),
          Text('${transportText(widget.locale, 'scheduledFor')}: ${patientMedicalTransportDateTime(item['scheduledFor'])}'),
          Text('${transportText(widget.locale, 'pickup')}: ${_locationText(item, pickup: true)}'),
          Text('${transportText(widget.locale, 'destination')}: ${_locationText(item, pickup: false)}'),
          Text('${transportText(widget.locale, 'companions')}: ${item['companionCount'] ?? 0}'),
          Text('${transportText(widget.locale, 'equipment')}: ${_equipmentText(widget.locale, item['equipment'])}'),
          if (provider['displayName'] != null) Text(provider['displayName'].toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
          if (item['etaMinutes'] != null) Text('${transportText(widget.locale, 'eta')}: ${item['etaMinutes']} ${transportText(widget.locale, 'minutes')}'),
          const SizedBox(height: 8),
          FilledButton.tonalIcon(
            key: ValueKey('medical-transport-detail-$id'),
            onPressed: id.isEmpty ? null : () => _openDetail(id),
            icon: const Icon(Icons.route_outlined),
            label: Text(patientMedicalTransportText(widget.locale, 'detailTitle')),
          ),
          if (patientMedicalTransportCanCancel(status)) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: id.isEmpty ? null : () => _cancel(id),
              icon: const Icon(Icons.cancel_outlined),
              label: Text(transportText(widget.locale, 'cancel')),
            ),
          ],
        ]),
      ),
    );
  }

  Future<void> _openDetail(String id, {Map<String, dynamic>? initial}) async {
    if (id.isEmpty || !mounted) return;
    await Navigator.push<void>(
      context,
      MaterialPageRoute(builder: (_) => PatientMedicalTransportStatusPage(
        session: widget.session,
        locale: widget.locale,
        requestId: id,
        initial: initial,
      )),
    );
    if (mounted) await refresh();
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
      final response = await widget.session.api.createMedicalTransport(
        clientRequestId: 'mobile-transport-${DateTime.now().microsecondsSinceEpoch}',
        mode: result.mode,
        scheduledFor: result.scheduledFor,
        pickupLatitude: result.pickupLatitude,
        pickupLongitude: result.pickupLongitude,
        pickupAddress: result.pickupAddress,
        destinationLatitude: result.destinationLatitude,
        destinationLongitude: result.destinationLongitude,
        destinationAddress: result.destinationAddress,
        assistance: result.assistance,
        companionCount: result.companionCount,
        equipment: result.equipment,
      );
      if (!mounted) return;
      setState(() => busy = false);
      final requestId = _map(response['request'])['id']?.toString() ?? '';
      if (requestId.isNotEmpty) {
        await _openDetail(requestId, initial: response);
      } else {
        await refresh();
      }
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
    required this.companionCount,
    required this.equipment,
    required this.scheduledFor,
    this.pickupLatitude,
    this.pickupLongitude,
    this.destinationLatitude,
    this.destinationLongitude,
    this.pickupAddress,
    this.destinationAddress,
  });
  final String mode;
  final String assistance;
  final int companionCount;
  final List<String> equipment;
  final DateTime scheduledFor;
  final double? pickupLatitude;
  final double? pickupLongitude;
  final double? destinationLatitude;
  final double? destinationLongitude;
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
  final pickupLatitude = TextEditingController();
  final pickupLongitude = TextEditingController();
  final destinationLatitude = TextEditingController();
  final destinationLongitude = TextEditingController();
  String mode = 'GROUND';
  String assistance = 'STANDARD';
  int companionCount = 0;
  final Set<String> equipment = <String>{};
  DateTime scheduledFor = DateTime.now().add(const Duration(hours: 2));
  bool locatingPickup = false;

  @override
  void dispose() {
    pickupAddress.dispose();
    destinationAddress.dispose();
    pickupLatitude.dispose();
    pickupLongitude.dispose();
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
              DropdownButtonFormField<int>(
                initialValue: companionCount,
                decoration: InputDecoration(labelText: transportText(widget.locale, 'companions')),
                items: List.generate(9, (value) => DropdownMenuItem(value: value, child: Text('$value'))),
                onChanged: (value) => setState(() => companionCount = value ?? companionCount),
              ),
              const SizedBox(height: 10),
              Align(alignment: AlignmentDirectional.centerStart, child: Text(transportText(widget.locale, 'equipment'), style: const TextStyle(fontWeight: FontWeight.w700))),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: equipment.contains('OXYGEN'),
                title: Text(transportText(widget.locale, 'oxygen')),
                onChanged: (value) => _toggleEquipment('OXYGEN', value == true),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: equipment.contains('MONITORING'),
                title: Text(transportText(widget.locale, 'monitoring')),
                onChanged: (value) => _toggleEquipment('MONITORING', value == true),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: equipment.contains('VENTILATION'),
                title: Text(transportText(widget.locale, 'ventilation')),
                onChanged: (value) => _toggleEquipment('VENTILATION', value == true),
              ),
              const SizedBox(height: 10),
              TextField(controller: pickupAddress, decoration: InputDecoration(labelText: '${transportText(widget.locale, 'pickup')} · ${transportText(widget.locale, 'address')}')),
              const SizedBox(height: 8),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: OutlinedButton.icon(
                  onPressed: locatingPickup ? null : _useCurrentPickupLocation,
                  icon: locatingPickup
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.my_location_outlined),
                  label: Text(transportText(widget.locale, 'useCurrentLocation')),
                ),
              ),
              const SizedBox(height: 10),
              TextField(controller: pickupLatitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'pickup')} · ${transportText(widget.locale, 'latitude')}')),
              const SizedBox(height: 10),
              TextField(controller: pickupLongitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'pickup')} · ${transportText(widget.locale, 'longitude')}')),
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
                subtitle: Text(patientMedicalTransportDateTime(scheduledFor.toIso8601String())),
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

  void _toggleEquipment(String value, bool selected) {
    setState(() {
      if (selected) {
        equipment.add(value);
      } else {
        equipment.remove(value);
      }
    });
  }

  Future<void> _useCurrentPickupLocation() async {
    setState(() => locatingPickup = true);
    try {
      final location = await _currentTransportLocation(widget.locale);
      if (!mounted) return;
      setState(() {
        pickupLatitude.text = location.latitude?.toStringAsFixed(6) ?? '';
        pickupLongitude.text = location.longitude?.toStringAsFixed(6) ?? '';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(transportText(widget.locale, 'locationCaptured'))),
      );
    } catch (value) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(value.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => locatingPickup = false);
    }
  }

  Future<void> _pickDateTime() async {
    final date = await showDatePicker(context: context, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: scheduledFor);
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(scheduledFor));
    if (time == null) return;
    setState(() => scheduledFor = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  void _submit() {
    final pickupLat = _optionalCoordinate(pickupLatitude.text, -90, 90);
    final pickupLng = _optionalCoordinate(pickupLongitude.text, -180, 180);
    final destinationLat = _optionalCoordinate(destinationLatitude.text, -90, 90);
    final destinationLng = _optionalCoordinate(destinationLongitude.text, -180, 180);
    final pickupAddressValue = pickupAddress.text.trim();
    final destinationAddressValue = destinationAddress.text.trim();
    if (_coordinatePairInvalid(pickupLatitude.text, pickupLongitude.text, pickupLat, pickupLng) ||
        _coordinatePairInvalid(destinationLatitude.text, destinationLongitude.text, destinationLat, destinationLng)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Latitude and longitude are optional, but when used they must be valid and provided together.')));
      return;
    }
    if (pickupAddressValue.isEmpty && pickupLat == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a pickup address or optional pickup coordinates.')));
      return;
    }
    if (destinationAddressValue.isEmpty && destinationLat == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a destination address or optional destination coordinates.')));
      return;
    }
    Navigator.pop(context, _TransportDraft(
      mode: mode,
      assistance: assistance,
      companionCount: companionCount,
      equipment: equipment.toList(growable: false),
      scheduledFor: scheduledFor,
      pickupLatitude: pickupLat,
      pickupLongitude: pickupLng,
      destinationLatitude: destinationLat,
      destinationLongitude: destinationLng,
      pickupAddress: pickupAddressValue.isEmpty ? null : pickupAddressValue,
      destinationAddress: destinationAddressValue.isEmpty ? null : destinationAddressValue,
    ));
  }
}

String _locationText(Map<String, dynamic> row, {required bool pickup}) {
  final address = row[pickup ? 'pickupAddress' : 'destinationAddress']?.toString().trim() ?? '';
  if (address.isNotEmpty) return address;
  final latitude = row[pickup ? 'pickupLatitude' : 'destinationLatitude'];
  final longitude = row[pickup ? 'pickupLongitude' : 'destinationLongitude'];
  if (latitude == null || longitude == null) return '—';
  return '$latitude, $longitude';
}

String _equipmentText(CarePointLocale locale, dynamic raw) {
  final values = raw is List ? raw.map((value) => value.toString()).toList(growable: false) : const <String>[];
  if (values.isEmpty) return transportText(locale, 'none');
  return values.map((value) => switch (value) {
    'OXYGEN' => transportText(locale, 'oxygen'),
    'MONITORING' => transportText(locale, 'monitoring'),
    'VENTILATION' => transportText(locale, 'ventilation'),
    _ => value,
  }).join(', ');
}

Map<String, dynamic> _map(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return <String, dynamic>{};
}

double? _optionalCoordinate(String raw, double min, double max) {
  final text = raw.trim();
  if (text.isEmpty) return null;
  final value = double.tryParse(text);
  if (value == null || value < min || value > max) return null;
  return value;
}

bool _coordinatePairInvalid(String rawLatitude, String rawLongitude, double? latitude, double? longitude) {
  final hasLatitudeText = rawLatitude.trim().isNotEmpty;
  final hasLongitudeText = rawLongitude.trim().isNotEmpty;
  if (!hasLatitudeText && !hasLongitudeText) return false;
  return latitude == null || longitude == null || hasLatitudeText != hasLongitudeText;
}
