import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/patient_consents.dart';
import 'package:carepoint_mobile_core/patient_consents_localization.dart';

http.Response json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type':'application/json'});
CarePointSession session(Future<http.Response> Function(http.Request) handle, {String role = 'PATIENT'}) {
  final api = CarePointApi(baseUrl:'https://carepoint.test/api/v1', client:MockClient(handle), tokenStore:MemoryCarePointTokenStore())..accessToken='synthetic-token';
  return CarePointSession(account:{'role':role}, api:api);
}
Map<String,dynamic> consent(String id, String state, {bool regrantable=false, String? expiresAt}) => {
  'id':id,'providerId':'provider-a','providerName':'Synthetic Provider','scope':'synthetic.scope','version':'v1','state':state,'effectiveState':state,
  'grantedAt':'2026-09-01T00:00:00Z','revokedAt':state=='REVOKED'?'2026-09-02T00:00:00Z':null,'expiresAt':expiresAt,'regrantable':regrantable,
};
Future<void> open(WidgetTester tester, CarePointSession s, {CarePointLocale locale=CarePointLocale.en}) async {
  await tester.binding.setSurfaceSize(const Size(430,900)); addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home:PatientConsentLifecyclePage(session:s, locale:locale))); await tester.pumpAndSettle();
}
void main() {
  test('F16 labels cover EN AR FR ES', () { for(final row in patientConsentLabels.values) { for(final language in ['en','ar','fr','es']) expect(row[language], isNotEmpty); } });
  test('F16 regrant API uses bearer transport, encoded owned path and no client authority fields', () async {
    final calls=<http.Request>[]; final s=session((r) async { calls.add(r); return json(consent('new','GRANTED')); });
    await s.api.regrantPatientConsent('history/a');
    expect(calls.single.method,'POST'); expect(calls.single.headers['authorization'],'Bearer synthetic-token');
    expect(calls.single.url.toString(),contains('history%2Fa/regrant')); expect(calls.single.body,'{}');
  });
  testWidgets('F16 non-patient never loads consent lifecycle', (tester) async {
    var calls=0; await open(tester,session((r) async { calls++; return json([]); },role:'DOCTOR'));
    expect(calls,0); expect(find.text(patientConsentText(CarePointLocale.en,'denied')),findsOneWidget);
  });
  testWidgets('F16 renders active, revoked-regrantable and expired states with exact actions', (tester) async {
    final rows=[consent('active','GRANTED'),consent('revoked','REVOKED',regrantable:true),{...consent('expired','GRANTED'), 'effectiveState':'EXPIRED','expiresAt':'2026-01-01T00:00:00Z'}];
    await open(tester,session((r) async=>json(rows)));
    expect(find.text(patientConsentText(CarePointLocale.en,'revoke')),findsOneWidget);
    expect(find.text(patientConsentText(CarePointLocale.en,'regrant')),findsOneWidget);
    expect(find.text(patientConsentText(CarePointLocale.en,'expiredHint')),findsOneWidget);
  });
  testWidgets('F16 regrant requires confirmation before POST and reloads after success', (tester) async {
    var gets=0, posts=0; final calls=<http.Request>[];
    final s=session((r) async { calls.add(r); if(r.method=='GET'){gets++; return json(gets==1?[consent('revoked','REVOKED',regrantable:true)]:[consent('new','GRANTED')]);} posts++; return json(consent('new','GRANTED')); });
    await open(tester,s);
    await tester.tap(find.text(patientConsentText(CarePointLocale.en,'regrant'))); await tester.pumpAndSettle(); expect(posts,0);
    await tester.tap(find.widgetWithText(FilledButton,patientConsentText(CarePointLocale.en,'confirm'))); await tester.pumpAndSettle();
    expect(posts,1); expect(gets,2); expect(find.text(patientConsentText(CarePointLocale.en,'granted')),findsOneWidget);
  });
  testWidgets('F16 cancelling regrant confirmation performs no write', (tester) async {
    var posts=0; final s=session((r) async { if(r.method=='POST') posts++; return json(r.method=='GET'?[consent('revoked','REVOKED',regrantable:true)]:{}); });
    await open(tester,s); await tester.tap(find.text(patientConsentText(CarePointLocale.en,'regrant'))); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton,patientConsentText(CarePointLocale.en,'cancel'))); await tester.pumpAndSettle(); expect(posts,0);
  });
  testWidgets('F16 Arabic consent lifecycle is RTL', (tester) async {
    await open(tester,session((r) async=>json([consent('active','GRANTED')])),locale:CarePointLocale.ar);
    final title=find.text(patientConsentText(CarePointLocale.ar,'title')); expect(Directionality.of(tester.element(title)),TextDirection.rtl);
  });
}
