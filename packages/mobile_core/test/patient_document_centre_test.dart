import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_document_centre.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('patient document centre searches filters and renders dd/mm/yyyy', (tester) async {
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer f14-access');
      if (request.url.path.endsWith('/clinical-documents/me/centre')) {
        return http.Response(jsonEncode({
          'accessBasis': 'PATIENT_SELF',
          'truncated': false,
          'items': [
            {
              'id': 'd1', 'kind': 'LAB_REPORT', 'mediaType': 'text/plain', 'byteLength': 11,
              'createdAt': '2026-09-12T06:00:00.000Z', 'releasedAt': '2026-09-12T06:10:00.000Z',
              'source': 'CARE_TEAM', 'downloadable': true, 'metadata': {'title': 'Blood result', 'fileName': 'blood.txt'}
            },
            {
              'id': 'd2', 'kind': 'IMAGING_REPORT', 'mediaType': 'image/png', 'byteLength': 20,
              'createdAt': '2026-09-11T06:00:00.000Z', 'releasedAt': '2026-09-11T06:10:00.000Z',
              'source': 'PATIENT', 'downloadable': true, 'metadata': {'title': 'Chest image', 'fileName': 'chest.png'}
            }
          ]
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'f14-access'..refreshToken = 'f14-refresh';
    final session = CarePointSession(account: const {'role': 'PATIENT'}, api: api);
    await tester.pumpWidget(MaterialApp(home: PatientDocumentCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();

    expect(find.text('Blood result'), findsOneWidget);
    expect(find.text('Chest image'), findsOneWidget);
    expect(find.textContaining('12/09/2026'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('patient-document-search')), 'chest');
    await tester.pump();
    expect(find.text('Blood result'), findsNothing);
    expect(find.text('Chest image'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('patient-document-search')), '');
    await tester.tap(find.byKey(const ValueKey('patient-document-kind-filter')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('LAB_REPORT').last);
    await tester.pumpAndSettle();
    expect(find.text('Blood result'), findsOneWidget);
    expect(find.text('Chest image'), findsNothing);
  });

  testWidgets('secure open issues one-time grant then downloads without using legacy content route', (tester) async {
    final paths = <String>[];
    final client = MockClient((request) async {
      paths.add(request.url.path);
      expect(request.headers['authorization'], 'Bearer f14-access');
      if (request.url.path.endsWith('/clinical-documents/me/centre')) {
        return http.Response(jsonEncode({
          'accessBasis': 'PATIENT_SELF', 'truncated': false,
          'items': [{
            'id': 'd1', 'kind': 'LAB_REPORT', 'mediaType': 'text/plain', 'byteLength': 16,
            'createdAt': '2026-09-12T06:00:00.000Z', 'releasedAt': '2026-09-12T06:10:00.000Z',
            'source': 'CARE_TEAM', 'downloadable': true, 'metadata': {'title': 'Secure result', 'fileName': 'result.txt'}
          }]
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-documents/me/d1/download-token')) {
        expect(request.method, 'POST');
        return http.Response(jsonEncode({'documentId': 'd1', 'token': 'A' * 43, 'expiresInSeconds': 300}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.endsWith('/clinical-documents/me/d1/download')) {
        expect(request.method, 'POST');
        expect((jsonDecode(request.body) as Map<String, dynamic>)['token'], 'A' * 43);
        return http.Response.bytes(utf8.encode('F14 secure body'), 200, headers: {'content-type': 'text/plain', 'content-disposition': 'attachment; filename="result.txt"'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'f14-access'..refreshToken = 'f14-refresh';
    final session = CarePointSession(account: const {'role': 'PATIENT'}, api: api);
    await tester.pumpWidget(MaterialApp(home: PatientDocumentCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('patient-document-open-d1')));
    await tester.pumpAndSettle();
    expect(find.text('F14 secure body'), findsOneWidget);
    expect(paths, contains('/api/v1/clinical-documents/me/d1/download-token'));
    expect(paths, contains('/api/v1/clinical-documents/me/d1/download'));
    expect(paths.where((path) => path.contains('/content')), isEmpty);
  });

  testWidgets('Arabic document centre keeps RTL localized empty state', (tester) async {
    final client = MockClient((request) async => http.Response(jsonEncode({'accessBasis': 'PATIENT_SELF', 'truncated': false, 'items': []}), 200, headers: {'content-type': 'application/json'}));
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)..accessToken = 'f14-access'..refreshToken = 'f14-refresh';
    final session = CarePointSession(account: const {'role': 'PATIENT'}, api: api);
    await tester.pumpWidget(MaterialApp(home: Directionality(textDirection: TextDirection.rtl, child: PatientDocumentCentrePage(session: session, locale: CarePointLocale.ar))));
    await tester.pumpAndSettle();
    expect(find.text('المستندات السريرية'), findsOneWidget);
    expect(find.text('لا توجد مستندات سريرية منشورة تطابق هذا العرض.'), findsOneWidget);
    expect(Directionality.of(tester.element(find.byKey(const ValueKey('patient-document-centre')))), TextDirection.rtl);
  });
}
