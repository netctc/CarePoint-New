// ignore_for_file: deprecated_member_use

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
  html.window.open(url, '_blank');
  Timer(const Duration(minutes: 2), () => html.Url.revokeObjectUrl(url));
}
