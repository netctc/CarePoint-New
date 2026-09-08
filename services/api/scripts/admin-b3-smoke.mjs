import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const patientEmail = "patient-ci@carepoint.test";
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD || "CarePoint-Patient#2026";
const fixtureEmails = ["b3-doctor-ci@carepoint.test", "b3-provider-ci@carepoint.test", "b3-review-ci@carepoint.test"];
const ids = { appointments: [] };

class Jar {
  constructor(){ this.values=new Map(); }
  capture(response){ const raw=response.headers.get("set-cookie")||""; for(const part of raw.split(/,(?=\s*[^;,]+=)/g)){ const first=part.split(";",1)[0]||""; const at=first.indexOf("="); if(at>0) this.values.set(first.slice(0,at).trim(),first.slice(at+1).trim()); } }
  header(){ return [...this.values].map(([k,v])=>`${k}=${v}`).join("; "); }
  get(name){ return this.values.get(name)||""; }
}
function assert(ok,message){ if(!ok) throw new Error(message); }
async function api(path,init={}){ const response=await fetch(apiBase+path,{...init,headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}}); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function web(path,jar){ const response=await fetch(adminBase+path,{headers:{accept:"application/json",cookie:jar.header()},redirect:"manual"}); jar.capture(response); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function cleanup(){
  if(ids.claim) await prisma.insuranceClaim.deleteMany({where:{id:ids.claim}}).catch(()=>{});
  if(ids.coverage) await prisma.insuranceCoverage.deleteMany({where:{id:ids.coverage}}).catch(()=>{});
  if(ids.payout) await prisma.providerPayout.deleteMany({where:{id:ids.payout}}).catch(()=>{});
  if(ids.invoice) await prisma.invoice.deleteMany({where:{id:ids.invoice}}).catch(()=>{});
  if(ids.pricing) await prisma.pricingSnapshot.deleteMany({where:{id:ids.pricing}}).catch(()=>{});
  if(ids.transport) await prisma.medicalTransportRequest.deleteMany({where:{id:ids.transport}}).catch(()=>{});
  if(ids.emergency) await prisma.emergencyAmbulanceRequest.deleteMany({where:{id:ids.emergency}}).catch(()=>{});
  if(ids.onboarding) await prisma.providerOnboarding.deleteMany({where:{id:ids.onboarding}}).catch(()=>{});
  if(ids.audit) await prisma.auditEvent.deleteMany({where:{id:ids.audit}}).catch(()=>{});
  if(ids.appointments.length) await prisma.appointment.deleteMany({where:{id:{in:ids.appointments}}}).catch(()=>{});
  if(ids.service) await prisma.service.deleteMany({where:{id:ids.service}}).catch(()=>{});
  const users=await prisma.user.findMany({where:{email:{in:fixtureEmails}},select:{id:true}}).catch(()=>[]); const userIds=users.map(x=>x.id);
  if(userIds.length){ await prisma.provider.deleteMany({where:{userId:{in:userIds}}}).catch(()=>{}); await prisma.user.deleteMany({where:{id:{in:userIds}}}).catch(()=>{}); }
}

try{
  await cleanup();
  const jar=new Jar();
  const loginResponse=await fetch(adminBase+"/api/admin/auth/login",{method:"POST",headers:{"content-type":"application/json",accept:"application/json",origin:adminBase},body:JSON.stringify({email:adminEmail,password:adminPassword})}); jar.capture(loginResponse); const login=await loginResponse.json();
  assert(loginResponse.status===200&&login.authenticated===true,"B3 admin login failed.");
  assert(!/accessToken|refreshToken/i.test(JSON.stringify(login)),"B3 admin login leaked bearer material.");
  const adminAccess=jar.get("carepoint_admin_access"); assert(adminAccess,"B3 admin access cookie missing.");

  const patientLogin=await api("/iam/login",{method:"POST",body:JSON.stringify({email:patientEmail,password:patientPassword})});
  assert(patientLogin.response.ok&&patientLogin.payload.accessToken,"B3 patient login fixture failed.");
  const denied=await api("/admin/operations/command-center",{headers:{authorization:`Bearer ${patientLogin.payload.accessToken}`}});
  assert(denied.response.status===403,`PATIENT command center access should be 403, got ${denied.response.status}.`);

  const specialty=await prisma.medicalSpecialty.findFirst({where:{active:true}}); const patient=await prisma.patientProfile.findFirst({where:{user:{email:patientEmail}}});
  assert(specialty&&patient,"B3 reference fixtures missing.");
  const [doctorUser,otherUser,reviewUser]=await Promise.all(fixtureEmails.map((email,index)=>prisma.user.create({data:{email,passwordHash:"b3-fixture-not-loginable",role:index===1?"OTHER_PROVIDER":"DOCTOR"}})));
  const doctor=await prisma.provider.create({data:{userId:doctorUser.id,class:"DOCTOR",displayName:"B3 Doctor",status:"ACTIVE"}});
  await prisma.provider.create({data:{userId:otherUser.id,class:"OTHER_PROVIDER",displayName:"B3 Provider",status:"ACTIVE"}});
  await prisma.provider.create({data:{userId:reviewUser.id,class:"DOCTOR",displayName:"B3 Review",status:"PENDING_REVIEW"}});
  const onboarding=await prisma.providerOnboarding.create({data:{userId:reviewUser.id,kind:"DOCTOR",specialtyId:specialty.id,state:"PENDING_REVIEW",submittedAt:new Date()}}); ids.onboarding=onboarding.id;
  const service=await prisma.service.create({data:{providerId:doctor.id,name:"B3 Service",currency:"USD"}}); ids.service=service.id;
  const now=Date.now(); const fixtureDate=new Date(now); const offset=-fixtureDate.getTimezoneOffset(); const fixtureAnchor=new Date(fixtureDate.getFullYear(),fixtureDate.getMonth(),fixtureDate.getDate(),12,0,0,0).getTime(); const rows=[["CLINIC","COMPLETED",-3600000],["TELEMEDICINE","CONFIRMED",0],["HOME_VISIT","REQUESTED",3600000]];
  for(const [modality,status,delta] of rows){ const startsAt=new Date(fixtureAnchor+delta); const row=await prisma.appointment.create({data:{patientId:patient.id,providerId:doctor.id,serviceId:service.id,modality,status,startsAt,endsAt:new Date(startsAt.getTime()+1800000)}}); ids.appointments.push(row.id); }
  const pricing=await prisma.pricingSnapshot.create({data:{appointmentId:ids.appointments[1],patientId:patient.id,providerId:doctor.id,serviceId:service.id,modality:"TELEMEDICINE",serviceName:"B3 Service",currency:"USD",unitPriceMinor:12000,totalMinor:12000}}); ids.pricing=pricing.id;
  const invoice=await prisma.invoice.create({data:{number:`B3-${now}`,appointmentId:ids.appointments[1],pricingSnapshotId:pricing.id,patientId:patient.id,providerId:doctor.id,currency:"USD",totalMinor:12000,patientResponsibilityMinor:12000,balanceDueMinor:12000,status:"OPEN"}}); ids.invoice=invoice.id;
  const coverage=await prisma.insuranceCoverage.create({data:{patientId:patient.id,payerCode:"B3",payerName:"B3 Payer",externalPolicyRef:`B3-${now}`}}); ids.coverage=coverage.id;
  const claim=await prisma.insuranceClaim.create({data:{appointmentId:ids.appointments[0],invoiceId:invoice.id,coverageId:coverage.id,patientId:patient.id,providerId:doctor.id,idempotencyKey:`b3-claim-${now}`,gateway:"mock",status:"DENIED",reconciliationStatus:"REVIEW_REQUIRED",submittedAmountMinor:12000,currency:"USD"}}); ids.claim=claim.id;
  const payout=await prisma.providerPayout.create({data:{providerId:doctor.id,amountMinor:4000,currency:"USD",idempotencyKey:`b3-payout-${now}`,gateway:"mock",status:"PENDING"}}); ids.payout=payout.id;
  const emergency=await prisma.emergencyAmbulanceRequest.create({data:{patientId:patient.id,status:"DISPATCHING",latitude:33.89,longitude:35.5,etaMinutes:9}}); ids.emergency=emergency.id;
  const transport=await prisma.medicalTransportRequest.create({data:{patientId:patient.id,mode:"GROUND",status:"REQUESTED",scheduledFor:new Date(now+10800000),pickupLatitude:33.89,pickupLongitude:35.5,destinationLatitude:33.9,destinationLongitude:35.51,clientRequestId:`b3-transport-${now}`}}); ids.transport=transport.id;
  const audit=await prisma.auditEvent.create({data:{actorId:patient.userId,action:"B3_TEST_ACCESS_DENIED",objectType:"B3_FIXTURE",result:"DENIED"}}); ids.audit=audit.id;

  const snapshot=await web(`/api/admin/operations/command-center?tzOffsetMinutes=${offset}`,jar);
  assert(snapshot.response.status===200,`B3 snapshot failed: ${snapshot.text}`); const text=JSON.stringify(snapshot.payload);
  assert(!/accessToken|refreshToken/i.test(text),"B3 snapshot leaked bearer material.");
  for(const key of ["patientId","firstName","lastName","phone","callbackPhone","pickupAddress","destinationAddress","latitude","longitude","note","externalPolicyRef"]) assert(!text.includes(`\"${key}\"`),`B3 snapshot leaked ${key}.`);
  assert(snapshot.payload.kpis?.visitsToday>=3,"B3 visit KPI is not live."); assert(snapshot.payload.kpis?.activeDoctors>=1&&snapshot.payload.kpis?.activeOtherProviders>=1,"B3 provider KPIs are not live.");
  assert(snapshot.payload.emergency?.queue?.some(x=>x.requestId===emergency.id),"B3 emergency queue is not live."); assert(snapshot.payload.governance?.doctors?.pendingReview>=1,"B3 governance KPI is not live.");
  assert(snapshot.payload.transport?.ground?.active>=1,"B3 transport KPI is not live."); assert(snapshot.payload.finance?.outstandingInvoices?.some(x=>x.currency==="USD"&&x.balanceDueMinor>=12000),"B3 finance KPI is not live.");
  assert(snapshot.payload.finance?.pendingPayouts?.some(x=>x.currency==="USD"&&x.amountMinor>=4000),"B3 payout KPI is not live."); assert(snapshot.payload.revenueCycle?.attentionClaims>=1,"B3 revenue-cycle KPI is not live.");
  assert(snapshot.payload.security?.recentDeniedEvents?.some(x=>x.action==="B3_TEST_ACCESS_DENIED"),"B3 security signal is not live.");
  const invalid=await web("/api/admin/operations/command-center?tzOffsetMinutes=9999",jar); assert(invalid.response.status===400,"B3 invalid timezone offset was not rejected.");
  const page=await fetch(adminBase+"/",{headers:{cookie:jar.header()},redirect:"manual"}); assert(page.status===200,"B3 authenticated command center page failed.");
  console.log(JSON.stringify({status:"passed",phase:"B3",liveDatabaseKpis:true,roleIsolation:true,phiNeutralSnapshot:true,appointmentModalityAggregation:true,providerGovernanceWorkload:true,emergencyAndTransportQueues:true,financeAndRevenueSignals:true,securitySignals:true,timezoneAwareTodayWindow:true,bearerTokensHiddenFromBrowserJson:true}));
}finally{ await cleanup().catch(()=>{}); await prisma.$disconnect(); }
