import 'package:flutter/services.dart';

const MethodChannel _channel = MethodChannel('carepoint/mobile/photo_picker');

Future<Map<String, dynamic>?> pickCarePointPhoto(String source) async {
  final raw = await _channel.invokeMethod<dynamic>('pickPhoto', <String, dynamic>{'source': source});
  if (raw == null) return null;
  if (raw is! Map) throw const FormatException('Unexpected native photo picker response.');
  final mapped = raw.map((key, value) => MapEntry(key.toString(), value));
  final bytes = mapped['bytes'];
  if (bytes is List<int> && bytes is! Uint8List) mapped['bytes'] = Uint8List.fromList(bytes);
  return mapped;
}
