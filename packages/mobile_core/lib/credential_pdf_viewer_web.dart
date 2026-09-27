import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;

Future<void> openCarePointCredentialPdf({
  required String fileName,
  required String contentBase64,
}) async {
  final bytes = base64Decode(contentBase64);
  final blob = html.Blob(<Object>[bytes], 'application/pdf');
  final url = html.Url.createObjectUrlFromBlob(blob);
  final opened = html.window.open(url, '_blank');
  if (opened == null) {
    html.Url.revokeObjectUrl(url);
    throw StateError('The browser blocked the PDF preview window.');
  }
  Timer(const Duration(minutes: 2), () => html.Url.revokeObjectUrl(url));
}
