import { PrismaClient } from '@prisma/client';

const apiBase = process.env.CAREPOINT_API_URL || 'http://127.0.0.1:4000/api/v1';
const webBase = process.env.CAREPOINT_ADMIN_URL || 'http://127.0.0.1:3000';
const prisma = new PrismaClient();

async function apiRaw(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(apiBase + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({}));
  return { response, status: response.status, payload };
}
async function api(path, options = {}) {
  const result = await apiRaw(path, options);
  if (result.status < 200 || result.status >= 300) throw new Error(`${options.method || 'GET'} ${path} -> ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload;
}
async function login(email, password) {
  const result = await api('/iam/login', { method: 'POST', body: { email, password } });
  if (!result.accessToken) throw new Error(`No access token for ${email}`);
  return result.accessToken;
}
function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (values.length === 0) {
    const fallback = response.headers.get('set-cookie');
    if (fallback) values.push(fallback);
  }
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}
async function web(path, { method = 'GET', cookie, body } = {}) {
  const headers = { origin: webBase };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(webBase + path, { method, headers, redirect: 'manual', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
  return { response, status: response.status, payload };
}

async function main() {
  const doctorToken = await login('doctor-clinical-a@carepoint.test', 'CarePoint-Clinical-Doctor#2026');
  const patientToken = await login('patient-clinical@carepoint.test', 'CarePoint-Clinical-Patient#2026');
  const adminToken = await login('admin-ci@carepoint.test', 'CarePoint-CI-Admin#2026');
  const patient = await prisma.user.findUnique({ where: { email: 'patient-clinical@carepoint.test' }, include: { patientProfile: true } });
  if (!patient?.patientProfile?.id) throw new Error('WEB-05 patient fixture is missing.');
  const patientId = patient.patientProfile.id;

  const roster = await api('/clinical/patients/roster', { token: doctorToken });
  if (!roster.items?.some((item) => item.id === patientId)) throw new Error('Authorized WEB-05 patient is missing from the provider roster.');
  if (roster.viewer?.class !== 'DOCTOR') throw new Error('WEB-05 viewer context is missing the provider class.');

  const workspace = await api(`/clinical/patients/${patientId}/workspace`, { token: doctorToken });
  if (workspace.patient?.id !== patientId || workspace.patient?.firstName !== 'Clinical') throw new Error('WEB-05 patient identity context is incorrect.');
  if (!['TREATMENT_RELATIONSHIP', 'OWN_AUTHORSHIP', 'PATIENT_CONSENT'].includes(workspace.accessBasis)) throw new Error(`Unexpected WEB-05 access basis ${workspace.accessBasis}.`);
  if (!workspace.timeline?.some((item) => item.finalized === true && item.latestRecord?.data?.diagnoses?.length)) throw new Error('WEB-05 longitudinal encounter/diagnosis snapshot is missing.');
  if (workspace.orders?.state !== 'AVAILABLE' || !workspace.orders.items?.some((item) => item.type === 'PRESCRIPTION') || !workspace.orders.items?.some((item) => item.type === 'LABORATORY')) throw new Error('WEB-05 orders/laboratory section is incomplete.');
  if (!workspace.orders.items.some((item) => item.labResult?.status === 'RELEASED')) throw new Error('WEB-05 laboratory result is missing.');
  if (workspace.documents?.state !== 'AVAILABLE' || workspace.documents.items?.length < 1) throw new Error('WEB-05 clinical documents are missing.');
  if (workspace.diagnosticReports?.state !== 'AVAILABLE' || workspace.diagnosticReports.items?.length < 1) throw new Error('WEB-05 diagnostic reports are missing.');
  if (!workspace.riskAlerts?.some((item) => item.source === 'LAB_RESULT_FLAG' && item.flag === 'TEST-FLAG')) throw new Error('WEB-05 provider-entered clinical flag was not surfaced without inference.');
  if (workspace.security?.encryptedClinicalRecords !== true || workspace.security?.auditedAccess !== true || workspace.security?.serverSideAccessBasisEnforced !== true || workspace.security?.automatedClinicalRiskInference !== false) throw new Error('WEB-05 security context is incomplete.');

  let second = await prisma.user.findUnique({ where: { email: 'patient-web05-unrelated@carepoint.test' }, include: { patientProfile: true } });
  if (!second) {
    await api('/iam/register/patient', { method: 'POST', body: { email: 'patient-web05-unrelated@carepoint.test', password: 'CarePoint-Web05-Patient#2026', firstName: 'Unrelated', lastName: 'Patient' } });
    second = await prisma.user.findUnique({ where: { email: 'patient-web05-unrelated@carepoint.test' }, include: { patientProfile: true } });
  }
  if (!second?.patientProfile?.id) throw new Error('WEB-05 unrelated-patient fixture is missing.');
  const crossPatientDenied = await apiRaw(`/clinical/patients/${second.patientProfile.id}/workspace`, { token: doctorToken });
  if (crossPatientDenied.status !== 403) throw new Error(`Expected cross-patient WEB-05 denial 403, got ${crossPatientDenied.status}.`);
  const adminDenied = await apiRaw(`/clinical/patients/${patientId}/workspace`, { token: adminToken });
  if (adminDenied.status !== 403) throw new Error(`Expected Admin WEB-05 PHI denial 403, got ${adminDenied.status}.`);
  const patientRoleDenied = await apiRaw(`/clinical/patients/${patientId}/workspace`, { token: patientToken });
  if (patientRoleDenied.status !== 403) throw new Error(`Expected Patient provider-workspace denial 403, got ${patientRoleDenied.status}.`);

  const adminClinicalLogin = await web('/api/clinical/auth/login', { method: 'POST', body: { email: 'admin-ci@carepoint.test', password: 'CarePoint-CI-Admin#2026' } });
  if (adminClinicalLogin.status !== 403) throw new Error(`Expected clinical BFF Admin login denial 403, got ${adminClinicalLogin.status}.`);

  const clinicalLogin = await web('/api/clinical/auth/login', { method: 'POST', body: { email: 'doctor-clinical-a@carepoint.test', password: 'CarePoint-Clinical-Doctor#2026' } });
  if (clinicalLogin.status !== 200 || clinicalLogin.payload?.authenticated !== true) throw new Error(`Clinical BFF login failed: ${clinicalLogin.status} ${JSON.stringify(clinicalLogin.payload)}`);
  const cookie = cookieHeader(clinicalLogin.response);
  if (!cookie.includes('carepoint_clinical_access=') || !cookie.includes('carepoint_clinical_refresh=') || !cookie.includes('carepoint_clinical_session=')) throw new Error('Clinical BFF did not issue the isolated HttpOnly session cookie family.');

  const webRoster = await web('/api/clinical/roster', { cookie });
  if (webRoster.status !== 200 || !webRoster.payload?.items?.some((item) => item.id === patientId)) throw new Error('Clinical BFF roster failed.');
  if (!webRoster.response.headers.get('cache-control')?.includes('no-store')) throw new Error('Clinical roster response is missing no-store cache control.');

  const webWorkspace = await web('/api/clinical/workspace', { method: 'POST', cookie, body: { patientId } });
  if (webWorkspace.status !== 200 || webWorkspace.payload?.patient?.id !== patientId) throw new Error('Clinical BFF workspace failed.');
  if (!webWorkspace.response.headers.get('cache-control')?.includes('no-store')) throw new Error('Clinical workspace response is missing no-store cache control.');

  const webCrossPatient = await web('/api/clinical/workspace', { method: 'POST', cookie, body: { patientId: second.patientProfile.id } });
  if (webCrossPatient.status !== 403) throw new Error(`Expected clinical BFF cross-patient denial 403, got ${webCrossPatient.status}.`);

  const page = await web('/clinical', { cookie });
  if (page.status !== 200 || typeof page.payload !== 'string' || !page.payload.includes('Patient Clinical Workspace')) throw new Error('WEB-05 dedicated clinical page is not rendered behind the clinical session boundary.');

  const logout = await web('/api/clinical/auth/logout', { method: 'POST', cookie, body: {} });
  if (logout.status !== 200) throw new Error(`Clinical BFF logout failed with ${logout.status}.`);
  const afterLogout = await web('/api/clinical/roster', { cookie });
  if (afterLogout.status !== 401) throw new Error(`Revoked clinical session remained usable after logout: ${afterLogout.status}.`);

  console.log(JSON.stringify({
    status: 'passed',
    patientId,
    dedicatedClinicalBoundary: true,
    adminPhiDenied: true,
    crossPatientDenied: true,
    timeline: true,
    ordersAndLabs: true,
    documentsAndReports: true,
    providerEnteredClinicalFlags: true,
    noAutonomousRiskInference: true,
    noStoreBff: true,
    sessionRevocation: true,
  }));
}

try { await main(); } finally { await prisma.$disconnect(); }
