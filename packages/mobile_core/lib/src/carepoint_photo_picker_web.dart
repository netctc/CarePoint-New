// ignore: deprecated_member_use
import 'dart:html' as html;
import 'dart:typed_data';

Future<Map<String, dynamic>?> pickCarePointPhoto(String source) async {
  final input = html.FileUploadInputElement()..accept = 'image/jpeg,image/png';
  if (source == 'camera') input.setAttribute('capture', 'environment');
  input.click();
  await input.onChange.first;
  final files = input.files;
  if (files == null || files.isEmpty) return null;
  final reader = html.FileReader();
  reader.readAsArrayBuffer(files.first);
  await reader.onLoad.first;
  final result = reader.result;
  Uint8List? bytes;
  if (result is ByteBuffer) bytes = Uint8List.view(result);
  if (result is Uint8List) bytes = result;
  if (bytes == null || bytes.isEmpty) throw StateError('The selected image could not be read.');
  return <String, dynamic>{
    'bytes': bytes,
    'capturedAt': DateTime.now().toUtc().toIso8601String(),
  };
}
