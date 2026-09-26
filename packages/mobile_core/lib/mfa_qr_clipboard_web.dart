import 'dart:html' as html;
import 'dart:js_util' as js_util;
import 'dart:typed_data';

Future<bool> copyPngBytesToClipboard(Uint8List bytes) async {
  try {
    final clipboard = js_util.getProperty(html.window.navigator, 'clipboard');
    final clipboardItemConstructor = js_util.getProperty(html.window, 'ClipboardItem');
    if (clipboard == null || clipboardItemConstructor == null) return false;

    final blob = html.Blob(<dynamic>[bytes], 'image/png');
    final payload = js_util.newObject();
    js_util.setProperty(payload, 'image/png', blob);
    final item = js_util.callConstructor(clipboardItemConstructor, <dynamic>[payload]);
    final promise = js_util.callMethod(clipboard, 'write', <dynamic>[
      js_util.jsify(<dynamic>[item]),
    ]);
    await js_util.promiseToFuture(promise);
    return true;
  } catch (_) {
    return false;
  }
}
