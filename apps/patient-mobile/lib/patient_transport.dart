import 'dart:math' as math;

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
    final capturedLocation = await _currentTransportLocation(locale);
    final location = await _resolveTransportLocation(
      session,
      locale,
      capturedLocation,
    );
    final response = await session.api.requestEmergencyAmbulance(
      clientRequestId: 'mobile-emergency-${DateTime.now().microsecondsSinceEpoch}',
      latitude: location.latitude,
      longitude: location.longitude,
      pickupAddress: location.address,
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

Future<TransportLocation> _resolveTransportLocation(
  CarePointSession session,
  CarePointLocale locale,
  TransportLocation location,
) async {
  if (!location.hasCoordinates) return location;
  try {
    final payload = await session.api.reverseGeocodeTransportLocation(
      latitude: location.latitude!,
      longitude: location.longitude!,
      languageCode: locale.name,
    );
    final raw = _map(payload['location']);
    final resolved = TransportLocation.fromJson(
      raw,
      fallbackSource: location.source,
    );
    return resolved.isValid ? resolved : location;
  } catch (_) {
    return location;
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
      builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: _TransportDialog(session: widget.session, locale: widget.locale),
      ),
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

class _TransportRasterMapConfig {
  const _TransportRasterMapConfig({
    required this.tileUrlTemplate,
    required this.attribution,
    required this.minZoom,
    required this.maxZoom,
    required this.initialZoom,
    this.defaultLatitude,
    this.defaultLongitude,
  });

  final String tileUrlTemplate;
  final String attribution;
  final int minZoom;
  final int maxZoom;
  final int initialZoom;
  final double? defaultLatitude;
  final double? defaultLongitude;

  factory _TransportRasterMapConfig.fromJson(Map<String, dynamic> json) {
    int intValue(String key, int fallback) {
      final raw = json[key];
      return raw is num ? raw.toInt() : int.tryParse(raw?.toString() ?? '') ?? fallback;
    }

    double? doubleValue(String key) {
      final raw = json[key];
      return raw is num ? raw.toDouble() : double.tryParse(raw?.toString() ?? '');
    }

    final minZoom = intValue('minZoom', 2);
    final maxZoom = intValue('maxZoom', 18);
    final initialZoom = intValue('initialZoom', 14).clamp(minZoom, maxZoom).toInt();
    return _TransportRasterMapConfig(
      tileUrlTemplate: json['tileUrlTemplate']?.toString().trim() ?? '',
      attribution: json['attribution']?.toString().trim() ?? '',
      minZoom: minZoom,
      maxZoom: maxZoom,
      initialZoom: initialZoom,
      defaultLatitude: doubleValue('defaultLatitude'),
      defaultLongitude: doubleValue('defaultLongitude'),
    );
  }

  bool get isValid =>
      tileUrlTemplate.startsWith('https://') &&
      tileUrlTemplate.contains('{z}') &&
      tileUrlTemplate.contains('{x}') &&
      tileUrlTemplate.contains('{y}') &&
      attribution.isNotEmpty;
}

class _TransportDialog extends StatefulWidget {
  const _TransportDialog({required this.session, required this.locale});
  final CarePointSession session;
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
  bool routePreviewAvailable = false;
  _TransportRasterMapConfig? mapConfig;

  @override
  void initState() {
    super.initState();
    _loadMapConfig();
    _loadPhase5Capabilities();
  }

  Future<void> _loadMapConfig() async {
    try {
      final payload = await widget.session.api.transportLocationConfig();
      final raw = _map(payload['map']);
      final config = _TransportRasterMapConfig.fromJson(raw);
      if (!mounted) return;
      if (payload['mapPickerAvailable'] == true && config.isValid) {
        setState(() => mapConfig = config);
      }
    } catch (_) {
      // Search, GPS and manual entry remain available when map config cannot load.
    }
  }

  Future<void> _loadPhase5Capabilities() async {
    try {
      final payload = await widget.session.api.transportLocationCapabilities();
      if (!mounted) return;
      setState(() => routePreviewAvailable = payload['routePreviewAvailable'] == true);
    } catch (_) {
      // Saved/manual locations keep working even when route preview is unavailable.
    }
  }

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
              Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.start,
                children: [
                  OutlinedButton.icon(
                    onPressed: locatingPickup ? null : _useCurrentPickupLocation,
                    icon: locatingPickup
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.my_location_outlined),
                    label: Text(transportText(widget.locale, 'useCurrentLocation')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _searchLocation(pickup: true),
                    icon: const Icon(Icons.search_outlined),
                    label: Text(transportText(widget.locale, 'searchLocation')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _selectSavedLocation(pickup: true),
                    icon: const Icon(Icons.bookmark_outline),
                    label: Text(transportText(widget.locale, 'savedLocations')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _selectHealthcareCenter(pickup: true),
                    icon: const Icon(Icons.local_hospital_outlined),
                    label: Text(transportText(widget.locale, 'healthcareCenters')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _saveCurrentLocation(pickup: true),
                    icon: const Icon(Icons.bookmark_add_outlined),
                    label: Text(transportText(widget.locale, 'saveLocation')),
                  ),
                  if (mapConfig != null)
                    OutlinedButton.icon(
                      onPressed: () => _pickOnMap(pickup: true),
                      icon: const Icon(Icons.map_outlined),
                      label: Text(transportText(widget.locale, 'pickOnMap')),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(controller: pickupLatitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'pickup')} · ${transportText(widget.locale, 'latitude')}')),
              const SizedBox(height: 10),
              TextField(controller: pickupLongitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'pickup')} · ${transportText(widget.locale, 'longitude')}')),
              const SizedBox(height: 10),
              TextField(controller: destinationAddress, decoration: InputDecoration(labelText: '${transportText(widget.locale, 'destination')} · ${transportText(widget.locale, 'address')}')),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.start,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _searchLocation(pickup: false),
                    icon: const Icon(Icons.search_outlined),
                    label: Text(transportText(widget.locale, 'searchLocation')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _selectSavedLocation(pickup: false),
                    icon: const Icon(Icons.bookmark_outline),
                    label: Text(transportText(widget.locale, 'savedLocations')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _selectHealthcareCenter(pickup: false),
                    icon: const Icon(Icons.local_hospital_outlined),
                    label: Text(transportText(widget.locale, 'healthcareCenters')),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _saveCurrentLocation(pickup: false),
                    icon: const Icon(Icons.bookmark_add_outlined),
                    label: Text(transportText(widget.locale, 'saveLocation')),
                  ),
                  if (mapConfig != null)
                    OutlinedButton.icon(
                      onPressed: () => _pickOnMap(pickup: false),
                      icon: const Icon(Icons.map_outlined),
                      label: Text(transportText(widget.locale, 'pickOnMap')),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(controller: destinationLatitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'destination')} · ${transportText(widget.locale, 'latitude')}')),
              const SizedBox(height: 10),
              TextField(controller: destinationLongitude, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: '${transportText(widget.locale, 'destination')} · ${transportText(widget.locale, 'longitude')}')),
              if (routePreviewAvailable && mode == 'GROUND') ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _previewRoute,
                  icon: const Icon(Icons.route_outlined),
                  label: Text(transportText(widget.locale, 'routePreview')),
                ),
              ],
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
      final captured = await _currentTransportLocation(widget.locale);
      final location = await _resolveTransportLocation(
        widget.session,
        widget.locale,
        captured,
      );
      if (!mounted) return;
      setState(() {
        pickupLatitude.text = location.latitude?.toStringAsFixed(6) ?? '';
        pickupLongitude.text = location.longitude?.toStringAsFixed(6) ?? '';
        if (location.hasAddress) pickupAddress.text = location.address!.trim();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            location.hasAddress
                ? transportText(widget.locale, 'addressResolved')
                : transportText(widget.locale, 'locationCaptured'),
          ),
        ),
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

  Future<void> _searchLocation({required bool pickup}) async {
    final biasLatitude = _optionalCoordinate(pickupLatitude.text, -90, 90);
    final biasLongitude = _optionalCoordinate(pickupLongitude.text, -180, 180);
    final initialQuery = (pickup ? pickupAddress.text : destinationAddress.text).trim();

    final location = await showDialog<TransportLocation>(
      context: context,
      builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: _TransportLocationSearchDialog(
          session: widget.session,
          locale: widget.locale,
          title: transportText(
            widget.locale,
            pickup ? 'searchPickup' : 'searchDestination',
          ),
          initialQuery: initialQuery,
          biasLatitude: biasLatitude,
          biasLongitude: biasLongitude,
        ),
      ),
    );
    if (location == null || !mounted) return;

    setState(() {
      final addressController = pickup ? pickupAddress : destinationAddress;
      final latitudeController = pickup ? pickupLatitude : destinationLatitude;
      final longitudeController = pickup ? pickupLongitude : destinationLongitude;
      if (location.hasAddress) addressController.text = location.address!.trim();
      latitudeController.text = location.latitude?.toStringAsFixed(6) ?? '';
      longitudeController.text = location.longitude?.toStringAsFixed(6) ?? '';
    });
  }

  Future<void> _pickOnMap({required bool pickup}) async {
    final config = mapConfig;
    if (config == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(transportText(widget.locale, 'mapUnavailable'))),
      );
      return;
    }

    final selectedLatitude = _optionalCoordinate(
      (pickup ? pickupLatitude : destinationLatitude).text,
      -90,
      90,
    );
    final selectedLongitude = _optionalCoordinate(
      (pickup ? pickupLongitude : destinationLongitude).text,
      -180,
      180,
    );

    TransportLocation? initialLocation;
    if (selectedLatitude != null && selectedLongitude != null) {
      initialLocation = TransportLocation(
        latitude: selectedLatitude,
        longitude: selectedLongitude,
        source: TransportLocationSource.mapPicker,
      );
    } else if (!pickup) {
      final pickupLat = _optionalCoordinate(pickupLatitude.text, -90, 90);
      final pickupLng = _optionalCoordinate(pickupLongitude.text, -180, 180);
      if (pickupLat != null && pickupLng != null) {
        initialLocation = TransportLocation(
          latitude: pickupLat,
          longitude: pickupLng,
          source: TransportLocationSource.mapPicker,
        );
      }
    }

    if (initialLocation == null) {
      try {
        initialLocation = await _currentTransportLocation(widget.locale);
      } catch (_) {
        // The map can still use its configured default center or world view.
      }
    }

    if (!mounted) return;
    final location = await showDialog<TransportLocation>(
      context: context,
      builder: (_) => Directionality(
        textDirection: widget.locale.textDirection,
        child: _TransportRasterMapPickerDialog(
          session: widget.session,
          locale: widget.locale,
          config: config,
          initialLocation: initialLocation,
        ),
      ),
    );
    if (location == null || !mounted) return;

    setState(() {
      final addressController = pickup ? pickupAddress : destinationAddress;
      final latitudeController = pickup ? pickupLatitude : destinationLatitude;
      final longitudeController = pickup ? pickupLongitude : destinationLongitude;
      if (location.hasAddress) addressController.text = location.address!.trim();
      latitudeController.text = location.latitude?.toStringAsFixed(6) ?? '';
      longitudeController.text = location.longitude?.toStringAsFixed(6) ?? '';
    });
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

class _TransportLocationSearchDialog extends StatefulWidget {
  const _TransportLocationSearchDialog({
    required this.session,
    required this.locale,
    required this.title,
    required this.initialQuery,
    this.biasLatitude,
    this.biasLongitude,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final String title;
  final String initialQuery;
  final double? biasLatitude;
  final double? biasLongitude;

  @override
  State<_TransportLocationSearchDialog> createState() =>
      _TransportLocationSearchDialogState();
}

class _TransportLocationSearchDialogState
    extends State<_TransportLocationSearchDialog> {
  late final TextEditingController query;
  bool busy = false;
  String? message;
  List<TransportLocationCandidate> items = const [];

  @override
  void initState() {
    super.initState();
    query = TextEditingController(text: widget.initialQuery);
  }

  @override
  void dispose() {
    query.dispose();
    super.dispose();
  }

  Future<void> search() async {
    final value = query.text.trim();
    if (value.length < 2) {
      setState(() {
        items = const [];
        message = transportText(widget.locale, 'locationSearchHint');
      });
      return;
    }

    setState(() {
      busy = true;
      message = null;
      items = const [];
    });
    try {
      final payload = await widget.session.api.searchTransportLocations(
        query: value,
        languageCode: widget.locale.name,
        biasLatitude: widget.biasLatitude,
        biasLongitude: widget.biasLongitude,
      );
      final rawItems = payload['items'];
      final next = rawItems is List
          ? rawItems
              .map((raw) => _map(raw))
              .map(TransportLocationCandidate.fromJson)
              .where((candidate) => candidate.location.isValid)
              .toList(growable: false)
          : const <TransportLocationCandidate>[];

      if (!mounted) return;
      setState(() {
        items = next;
        if (payload['placeSearchAvailable'] != true) {
          message = transportText(widget.locale, 'manualLocationMode');
        } else if (next.isEmpty) {
          message = transportText(widget.locale, 'noLocationMatches');
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        items = const [];
        message = transportText(widget.locale, 'locationServiceUnavailable');
      });
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title),
        content: SizedBox(
          width: 520,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: query,
                autofocus: true,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => search(),
                decoration: InputDecoration(
                  labelText: transportText(widget.locale, 'searchLocation'),
                  hintText: transportText(widget.locale, 'locationSearchHint'),
                  suffixIcon: IconButton(
                    onPressed: busy ? null : search,
                    icon: busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.search_outlined),
                  ),
                ),
              ),
              if (message != null) ...[
                const SizedBox(height: 12),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(message!),
                ),
              ],
              if (items.isNotEmpty) ...[
                const SizedBox(height: 12),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 320),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, index) {
                      final candidate = items[index];
                      final location = candidate.location;
                      return ListTile(
                        leading: const Icon(Icons.place_outlined),
                        title: Text(candidate.label),
                        subtitle: Text([
                          if (location.address?.trim().isNotEmpty == true)
                            location.address!.trim(),
                          if (location.hasCoordinates)
                            '${location.latitude!.toStringAsFixed(6)}, ${location.longitude!.toStringAsFixed(6)}',
                        ].join('\n')),
                        onTap: () => Navigator.pop(context, location),
                      );
                    },
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(cpText(widget.locale, 'common.cancel')),
          ),
        ],
      );
}

class _TransportRasterMapPickerDialog extends StatefulWidget {
  const _TransportRasterMapPickerDialog({
    required this.session,
    required this.locale,
    required this.config,
    this.initialLocation,
  });

  final CarePointSession session;
  final CarePointLocale locale;
  final _TransportRasterMapConfig config;
  final TransportLocation? initialLocation;

  @override
  State<_TransportRasterMapPickerDialog> createState() =>
      _TransportRasterMapPickerDialogState();
}

class _TransportRasterMapPickerDialogState
    extends State<_TransportRasterMapPickerDialog> {
  static const double _tileSize = 256;
  static const double _maxMercatorLatitude = 85.05112878;

  late double latitude;
  late double longitude;
  late int zoom;
  bool resolving = false;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialLocation;
    final hasInitial = initial?.hasCoordinates == true;
    final hasDefault = widget.config.defaultLatitude != null &&
        widget.config.defaultLongitude != null;
    latitude = hasInitial
        ? initial!.latitude!
        : hasDefault
            ? widget.config.defaultLatitude!
            : 0;
    longitude = hasInitial
        ? initial!.longitude!
        : hasDefault
            ? widget.config.defaultLongitude!
            : 0;
    zoom = hasInitial || hasDefault
        ? widget.config.initialZoom
        : widget.config.minZoom;
  }

  double get _worldSize => _tileSize * math.pow(2, zoom).toDouble();

  Offset _project(double lat, double lng) {
    final safeLat =
        lat.clamp(-_maxMercatorLatitude, _maxMercatorLatitude).toDouble();
    final x = (lng + 180) / 360 * _worldSize;
    final sinLat = math.sin(safeLat * math.pi / 180);
    final y =
        (0.5 - math.log((1 + sinLat) / (1 - sinLat)) / (4 * math.pi)) *
            _worldSize;
    return Offset(x, y);
  }

  ({double latitude, double longitude}) _unproject(Offset world) {
    final wrappedX = ((world.dx % _worldSize) + _worldSize) % _worldSize;
    final clampedY = world.dy.clamp(0.0, _worldSize).toDouble();
    final lng = wrappedX / _worldSize * 360 - 180;
    final mercator = math.pi - 2 * math.pi * clampedY / _worldSize;
    final lat = 180 / math.pi *
        (2 * math.atan(math.exp(mercator)) - math.pi / 2);
    return (latitude: lat, longitude: lng);
  }

  void _panBy(Offset delta) {
    final current = _project(latitude, longitude);
    final next = _unproject(
      Offset(current.dx - delta.dx, current.dy - delta.dy),
    );
    setState(() {
      latitude = next.latitude;
      longitude = next.longitude;
    });
  }

  void _selectAt(Offset localPosition, Size size) {
    final current = _project(latitude, longitude);
    final nextWorld = Offset(
      current.dx + localPosition.dx - size.width / 2,
      current.dy + localPosition.dy - size.height / 2,
    );
    final next = _unproject(nextWorld);
    setState(() {
      latitude = next.latitude;
      longitude = next.longitude;
    });
  }

  void _changeZoom(int delta) {
    final next = (zoom + delta)
        .clamp(widget.config.minZoom, widget.config.maxZoom)
        .toInt();
    if (next == zoom) return;
    setState(() => zoom = next);
  }

  String _tileUrl(int z, int x, int y) => widget.config.tileUrlTemplate
      .replaceAll('{z}', '$z')
      .replaceAll('{x}', '$x')
      .replaceAll('{y}', '$y');

  List<Widget> _tiles(Size size) {
    final center = _project(latitude, longitude);
    final centerTileX = (center.dx / _tileSize).floor();
    final centerTileY = (center.dy / _tileSize).floor();
    final tileCount = math.pow(2, zoom).toInt();
    final result = <Widget>[];

    for (var dy = -2; dy <= 2; dy++) {
      final tileY = centerTileY + dy;
      if (tileY < 0 || tileY >= tileCount) continue;
      for (var dx = -2; dx <= 2; dx++) {
        final rawTileX = centerTileX + dx;
        final tileX = ((rawTileX % tileCount) + tileCount) % tileCount;
        final left = size.width / 2 + rawTileX * _tileSize - center.dx;
        final top = size.height / 2 + tileY * _tileSize - center.dy;

        result.add(Positioned(
          left: left,
          top: top,
          width: _tileSize,
          height: _tileSize,
          child: Image.network(
            _tileUrl(zoom, tileX, tileY),
            fit: BoxFit.cover,
            gaplessPlayback: true,
            errorBuilder: (_, __, ___) => Container(
              color: const Color(0xFFE2E8F0),
              alignment: Alignment.center,
              child: const Icon(
                Icons.broken_image_outlined,
                color: Color(0xFF64748B),
              ),
            ),
          ),
        ));
      }
    }
    return result;
  }

  Future<void> _confirm() async {
    setState(() => resolving = true);
    try {
      final selected = TransportLocation(
        latitude: latitude,
        longitude: longitude,
        source: TransportLocationSource.mapPicker,
      );
      final resolved = await _resolveTransportLocation(
        widget.session,
        widget.locale,
        selected,
      );
      final result = TransportLocation(
        address: resolved.address,
        latitude: latitude,
        longitude: longitude,
        placeId: resolved.placeId,
        source: TransportLocationSource.mapPicker,
      );
      if (mounted) Navigator.pop(context, result);
    } finally {
      if (mounted) setState(() => resolving = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(transportText(widget.locale, 'mapPickerTitle')),
        content: SizedBox(
          width: 520,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: Text(transportText(widget.locale, 'mapPickerHint')),
              ),
              const SizedBox(height: 10),
              AspectRatio(
                aspectRatio: 1,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final size =
                        Size(constraints.maxWidth, constraints.maxHeight);
                    return ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onPanUpdate: (details) => _panBy(details.delta),
                        onTapDown: (details) =>
                            _selectAt(details.localPosition, size),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            Container(color: const Color(0xFFE2E8F0)),
                            ..._tiles(size),
                            const IgnorePointer(
                              child: Center(
                                child: Icon(
                                  Icons.location_pin,
                                  size: 44,
                                  color: Color(0xFFE11D48),
                                  shadows: [
                                    Shadow(
                                      blurRadius: 4,
                                      color: Colors.white,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            PositionedDirectional(
                              top: 10,
                              end: 10,
                              child: Column(
                                children: [
                                  FloatingActionButton.small(
                                    heroTag: null,
                                    onPressed: zoom < widget.config.maxZoom
                                        ? () => _changeZoom(1)
                                        : null,
                                    child: const Icon(Icons.add),
                                  ),
                                  const SizedBox(height: 6),
                                  FloatingActionButton.small(
                                    heroTag: null,
                                    onPressed: zoom > widget.config.minZoom
                                        ? () => _changeZoom(-1)
                                        : null,
                                    child: const Icon(Icons.remove),
                                  ),
                                ],
                              ),
                            ),
                            PositionedDirectional(
                              start: 6,
                              bottom: 6,
                              child: Container(
                                constraints:
                                    BoxConstraints(maxWidth: size.width - 12),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 3,
                                ),
                                color: const Color(0xE0FFFFFF),
                                child: Text(
                                  widget.config.attribution,
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: Color(0xFF334155),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '${latitude.toStringAsFixed(6)}, ${longitude.toStringAsFixed(6)}',
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: resolving ? null : () => Navigator.pop(context),
            child: Text(cpText(widget.locale, 'common.cancel')),
          ),
          FilledButton.icon(
            onPressed: resolving ? null : _confirm,
            icon: resolving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            label: Text(transportText(widget.locale, 'confirmLocation')),
          ),
        ],
      );
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
