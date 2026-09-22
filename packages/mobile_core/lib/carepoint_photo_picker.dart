import 'dart:typed_data';

import 'src/carepoint_photo_picker_native.dart'
    if (dart.library.html) 'src/carepoint_photo_picker_web.dart' as implementation;

enum CarePointPhotoSource { camera, gallery }

class CarePointPickedPhoto {
  const CarePointPickedPhoto({required this.bytes, required this.capturedAt});

  final Uint8List bytes;
  final DateTime capturedAt;
}

Future<CarePointPickedPhoto?> pickCarePointPhoto(CarePointPhotoSource source) async {
  final result = await implementation.pickCarePointPhoto(source.name);
  if (result == null) return null;
  final rawBytes = result['bytes'];
  final bytes = rawBytes is Uint8List
      ? rawBytes
      : rawBytes is List<int>
          ? Uint8List.fromList(rawBytes)
          : null;
  if (bytes == null || bytes.isEmpty) {
    throw StateError('Photo picker returned no image bytes.');
  }
  final capturedAt = DateTime.tryParse(result['capturedAt']?.toString() ?? '')?.toUtc() ?? DateTime.now().toUtc();
  return CarePointPickedPhoto(bytes: bytes, capturedAt: capturedAt);
}
