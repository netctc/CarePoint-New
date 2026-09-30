import 'dart:convert';

import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_auth.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('login gate restores a persisted session for the expected role', (tester) async {
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'patient-access', refreshToken: 'patient-refresh');
    final client = MockClient((request) async {
      expect(request.url.path, '/api/v1/iam/accounts/me');
      expect(request.headers['authorization'], 'Bearer patient-access');
      return http.Response(
        jsonEncode({'id': 'u1', 'email': 'patient@example.test', 'role': 'PATIENT', 'status': 'ACTIVE'}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store);

    await tester.pumpWidget(MaterialApp(
      home: CarePointLoginGate(
        locale: CarePointLocale.en,
        expectedRole: 'PATIENT',
        title: 'Patient',
        api: api,
        builder: (_, session, __) => Text('RESTORED:${session.role}'),
      ),
    ));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpAndSettle();

    expect(find.text('RESTORED:PATIENT'), findsOneWidget);
    expect(store.accessToken, 'patient-access');
    expect(store.refreshToken, 'patient-refresh');
  });

  testWidgets('login gate clears a restored session belonging to another app role', (tester) async {
    final store = MemoryCarePointTokenStore();
    await store.writeTokens(accessToken: 'doctor-access', refreshToken: 'doctor-refresh');
    final client = MockClient((request) async {
      expect(request.url.path, '/api/v1/iam/accounts/me');
      return http.Response(
        jsonEncode({'id': 'u2', 'email': 'doctor@example.test', 'role': 'DOCTOR', 'status': 'ACTIVE'}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = CarePointApi(baseUrl: 'https://carepoint.test/api/v1', client: client, tokenStore: store);

    await tester.pumpWidget(MaterialApp(
      home: CarePointLoginGate(
        locale: CarePointLocale.en,
        expectedRole: 'PATIENT',
        title: 'Patient',
        api: api,
        builder: (_, session, __) => Text('UNEXPECTED:${session.role}'),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Sign in'), findsOneWidget);
    expect(find.textContaining('UNEXPECTED:'), findsNothing);
    expect(store.accessToken, isNull);
    expect(store.refreshToken, isNull);
  });
}
