import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const targetEmail = "b8-telehealth-patient-ci@carepoint.test";
const targetPassword = "CarePoint-B8-Patient#2026";
const roomPrefix = "cp_b8_secret_room_";

class Jar {
  constructor(){ this.values=new Map(); }
  capture(response){ const raw=response.headers.get("set-cookie")||""; for(const part of raw.split(/,(?=\s*[^;,]+=)/g)){ const first=part.split(";",1)[0]||""; const at=first.indexOf("="); if(at>0){ const key=first.slice(0,at).trim(); const value=first.slice(at+1).trim(); if(value) this.values.set(key,value); else this.values.delete(key); } } }
  header(){ return [...this.values].map(([key,value])=>`${key}=${value}`).join("; "); }
}

function assert(ok,message){ if(!ok) throw new Error(message); }
async function api(path,init={}){ const response=await fetch(apiBase+path,{...init,headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}}); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function web(path,jar,init={}){ const headers={accept:"application/json",cookie:jar.header(),...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}; if(init.method&&init.method!=="GET"&&!headers.origin) headers.origin=adminBase; const response=await fetch(adminBase+path,{...init,headers,redirect:"manual"}); jar.capture(response); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function login(email,password){ const result=await api("/iam/login",{method:"POST",body:JSON.stringify({email,password})}); assert(result.response.ok&&result.payload.accessToken,`Login failed for ${email}: ${result.text}`); return result.payload.accessToken; }

async function cleanup(){
  const patient=await prisma.user.findUnique({where:{email:targetEmail},select:{id:true,patientProfile:{select:{id:true}}}}).catch(()=>null);
  const provider=await prisma.provider.findFirst({where:{displayName:"B8 Telehealth Provider"},select:{id:true}}).catch(()=>null);
  const appointmentIds=provider?await prisma.appointment.findMany({where:{providerId:provider.id},select:{id:true}}).catch(()=>[]):[];
  const ids=appointmentIds.map(x=>x.id);
  const sessions=ids.length?await prisma.telehealthSession.findMany({where:{appointmentId:{in:ids}},select:{id:true,consentId:true}}).catch(()=>[]):[];
  const sessionIds=sessions.map(x=>x.id);
  const consentIds=sessions.map(x=>x.consentId).filter(Boolean);
  if(sessionIds.length||ids.length){
    await prisma.auditEvent.deleteMany({where:{OR:[...(sessionIds.length?[{objectId:{in:sessionIds}}]:[]),...(ids.length?[{objectId:{in:ids}}]:[])]}}).catch(()=>{});
  }
  if(ids.length) await prisma.appointment.deleteMany({where:{id:{in:ids}}}).catch(()=>{});
  if(consentIds.length) await prisma.consent.deleteMany({where:{id:{in:consentIds}}}).catch(()=>{});
  if(provider) await prisma.provider.delete({where:{id:provider.id}}).catch(()=>{});
  if(patient) await prisma.user.delete({where:{id:patient.id}}).catch(()=>{});
}

let stage="cleanup";
try {
  await cleanup();
  stage="patient-auth";
  console.log(`B8 stage: ${stage}`);
  const registration=await api("/iam/register/patient",{method:"POST",body:JSON.stringify({email:targetEmail,password:targetPassword,firstName:"B8 Secret",lastName:"Tele Patient"})});
  assert(registration.response.ok,`B8 patient registration failed: ${registration.text}`);
  const patientToken=await login(targetEmail,targetPassword);
  const adminToken=await login(adminEmail,adminPassword);
  const patient=await prisma.user.findUnique({where:{email:targetEmail},select:{id:true,patientProfile:{select:{id:true}}}});
  assert(patient?.patientProfile,"B8 patient profile missing.");

  stage="fixtures";
  console.log(`B8 stage: ${stage}`);
  const provider=await prisma.provider.create({data:{class:"DOCTOR",displayName:"B8 Telehealth Provider",status:"ACTIVE"}});
  const service=await prisma.service.create({data:{providerId:provider.id,name:"B8 Virtual Care",currency:"USD",active:true}});
  await prisma.serviceModality.create({data:{serviceId:service.id,modality:"TELEMEDICINE",durationMinutes:30,priceMinor:5000,active:true}});

  const now=Date.now();
  const resetAppointment=await prisma.appointment.create({data:{patientId:patient.patientProfile.id,providerId:provider.id,serviceId:service.id,modality:"TELEMEDICINE",status:"CONFIRMED",startsAt:new Date(now+5*60_000),endsAt:new Date(now+35*60_000)}});
  const activeAppointment=await prisma.appointment.create({data:{patientId:patient.patientProfile.id,providerId:provider.id,serviceId:service.id,modality:"TELEMEDICINE",status:"CONFIRMED",startsAt:new Date(now-20*60_000),endsAt:new Date(now+10*60_000)}});
  const missingSessionAppointment=await prisma.appointment.create({data:{patientId:patient.patientProfile.id,providerId:provider.id,serviceId:service.id,modality:"TELEMEDICINE",status:"CONFIRMED",startsAt:new Date(now+7*60_000),endsAt:new Date(now+37*60_000)}});

  const resetConsent=await prisma.consent.create({data:{patientId:patient.patientProfile.id,providerId:provider.id,scope:"TELEMEDICINE_SESSION",version:"telemedicine-v1",state:"GRANTED"}});
  const activeConsent=await prisma.consent.create({data:{patientId:patient.patientProfile.id,providerId:provider.id,scope:"TELEMEDICINE_SESSION",version:"telemedicine-v1",state:"GRANTED"}});
  const resetSession=await prisma.telehealthSession.create({data:{appointmentId:resetAppointment.id,roomName:`${roomPrefix}reset`,status:"READY",consentId:resetConsent.id,consentVersion:"telemedicine-v1",patientReadyAt:new Date(),providerReadyAt:new Date(),patientReadiness:{camera:true,microphone:true,network:true,checkedAt:new Date().toISOString()},providerReadiness:{camera:true,microphone:true,network:true,checkedAt:new Date().toISOString()},e2eeKeyId:"b8-hidden-key",e2eeWrappedKey:"b8-hidden-wrapped-key",e2eeIv:"b8-hidden-iv",e2eeCiphertext:"b8-hidden-ciphertext"}});
  const activeSession=await prisma.telehealthSession.create({data:{appointmentId:activeAppointment.id,roomName:`${roomPrefix}active`,status:"ACTIVE",consentId:activeConsent.id,consentVersion:"telemedicine-v1",patientReadyAt:new Date(now-25*60_000),providerReadyAt:new Date(now-25*60_000),patientReadiness:{camera:true,microphone:true,network:true},providerReadiness:{camera:true,microphone:true,network:true},startedAt:new Date(now-18*60_000),e2eeKeyId:"b8-active-hidden-key",e2eeWrappedKey:"b8-active-hidden-wrapped-key",e2eeIv:"b8-active-hidden-iv",e2eeCiphertext:"b8-active-hidden-ciphertext"}});

  stage="role-isolation";
  console.log(`B8 stage: ${stage}`);
  const patientDenied=await api("/admin/operations/telehealth/workspace",{headers:{authorization:`Bearer ${patientToken}`}});
  assert(patientDenied.response.status===403,`PATIENT telehealth admin workspace should be 403, got ${patientDenied.response.status}.`);
  const adminJoinDenied=await api(`/telehealth/appointments/${resetAppointment.id}`,{headers:{authorization:`Bearer ${adminToken}`}});
  assert(adminJoinDenied.response.status===403,`ADMIN must not acquire TELEHEALTH_JOIN; expected 403, got ${adminJoinDenied.response.status}.`);

  stage="admin-login";
  console.log(`B8 stage: ${stage}`);
  const jar=new Jar();
  const adminLogin=await web("/api/admin/auth/login",jar,{method:"POST",body:JSON.stringify({email:adminEmail,password:adminPassword})});
  assert(adminLogin.response.status===200&&adminLogin.payload.authenticated===true,"B8 admin web login failed.");

  stage="workspace";
  console.log(`B8 stage: ${stage}`);
  const snapshot=await web("/api/admin/telehealth/workspace",jar);
  assert(snapshot.response.status===200,`B8 telehealth workspace failed: ${snapshot.text}`);
  assert(snapshot.payload.privacy?.phiNeutral===true&&snapshot.payload.policy?.adminCannotJoin===true,"B8 privacy/operational policy missing.");
  assert(snapshot.payload.summary?.appointmentsInWindow>=3&&snapshot.payload.summary?.active>=1&&snapshot.payload.summary?.attentionNeeded>=1,"B8 live telehealth summary is incomplete.");
  const resetRow=snapshot.payload.queue?.find(x=>x.sessionId===resetSession.id);
  const activeRow=snapshot.payload.queue?.find(x=>x.sessionId===activeSession.id);
  const missingRow=snapshot.payload.queue?.find(x=>x.appointmentId===missingSessionAppointment.id);
  assert(resetRow&&activeRow&&missingRow,"B8 telehealth queue is missing fixture rows.");
  assert(missingRow.severity==="HIGH"&&missingRow.attentionReasons.includes("SESSION_NOT_INITIALIZED"),"B8 did not prioritize an imminent uninitialized session.");
  assert(resetRow.consentGranted===true&&resetRow.patientReady===true&&resetRow.providerReady===true,"B8 normalized readiness state is incorrect.");
  assert(activeRow.actions?.canTerminateSession===true,"B8 active session is not terminable through the safe operations action.");

  const snapshotText=JSON.stringify(snapshot.payload);
  for(const forbidden of ["patientId","patientProfile","firstName","lastName","email","roomName","e2eeKeyId","e2eeWrappedKey","e2eeIv","e2eeCiphertext","consentId","participantToken","accessToken","refreshToken","serverUrl"]){
    assert(!snapshotText.includes(`\"${forbidden}\"`),`B8 workspace leaked forbidden field ${forbidden}.`);
  }
  assert(!snapshotText.includes(targetEmail)&&!snapshotText.includes(patient.id)&&!snapshotText.includes(patient.patientProfile.id),"B8 workspace leaked patient identity.");
  assert(!snapshotText.includes(roomPrefix)&&!snapshotText.includes("b8-hidden-key")&&!snapshotText.includes("b8-hidden-ciphertext"),"B8 workspace leaked room/encryption material.");

  stage="same-origin";
  console.log(`B8 stage: ${stage}`);
  const forged=await web("/api/admin/telehealth/actions",jar,{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({action:"RESET_READINESS",sessionId:resetSession.id})});
  assert(forged.response.status===403,`B8 forged reset should be 403, got ${forged.response.status}.`);
  const unchanged=await prisma.telehealthSession.findUnique({where:{id:resetSession.id},select:{status:true,patientReadyAt:true,providerReadyAt:true}});
  assert(unchanged?.status==="READY"&&unchanged.patientReadyAt&&unchanged.providerReadyAt,"B8 forged request changed readiness state.");

  stage="readiness-reset";
  console.log(`B8 stage: ${stage}`);
  const reset=await web("/api/admin/telehealth/actions",jar,{method:"POST",body:JSON.stringify({action:"RESET_READINESS",sessionId:resetSession.id})});
  assert(reset.response.ok&&reset.payload.status==="WAITING"&&reset.payload.consentPreserved===true,`B8 readiness reset failed: ${reset.text}`);
  const resetStored=await prisma.telehealthSession.findUnique({where:{id:resetSession.id},select:{status:true,consentId:true,patientReadyAt:true,providerReadyAt:true,patientReadiness:true,providerReadiness:true}});
  assert(resetStored?.status==="WAITING"&&resetStored.consentId===resetConsent.id&&!resetStored.patientReadyAt&&!resetStored.providerReadyAt&&resetStored.patientReadiness===null&&resetStored.providerReadiness===null,"B8 readiness reset did not persist safely/preserve consent.");

  stage="session-termination";
  console.log(`B8 stage: ${stage}`);
  const terminate=await web("/api/admin/telehealth/actions",jar,{method:"POST",body:JSON.stringify({action:"TERMINATE_SESSION",sessionId:activeSession.id,reasonCode:"TECHNICAL_FAILURE"})});
  assert(terminate.response.ok&&terminate.payload.status==="ENDED"&&terminate.payload.appointmentStatus==="CONFIRMED",`B8 active session termination failed: ${terminate.text}`);
  const activeStored=await prisma.telehealthSession.findUnique({where:{id:activeSession.id},select:{status:true,endedAt:true,appointment:{select:{status:true}}}});
  assert(activeStored?.status==="ENDED"&&activeStored.endedAt&&activeStored.appointment.status==="CONFIRMED","B8 termination did not preserve appointment lifecycle.");

  for(const result of [reset.payload,terminate.payload]){
    const text=JSON.stringify(result);
    assert(!text.includes(targetEmail)&&!text.includes(patient.id)&&!text.includes(patient.patientProfile.id),"B8 action response leaked patient identity.");
    assert(!text.includes(roomPrefix)&&!text.includes("e2ee"),"B8 action response leaked room/encryption material.");
  }

  stage="audit";
  console.log(`B8 stage: ${stage}`);
  const admin=await prisma.user.findUnique({where:{email:adminEmail},select:{id:true}});
  assert(admin,"B8 admin fixture missing.");
  const audit=await prisma.auditEvent.findMany({where:{actorId:admin.id,objectId:{in:[resetSession.id,activeSession.id]},action:{in:["ADMIN_TELEHEALTH_READINESS_RESET","ADMIN_TELEHEALTH_SESSION_TERMINATED"]}},select:{action:true,result:true,metadata:true}});
  assert(audit.some(x=>x.action==="ADMIN_TELEHEALTH_READINESS_RESET"&&x.result==="SUCCESS")&&audit.some(x=>x.action==="ADMIN_TELEHEALTH_SESSION_TERMINATED"&&x.result==="SUCCESS"),"B8 interventions were not fully audited.");

  stage="page-render";
  console.log(`B8 stage: ${stage}`);
  const page=await fetch(adminBase+"/telehealth",{headers:{cookie:jar.header()},redirect:"manual"});
  assert(page.status===200,"B8 authenticated telehealth page failed.");

  stage="post-action-workspace";
  console.log(`B8 stage: ${stage}`);
  const after=await web("/api/admin/telehealth/workspace",jar);
  assert(after.response.ok,"B8 post-action workspace failed.");
  const afterReset=after.payload.queue.find(x=>x.sessionId===resetSession.id);
  const afterActive=after.payload.queue.find(x=>x.sessionId===activeSession.id);
  assert(afterReset?.sessionStatus==="WAITING"&&afterReset.patientReady===false&&afterReset.providerReady===false,"B8 post-reset workspace did not reflect state.");
  assert(afterActive?.sessionStatus==="ENDED","B8 post-termination workspace did not reflect state.");

  console.log(JSON.stringify({status:"passed",phase:"B8",liveTelehealthWorkspace:true,roleIsolation:true,adminCannotJoin:true,phiNeutralCareDelivery:true,joinCredentialsHidden:true,readinessPrioritization:true,sameOriginMutationGuard:true,readinessReset:true,consentPreserved:true,activeSessionTermination:true,appointmentLifecyclePreserved:true,auditableTelehealthOperations:true,bearerTokensHiddenFromBrowserJson:true}));
}catch(error){
  const message=error instanceof Error?error.message:String(error);
  console.error(`B8 acceptance failed at stage: ${stage}`);
  throw new Error(`[${stage}] ${message}`);
}finally{
  await cleanup().catch(()=>{});
  await prisma.$disconnect();
}
