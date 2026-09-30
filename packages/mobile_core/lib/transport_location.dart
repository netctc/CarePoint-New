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

class TransportLocationUnavailableException implements Exception {
  const TransportLocationUnavailableException(this.code);

  final String code;

  @override
  String toString() => 'Transport location unavailable: $code';
}
