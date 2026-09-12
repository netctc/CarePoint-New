import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const patientEmail = "patient-ci@carepoint.test";
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD || "CarePoint-Patient#2026";
const providerEmail = "b5-doctor-ci@carepoint.test";
const ids = { appointments: [], slots: [] };

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
  if(ids.appointments.length) await prisma.insuranceClaim.deleteMany({where:{appointmentId:{in:ids.appointments}}}).catch(()=>{});
  if(ids.appointments.length) await prisma.paymentReceipt.deleteMany({where:{invoiceId:{in:(await prisma.invoice.findMany({where:{appointmentId:{in:ids.appointments}},select:{id:true}})).map(x=>x.id)}}}).catch(()=>{});
  if(ids.appointments.length) await prisma.invoice.deleteMany({where:{appointmentId:{in:ids.appointments}}}).catch(()=>{});
  if(ids.appointments.length) await prisma.pricingSnapshot.deleteMany({where:{appointmentId:{in:ids.appointments}}}).catch(()=>{});
  if(ids.appointments.length) await prisma.appointment.deleteMany({where:{id:{in:ids.appointments}}}).catch(()=>{});
  if(ids.slots.length) await prisma.availabilitySlot.deleteMany({where:{id:{in:ids.slots}}}).catch(()=>{});
  if(ids.service) await prisma.service.deleteMany({where:{id:ids.service}}).catch(()=>{});
  const user=await prisma.user.findUnique({where:{email:providerEmail},select:{id:true}}).catch(()=>null);
  if(user){ await prisma.provider.deleteMany({where:{userId:user.id}}).catch(()=>{}); await prisma.user.deleteMany({where:{id:user.id}}).catch(()=>{}); }
}

try{
  await cleanup();
  const jar=new Jar();
  const login=await web("/api/admin/auth/login",jar,{method:"POST",body:JSON.stringify({email:adminEmail,password:adminPassword})});
  assert(login.response.status===200&&login.payload.authenticated===true,"B5 admin login failed.");
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(JSON.stringify(login.payload)),"B5 admin login leaked bearer material.");

  const patientLogin=await api("/iam/login",{method:"POST",body:JSON.stringify({email:patientEmail,password:patientPassword})});
  assert(patientLogin.response.ok&&patientLogin.payload.accessToken,"B5 patient login fixture failed.");
  const patientDenied=await api("/admin/operations/appointments/invalid/reschedule-options",{headers:{authorization:`Bearer ${patientLogin.payload.accessToken}`}});
  assert(patientDenied.response.status===403,`PATIENT reschedule options should be 403, got ${patientDenied.response.status}.`);

  const patient=await prisma.patientProfile.findFirst({where:{user:{email:patientEmail}}}); assert(patient,"B5 patient fixture missing.");
  const providerUser=await prisma.user.create({data:{email:providerEmail,passwordHash:"b5-fixture-not-loginable",role:"DOCTOR"}});
  const provider=await prisma.provider.create({data:{userId:providerUser.id,class:"DOCTOR",displayName:"B5 Rescheduling Doctor",status:"ACTIVE"}});
  const service=await prisma.service.create({data:{providerId:provider.id,name:"B5 Immutable Service",currency:"USD",modalities:{create:[{modality:"CLINIC",durationMinutes:30,priceMinor:12500},{modality:"TELEMEDICINE",durationMinutes:30,priceMinor:17500}]}}}); ids.service=service.id;
  const now=Date.now();

  async function slot(modality,startHours,bookedCount=0){
    const row=await prisma.availabilitySlot.create({data:{providerId:provider.id,serviceId:service.id,modality,startsAt:new Date(now+startHours*3600000),endsAt:new Date(now+(startHours+.5)*3600000),capacity:1,bookedCount}}); ids.slots.push(row.id); return row;
  }

  const clinicSource=await slot("CLINIC",4,1); const clinicDest=await slot("CLINIC",6,0); const clinicFull=await slot("CLINIC",7,1);
  const clinicAppointment=await prisma.appointment.create({data:{patientId:patient.id,providerId:provider.id,serviceId:service.id,slotId:clinicSource.id,modality:"CLINIC",status:"CONFIRMED",startsAt:clinicSource.startsAt,endsAt:clinicSource.endsAt,idempotencyKey:`b5-clinic-${now}`}}); ids.appointments.push(clinicAppointment.id);
  const pricingBefore=await prisma.pricingSnapshot.findUnique({where:{appointmentId:clinicAppointment.id}}); const invoiceBefore=await prisma.invoice.findUnique({where:{appointmentId:clinicAppointment.id}});
  assert(pricingBefore&&invoiceBefore,"B5 booking trigger did not create immutable pricing/invoice fixtures.");

  const from=new Date(now+3*3600000).toISOString(); const to=new Date(now+8*3600000).toISOString();
  const options=await web(`/api/admin/operations/appointments/reschedule-options?appointmentId=${encodeURIComponent(clinicAppointment.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,jar);
  assert(options.response.status===200,`B5 reschedule options failed: ${options.text}`);
  const optionText=JSON.stringify(options.payload);
  assert(options.payload.items?.some(x=>x.slotId===clinicDest.id),"B5 compatible destination slot was not returned.");
  assert(!options.payload.items?.some(x=>x.slotId===clinicSource.id),"B5 current slot was returned as a destination.");
  assert(!options.payload.items?.some(x=>x.slotId===clinicFull.id),"B5 full slot was returned as available.");
  for(const key of ["patientId","firstName","lastName","phone","externalPolicyRef","ciphertext","note"]) assert(!optionText.includes(`\"${key}\"`),`B5 reschedule options leaked ${key}.`);
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(optionText),"B5 reschedule options leaked bearer material.");

  const forged=await web("/api/admin/operations/appointments/reschedule",jar,{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({appointmentId:clinicAppointment.id,slotId:clinicDest.id})});
  assert(forged.response.status===403,`B5 cross-origin reschedule should be 403, got ${forged.response.status}.`);
  assert((await prisma.availabilitySlot.findUnique({where:{id:clinicSource.id}}))?.bookedCount===1,"B5 forged request released source inventory.");
  assert((await prisma.availabilitySlot.findUnique({where:{id:clinicDest.id}}))?.bookedCount===0,"B5 forged request reserved destination inventory.");

  const moved=await web("/api/admin/operations/appointments/reschedule",jar,{method:"POST",body:JSON.stringify({appointmentId:clinicAppointment.id,slotId:clinicDest.id})});
  assert(moved.response.ok&&moved.payload.slotId===clinicDest.id,`B5 reschedule failed: ${moved.text}`);
  const clinicAfter=await prisma.appointment.findUnique({where:{id:clinicAppointment.id}});
  assert(clinicAfter?.slotId===clinicDest.id&&clinicAfter.startsAt.getTime()===clinicDest.startsAt.getTime(),"B5 appointment did not move to destination slot.");
  assert((await prisma.availabilitySlot.findUnique({where:{id:clinicSource.id}}))?.bookedCount===0,"B5 source slot was not released exactly once.");
  assert((await prisma.availabilitySlot.findUnique({where:{id:clinicDest.id}}))?.bookedCount===1,"B5 destination slot was not reserved exactly once.");
  const pricingAfter=await prisma.pricingSnapshot.findUnique({where:{appointmentId:clinicAppointment.id}}); const invoiceAfter=await prisma.invoice.findUnique({where:{appointmentId:clinicAppointment.id}});
  assert(pricingAfter?.id===pricingBefore.id&&pricingAfter.totalMinor===pricingBefore.totalMinor&&pricingAfter.providerId===pricingBefore.providerId&&pricingAfter.serviceId===pricingBefore.serviceId&&pricingAfter.modality===pricingBefore.modality,"B5 changed immutable PricingSnapshot during reschedule.");
  assert(invoiceAfter?.id===invoiceBefore.id&&invoiceAfter.number===invoiceBefore.number&&invoiceAfter.totalMinor===invoiceBefore.totalMinor&&invoiceAfter.status===invoiceBefore.status,"B5 changed immutable Invoice during reschedule.");

  const fullAttempt=await web("/api/admin/operations/appointments/reschedule",jar,{method:"POST",body:JSON.stringify({appointmentId:clinicAppointment.id,slotId:clinicFull.id})});
  assert(fullAttempt.response.status===409,"B5 allowed rescheduling into a full slot.");
  assert((await prisma.appointment.findUnique({where:{id:clinicAppointment.id}}))?.slotId===clinicDest.id,"B5 failed full-slot attempt changed appointment.");

  const teleSource=await slot("TELEMEDICINE",9,1); const teleDest=await slot("TELEMEDICINE",11,0); const teleBlockedDest=await slot("TELEMEDICINE",13,0);
  const teleAppointment=await prisma.appointment.create({data:{patientId:patient.id,providerId:provider.id,serviceId:service.id,slotId:teleSource.id,modality:"TELEMEDICINE",status:"CONFIRMED",startsAt:teleSource.startsAt,endsAt:teleSource.endsAt,idempotencyKey:`b5-tele-${now}`}}); ids.appointments.push(teleAppointment.id);
  await prisma.telehealthSession.create({data:{appointmentId:teleAppointment.id,roomName:`b5_room_${now}`,status:"READY",patientReadyAt:new Date(),providerReadyAt:new Date(),patientReadiness:{camera:true,microphone:true,network:true},providerReadiness:{camera:true,microphone:true,network:true},e2eeKeyId:"b5-test-key",e2eeWrappedKey:"wrapped",e2eeIv:"iv",e2eeCiphertext:"ciphertext"}});
  const teleMove=await web("/api/admin/operations/appointments/reschedule",jar,{method:"POST",body:JSON.stringify({appointmentId:teleAppointment.id,slotId:teleDest.id})});
  assert(teleMove.response.ok&&teleMove.payload.reschedule?.telehealthReadinessReset===true,`B5 telehealth reschedule failed: ${teleMove.text}`);
  const teleSession=await prisma.telehealthSession.findUnique({where:{appointmentId:teleAppointment.id}});
  assert(teleSession?.status==="WAITING"&&!teleSession.patientReadyAt&&!teleSession.providerReadyAt,"B5 did not reset stale telehealth readiness after reschedule.");
  await prisma.telehealthSession.update({where:{appointmentId:teleAppointment.id},data:{status:"ACTIVE",startedAt:new Date()}});
  const activeTeleAttempt=await web("/api/admin/operations/appointments/reschedule",jar,{method:"POST",body:JSON.stringify({appointmentId:teleAppointment.id,slotId:teleBlockedDest.id})});
  assert(activeTeleAttempt.response.status===409,"B5 allowed a started telehealth session to be rescheduled.");
  assert((await prisma.availabilitySlot.findUnique({where:{id:teleBlockedDest.id}}))?.bookedCount===0,"B5 blocked telehealth reschedule consumed destination inventory.");

  const events=await prisma.auditEvent.findMany({where:{action:"ADMIN_APPOINTMENT_RESCHEDULED",objectId:{in:[clinicAppointment.id,teleAppointment.id]}},select:{action:true,objectId:true,metadata:true,result:true}});
  assert(events.length===2&&events.every(x=>x.result==="SUCCESS"),"B5 audit trail did not record both successful reschedules.");
  const auditText=JSON.stringify(events); for(const key of ["patientId","firstName","lastName","phone","note","externalPolicyRef"]) assert(!auditText.includes(`\"${key}\"`),`B5 audit metadata leaked ${key}.`);

  const page=await fetch(adminBase+"/appointments",{headers:{cookie:jar.header()},redirect:"manual"}); assert(page.status===200,"B5 authenticated appointments page failed.");
  console.log(JSON.stringify({status:"passed",phase:"B5",liveRescheduleOptions:true,roleIsolation:true,phiNeutralRescheduling:true,sameOriginMutationGuard:true,atomicCapacityTransfer:true,immutablePricingPreserved:true,invoiceIdentityPreserved:true,fullSlotRejected:true,telehealthReadinessReset:true,startedTelehealthBlocked:true,auditableRescheduling:true,bearerTokensHiddenFromBrowserJson:true}));
}finally{ await cleanup().catch(()=>{}); await prisma.$disconnect(); }
