enum TransportLocationSource {
  gps,
  addressSearch,
  mapPicker,
  manual,
}

class TransportLocation {
  const TransportLocation({
    this.address,
    this.latitude,
    this.longitude,
    this.placeId,
    required this.source,
  });

  final String? address;
  final double? latitude;
  final double? longitude;
  final String? placeId;
  final TransportLocationSource source;

  factory TransportLocation.fromJson(
    Map<String, dynamic> json, {
    TransportLocationSource fallbackSource = TransportLocationSource.manual,
  }) {
    return TransportLocation(
      address: json['address']?.toString(),
      latitude: _transportDouble(json['latitude']),
      longitude: _transportDouble(json['longitude']),
      placeId: json['placeId']?.toString(),
      source: _transportLocationSource(json['source']) ?? fallbackSource,
    );
  }

  bool get hasAddress => address?.trim().isNotEmpty == true;
  bool get hasCoordinates => latitude != null && longitude != null;
  bool get hasPartialCoordinates => (latitude == null) != (longitude == null);

  bool get isValid {
    if (hasPartialCoordinates) return false;
    if (latitude != null && (latitude! < -90 || latitude! > 90)) return false;
    if (longitude != null && (longitude! < -180 || longitude! > 180)) return false;
    return hasAddress || hasCoordinates;
  }

  TransportLocation normalized() => TransportLocation(
        address: hasAddress ? address!.trim() : null,
        latitude: latitude,
        longitude: longitude,
        placeId: placeId?.trim().isNotEmpty == true ? placeId!.trim() : null,
        source: source,
      );

  Map<String, dynamic> toJson() => {
        if (hasAddress) 'address': address!.trim(),
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (placeId?.trim().isNotEmpty == true) 'placeId': placeId!.trim(),
        'source': source.name.toUpperCase(),
      };
}

class TransportLocationCandidate {
  const TransportLocationCandidate({
    required this.label,
    required this.location,
  });

  final String label;
  final TransportLocation location;

  factory TransportLocationCandidate.fromJson(Map<String, dynamic> json) {
    final rawLocation = json['location'];
    final locationMap = rawLocation is Map<String, dynamic>
        ? rawLocation
        : rawLocation is Map
            ? rawLocation.map((key, value) => MapEntry(key.toString(), value))
            : <String, dynamic>{};
    return TransportLocationCandidate(
      label: json['label']?.toString().trim().isNotEmpty == true
          ? json['label'].toString().trim()
          : locationMap['address']?.toString() ?? '',
      location: TransportLocation.fromJson(
        locationMap,
        fallbackSource: TransportLocationSource.addressSearch,
      ),
    );
  }
}

abstract interface class CurrentDeviceTransportLocationProvider {
  Future<TransportLocation> currentLocation();
}

abstract interface class TransportGeocodingProvider {
  Future<TransportLocation> reverseGeocode({
    required double latitude,
    required double longitude,
  });

  Future<List<TransportLocationCandidate>> search(String query);
}

abstract interface class TransportMapPickerProvider {
  Future<TransportLocation?> pick({
    TransportLocation? initialLocation,
  });
}

class TransportLocationUnavailableException implements Exception {
  const TransportLocationUnavailableException(this.code);

  final String code;

  @override
  String toString() => 'Transport location unavailable: $code';
}


double? _transportDouble(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '');
}

TransportLocationSource? _transportLocationSource(dynamic value) {
  final normalized = value?.toString().trim().toUpperCase();
  return switch (normalized) {
    'GPS' => TransportLocationSource.gps,
    'ADDRESS_SEARCH' => TransportLocationSource.addressSearch,
    'MAP_PICKER' => TransportLocationSource.mapPicker,
    'MANUAL' => TransportLocationSource.manual,
    _ => null,
  };
}
