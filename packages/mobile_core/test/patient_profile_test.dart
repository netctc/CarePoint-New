import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_profile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('F7 profile labels cover all supported languages', () {
    for (final locale in CarePointLocale.values) {
      expect(patientProfileText(locale, 'title'), isNotEmpty);
      expect(patientProfileText(locale, 'edit'), isNotEmpty);
      expect(patientProfileText(locale, 'conflict'), isNotEmpty);
    }
  });

  test('F7 profile API keeps ownership server-side and carries the observed concurrency token', () async {
    Map<String, dynamic>? patchBody;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer f7-api');
      if (request.method == 'GET' && request.url.path.endsWith('/iam/patient-profile')) {
        return http.Response(jsonEncode({
          'firstName': 'Alice',
          'lastName': 'Patient',
          'phone': '+961 70 000 000',
          'createdAt': '2026-09-11T18:00:00.000Z',
          'updatedAt': '2026-09-11T18:00:00.000Z',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'PATCH' && request.url.path.endsWith('/iam/patient-profile')) {
        patchBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({
          'firstName': 'Alicia',
          'lastName': 'Patient',
          'phone': '',
          'createdAt': '2026-09-11T18:00:00.000Z',
          'updatedAt': '2026-09-11T18:05:00.000Z',
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f7-api'
      ..refreshToken = 'f7-refresh';

    final profile = await api.patientProfile();
    expect(profile['firstName'], 'Alice');
    await api.updatePatientProfile(
      firstName: ' Alicia ',
      lastName: ' Patient ',
      phone: ' ',
      expectedUpdatedAt: profile['updatedAt'].toString(),
    );

    expect(patchBody, isNotNull);
    expect(patchBody!['firstName'], 'Alicia');
    expect(patchBody!['lastName'], 'Patient');
    expect(patchBody!['phone'], '');
    expect(patchBody!['expectedUpdatedAt'], '2026-09-11T18:00:00.000Z');
    expect(patchBody!.containsKey('patientId'), false);
    expect(patchBody!.containsKey('userId'), false);
    expect(patchBody!.containsKey('accountId'), false);
  });

  testWidgets('F7 patient can load and save profile while advancing the concurrency token', (tester) async {
    Map<String, dynamic>? patchBody;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer f7-save');
      if (request.method == 'GET' && request.url.path.endsWith('/iam/patient-profile')) {
        return http.Response(jsonEncode({
          'firstName': 'Alice',
          'lastName': 'Patient',
          'phone': '+96170000000',
          'createdAt': '2026-09-11T18:00:00.000Z',
          'updatedAt': '2026-09-11T18:00:00.000Z',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'PATCH' && request.url.path.endsWith('/iam/patient-profile')) {
        patchBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({
          'firstName': 'Alicia',
          'lastName': 'Patient',
          'phone': '+96170000000',
          'createdAt': '2026-09-11T18:00:00.000Z',
          'updatedAt': '2026-09-11T18:01:00.000Z',
        }), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f7-save'
      ..refreshToken = 'f7-save-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientProfilePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(find.text('Alice'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('profile-first-name')), 'Alicia');
    await tester.tap(find.byKey(const ValueKey('profile-save')));
    await tester.pumpAndSettle();

    expect(patchBody!['expectedUpdatedAt'], '2026-09-11T18:00:00.000Z');
    expect(find.text('Profile updated.'), findsOneWidget);
    expect(find.text('Alicia'), findsOneWidget);
  });

  testWidgets('F7 stale update is never silently overwritten and requires explicit reload', (tester) async {
    var getCount = 0;
    var patchCount = 0;
    final client = MockClient((request) async {
      expect(request.headers['authorization'], 'Bearer f7-conflict');
      if (request.method == 'GET' && request.url.path.endsWith('/iam/patient-profile')) {
        getCount++;
        return http.Response(jsonEncode({
          'firstName': getCount == 1 ? 'Alice' : 'Alice Latest',
          'lastName': 'Patient',
          'phone': '+96170000000',
          'createdAt': '2026-09-11T18:00:00.000Z',
          'updatedAt': getCount == 1 ? '2026-09-11T18:00:00.000Z' : '2026-09-11T18:03:00.000Z',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'PATCH' && request.url.path.endsWith('/iam/patient-profile')) {
        patchCount++;
        return http.Response(jsonEncode({'message': 'Patient profile changed. Reload before saving.'}), 409, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f7-conflict'
      ..refreshToken = 'f7-conflict-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientProfilePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('profile-first-name')), 'My stale edit');
    await tester.tap(find.byKey(const ValueKey('profile-save')));
    await tester.pumpAndSettle();

    expect(patchCount, 1);
    expect(find.text('This profile was changed from another session. Your changes were not saved.'), findsOneWidget);
    final save = tester.widget<FilledButton>(find.byKey(const ValueKey('profile-save')));
    expect(save.onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('profile-reload')));
    await tester.pumpAndSettle();
    expect(find.text('Alice Latest'), findsOneWidget);
  });

  testWidgets('F7 blank required names are rejected without a write', (tester) async {
    var patchCount = 0;
    final client = MockClient((request) async {
      if (request.method == 'GET' && request.url.path.endsWith('/iam/patient-profile')) {
        return http.Response(jsonEncode({
          'firstName': 'Alice',
          'lastName': 'Patient',
          'phone': null,
          'createdAt': '2026-09-11T18:00:00.000Z',
          'updatedAt': '2026-09-11T18:00:00.000Z',
        }), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'PATCH') patchCount++;
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f7-validation'
      ..refreshToken = 'f7-validation-refresh';
    final session = CarePointSession(account: const {'id': 'patient1', 'role': 'PATIENT'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientProfilePage(session: session, locale: CarePointLocale.es)));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('profile-first-name')), '');
    await tester.tap(find.byKey(const ValueKey('profile-save')));
    await tester.pump();
    expect(patchCount, 0);
    expect(find.text('El nombre y los apellidos son obligatorios.'), findsOneWidget);
  });

  testWidgets('F7 non-patient is rejected before any profile request', (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{}', 500, headers: {'content-type': 'application/json'});
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client)
      ..accessToken = 'f7-wrong-role'
      ..refreshToken = 'f7-wrong-role-refresh';
    final session = CarePointSession(account: const {'id': 'doctor1', 'role': 'DOCTOR'}, api: api);

    await tester.pumpWidget(MaterialApp(home: PatientProfilePage(session: session, locale: CarePointLocale.en)));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Patient profile access is not available for this account.'), findsOneWidget);
  });
}
