import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:carepoint_mobile_core/carepoint_api.dart';
import 'package:carepoint_mobile_core/carepoint_token_store.dart';
import 'package:carepoint_mobile_core/carepoint_localization.dart';
import 'package:carepoint_mobile_core/care_journeys_models.dart';
import 'package:carepoint_mobile_core/care_journeys_localization.dart';
import 'package:carepoint_mobile_core/care_planning_models.dart';
import 'package:carepoint_mobile_core/care_planning_localization.dart';
import 'package:carepoint_mobile_core/care_planning.dart';

http.Response json(Object body, [int status=200]) => http.Response(jsonEncode(body),status,headers:{'content-type':'application/json'});
CarePointSession session(Future<http.Response> Function(http.Request) handle) {
  final api=CarePointApi(baseUrl:'https://carepoint.test/api/v1',client:MockClient(handle),tokenStore:MemoryCarePointTokenStore())..accessToken='synthetic-access';
  return CarePointSession(account:const {'role':'PATIENT'},api:api);
}
Map<String,dynamic> options() => {
  'appointment':{'id':'visit-a','updatedAt':'2026-09-11T10:00:00.000Z','startsAt':DateTime.now().add(const Duration(days:10)).toUtc().toIso8601String(),'modality':'TELEMEDICINE','service':{'name':'Test service'},'provider':{'displayName':'Test provider'}},
  'items':[{'slotId':'new-slot','startsAt':DateTime.now().add(const Duration(days:8)).toUtc().toIso8601String(),'endsAt':DateTime.now().add(const Duration(days:8,minutes:30)).toUtc().toIso8601String()}],
};
Future<void> openPage(WidgetTester tester,Widget page) async {
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>page)),child:const Text('Open'))))));
  await tester.tap(find.text('Open'));await tester.pumpAndSettle();
}
Future<void> selectNewTime(WidgetTester tester) async {
  final button=find.widgetWithText(FilledButton,planningText(CarePointLocale.en,'reschedule'));
  await tester.ensureVisible(button);await tester.tap(button);await tester.pumpAndSettle();
}
void main(){
  test('F2 date ranges validate calendar dates and inclusive end dates',(){
    expect(planningWindow('30/02/2026','02/03/2026'),isNull);
    expect(planningWindow('12/09/2026','11/09/2026'),isNull);
    final range=planningWindow('11/09/2026','12/09/2026')!;
    expect(DateTime.parse(range['to']!).toLocal().day,13);
  });
  test('F2 earlier window is capped at the existing appointment',(){
    final before=DateTime(2026,9,15,10);
    final range=planningWindow('11/09/2026','20/09/2026',before:before)!;
    expect(DateTime.parse(range['to']!),before.toUtc());
    expect(planningWindow('16/09/2026','20/09/2026',before:before),isNull);
  });
  test('F2 excessively long date windows are rejected',(){expect(planningWindow('01/01/2026','31/12/2026'),isNull);});
  test('F2 reschedule intents freeze version, key and waiting entry for retries',(){
    final intent=CareRescheduleIntent(slotId:'slot',expectedUpdatedAt:'2026-09-11T10:00:00Z',waitlistEntryId:'entry');
    final snapshot=intent.body; snapshot['slotId']='changed';
    expect(intent.body['slotId'],'slot');expect(intent.body['waitlistEntryId'],'entry');expect(intent.body['idempotencyKey'],intent.body['idempotencyKey']);
  });
  test('F2 distinct changes have distinct non-patient-derived keys',(){
    final a=CareRescheduleIntent(slotId:'slot',expectedUpdatedAt:'2026-09-11T10:00:00Z');
    final b=CareRescheduleIntent(slotId:'slot',expectedUpdatedAt:'2026-09-11T10:00:00Z');
    expect(a.body['idempotencyKey'],isNot(b.body['idempotencyKey']));
  });
  test('F2 incomplete reschedule intents are rejected',(){expect(()=>CareRescheduleIntent(slotId:'',expectedUpdatedAt:'bad'),throwsArgumentError);});
  test('F2 labels cover all supported interface languages',(){
    for(final row in planningLabels.values){for(final locale in ['en','ar','fr','es']){expect(row[locale],isNotEmpty);}}
  });
  test('F2 API uses authenticated self-service routes without patient authority fields',()async{
    final calls=<http.Request>[];
    final s=session((r)async{calls.add(r);return json({'items':[]});});
    await s.api.rescheduleOptions('visit/a');await s.api.rescheduleHistory('visit/a');await s.api.earlierWaitlist();
    await s.api.joinEarlierWaitlist('visit/a',{'from':'2026-09-11T00:00:00Z','to':'2026-09-12T00:00:00Z','expectedUpdatedAt':'2026-09-10T00:00:00Z'});
    await s.api.withdrawEarlierWaitlist('entry/a');await s.api.earlierMatches('entry/a');await s.api.providerWaitlistDemand();
    expect(calls.length,7);
    for(final r in calls){expect(r.headers['authorization'],'Bearer synthetic-access');expect(r.body.contains('patientId'),isFalse);expect(r.body.contains('accountId'),isFalse);}
    expect(calls.first.url.toString(),contains('visit%2Fa'));
  });
  testWidgets('F2 no reschedule request is sent before explicit confirmation',(tester)async{
    var writes=0;
    final s=session((r)async{if(r.method=='POST'){writes++;return json({'appointmentId':'visit-a'});}return json(options());});
    await openPage(tester,CareReschedulePage(session:s,locale:CarePointLocale.en,appointmentId:'visit-a'));
    await selectNewTime(tester);expect(writes,0);
    expect(find.text(planningText(CarePointLocale.en,'confirm')),findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton,journeyText(CarePointLocale.en,'cancel')));await tester.pumpAndSettle();expect(writes,0);
  });
  testWidgets('F2 an ambiguous failure retries the identical change and version',(tester)async{
    final bodies=<String>[];
    final s=session((r)async{
      if(r.method=='POST'){bodies.add(r.body);return bodies.length==1?json({'message':'Synthetic unavailable'},503):json({'appointmentId':'visit-a'});}
      return json(options());
    });
    await openPage(tester,CareReschedulePage(session:s,locale:CarePointLocale.en,appointmentId:'visit-a'));
    await selectNewTime(tester);
    await tester.tap(find.widgetWithText(FilledButton,journeyText(CarePointLocale.en,'confirm')));await tester.pumpAndSettle();
    expect(bodies.length,1);expect(find.text(planningText(CarePointLocale.en,'pending')),findsOneWidget);
    await tester.ensureVisible(find.byKey(const ValueKey('planning-retry')));await tester.tap(find.byKey(const ValueKey('planning-retry')));await tester.pumpAndSettle();
    expect(bodies.length,2);expect(bodies[1],bodies[0]);expect(find.text('Open'),findsOneWidget);
  });
  testWidgets('F2 waiting list separates active and fulfilled actions without auto-booking',(tester)async{
    var writes=0;
    final s=session((r)async{if(r.method=='POST')writes++;return json({'items':[
      {'id':'w1','appointmentId':'a1','serviceName':'Waiting service','providerName':'Provider','status':'WAITING','fromAt':'2026-09-11T10:00:00Z','toAt':'2026-09-12T10:00:00Z'},
      {'id':'w2','appointmentId':'a2','serviceName':'Completed service','providerName':'Provider','status':'FULFILLED'},
    ]});});
    await openPage(tester,CareWaitlistPage(session:s,locale:CarePointLocale.en));
    expect(find.text('Waiting service'),findsOneWidget);expect(find.widgetWithText(FilledButton,planningText(CarePointLocale.en,'matches')),findsOneWidget);expect(writes,0);
  });
  testWidgets('F2 change history displays both old and new times',(tester)async{
    final s=session((_)async=>json({'items':[{'id':'change','fromStartsAt':'2026-09-12T10:00:00Z','toStartsAt':'2026-09-11T10:00:00Z','createdAt':'2026-09-10T10:00:00Z','fromWaitlist':true}]}));
    await openPage(tester,CareChangeHistoryPage(session:s,locale:CarePointLocale.en,appointmentId:'visit-a'));
    expect(find.textContaining('12/09/2026'),findsOneWidget);expect(find.textContaining('11/09/2026'),findsOneWidget);expect(find.textContaining(planningText(CarePointLocale.en,'FULFILLED')),findsOneWidget);
  });
  testWidgets('F2 Arabic waiting list preserves RTL and translated state',(tester)async{
    final s=session((_)async=>json({'items':[]}));
    await openPage(tester,Directionality(textDirection:TextDirection.rtl,child:CareWaitlistPage(session:s,locale:CarePointLocale.ar)));
    expect(find.text(planningText(CarePointLocale.ar,'waitlist')),findsOneWidget);
    final context=tester.element(find.text(planningText(CarePointLocale.ar,'noGuarantee')));
    expect(Directionality.of(context),TextDirection.rtl);
  });
}
