import assert from 'node:assert/strict';
import { PersistentConsentService } from '../dist/modules/consent/persistent-consent.service.js';

const now = Date.now();
const patients = new Map([['patient-account', { id: 'patient-1', userId: 'patient-account' }], ['other-account', { id: 'patient-2', userId: 'other-account' }]]);
const providers = new Map([
  ['provider-active', { id: 'provider-active', displayName: 'Synthetic Active Provider', status: 'ACTIVE' }],
  ['provider-inactive', { id: 'provider-inactive', displayName: 'Synthetic Inactive Provider', status: 'SUSPENDED' }],
]);
const consents = new Map([
  ['revoked-valid', { id: 'revoked-valid', patientId: 'patient-1', providerId: 'provider-active', scope: 'synthetic.scope', version: 'v1', state: 'REVOKED', grantedAt: new Date(now - 20000), revokedAt: new Date(now - 10000), expiresAt: new Date(now + 86400000) }],
  ['revoked-expired', { id: 'revoked-expired', patientId: 'patient-1', providerId: null, scope: 'expired.scope', version: 'v1', state: 'REVOKED', grantedAt: new Date(now - 20000), revokedAt: new Date(now - 10000), expiresAt: new Date(now - 1000) }],
  ['revoked-inactive', { id: 'revoked-inactive', patientId: 'patient-1', providerId: 'provider-inactive', scope: 'inactive.scope', version: 'v1', state: 'REVOKED', grantedAt: new Date(now - 20000), revokedAt: new Date(now - 10000), expiresAt: null }],
  ['other-consent', { id: 'other-consent', patientId: 'patient-2', providerId: null, scope: 'other.scope', version: 'v1', state: 'REVOKED', grantedAt: new Date(now - 20000), revokedAt: new Date(now - 10000), expiresAt: null }],
]);
let sequence = 0;
const clone = (row) => row ? { ...row } : null;
const tx = {
  $queryRaw: async () => [],
  patientProfile: { findUnique: async ({ where }) => clone([...patients.values()].find((row) => row.userId === where.userId)) },
  provider: {
    findUnique: async ({ where }) => clone(providers.get(where.id)),
    findMany: async ({ where }) => [...providers.values()].filter((row) => where.id.in.includes(row.id)).map(clone),
  },
  consent: {
    findUnique: async ({ where }) => clone(consents.get(where.id)),
    findMany: async ({ where }) => [...consents.values()].filter((row) => row.patientId === where.patientId).map(clone),
    findFirst: async ({ where }) => [...consents.values()].find((row) => row.patientId === where.patientId && row.providerId === where.providerId && row.scope === where.scope && row.version === where.version && row.state === 'GRANTED' && (!row.expiresAt || row.expiresAt > new Date())) ? clone([...consents.values()].find((row) => row.patientId === where.patientId && row.providerId === where.providerId && row.scope === where.scope && row.version === where.version && row.state === 'GRANTED' && (!row.expiresAt || row.expiresAt > new Date()))) : null,
    create: async ({ data }) => { const row = { id: `created-${++sequence}`, grantedAt: new Date(), revokedAt: null, ...data }; consents.set(row.id, row); return clone(row); },
    update: async ({ where, data }) => { const row = { ...consents.get(where.id), ...data }; consents.set(where.id, row); return clone(row); },
  },
};
const prisma = { ...tx, $transaction: async (work) => work(tx) };
const audits = [];
const audit = { write: async (row) => audits.push(row), writeInTransaction: async (_tx, row) => audits.push(row) };
const service = new PersistentConsentService(prisma, audit);
const patient = { accountId: 'patient-account', role: 'PATIENT' };
const other = { accountId: 'other-account', role: 'PATIENT' };

const listed = await service.listMine(patient);
assert.ok(listed.every((row) => !('patientId' in row)), 'Public consent DTO must not expose patientId.');
assert.equal(listed.find((row) => row.id === 'revoked-valid').providerName, 'Synthetic Active Provider');
assert.equal(listed.find((row) => row.id === 'revoked-valid').regrantable, true);
assert.equal(listed.find((row) => row.id === 'revoked-expired').effectiveState, 'REVOKED');
assert.equal(listed.find((row) => row.id === 'revoked-expired').regrantable, false);

const first = await service.regrant(patient, 'revoked-valid');
assert.equal(first.scope, 'synthetic.scope'); assert.equal(first.version, 'v1'); assert.equal(first.providerId, 'provider-active');
assert.equal(first.effectiveState, 'GRANTED'); assert.equal(first.regrantable, false); assert.ok(!('patientId' in first));
const countAfterFirst = [...consents.values()].filter((row) => row.patientId === 'patient-1' && row.scope === 'synthetic.scope' && row.state === 'GRANTED').length;
const replay = await service.regrant(patient, 'revoked-valid');
assert.equal(replay.id, first.id, 'Re-grant must be idempotent when an equivalent active grant already exists.');
assert.equal([...consents.values()].filter((row) => row.patientId === 'patient-1' && row.scope === 'synthetic.scope' && row.state === 'GRANTED').length, countAfterFirst);

await assert.rejects(service.regrant(other, 'revoked-valid'), (error) => error?.getStatus?.() === 403);
await assert.rejects(service.regrant(patient, 'revoked-expired'), (error) => error?.getStatus?.() === 409);
await assert.rejects(service.regrant(patient, 'revoked-inactive'), (error) => error?.getStatus?.() === 409);
assert.ok(audits.some((row) => row.action === 'CONSENT_REGRANTED'));
assert.ok(audits.some((row) => row.action === 'CONSENT_REGRANT_DENIED'));
console.log(JSON.stringify({ status: 'passed', safeDto: true, ownership: true, idempotentRegrant: true, expiredRejected: true, inactiveProviderRejected: true }));
