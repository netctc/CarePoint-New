import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ProviderSlotInventoryController } = require('../dist/modules/scheduling/provider-slot-inventory.controller.js');
const from = '2026-09-11T00:00:00.000Z', to = '2026-09-25T00:00:00.000Z';
const doctor = { accountId: 'doctor-a', role: 'DOCTOR' };
function fixture({ provider = { id: 'provider-a', status: 'ACTIVE' }, rows = [] } = {}) {
  const calls = [];
  const prisma = {
    provider: { findUnique: async (q) => { calls.push(['provider', q]); return provider; } },
    availabilitySlot: { findMany: async (q) => { calls.push(['slots', q]); return rows; } },
  };
  return { controller: new ProviderSlotInventoryController(prisma), calls };
}
test('F1 inventory denies patient/admin/support before querying storage', async () => {
  for (const role of ['PATIENT', 'ADMIN', 'SUPPORT']) {
    const f = fixture();
    await assert.rejects(f.controller.list({ ...doctor, role }, from, to), e => e.getStatus() === 403);
    assert.equal(f.calls.length, 0);
  }
});
test('F1 inventory denies inactive and missing providers', async () => {
  for (const provider of [null, { id: 'provider-a', status: 'SUSPENDED' }]) {
    const f = fixture({ provider });
    await assert.rejects(f.controller.list(doctor, from, to), e => e.getStatus() === 403);
    assert.equal(f.calls.filter(([kind]) => kind === 'slots').length, 0);
  }
});
test('F1 inventory ownership is derived only from authenticated account', async () => {
  const f = fixture(); await f.controller.list(doctor, from, to);
  assert.deepEqual(f.calls[0][1].where, { userId: 'doctor-a' });
  assert.equal(f.calls[1][1].where.providerId, 'provider-a');
});
test('F1 other providers use the same owner boundary', async () => {
  const f = fixture({ provider: { id: 'other-b', status: 'ACTIVE' } });
  await f.controller.list({ accountId: 'other-account', role: 'OTHER_PROVIDER' }, from, to);
  assert.equal(f.calls[0][1].where.userId, 'other-account');
  assert.equal(f.calls[1][1].where.providerId, 'other-b');
});
test('F1 inventory rejects unbounded, reversed, missing and timezone-less ranges', async () => {
  for (const range of [[undefined, to], ['not-a-date', to], ['2026-09-11T00:00:00', to], [to, from], [from, '2027-09-11T00:00:00Z']]) {
    const f = fixture(); await assert.rejects(f.controller.list(doctor, ...range), e => e.getStatus() === 400);
    assert.equal(f.calls.length, 0);
  }
});
test('F1 inventory rejects impossible calendar dates instead of normalising them', async () => {
  for (const [start, end] of [
    ['2026-02-30T00:00:00Z', '2026-03-10T00:00:00Z'],
    ['2025-02-29T00:00:00Z', '2025-03-10T00:00:00Z'],
    ['2026-09-11T24:00:00Z', '2026-09-15T00:00:00Z'],
  ]) {
    const f = fixture(); await assert.rejects(f.controller.list(doctor, start, end), e => e.getStatus() === 400);
    assert.equal(f.calls.length, 0);
  }
  const leap = fixture(); await leap.controller.list(doctor, '2024-02-29T10:00:00+03:00', '2024-03-01T10:00:00+03:00');
  assert.equal(leap.calls[1][1].where.startsAt.gte.toISOString(), '2024-02-29T07:00:00.000Z');
});
test('F1 inventory rejects invalid pages before querying storage', async () => {
  for (const page of ['0', '-1', '1.5', 'NaN', '1001', '1e2', '']) {
    const f = fixture(); await assert.rejects(f.controller.list(doctor, from, to, page), e => e.getStatus() === 400);
    assert.equal(f.calls.length, 0);
  }
});
test('F1 inventory pagination is bounded, deterministic and not public-open-only', async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: `slot-${i}`, status: 'BLOCKED' }));
  const f = fixture({ rows }); const result = await f.controller.list(doctor, from, to, '2');
  assert.equal(result.items.length, 50); assert.equal(result.nextPage, 3);
  const q = f.calls[1][1]; assert.equal(q.take, 51); assert.equal(q.skip, 50);
  assert.deepEqual(q.orderBy, [{ startsAt: 'asc' }, { id: 'asc' }]);
  assert.equal(q.where.status, undefined);
});
test('F1 inventory projection excludes clinical and appointment identities', async () => {
  const f = fixture(); const result = await f.controller.list(doctor, from, to);
  const select = f.calls[1][1].select;
  assert.deepEqual(Object.keys(select).sort(), ['id','serviceId','modality','startsAt','endsAt','capacity','bookedCount','status','version','service'].sort());
  assert.deepEqual(select.service, { select: { name: true } });
  assert.equal(result.nextPage, null);
});
