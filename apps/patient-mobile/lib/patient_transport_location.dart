import 'package:carepoint_mobile_core/transport_location.dart';
import 'package:geolocator/geolocator.dart';

class GeolocatorTransportLocationProvider
    implements CurrentDeviceTransportLocationProvider {
  const GeolocatorTransportLocationProvider();

  @override
  Future<TransportLocation> currentLocation() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const TransportLocationUnavailableException('SERVICE_DISABLED');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw const TransportLocationUnavailableException('PERMISSION_DENIED');
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
      ),
    );

    return TransportLocation(
      latitude: position.latitude,
      longitude: position.longitude,
      source: TransportLocationSource.gps,
    );
  }
}
