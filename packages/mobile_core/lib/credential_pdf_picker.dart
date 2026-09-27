import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

const int carePointCredentialPdfMaxBytes = 8 * 1024 * 1024;
const int carePointCredentialPdfMaxFiles = 10;

class CarePointCredentialPdf {
  const CarePointCredentialPdf({required this.name, required this.bytes});
  final String name;
  final Uint8List bytes;
  int get byteLength => bytes.lengthInBytes;
}

class CarePointCredentialPdfException implements Exception {
  const CarePointCredentialPdfException(this.message);
  final String message;
  @override
  String toString() => message;
}

Future<List<CarePointCredentialPdf>> pickCarePointCredentialPdfs({
  int maxFiles = carePointCredentialPdfMaxFiles,
}) async {
  final result = await FilePicker.platform.pickFiles(
    allowMultiple: true,
    type: FileType.custom,
    allowedExtensions: const ['pdf'],
    withData: true,
  );
  if (result == null) return const [];

  if (result.files.length > maxFiles) {
    throw CarePointCredentialPdfException(
      'Select at most ' + maxFiles.toString() + ' PDF documents.',
    );
  }

  final picked = <CarePointCredentialPdf>[];
  for (final selected in result.files) {
    final bytes = selected.bytes;
    if (bytes == null || bytes.isEmpty) {
      throw CarePointCredentialPdfException(
        'Unable to read PDF document ' + selected.name + '.',
      );
    }
    if (bytes.lengthInBytes > carePointCredentialPdfMaxBytes) {
      throw CarePointCredentialPdfException(
        'PDF document ' + selected.name + ' exceeds the 8 MB limit.',
      );
    }
    if (bytes.lengthInBytes < 5 ||
        String.fromCharCodes(bytes.sublist(0, 5)) != '%PDF-') {
      throw CarePointCredentialPdfException(
        selected.name + ' is not a valid PDF document.',
      );
    }
    picked.add(CarePointCredentialPdf(name: selected.name, bytes: bytes));
  }
  return List<CarePointCredentialPdf>.unmodifiable(picked);
}

String carePointCredentialPdfSizeLabel(int bytes) {
  if (bytes < 1024) return bytes.toString() + ' B';
  final kb = bytes / 1024;
  if (kb < 1024) return kb.toStringAsFixed(1) + ' KB';
  return (kb / 1024).toStringAsFixed(1) + ' MB';
}
