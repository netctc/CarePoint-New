import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const patientEmail = "patient-ci@carepoint.test";
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD || "CarePoint-Patient#2026";
const providerEmail = "b4-doctor-ci@carepoint.test";
const ids = { appointments: [] };

class Jar {
  constructor(){ this.values=new Map(); }
  capture(response){ const raw=response.headers.get("set-cookie")||""; for(const part of raw.split(/,(?=\s*[^;,]+=)/g)){ const first=part.split(";",1)[0]||""; const at=first.indexOf("="); if(at>0){ const key=first.slice(0,at).trim(); const value=first.slice(at+1).trim(); if(value) this.values.set(key,value); else this.values.delete(key); } } }
  header(){ return [...this.values].map(([key,value])=>`${key}=${value}`).join("; "); }
}
function assert(ok,message){ if(!ok) throw new Error(message); }
async function api(path,init={}){ const response=await fetch(apiBase+path,{...init,headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}}); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function web(path,jar,init={}){ const headers={accept:"application/json",cookie:jar.header(),...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}; if(init.method&&init.method!=="GET"&&!headers.origin) headers.origin=adminBase; const response=await fetch(adminBase+path,{...init,headers,redirect:"manual"}); jar.capture(response); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function cleanup(){
  if(ids.appointments.length) await prisma.auditEvent.deleteMany({where:{objectType:"APPOINTMENT",objectId:{in:ids.appointments}}}).catch(()=>{});
  if(ids.appointments.length) await prisma.appointment.deleteMany({where:{id:{in:ids.appointments}}}).catch(()=>{});
  if(ids.slot) await prisma.availabilitySlot.deleteMany({where:{id:ids.slot}}).catch(()=>{});
  if(ids.service) await prisma.service.deleteMany({where:{id:ids.service}}).catch(()=>{});
  const user=await prisma.user.findUnique({where:{email:providerEmail},select:{id:true}}).catch(()=>null);
  if(user){ await prisma.provider.deleteMany({where:{userId:user.id}}).catch(()=>{}); await prisma.user.deleteMany({where:{id:user.id}}).catch(()=>{}); }
}

try{
  await cleanup();
  const jar=new Jar();
  const login=await web("/api/admin/auth/login",jar,{method:"POST",body:JSON.stringify({email:adminEmail,password:adminPassword})});
  assert(login.response.status===200&&login.payload.authenticated===true,"B4 admin login failed.");
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(JSON.stringify(login.payload)),"B4 admin login leaked bearer material.");

  const patientLogin=await api("/iam/login",{method:"POST",body:JSON.stringify({email:patientEmail,password:patientPassword})});
  assert(patientLogin.response.ok&&patientLogin.payload.accessToken,"B4 patient login fixture failed.");
  const patientDenied=await api("/admin/operations/appointments",{headers:{authorization:`Bearer ${patientLogin.payload.accessToken}`}});
  assert(patientDenied.response.status===403,`PATIENT appointment operations should be 403, got ${patientDenied.response.status}.`);

  const patient=await prisma.patientProfile.findFirst({where:{user:{email:patientEmail}}}); assert(patient,"B4 patient fixture missing.");
  const providerUser=await prisma.user.create({data:{email:providerEmail,passwordHash:"b4-fixture-not-loginable",role:"DOCTOR"}});
  const provider=await prisma.provider.create({data:{userId:providerUser.id,class:"DOCTOR",displayName:"B4 Operations Doctor",status:"ACTIVE"}});
  const service=await prisma.service.create({data:{providerId:provider.id,name:"B4 Operations Service",currency:"USD"}}); ids.service=service.id;
  const now=Date.now();
  const times={noShow:[now-5*3600000,now-4.5*3600000],complete:[now-3*3600000,now-2.5*3600000],cancel:[now+3*3600000,now+3.5*3600000],future:[now+5*3600000,now+5.5*3600000]};
  const slot=await prisma.availabilitySlot.create({data:{providerId:provider.id,serviceId:service.id,modality:"CLINIC",startsAt:new Date(times.cancel[0]),endsAt:new Date(times.cancel[1]),capacity:1,bookedCount:1}}); ids.slot=slot.id;
  for(const [key,[start,end]] of Object.entries(times)){
    const row=await prisma.appointment.create({data:{patientId:patient.id,providerId:provider.id,serviceId:service.id,slotId:key==="cancel"?slot.id:null,modality:"CLINIC",status:"CONFIRMED",startsAt:new Date(start),endsAt:new Date(end),idempotencyKey:`b4-${key}-${now}`}}); ids.appointments.push(row.id); ids[key]=row.id;
  }

  const from=new Date(now-6*3600000).toISOString(); const to=new Date(now+6*3600000).toISOString();
  const list=await web(`/api/admin/operations/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&modality=CLINIC&status=CONFIRMED&providerId=${encodeURIComponent(provider.id)}`,jar);
  assert(list.response.status===200,`B4 appointment list failed: ${list.text}`); const listText=JSON.stringify(list.payload);
  assert(list.payload.total===4&&list.payload.items?.length===4,"B4 live filtered appointment list did not return all fixtures.");
  assert(list.payload.filters?.providers?.some(x=>x.id===provider.id&&x.displayName==="B4 Operations Doctor"),"B4 provider filter options are not live.");
  for(const key of ["patientId","firstName","lastName","phone","cancellationReason","note","clinicalRecord","ciphertext","externalPolicyRef"]) assert(!listText.includes(`\"${key}\"`),`B4 appointment payload leaked ${key}.`);
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(listText),"B4 appointment payload leaked bearer material.");

  const tooWide=await web(`/api/admin/operations/appointments?from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now+32*24*3600000).toISOString())}`,jar);
  assert(tooWide.response.status===400,"B4 accepted an appointment interval wider than 31 days.");

  const forged=await web("/api/admin/operations/appointments/action",jar,{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({appointmentId:ids.cancel,action:"CANCEL",reasonCode:"OPERATIONS"})});
  assert(forged.response.status===403,`B4 cross-origin mutation should be 403, got ${forged.response.status}.`);
  assert((await prisma.appointment.findUnique({where:{id:ids.cancel}}))?.status==="CONFIRMED","B4 forged request changed appointment state.");

  const cancel=await web("/api/admin/operations/appointments/action",jar,{method:"POST",body:JSON.stringify({appointmentId:ids.cancel,action:"CANCEL",reasonCode:"PROVIDER_UNAVAILABLE"})});
  assert(cancel.response.ok&&cancel.payload.status==="CANCELLED",`B4 cancellation failed: ${cancel.text}`);
  assert((await prisma.availabilitySlot.findUnique({where:{id:slot.id}}))?.bookedCount===0,"B4 cancellation did not release booked slot capacity.");

  const complete=await web("/api/admin/operations/appointments/action",jar,{method:"POST",body:JSON.stringify({appointmentId:ids.complete,action:"COMPLETE"})});
  assert(complete.response.ok&&complete.payload.status==="COMPLETED",`B4 completion failed: ${complete.text}`);
  const noShow=await web("/api/admin/operations/appointments/action",jar,{method:"POST",body:JSON.stringify({appointmentId:ids.noShow,action:"NO_SHOW"})});
  assert(noShow.response.ok&&noShow.payload.status==="NO_SHOW",`B4 no-show failed: ${noShow.text}`);
  const premature=await web("/api/admin/operations/appointments/action",jar,{method:"POST",body:JSON.stringify({appointmentId:ids.future,action:"NO_SHOW"})});
  assert(premature.response.status===409,"B4 allowed future appointment to be marked no-show.");

  const events=await prisma.auditEvent.findMany({where:{objectType:"APPOINTMENT",objectId:{in:[ids.cancel,ids.complete,ids.noShow]}},select:{action:true,metadata:true,result:true}});
  const actions=new Set(events.filter(x=>x.result==="SUCCESS").map(x=>x.action));
  for(const action of ["ADMIN_APPOINTMENT_CANCELLED","ADMIN_APPOINTMENT_COMPLETED","ADMIN_APPOINTMENT_NO_SHOW"]) assert(actions.has(action),`B4 audit trail missing ${action}.`);
  const auditText=JSON.stringify(events); for(const key of ["patientId","firstName","lastName","phone","note"]) assert(!auditText.includes(`\"${key}\"`),`B4 audit metadata leaked ${key}.`);

  const page=await fetch(adminBase+"/appointments",{headers:{cookie:jar.header()},redirect:"manual"}); assert(page.status===200,"B4 authenticated appointments page failed.");
  console.log(JSON.stringify({status:"passed",phase:"B4",liveFilteredAppointments:true,roleIsolation:true,phiNeutralOperations:true,sameOriginMutationGuard:true,controlledCancellationReasons:true,slotInventoryRelease:true,completeTransition:true,noShowTimeGate:true,auditableInterventions:true,bearerTokensHiddenFromBrowserJson:true}));
}finally{ await cleanup().catch(()=>{}); await prisma.$disconnect(); }
