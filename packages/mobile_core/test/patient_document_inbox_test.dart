import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_document_centre.dart';
import 'package:carepoint_mobile_core/patient_notifications.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F15 extends the notification allowlist without mutating the F8-F12 compatibility constant', () {
    expect(patientNotificationRoutableEntityTypes, isNot(contains('CLINICAL_DOCUMENT')));
    expect(patientNotificationRoutableEntityTypesF15, containsAll({...patientNotificationRoutableEntityTypes, 'CLINICAL_DOCUMENT'}));
    expect(
      patientNotificationDestination({'entityType': 'CLINICAL_DOCUMENT'}),
      PatientNotificationDestination.clinicalDocument,
    );
    expect(
      patientNotificationTitle(CarePointLocale.en, {
        'type': 'CLINICAL_UPDATE',
        'safeTitleKey': 'notification.clinical.document.title',
      }),
      'Clinical update',
    );
  });

  testWidgets('opened document can be explicitly acknowledged and remains server-owned state', (tester) async {
    var acknowledged = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f15-ack');
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical-documents/me/centre') {
        return http.Response(jsonEncode({
          'accessBasis': 'PATIENT_SELF',
          'truncated': false,
          'items': [{
            'id': 'd-ack',
            'kind': 'CLINICAL_ATTACHMENT',
            'mediaType': 'text/plain',
            'byteLength': 12,
            'createdAt': '2026-09-12T08:00:00.000Z',
            'releasedAt': '2026-09-12T08:05:00.000Z',
            'source': 'CARE_TEAM',
            'downloadable': true,
            'opened': true,
            'firstOpenedAt': '2026-09-12T08:10:00.000Z',
            'acknowledged': acknowledged,
            'acknowledgedAt': acknowledged ? '2026-09-12T08:12:00.000Z' : null,
            'patientRemovable': false,
            'metadata': {'title': 'Care plan'}
          }]
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/clinical-documents/me/d-ack/acknowledge') {
        acknowledged = true;
        return http.Response(jsonEncode({
          'documentId': 'd-ack',
          'firstOpenedAt': '2026-09-12T08:10:00.000Z',
          'acknowledgedAt': '2026-09-12T08:12:00.000Z'
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f15-ack'
      ..refreshToken = 'f15-refresh';
    final session = CarePointSession(account: const {'id': 'patient', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientDocumentCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.textContaining('Opened'), findsOneWidget);
    expect(find.byKey(const ValueKey('patient-document-ack-d-ack')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('patient-document-ack-d-ack')));
    await tester.pumpAndSettle();
    expect(calls, contains('POST /api/v1/clinical-documents/me/d-ack/acknowledge'));
    expect(find.textContaining('Acknowledged'), findsOneWidget);
    expect(find.byKey(const ValueKey('patient-document-ack-d-ack')), findsNothing);
  });

  testWidgets('patient creates and removes only a personal note through inbox API', (tester) async {
    var noteExists = false;
    final bodies = <Map<String, dynamic>>[];
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer f15-note');
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical-documents/me/centre') {
        return http.Response(jsonEncode({
          'accessBasis': 'PATIENT_SELF',
          'truncated': false,
          'items': noteExists ? [{
            'id': 'my-note',
            'kind': 'PATIENT_UPLOAD',
            'mediaType': 'text/plain',
            'byteLength': 20,
            'createdAt': '2026-09-12T09:00:00.000Z',
            'releasedAt': '2026-09-12T09:00:00.000Z',
            'source': 'PATIENT',
            'downloadable': true,
            'opened': false,
            'acknowledged': false,
            'patientRemovable': true,
            'metadata': {'title': 'My history note', 'description': 'Category: History'}
          }] : []
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/clinical-documents/me/inbox/text') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        bodies.add(body);
        noteExists = true;
        return http.Response(jsonEncode({'id': 'my-note', 'kind': 'PATIENT_UPLOAD', 'patientProvided': true, 'providerVerified': false}), 201, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/clinical-documents/me/my-note/remove') {
        noteExists = false;
        return http.Response(jsonEncode({'id': 'my-note', 'status': 'REMOVED'}), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f15-note'
      ..refreshToken = 'f15-refresh';
    final session = CarePointSession(account: const {'id': 'patient', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientDocumentCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('patient-document-add-note')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('patient-document-note-title')), 'My history note');
    await tester.enterText(find.byKey(const ValueKey('patient-document-note-category')), 'History');
    await tester.enterText(find.byKey(const ValueKey('patient-document-note-description')), 'Patient context');
    await tester.enterText(find.byKey(const ValueKey('patient-document-note-content')), 'Patient supplied text');
    await tester.tap(find.byKey(const ValueKey('patient-document-note-save')));
    await tester.pumpAndSettle();

    expect(bodies, hasLength(1));
    expect(bodies.single['title'], 'My history note');
    expect(bodies.single['category'], 'History');
    expect(bodies.single['description'], 'Patient context');
    expect(bodies.single['content'], 'Patient supplied text');
    expect(find.text('My history note'), findsOneWidget);
    expect(find.textContaining('Patient-provided'), findsOneWidget);
    expect(find.textContaining('Not provider-verified'), findsOneWidget);
    expect(find.byKey(const ValueKey('patient-document-remove-my-note')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('patient-document-remove-my-note')));
    await tester.pumpAndSettle();
    expect(find.text('Remove personal document?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
    await tester.pumpAndSettle();
    expect(noteExists, false);
    expect(find.text('My history note'), findsNothing);
  });

  testWidgets('clinical document notification deep-links to focused re-authorized document centre', (tester) async {
    var read = false;
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      expect(request.headers['authorization'], 'Bearer f15-route');
      if (request.method == 'GET' && request.url.path == '/api/v1/notifications') {
        return http.Response(jsonEncode([{
          'id': 'document-event',
          'type': 'CLINICAL_UPDATE',
          'entityType': 'CLINICAL_DOCUMENT',
          'entityId': 'document-focus',
          'safeTitleKey': 'notification.clinical.document.title',
          'readAt': read ? '2026-09-12T09:10:00.000Z' : null,
          'createdAt': '2026-09-12T09:00:00.000Z',
          'deliveries': []
        }]), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/api/v1/notifications/document-event/read') {
        read = true;
        return http.Response(jsonEncode({'id': 'document-event', 'readAt': '2026-09-12T09:10:00.000Z'}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && request.url.path == '/api/v1/clinical-documents/me/centre') {
        expect(request.url.queryParameters['focusDocumentId'], 'document-focus');
        return http.Response(jsonEncode({
          'accessBasis': 'PATIENT_SELF',
          'truncated': false,
          'focusDocumentId': 'document-focus',
          'items': [{
            'id': 'document-focus',
            'kind': 'CLINICAL_ATTACHMENT',
            'mediaType': 'application/pdf',
            'byteLength': 42,
            'createdAt': '2026-09-12T08:50:00.000Z',
            'releasedAt': '2026-09-12T08:55:00.000Z',
            'source': 'CARE_TEAM',
            'downloadable': true,
            'opened': false,
            'acknowledged': false,
            'patientRemovable': false,
            'metadata': {'title': 'Released care document'}
          }]
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f15-route'
      ..refreshToken = 'f15-refresh';
    final session = CarePointSession(account: const {'id': 'patient', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientNotificationCentrePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('Clinical update'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('notification-document-event')));
    await tester.pumpAndSettle();

    expect(calls, contains('POST /api/v1/notifications/document-event/read'));
    expect(calls, contains('GET /api/v1/clinical-documents/me/centre'));
    expect(find.text('Released care document'), findsOneWidget);
    expect(find.textContaining('Selected document'), findsOneWidget);
  });
}
