part of 'carepoint_api.dart';

class CarePointDownloadedDocument {
  const CarePointDownloadedDocument({required this.bytes, required this.mediaType, required this.fileName});
  final List<int> bytes;
  final String mediaType;
  final String fileName;
}

extension ClinicalDocumentsSecureApi on CarePointApi {
  Future<Map<String, dynamic>> patientDocumentCentre({String? kind, String search = '', int limit = 100, String? focusDocumentId}) async {
    final result = await _send('GET', '/clinical-documents/me/centre', query: {
      if (kind != null && kind.isNotEmpty && kind != 'ALL') 'kind': kind,
      if (search.trim().isNotEmpty) 'q': search.trim(),
      if (focusDocumentId != null && focusDocumentId.trim().isNotEmpty) 'focusDocumentId': focusDocumentId.trim(),
      'limit': limit.toString(),
    });
    return _asMap(result);
  }

  Future<Map<String, dynamic>> uploadPatientTextDocument({
    required String title,
    required String content,
    String? category,
    String? description,
  }) async {
    return _asMap(await _send('POST', '/clinical-documents/me/inbox/text', body: {
      'title': title.trim(),
      'content': content,
      if (category?.trim().isNotEmpty == true) 'category': category!.trim(),
      if (description?.trim().isNotEmpty == true) 'description': description!.trim(),
    }));
  }

  Future<Map<String, dynamic>> acknowledgePatientClinicalDocument(String documentId) async {
    return _asMap(await _send('POST', '/clinical-documents/me/$documentId/acknowledge', body: const {}));
  }

  Future<Map<String, dynamic>> removePatientClinicalDocumentFromInbox(String documentId) async {
    return _asMap(await _send('POST', '/clinical-documents/me/$documentId/remove', body: const {}));
  }

  Future<Map<String, dynamic>> issuePatientClinicalDocumentDownloadToken(String documentId) async {
    return _asMap(await _send('POST', '/clinical-documents/me/$documentId/download-token', body: const {}));
  }

  Future<CarePointDownloadedDocument> downloadPatientClinicalDocument(String documentId) async {
    final grant = await issuePatientClinicalDocumentDownloadToken(documentId);
    final token = grant['token']?.toString();
    if (token == null || token.isEmpty) throw const CarePointApiException('Document download grant did not contain a token.');
    final response = await _raw('POST', '/clinical-documents/me/$documentId/download', body: {'token': token});
    if (response.statusCode < 200 || response.statusCode >= 300) _decode(response);
    final mediaType = (response.headers['content-type'] ?? 'application/octet-stream').split(';').first.trim();
    final disposition = response.headers['content-disposition'] ?? '';
    final match = RegExp(r'filename="([^"]+)"', caseSensitive: false).firstMatch(disposition);
    final fileName = match?.group(1)?.trim();
    return CarePointDownloadedDocument(
      bytes: response.bodyBytes,
      mediaType: mediaType.isEmpty ? 'application/octet-stream' : mediaType,
      fileName: fileName == null || fileName.isEmpty ? 'carepoint-document-$documentId' : fileName,
    );
  }
}
