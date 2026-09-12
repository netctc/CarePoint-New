import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPasswordAsync } from '@carepoint/identity';

// This fixture writes synthetic data only to the explicitly opted-in CI database.
// It never deletes records, disables constraints or contacts an external gateway.
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.CAREPOINT_AVAILABILITY_HTTP_ACCEPTANCE, 'true');
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
assert.equal(database.pathname, '/carepoint');
const api = new URL(process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1');
assert.equal(api.protocol, 'http:');
assert.ok(['localhost', '127.0.0.1'].includes(api.hostname));
assert.equal(api.port, '4000');
assert.equal(api.pathname, '/api/v1');
export const db = new PrismaClient();
export const id = () => randomUUID();
export const day = 86400000;
export const future = (days) => new Date(Date.now() + days * day);
const password = `Synthetic!${randomUUID()}Aa9`;
const passwordHash = await hashPasswordAsync(password);

export async function raw(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(api.href + path, {
    method, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
export async function ok(path, options = {}) {
  const result = await raw(path, options);
  assert.ok(result.status === 200 || result.status === 201, `${options.method || 'GET'} ${path}: unexpected status ${result.status}`);
  return result.body;
}
export async function account(role = 'PATIENT') {
  const email = `availability-${id()}@example.invalid`;
  if (role === 'PATIENT') {
    await ok('/iam/register/patient', { method: 'POST', body: { email, password, firstName: 'Synthetic', lastName: 'HTTP Acceptance' } });
  } else {
    await db.user.create({ data: { email, passwordHash, role } });
  }
  const user = await db.user.findUniqueOrThrow({ where: { email }, include: { patientProfile: true } });
  const session = await ok('/iam/login', { method: 'POST', body: { email, password } });
  assert.equal(typeof session.accessToken, 'string');
  return { token: session.accessToken, userId: user.id, patientId: user.patientProfile?.id, email };
}
export async function provider(role = 'DOCTOR') {
  const user = await account(role);
  const row = await db.provider.create({ data: { userId: user.userId, class: role, displayName: 'Synthetic HTTP provider', status: 'ACTIVE' } });
  let category;
  if (role === 'OTHER_PROVIDER') {
    category = await db.providerCategory.create({ data: { slug: `synthetic-${id()}`, labels: { en: 'Synthetic category' }, family: 'TEST', requiredCredentialTypes: ['test-license'], capabilities: {} } });
    await db.otherProviderProfile.create({ data: { providerId: row.id, categoryId: category.id } });
  }
  const credential = await db.providerCredential.create({ data: { providerId: row.id, type: role === 'DOCTOR' ? 'medical-license' : 'test-license', status: 'VERIFIED', validFrom: future(-1), validUntil: future(60) } });
  return { ...user, providerId: row.id, credentialId: credential.id, categoryId: category?.id };
}
export async function service(owner) {
  const row = await db.service.create({ data: { providerId: owner.providerId, name: 'Synthetic HTTP service', currency: 'SAR', modalities: { create: [{ modality: 'CLINIC', durationMinutes: 30, priceMinor: 5000 }, { modality: 'TELEMEDICINE', durationMinutes: 30, priceMinor: 6000 }] } } });
  const location = await db.providerLocation.create({ data: { providerId: owner.providerId, label: 'Synthetic clinic', addressLine1: '100 Test Street', city: 'Test City', countryCode: 'SA', latitude: 24.7, longitude: 46.7, arrivalInstructions: 'Synthetic reception', addressValidatedAt: new Date() } });
  await db.serviceDeliveryContext.create({ data: { serviceId: row.id, modality: 'CLINIC', clinicLocationId: location.id } });
  const startsAt = future(3); startsAt.setUTCMinutes(0, 0, 0);
  const slot = await db.availabilitySlot.create({ data: { providerId: owner.providerId, serviceId: row.id, modality: 'CLINIC', startsAt, endsAt: new Date(startsAt.getTime() + 1800000) } });
  const input = { serviceId: row.id, modality: 'CLINIC', from: future(1).toISOString(), to: future(15).toISOString(), inAppNotices: true };
  return { serviceId: row.id, slot, input };
}
export const post = (token, body = {}) => ({ token, method: 'POST', body });
export async function demand(owner, query = '') { return ok(`/provider/availability-demand${query}`, { token: owner.token }); }
export function safeAggregate(value) {
  const text = JSON.stringify(value);
  for (const field of ['patientId', 'patientName', 'requestId', 'appointmentId', 'email', 'phone', 'contactPhone', 'addressLine1', 'activeKey', 'acceptedKeyHash', 'acceptedRequestHash', 'noticeConsentAt']) {
    assert.equal(text.includes(`"${field}"`), false, `Unexpected private field: ${field}`);
  }
  assert.equal(value.containsPatientIdentities, false); assert.equal(value.reservesSlots, false);
}
