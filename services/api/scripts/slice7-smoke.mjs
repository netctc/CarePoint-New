import { PrismaClient } from '@prisma/client';

const base = process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1';
const prisma = new PrismaClient();
const clinicalDoctorPassword = process.env.SLICE7_CLINICAL_DOCTOR_PASSWORD;
const clinicalPatientPassword = process.env.SLICE7_CLINICAL_PATIENT_PASSWORD;
const outsiderPassword = process.env.SLICE6_DOCTOR_PASSWORD;
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!clinicalDoctorPassword || !clinicalPatientPassword || !outsiderPassword || !adminPassword) throw new Error('Slice 7 CI passwords must be supplied through environment variables.');

async function raw(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}
async function request(path, options = {}) {
  const result = await raw(path, options);
  if (result.status < 200 || result.status >= 300) throw new Error(`${options.method || 'GET'} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}
async function login(email, password) {
  const result = await request('/iam/login', { method: 'POST', body: { email, password } });
  if (!result.accessToken) throw new Error(`No access token for ${email}`);
  return result.accessToken;
}

async function main() {
  const patientToken = await login('patient-clinical@carepoint.test', clinicalPatientPassword);
  const doctorAToken = await login('doctor-clinical-a@carepoint.test', clinicalDoctorPassword);
  const doctorBToken = await login('doctor-clinical-b@carepoint.test', clinicalDoctorPassword);
  const outsiderToken = await login('doctor-slice2@carepoint.test', outsiderPassword);
  const adminToken = await login('admin-ci@carepoint.test', adminPassword);

  const patient = await prisma.user.findUnique({ where: { email: 'patient-clinical@carepoint.test' }, include: { patientProfile: true } });
  const doctorA = await prisma.user.findUnique({ where: { email: 'doctor-clinical-a@carepoint.test' }, include: { provider: true } });
  const doctorB = await prisma.user.findUnique({ where: { email: 'doctor-clinical-b@carepoint.test' }, include: { provider: true } });
  const outsider = await prisma.user.findUnique({ where: { email: 'doctor-slice2@carepoint.test' }, include: { provider: true } });
  if (!patient?.patientProfile?.id || !doctorA?.provider?.id || !doctorB?.provider?.id || !outsider?.provider?.id) throw new Error('Slice 7 prerequisite identities are missing.');

  const appointment = await prisma.appointment.findFirst({
    where: { patientId: patient.patientProfile.id, providerId: doctorA.provider.id, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!appointment) throw new Error('Completed clinical appointment fixture is missing.');

  const subjectPlaintext = 'Synthetic secure follow-up subject';
  const initialPlaintext = 'Synthetic private initial message for encrypted-at-rest verification.';
  const createInput = {
    appointmentId: appointment.id,
    subject: subjectPlaintext,
    initialMessage: initialPlaintext,
    clientConversationId: 'slice7-conversation-0001',
  };
  const conversation = await request('/communications/conversations', { method: 'POST', token: patientToken, body: createInput });
  if (conversation.status !== 'OPEN' || conversation.appointmentId !== appointment.id || conversation.subject !== subjectPlaintext) throw new Error('Secure conversation creation response is invalid.');
  if (!conversation.messages?.some((item) => item.body === initialPlaintext)) throw new Error('Initial secure message was not returned after conversation creation.');
  const conversationRetry = await request('/communications/conversations', { method: 'POST', token: patientToken, body: createInput });
  if (conversationRetry.id !== conversation.id) throw new Error('Conversation idempotency retry returned a different conversation.');

  const storedConversation = await prisma.careConversation.findUnique({ where: { id: conversation.id } });
  const initialStored = await prisma.careMessage.findFirst({ where: { conversationId: conversation.id, senderAccountId: patient.id }, orderBy: { sentAt: 'asc' } });
  if (!storedConversation || !initialStored) throw new Error('Secure conversation persistence is incomplete.');
  if (JSON.stringify(storedConversation).includes(subjectPlaintext) || JSON.stringify(initialStored).includes(initialPlaintext)) throw new Error('Secure conversation plaintext leaked to PostgreSQL.');
  if (storedConversation.subjectAlgorithm !== 'AES-256-GCM' || initialStored.algorithm !== 'AES-256-GCM') throw new Error('Secure messaging envelope algorithm is unexpected.');

  const adminDenied = await raw(`/communications/conversations/${conversation.id}`, { token: adminToken });
  if (adminDenied.status !== 403) throw new Error(`Admin unexpectedly accessed secure conversation: HTTP ${adminDenied.status}.`);
  const outsiderDenied = await raw(`/communications/conversations/${conversation.id}`, { token: outsiderToken });
  if (outsiderDenied.status !== 403) throw new Error(`Unrelated provider unexpectedly accessed secure conversation: HTTP ${outsiderDenied.status}.`);

  const patientPreferences = await request('/notifications/preferences', { token: patientToken });
  if (patientPreferences.inAppEnabled !== true) throw new Error('Default in-app notification preference is not enabled.');
  const endpointRef = 'opaque-push-endpoint-reference-slice7';
  const endpoint = await request('/notifications/endpoints', { method: 'POST', token: patientToken, body: { channel: 'PUSH', externalEndpointRef: endpointRef } });
  if (endpoint.externalEndpointRef !== undefined || endpoint.externalEndpointReferenceStoredExternally !== true) throw new Error('Notification endpoint API leaked the opaque external reference.');
  const listedEndpoints = await request('/notifications/endpoints', { token: patientToken });
  if (!listedEndpoints.some((item) => item.id === endpoint.id && item.externalEndpointRef === undefined && item.externalEndpointReferenceStoredExternally === true)) throw new Error('Notification endpoint listing is not redacted.');
  const updatedPreferences = await request('/notifications/preferences', { method: 'PATCH', token: patientToken, body: { locale: 'ar', pushEnabled: true } });
  if (updatedPreferences.locale !== 'ar' || updatedPreferences.pushEnabled !== true) throw new Error('Notification preferences did not update.');

  const attachmentMarker = 'SLICE7-PRIVATE-ATTACHMENT-CONTENT';
  const attachment = await request(`/clinical-documents/appointments/${appointment.id}/upload`, {
    method: 'POST', token: doctorAToken, body: {
      kind: 'CLINICAL_ATTACHMENT', mediaType: 'text/plain', fileName: 'slice7-private-attachment.txt', title: 'Slice 7 private attachment',
      contentBase64: Buffer.from(attachmentMarker).toString('base64'),
    },
  });
  if (!attachment.id) throw new Error('Slice 7 attachment fixture was not created.');

  const doctorReplyPlaintext = 'Synthetic confidential doctor reply with protected attachment.';
  const replyInput = { body: doctorReplyPlaintext, clientMessageId: 'slice7-doctor-reply-0001', attachmentDocumentIds: [attachment.id] };
  const reply = await request(`/communications/conversations/${conversation.id}/messages`, { method: 'POST', token: doctorAToken, body: replyInput });
  if (reply.body !== doctorReplyPlaintext || !reply.attachmentDocumentIds?.includes(attachment.id)) throw new Error('Doctor secure reply is incomplete.');
  const replyRetry = await request(`/communications/conversations/${conversation.id}/messages`, { method: 'POST', token: doctorAToken, body: replyInput });
  if (replyRetry.id !== reply.id) throw new Error('Message idempotency retry returned a different message.');
  const storedReply = await prisma.careMessage.findUnique({ where: { id: reply.id } });
  if (!storedReply || JSON.stringify(storedReply).includes(doctorReplyPlaintext)) throw new Error('Doctor reply plaintext leaked to PostgreSQL.');

  const attachmentAccess = await raw(`/clinical-documents/${attachment.id}/content`, { token: patientToken });
  if (attachmentAccess.status !== 403) throw new Error(`Message attachment incorrectly granted clinical-document access: HTTP ${attachmentAccess.status}.`);

  const patientListBeforeRead = await request('/communications/conversations', { token: patientToken });
  const patientListItem = patientListBeforeRead.find((item) => item.id === conversation.id);
  if (!patientListItem || patientListItem.unreadCount < 1) throw new Error('Patient unread count did not reflect provider reply.');
  const thread = await request(`/communications/conversations/${conversation.id}`, { token: patientToken });
  if (!thread.messages?.some((item) => item.id === reply.id && item.body === doctorReplyPlaintext)) throw new Error('Patient could not read the secure provider reply through conversation membership.');
  await request(`/communications/conversations/${conversation.id}/read`, { method: 'POST', token: patientToken, body: {} });
  const patientListAfterRead = await request('/communications/conversations', { token: patientToken });
  if (patientListAfterRead.find((item) => item.id === conversation.id)?.unreadCount !== 0) throw new Error('Read receipt did not clear patient unread count.');

  const patientNotifications = await request('/notifications', { token: patientToken });
  const replyNotifications = patientNotifications.filter((item) => item.type === 'SECURE_MESSAGE' && item.entityId === conversation.id);
  if (replyNotifications.length !== 1) throw new Error(`Message retry created duplicate patient notifications: ${replyNotifications.length}.`);
  const replyNotification = replyNotifications[0];
  if (JSON.stringify(replyNotification).includes(doctorReplyPlaintext) || replyNotification.safeTitleKey !== 'notification.message.title' || replyNotification.safeBodyKey !== 'notification.message.body') throw new Error('Notification event contains unsafe message content.');
  const inAppDelivery = replyNotification.deliveries?.find((item) => item.channel === 'IN_APP');
  const pushDelivery = replyNotification.deliveries?.find((item) => item.channel === 'PUSH');
  if (inAppDelivery?.status !== 'SENT' || pushDelivery?.status !== 'SENT') throw new Error('Expected in-app and mock push notification delivery did not complete.');
  if (JSON.stringify(replyNotification.deliveries).includes(endpointRef)) throw new Error('Notification delivery presentation leaked the destination endpoint reference.');
  const readNotification = await request(`/notifications/${replyNotification.id}/read`, { method: 'POST', token: patientToken, body: {} });
  if (!readNotification.readAt) throw new Error('Notification read state was not persisted.');

  const unauthorizedCareAdd = await raw(`/communications/conversations/${conversation.id}/participants`, {
    method: 'POST', token: doctorAToken, body: { providerId: outsider.provider.id },
  });
  if (unauthorizedCareAdd.status !== 403) throw new Error(`Provider without treatment relationship was admitted to care team: HTTP ${unauthorizedCareAdd.status}.`);

  const careMember = await request(`/communications/conversations/${conversation.id}/participants`, {
    method: 'POST', token: doctorAToken, body: { providerId: doctorB.provider.id },
  });
  if (careMember.providerId !== doctorB.provider.id || careMember.accessBasis !== 'TREATMENT_RELATIONSHIP') throw new Error('Treatment-related provider was not admitted with the correct access basis.');
  const doctorBThread = await request(`/communications/conversations/${conversation.id}`, { token: doctorBToken });
  if (!doctorBThread.participants?.some((item) => item.providerId === doctorB.provider.id)) throw new Error('Admitted care-team provider cannot access the conversation.');
  const careReply = await request(`/communications/conversations/${conversation.id}/messages`, {
    method: 'POST', token: doctorBToken, body: { body: 'Synthetic care-team coordination follow-up.', clientMessageId: 'slice7-care-team-message-0001' },
  });
  if (!careReply.id) throw new Error('Care-team participant could not send a secure message.');

  const closed = await request(`/communications/conversations/${conversation.id}/close`, { method: 'POST', token: patientToken, body: {} });
  if (closed.status !== 'CLOSED') throw new Error('Care conversation did not close.');
  const sendAfterClose = await raw(`/communications/conversations/${conversation.id}/messages`, {
    method: 'POST', token: doctorBToken, body: { body: 'This must not be sent.', clientMessageId: 'slice7-after-close-0001' },
  });
  if (sendAfterClose.status !== 409) throw new Error(`Closed conversation accepted a new message: HTTP ${sendAfterClose.status}.`);

  const storedNotifications = await prisma.notificationEvent.findMany({ where: { entityId: conversation.id } });
  const persistedText = JSON.stringify(storedNotifications);
  if (persistedText.includes(initialPlaintext) || persistedText.includes(doctorReplyPlaintext) || persistedText.includes(attachmentMarker)) throw new Error('Notification persistence contains message or attachment PHI.');
  const storedEndpoint = await prisma.notificationEndpoint.findUnique({ where: { id: endpoint.id } });
  if (!storedEndpoint || storedEndpoint.externalEndpointRef !== endpointRef) throw new Error('Opaque external notification endpoint reference was not persisted correctly.');
  if (JSON.stringify(listedEndpoints).includes(endpointRef)) throw new Error('Opaque external notification endpoint reference leaked through API listing.');

  const audits = await prisma.auditEvent.findMany({ where: { objectId: conversation.id }, orderBy: { occurredAt: 'asc' } });
  const actions = new Set(audits.map((item) => item.action));
  for (const action of ['CARE_CONVERSATION_CREATED', 'CARE_CONVERSATION_READ', 'CARE_CONVERSATION_MARKED_READ', 'CARE_PARTICIPANT_ADD_DENIED', 'CARE_PARTICIPANT_ADDED', 'CARE_CONVERSATION_CLOSED']) {
    if (!actions.has(action)) throw new Error(`Missing expected communications audit action ${action}.`);
  }
  const messageAudits = await prisma.auditEvent.findMany({ where: { objectType: 'CARE_MESSAGE', action: 'CARE_MESSAGE_SENT' } });
  if (messageAudits.length < 3) throw new Error('Secure message send audit events are incomplete.');
  if (JSON.stringify([...audits, ...messageAudits]).includes(doctorReplyPlaintext)) throw new Error('Audit trail contains secure message body PHI.');

  console.log(JSON.stringify({
    status: 'passed', appointmentBoundConversation: true, conversationIdempotent: true, messageIdempotent: true,
    encryptedAtRest: true, adminAndOutsiderDenied: true, attachmentDoesNotGrantDocumentAccess: true,
    readReceipts: true, notificationPayloadPhiNeutral: true, notificationDeliveryIdempotent: true,
    pushEndpointRedacted: true, mockPushDelivered: true, careTeamRelationshipGate: true,
    closedConversationProtected: true, communicationsAuditedWithoutMessagePhi: true,
  }));
}

try { await main(); } finally { await prisma.$disconnect(); }
