import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hashPasswordAsync } from '@carepoint/identity';
import { db, id, account, provider, service } from './f3-http-fixture.mjs';

// Importing the shared fixture first enforces test mode, explicit opt-in and
// loopback API/PostgreSQL. This runner additionally requires an ephemeral CI job.
assert.equal(process.env.CI, 'true');
assert.equal(process.env.CAREPOINT_MOBILE_LIVE_ACCEPTANCE, 'true');
for (const name of ['PAYMENT_GATEWAY_PROVIDER', 'INSURANCE_GATEWAY_PROVIDER', 'CLAIMS_GATEWAY_PROVIDER', 'NOTIFICATION_GATEWAY_PROVIDER', 'TELEHEALTH_PROVIDER']) {
  assert.equal(process.env[name], 'mock', `${name} must remain synthetic`);
}
const root = await realpath(process.env.RUNNER_TEMP || '/missing-runner-temp');
const fixturePath = join(root, 'carepoint-f3-mobile-fixture.json');
const resultPath = join(root, 'carepoint-f3-mobile-result.json');
assert.equal(resolve(process.env.CAREPOINT_MOBILE_LIVE_FIXTURE || ''), fixturePath);
assert.equal(resolve(process.env.CAREPOINT_MOBILE_LIVE_RESULT || ''), resultPath);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(sourceCommit, /^[a-f0-9]{40}$/);
const keys = ['book', 'retry', 'withdraw', 'isolation'];

async function readPrivate(path) {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 100000);
  assert.equal(stat.mode & 0o077, 0, 'Synthetic credentials/results must not be group/world readable');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function prepare() {
  const password = `Synthetic-Mobile!${id()}Aa9`;
  const passwordHash = await hashPasswordAsync(password);
  const login = async (actor) => {
    // Only freshly generated, synthetic actors are passed here. No real account
    // is searched by a user-supplied identifier and no historical fixture changes.
    assert.ok(actor.email.endsWith('@example.invalid'));
    await db.user.update({ where: { id: actor.userId }, data: { passwordHash } });
    return { email: actor.email, password, userId: actor.userId, patientId: actor.patientId, providerId: actor.providerId };
  };
  const cases = {};
  for (const key of keys) {
    const owner = await provider(key === 'withdraw' ? 'OTHER_PROVIDER' : 'DOCTOR');
    const patient = await account();
    const offered = await service(owner);
    const serviceName = `Synthetic mobile ${key} ${id()}`;
    await db.service.update({ where: { id: offered.serviceId }, data: { name: serviceName } });
    cases[key] = {
      patient: await login(patient), owner: await login(owner),
      ownerRole: key === 'withdraw' ? 'OTHER_PROVIDER' : 'DOCTOR',
      serviceId: offered.serviceId, serviceName, slotId: offered.slot.id, input: offered.input,
    };
  }
  cases.isolation.outsider = await login(await account());
  cases.isolation.otherOwner = await login(await provider());
  const manifest = {
    schemaVersion: 1, mode: 'SYNTHETIC_LOCAL_ONLY', runTag: id(), sourceCommit,
    createdAt: new Date().toISOString(), apiBase: process.env.CAREPOINT_API_URL, cases,
  };
  await writeFile(fixturePath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  console.log('F3.2 isolated mobile fixture prepared; no credentials or actor identifiers logged.');
}
async function verify() {
  const fixture = await readPrivate(fixturePath), result = await readPrivate(resultPath);
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.mode, 'SYNTHETIC_LOCAL_ONLY');
  assert.equal(fixture.sourceCommit, sourceCommit);
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.runTag, fixture.runTag);
  assert.ok(Date.now() - Date.parse(fixture.createdAt) < 30 * 60 * 1000);
  assert.deepEqual(Object.keys(result.cases).sort(), [...keys].sort());
  for (const key of keys) {
    const configured = fixture.cases[key], observed = result.cases[key];
    const requests = await db.patientAvailabilityRequest.findMany({ where: { patientId: configured.patient.patientId }, include: { notice: true } });
    assert.equal(requests.length, 1, `${key}: exactly one persisted request`);
    const request = requests[0];
    assert.equal(request.id, observed.requestId);
    assert.equal(request.serviceId, configured.serviceId);
    assert.equal(request.providerId, configured.owner.providerId);
    assert.equal(request.modality, 'CLINIC');
    assert.equal(request.noticeConsentVersion, 'IN_APP_AVAILABILITY_V1');
    const appointments = await db.appointment.findMany({ where: { patientId: configured.patient.patientId } });
    const invoices = await db.invoice.findMany({ where: { patientId: configured.patient.patientId } });
    const slot = await db.availabilitySlot.findUniqueOrThrow({ where: { id: configured.slotId } });
    const booked = key === 'book' || key === 'retry';
    assert.equal(appointments.length, booked ? 1 : 0, `${key}: appointment count`);
    assert.equal(invoices.length, booked ? 1 : 0, `${key}: invoice count`);
    assert.equal(slot.bookedCount, booked ? 1 : 0, `${key}: inventory count`);
    assert.equal(request.status, booked ? 'FULFILLED' : key === 'withdraw' ? 'WITHDRAWN' : 'WAITING');
    if (booked) {
      assert.equal(appointments[0].id, observed.appointmentId);
      assert.equal(appointments[0].slotId, configured.slotId);
      assert.equal(request.bookedAppointmentId, appointments[0].id);
      assert.equal(invoices[0].appointmentId, appointments[0].id);
      assert.equal(request.notice?.active, false);
      assert.ok(request.closedAt);
    } else {
      assert.equal(observed.appointmentId, null);
      assert.equal(request.bookedAppointmentId, null);
      if (key === 'withdraw') { assert.equal(request.notice?.active, false); assert.ok(request.closedAt); }
    }
  }
  console.log(JSON.stringify({ phase: 'F3.2', status: 'passed', cases: keys.length, headlessFlutterWithLiveHttp: true, independentPostgresPostconditions: true, actualDeviceAcceptance: false, signedRelease: false, sourceCommit }));
}
try {
  if (process.argv[2] === 'prepare') await prepare();
  else { assert.equal(process.argv[2], 'verify'); await verify(); }
} finally { await db.$disconnect(); }
