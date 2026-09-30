import 'dart:typed_data';

/// Flutter 3.47 no longer exposes dart:js_util on this package surface.
/// Returning false delegates to the existing safe text/URI clipboard fallback.
Future<bool> copyPngBytesToClipboard(Uint8List bytes) async => false;
