// Offline unit tests: in-memory collaborators only. No credentials, network,
// live database changes or medical data. These do not prove PostgreSQL concurrency.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { PatientJourneysService } = require('../dist/modules/scheduling/patient-journeys.service.js');
const { journeyId, journeyInstant, journeyWindow, assertFutureChange } = require('../dist/modules/scheduling/patient-journeys.policy.js');
const patient = { accountId:'account-a',role:'PATIENT' };
const now = Date.now();
const oldVersion = new Date(now - 60000);
const future = minutes => new Date(now + minutes * 60000);
const input = extra => ({slotId:'destination',idempotencyKey:'request-12345',expectedUpdatedAt:oldVersion.toISOString(),...extra});
const status = expected => e => e.getStatus?.() === expected;
function fixture(config = {}) {
  const calls = [];
  let record = config.record ?? null;
  let entry = config.entry ?? null;
  const appointment = {id:'appointment-a',patientId:'patient-a',providerId:'provider-a',serviceId:'service-a',slotId:'origin',status:'CONFIRMED',modality:'TELEMEDICINE',startsAt:future(14400),endsAt:future(14430),updatedAt:oldVersion,provider:{id:'provider-a',status:'ACTIVE',displayName:'Test provider'},service:{id:'service-a',active:true,name:'Test service'},patient:{userId:patient.accountId},telehealthSession:null,...config.appointment};
  const destination = {id:'destination',providerId:'provider-a',serviceId:'service-a',modality:'TELEMEDICINE',startsAt:future(10000),endsAt:future(10030),capacity:1,bookedCount:0,status:'OPEN',...config.destination};
  const tx = {
    $queryRaw:async () => {calls.push('lock');return [{id:appointment.id}];},
    appointment:{
      findFirst:async q => q.where.patient ? (q.where.patient.userId===patient.accountId ? appointment : null) : config.overlap ?? null,
      findUnique:async () => appointment,
      updateMany:async q => {calls.push(['appointment',q]);return {count:config.changedCount ?? 1};},
      update:async q => {calls.push(['cancel',q]);return {...appointment,...q.data};},
      findMany:async () => [appointment],
    },
    availabilitySlot:{findUnique:async () => config.missingDestination ? null : destination,findMany:async () => [destination],updateMany:async q => {calls.push(['inventory',q]);return {count:q.where.id==='origin' ? config.releaseCount ?? 1 : config.reserveCount ?? 1};}},
    serviceModality:{findUnique:async () => ({active:config.modalityActive ?? true})},
    clinicalRecord:{findFirst:async () => config.clinical ?? null},
    insuranceClaim:{findFirst:async () => config.claim ?? null},
    insuranceEligibilityCheck:{findFirst:async () => config.eligibility ?? null},
    priorAuthorization:{findFirst:async () => config.authorization ?? null},
    availabilityException:{findFirst:async () => config.exception ?? null},
    appointmentVisitContext:{findUnique:async () => null},
    patientAppointmentChange:{findUnique:async () => record,findMany:async () => record?[record]:[],create:async q => {calls.push('history');record={id:'change-a',createdAt:new Date(),...q.data};return record;}},
    patientProfile:{findUnique:async q => q.where.userId===patient.accountId?{id:'patient-a'}:null},
    patientWaitlistEntry:{
      findUnique:async () => entry,
      findFirst:async q => entry && q.where.patientId===entry.patientId && (!q.where.appointmentId || q.where.appointmentId===entry.appointmentId) && (!q.where.status || q.where.status===entry.status) ? entry:null,
      count:async () => config.waitCount ?? 0,
      findMany:async () => entry?[entry]:[],
      updateMany:async () => ({count:0}),
      create:async q => {entry={id:'wait-a',status:'WAITING',createdAt:new Date(),closedAt:null,...q.data};calls.push('wait-create');return entry;},
      update:async q => {entry={...entry,...q.data};calls.push('wait-update');return entry;},
    },
    provider:{findUnique:async () => ({id:'provider-a',status:'ACTIVE'})},
    telehealthSession:{update:async q => {calls.push(['telehealth',q]);return {}; }},
  };
  const prisma = {...tx,$transaction:async (work,options) => {calls.push(['transaction',options]);return work(tx);}};
  const audit = {writeInTransaction:async (db,event) => {assert.equal(db,tx);calls.push(['audit',event]);}};
  return {service:new PatientJourneysService(prisma,audit),calls,appointment,destination,record:()=>record,entry:()=>entry};
}
test('F2 strict date parsing rejects impossible civil values and missing timezone', () => {
  for(const value of ['2026-02-30T00:00:00Z','2025-02-29T00:00:00Z','2026-09-11T24:00:00Z','2026-09-11T10:00:00',null,{}]) assert.throws(()=>journeyInstant(value,'date'));
  assert.equal(journeyInstant('2024-02-29T10:00:00+03:00','date').toISOString(),'2024-02-29T07:00:00.000Z');
});
test('F2 bounded ids and date windows reject malformed input', () => {
  for(const id of ['',{},'x'.repeat(129),'abc\ndef']) assert.throws(()=>journeyId(id));
  assert.throws(()=>journeyWindow('2026-09-11T00:00:00Z','2026-12-11T00:00:00Z'));
  assert.throws(()=>journeyWindow('2026-09-12T00:00:00Z','2026-09-11T00:00:00Z'));
});
test('F2 telehealth preparation and ended sessions prohibit changes', () => {
  const at=new Date('2026-09-11T10:00:00Z');
  const a={status:'CONFIRMED',modality:'TELEMEDICINE',startsAt:new Date('2026-09-11T10:30:00Z')};
  assert.throws(()=>assertFutureChange(a,at));
  assert.doesNotThrow(()=>assertFutureChange({...a,startsAt:new Date('2026-09-11T10:31:00Z')},at));
  assert.throws(()=>assertFutureChange({...a,status:'CANCELLED'},at));
});
test('F2 patient ownership cannot be replaced by a provider or another patient', async () => {
  for(const principal of [{accountId:'doctor',role:'DOCTOR'},{accountId:'other-patient',role:'PATIENT'}]) {
    const f=fixture();await assert.rejects(f.service.reschedule(principal,'appointment-a',input()),status(principal.role==='DOCTOR'?403:404));
    assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='inventory').length,0);
  }
});
test('F2 options carry exact source version and no reservation guarantee', async () => {
  const f=fixture();const result=await f.service.options(patient,'appointment-a');
  assert.equal(result.appointment.updatedAt,oldVersion);assert.equal(result.items[0].slotId,'destination');assert.equal(result.policy.slotsReserved,false);
});
test('F2 stale appointment version rejects without touching capacity', async () => {
  const f=fixture();await assert.rejects(f.service.reschedule(patient,'appointment-a',input({expectedUpdatedAt:future(1).toISOString()})),status(409));
  assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='inventory').length,0);
});
for(const [name,config] of [
  ['full destination',{destination:{bookedCount:1}}],
  ['blocked destination',{destination:{status:'BLOCKED'}}],
  ['different provider',{destination:{providerId:'other'}}],
  ['different service',{destination:{serviceId:'other'}}],
  ['different modality',{destination:{modality:'CLINIC'}}],
  ['overlapping appointment',{overlap:{id:'other'}}],
  ['vacation exception',{exception:{id:'exception'}}],
  ['existing clinical content',{clinical:{id:'record'}}],
  ['issued insurance claim',{claim:{id:'claim'}}],
  ['expired eligibility',{eligibility:{expiresAt:future(10)}}],
  ['expired prior authorisation',{authorization:{validUntil:future(10)}}],
]) test(`F2 rejects ${name} before capacity transfer`,async()=>{
  const f=fixture(config);await assert.rejects(f.service.reschedule(patient,'appointment-a',input()),status(409));
  assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='inventory').length,0);
});
test('F2 transfer, history and audit use the same Serializable transaction',async()=>{
  const f=fixture();const result=await f.service.reschedule(patient,'appointment-a',input());
  assert.equal(result.appointmentId,'appointment-a');assert.equal(result.replayed,false);
  assert.equal(f.calls[0][1].isolationLevel,'Serializable');
  const moves=f.calls.filter(c=>Array.isArray(c)&&c[0]==='inventory');
  assert.equal(moves[0][1].data.bookedCount.increment,1);assert.equal(moves[1][1].data.bookedCount.decrement,1);
  const mutation=f.calls.find(c=>Array.isArray(c)&&c[0]==='appointment')[1];
  assert.deepEqual(Object.keys(mutation.data).sort(),['slotId','startsAt','endsAt','updatedAt'].sort());
  assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='audit').length,1);
});
test('F2 retry after a successful commit replays without another capacity transfer',async()=>{
  const f=fixture();const first=await f.service.reschedule(patient,'appointment-a',input());
  const count=f.calls.filter(c=>Array.isArray(c)&&c[0]==='inventory').length;
  const replay=await f.service.reschedule(patient,'appointment-a',input());
  assert.equal(replay.changeId,first.changeId);assert.equal(replay.replayed,true);
  assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='inventory').length,count);
  await assert.rejects(f.service.reschedule(patient,'appointment-a',input({slotId:'other'})),status(409));
});
test('F2 failed origin release rejects the transaction before history or success audit',async()=>{
  const f=fixture({releaseCount:0});await assert.rejects(f.service.reschedule(patient,'appointment-a',input()),status(409));
  assert.equal(f.record(),null);assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='audit').length,0);
});
test('F2 repeated join returns one active request without reserving a slot',async()=>{
  const f=fixture();const args={from:future(60).toISOString(),to:future(14000).toISOString(),expectedUpdatedAt:oldVersion.toISOString()};
  const first=await f.service.joinWaitlist(patient,'appointment-a',args);
  const next=await f.service.joinWaitlist(patient,'appointment-a',args);
  assert.equal(next.id,first.id);assert.equal(f.calls.filter(c=>c==='wait-create').length,1);
  assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='inventory').length,0);
});
test('F2 waitlist window must be earlier and cannot silently replace another window',async()=>{
  const f=fixture();const args={from:future(60).toISOString(),to:future(14000).toISOString(),expectedUpdatedAt:oldVersion.toISOString()};
  await f.service.joinWaitlist(patient,'appointment-a',args);
  await assert.rejects(f.service.joinWaitlist(patient,'appointment-a',{...args,from:future(61).toISOString()}),status(409));
  await assert.rejects(f.service.joinWaitlist(patient,'appointment-a',{...args,to:future(15000).toISOString()}),status(400));
});
test('F2 withdrawal is idempotent and cannot change appointment state',async()=>{
  const entry={id:'wait-a',appointmentId:'appointment-a',patientId:'patient-a',status:'WAITING',fromAt:future(60),toAt:future(14000),createdAt:new Date(),closedAt:null};
  const f=fixture({entry});await f.service.withdraw(patient,'wait-a');await f.service.withdraw(patient,'wait-a');
  assert.equal(f.entry().status,'WITHDRAWN');assert.equal(f.calls.filter(c=>c==='wait-update').length,1);
  assert.equal(f.calls.filter(c=>Array.isArray(c)&&c[0]==='appointment').length,0);
});
test('F2 accepting an earlier match fulfils its request before changing the booking',async()=>{
  const entry={id:'wait-a',appointmentId:'appointment-a',patientId:'patient-a',status:'WAITING',fromAt:future(60),toAt:future(14000),createdAt:new Date(),closedAt:null};
  const f=fixture({entry});await f.service.reschedule(patient,'appointment-a',input({waitlistEntryId:'wait-a'}));
  assert.equal(f.entry().status,'FULFILLED');assert.equal(f.record().waitlistEntryId,'wait-a');
  assert.ok(f.calls.indexOf('wait-update')<f.calls.findIndex(c=>Array.isArray(c)&&c[0]==='appointment'));
});
test('F2 expired request cannot be accepted',async()=>{
  const entry={id:'wait-a',appointmentId:'appointment-a',patientId:'patient-a',status:'WAITING',fromAt:future(-60),toAt:future(-1),createdAt:new Date(),closedAt:null};
  const f=fixture({entry});await assert.rejects(f.service.reschedule(patient,'appointment-a',input({waitlistEntryId:'wait-a'})),status(409));
});
test('F2 cancellation shares the locked transaction boundary and releases the current slot',async()=>{
  const f=fixture();await f.service.cancel(patient,'appointment-a','Patient request');
  assert.equal(f.calls[0][1].isolationLevel,'Serializable');assert.ok(f.calls.includes('lock'));
  assert.equal(f.calls.find(c=>Array.isArray(c)&&c[0]==='inventory')[1].where.id,'origin');
});
test('F2 migration declares append-only history and invalidation for every appointment writer',()=>{
  const sql=readFileSync(new URL('../prisma/migrations/20260911143000_f2_patient_rescheduling_waitlist/migration.sql',import.meta.url),'utf8');
  assert.match(sql,/BEFORE UPDATE OR DELETE ON "PatientAppointmentChange"/);
  assert.match(sql,/AFTER UPDATE OF status, "startsAt", "slotId" ON "Appointment"/);
  assert.match(sql,/CREATE UNIQUE INDEX "PatientWaitlistEntry_activeKey_key"/);
});
