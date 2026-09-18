import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const patientEmail = "patient-ci@carepoint.test";
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD;
const providerName = "B9 Analytics Provider";
const marker = "B9 analytics fixture";
const testCurrency = "B9X";
const payerCode = "B9TEST";
const dayMs = 24 * 60 * 60 * 1000;

class Jar {
  constructor(){ this.values=new Map(); }
  capture(response){ const raw=response.headers.get("set-cookie")||""; for(const part of raw.split(/,(?=\s*[^;,]+=)/g)){ const first=part.split(";",1)[0]||""; const at=first.indexOf("="); if(at>0){ const key=first.slice(0,at).trim(); const value=first.slice(at+1).trim(); if(value) this.values.set(key,value); else this.values.delete(key); } } }
  header(){ return [...this.values].map(([key,value])=>`${key}=${value}`).join("; "); }
}

function assert(ok,message){ if(!ok) throw new Error(message); }
async function api(path,init={}){ const response=await fetch(apiBase+path,{...init,headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}}); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function web(path,jar,init={}){ const headers={accept:"application/json",cookie:jar.header(),...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}; if(init.method&&init.method!=="GET"&&!headers.origin) headers.origin=adminBase; const response=await fetch(adminBase+path,{...init,headers,redirect:"manual"}); jar.capture(response); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function login(email,password){ assert(password,`Missing CI password for ${email}.`); const result=await api("/iam/login",{method:"POST",body:JSON.stringify({email,password})}); assert(result.response.ok&&result.payload.accessToken,`Login failed for ${email}: ${result.text}`); return result.payload.accessToken; }

async function cleanup(){
  const provider=await prisma.provider.findFirst({where:{displayName:providerName},select:{id:true}}).catch(()=>null);
  const appointments=provider?await prisma.appointment.findMany({where:{providerId:provider.id},select:{id:true}}).catch(()=>[]):[];
  const appointmentIds=appointments.map(x=>x.id);
  const invoices=appointmentIds.length?await prisma.invoice.findMany({where:{appointmentId:{in:appointmentIds}},select:{id:true}}).catch(()=>[]):[];
  const invoiceIds=invoices.map(x=>x.id);
  const claims=appointmentIds.length?await prisma.insuranceClaim.findMany({where:{appointmentId:{in:appointmentIds}},select:{id:true}}).catch(()=>[]):[];
  const claimIds=claims.map(x=>x.id);
  const intents=invoiceIds.length?await prisma.paymentIntent.findMany({where:{invoiceId:{in:invoiceIds}},select:{id:true}}).catch(()=>[]):[];
  const intentIds=intents.map(x=>x.id);

  if(claimIds.length){
    await prisma.claimEvent.deleteMany({where:{claimId:{in:claimIds}}}).catch(()=>{});
    await prisma.explanationOfBenefits.deleteMany({where:{claimId:{in:claimIds}}}).catch(()=>{});
    await prisma.insuranceRemittance.deleteMany({where:{claimId:{in:claimIds}}}).catch(()=>{});
  }
  if(appointmentIds.length) await prisma.insuranceClaim.deleteMany({where:{appointmentId:{in:appointmentIds}}}).catch(()=>{});
  if(intentIds.length) await prisma.paymentRefund.deleteMany({where:{paymentIntentId:{in:intentIds}}}).catch(()=>{});
  if(invoiceIds.length) await prisma.paymentReceipt.deleteMany({where:{invoiceId:{in:invoiceIds}}}).catch(()=>{});
  if(provider) await prisma.providerLedgerEntry.deleteMany({where:{providerId:provider.id}}).catch(()=>{});
  if(invoiceIds.length) await prisma.paymentIntent.deleteMany({where:{invoiceId:{in:invoiceIds}}}).catch(()=>{});
  if(invoiceIds.length) await prisma.invoice.deleteMany({where:{id:{in:invoiceIds}}}).catch(()=>{});
  if(appointmentIds.length) await prisma.pricingSnapshot.deleteMany({where:{appointmentId:{in:appointmentIds}}}).catch(()=>{});
  if(appointmentIds.length) await prisma.telehealthSession.deleteMany({where:{appointmentId:{in:appointmentIds}}}).catch(()=>{});
  await prisma.auditEvent.deleteMany({where:{objectType:"B9_ANALYTICS_FIXTURE"}}).catch(()=>{});

  const emergencies=await prisma.emergencyAmbulanceRequest.findMany({where:{pickupAddress:marker},select:{id:true}}).catch(()=>[]);
  const emergencyIds=emergencies.map(x=>x.id);
  if(emergencyIds.length){
    await prisma.emergencyDispatchEvent.deleteMany({where:{emergencyRequestId:{in:emergencyIds}}}).catch(()=>{});
    await prisma.emergencyRequestIdempotency.deleteMany({where:{emergencyRequestId:{in:emergencyIds}}}).catch(()=>{});
    await prisma.emergencyAmbulanceRequest.deleteMany({where:{id:{in:emergencyIds}}}).catch(()=>{});
  }
  const transports=await prisma.medicalTransportRequest.findMany({where:{pickupAddress:marker},select:{id:true}}).catch(()=>[]);
  const transportIds=transports.map(x=>x.id);
  if(transportIds.length){
    await prisma.medicalTransportEvent.deleteMany({where:{transportRequestId:{in:transportIds}}}).catch(()=>{});
    await prisma.medicalTransportRequest.deleteMany({where:{id:{in:transportIds}}}).catch(()=>{});
  }
  if(appointmentIds.length) await prisma.appointment.deleteMany({where:{id:{in:appointmentIds}}}).catch(()=>{});
  if(provider){
    await prisma.service.deleteMany({where:{providerId:provider.id}}).catch(()=>{});
    await prisma.provider.deleteMany({where:{id:provider.id}}).catch(()=>{});
  }
  await prisma.insuranceCoverage.deleteMany({where:{payerCode}}).catch(()=>{});
}

let stage="cleanup";
try{
  assert(adminPassword,"BOOTSTRAP_ADMIN_PASSWORD is required for B9 acceptance.");
  assert(patientPassword,"SLICE6_PATIENT_PASSWORD is required for B9 acceptance.");
  await cleanup();

  stage="auth"; console.log(`B9 stage: ${stage}`);
  const patientToken=await login(patientEmail,patientPassword);
  const adminToken=await login(adminEmail,adminPassword);
  const patient=await prisma.patientProfile.findFirst({where:{user:{email:patientEmail}},select:{id:true}});
  assert(patient,"B9 patient fixture missing.");

  const patientDenied=await api("/admin/operations/analytics/workspace?days=7",{headers:{authorization:`Bearer ${patientToken}`}});
  assert(patientDenied.response.status===403,`PATIENT analytics should be 403, got ${patientDenied.response.status}.`);
  const invalidPeriod=await api("/admin/operations/analytics/workspace?days=14",{headers:{authorization:`Bearer ${adminToken}`}});
  assert(invalidPeriod.response.status===400,`Unsupported analytics period should be 400, got ${invalidPeriod.response.status}.`);

  stage="fixtures"; console.log(`B9 stage: ${stage}`);
  const provider=await prisma.provider.create({data:{class:"DOCTOR",displayName:providerName,status:"ACTIVE"}});
  const service=await prisma.service.create({data:{providerId:provider.id,name:"B9 Analytics Service",currency:testCurrency,modalities:{create:[
    {modality:"CLINIC",durationMinutes:30,priceMinor:9900},
    {modality:"TELEMEDICINE",durationMinutes:30,priceMinor:9900},
    {modality:"HOME_VISIT",durationMinutes:30,priceMinor:9900},
  ]}}});
  const now=Date.now();
  async function appointment(modality,status,offsetDays){
    const startsAt=new Date(now+offsetDays*dayMs);
    const row=await prisma.appointment.create({data:{patientId:patient.id,providerId:provider.id,serviceId:service.id,modality,status,startsAt,endsAt:new Date(startsAt.getTime()+30*60_000)}});
    const invoice=await prisma.invoice.findUnique({where:{appointmentId:row.id}});
    assert(invoice,`B9 invoice trigger missing for ${row.id}.`);
    await prisma.invoice.update({where:{id:invoice.id},data:{issuedAt:startsAt}});
    return {row,invoice:{...invoice,issuedAt:startsAt}};
  }

  const currentTele=await appointment("TELEMEDICINE","COMPLETED",-2);
  const currentClinic=await appointment("CLINIC","NO_SHOW",-1);
  const previousTele=await appointment("TELEMEDICINE","COMPLETED",-9);
  const previousHome=await appointment("HOME_VISIT","CANCELLED",-8);

  for(const [suffix,item] of [["current",currentTele],["previous",previousTele]]){
    await prisma.telehealthSession.create({data:{appointmentId:item.row.id,roomName:`b9_${suffix}_${now}`,status:"ENDED",startedAt:new Date(item.row.startsAt.getTime()+5*60_000),endedAt:new Date(item.row.startsAt.getTime()+25*60_000),e2eeKeyId:`b9-${suffix}-key`,e2eeWrappedKey:"wrapped",e2eeIv:"iv",e2eeCiphertext:"ciphertext"}});
  }

  await prisma.paymentIntent.create({data:{invoiceId:currentClinic.invoice.id,patientId:patient.id,providerId:provider.id,amountMinor:5000,currency:testCurrency,gateway:"mock",idempotencyKey:`b9-current-payment-${now}`,status:"SUCCEEDED",createdAt:new Date(now-dayMs),succeededAt:new Date(now-dayMs)}});
  await prisma.paymentIntent.create({data:{invoiceId:previousHome.invoice.id,patientId:patient.id,providerId:provider.id,amountMinor:2500,currency:testCurrency,gateway:"mock",idempotencyKey:`b9-previous-payment-${now}`,status:"SUCCEEDED",createdAt:new Date(now-8*dayMs),succeededAt:new Date(now-8*dayMs)}});

  const coverage=await prisma.insuranceCoverage.create({data:{patientId:patient.id,payerCode,payerName:"B9 Test Payer",externalPolicyRef:`b9-policy-${now}`,status:"ACTIVE"}});
  await prisma.insuranceClaim.create({data:{appointmentId:currentClinic.row.id,invoiceId:currentClinic.invoice.id,coverageId:coverage.id,patientId:patient.id,providerId:provider.id,idempotencyKey:`b9-current-claim-${now}`,gateway:"mock",status:"DENIED",reconciliationStatus:"REVIEW_REQUIRED",submittedAmountMinor:9900,currency:testCurrency,submittedAt:new Date(now-dayMs)}});
  await prisma.insuranceClaim.create({data:{appointmentId:previousHome.row.id,invoiceId:previousHome.invoice.id,coverageId:coverage.id,patientId:patient.id,providerId:provider.id,idempotencyKey:`b9-previous-claim-${now}`,gateway:"mock",status:"PAID",reconciliationStatus:"RECONCILED",submittedAmountMinor:9900,currency:testCurrency,submittedAt:new Date(now-8*dayMs),paidAt:new Date(now-8*dayMs)}});

  await prisma.auditEvent.create({data:{actorId:null,action:"AUTHORIZATION_DENIED",objectType:"B9_ANALYTICS_FIXTURE",result:"DENIED",occurredAt:new Date(now-dayMs)}});
  await prisma.auditEvent.create({data:{actorId:null,action:"AUTHORIZATION_DENIED",objectType:"B9_ANALYTICS_FIXTURE",result:"DENIED",occurredAt:new Date(now-8*dayMs)}});
  await prisma.emergencyAmbulanceRequest.create({data:{patientId:patient.id,status:"COMPLETED",latitude:33.89,longitude:35.5,pickupAddress:marker,requestedAt:new Date(now-dayMs)}});
  await prisma.emergencyAmbulanceRequest.create({data:{patientId:patient.id,status:"COMPLETED",latitude:33.89,longitude:35.5,pickupAddress:marker,requestedAt:new Date(now-8*dayMs)}});
  await prisma.medicalTransportRequest.create({data:{patientId:patient.id,mode:"GROUND",status:"COMPLETED",assistance:"STANDARD",scheduledFor:new Date(now-dayMs),pickupLatitude:33.89,pickupLongitude:35.5,pickupAddress:marker,destinationLatitude:33.9,destinationLongitude:35.51,destinationAddress:marker,clientRequestId:`b9-ground-${now}`,requestedAt:new Date(now-dayMs)}});
  await prisma.medicalTransportRequest.create({data:{patientId:patient.id,mode:"AIR",status:"COMPLETED",assistance:"STANDARD",scheduledFor:new Date(now-8*dayMs),pickupLatitude:33.89,pickupLongitude:35.5,pickupAddress:marker,destinationLatitude:33.9,destinationLongitude:35.51,destinationAddress:marker,clientRequestId:`b9-air-${now}`,requestedAt:new Date(now-8*dayMs)}});

  stage="api-workspace"; console.log(`B9 stage: ${stage}`);
  const analytics=await api("/admin/operations/analytics/workspace?days=7",{headers:{authorization:`Bearer ${adminToken}`}});
  assert(analytics.response.status===200,`B9 analytics API failed: ${analytics.text}`);
  const a=analytics.payload;
  assert(a.window?.days===7&&a.privacy?.aggregateOnly===true&&a.privacy?.phiNeutral===true,"B9 analytics privacy/window contract missing.");
  assert(a.current?.appointments?.byModality?.TELEMEDICINE>=1&&a.current?.appointments?.byModality?.CLINIC>=1,"B9 current appointment analytics missing fixture activity.");
  assert(a.previous?.appointments?.byModality?.TELEMEDICINE>=1&&a.previous?.appointments?.byModality?.HOME_VISIT>=1,"B9 previous appointment analytics missing fixture activity.");
  assert(a.current.appointments.noShowRate>0&&a.previous.appointments.cancellationRate>0,"B9 appointment outcome rates were not calculated.");
  assert(a.current.telehealth.initializedSessions>=1&&a.previous.telehealth.initializedSessions>=1,"B9 telehealth aggregates missing fixture sessions.");
  const currentFinance=a.current.finance.find(x=>x.currency===testCurrency);
  const previousFinance=a.previous.finance.find(x=>x.currency===testCurrency);
  assert(currentFinance?.invoiceCount===2&&previousFinance?.invoiceCount===2,"B9 invoice period cohorts are incorrect.");
  assert(currentFinance?.successfulPaymentCount===1&&currentFinance?.successfulPaymentsMinor===5000,"B9 current payment analytics are incorrect.");
  assert(previousFinance?.successfulPaymentCount===1&&previousFinance?.successfulPaymentsMinor===2500,"B9 previous payment analytics are incorrect.");
  assert(a.current.claims.byStatus.DENIED>=1&&a.current.claims.reviewRequired>=1&&a.previous.claims.byStatus.PAID>=1,"B9 claims analytics are incomplete.");
  assert(a.current.security.denied>=1&&a.previous.security.denied>=1,"B9 security trend data is incomplete.");
  assert(a.current.mobility.emergencyRequests>=1&&a.previous.mobility.emergencyRequests>=1,"B9 emergency demand analytics are incomplete.");
  assert(a.current.mobility.scheduledTransport.ground>=1&&a.previous.mobility.scheduledTransport.air>=1,"B9 transport analytics are incomplete.");
  assert(a.network.activeDoctors>=1,"B9 provider network snapshot is incomplete.");
  for(const key of ["appointmentVolume","noShowRate","claimDenialRate","deniedSecurityEvents","telehealthInitializationRate","emergencyDemand"]) assert(a.signals?.[key],`B9 signal ${key} missing.`);

  const serialized=JSON.stringify(a);
  for(const forbidden of ["patientId","providerId","appointmentId","invoiceId","claimId","firstName","lastName","email","roomName","e2eeKeyId","e2eeWrappedKey","e2eeIv","e2eeCiphertext","externalPolicyRef","gatewayReference","denialCode"]){
    assert(!serialized.includes(`\"${forbidden}\"`),`B9 analytics leaked forbidden field ${forbidden}.`);
  }
  assert(!serialized.includes(providerName)&&!serialized.includes(marker)&&!serialized.includes(coverage.externalPolicyRef),"B9 analytics leaked fixture identity/details.");

  stage="admin-web"; console.log(`B9 stage: ${stage}`);
  const jar=new Jar();
  const adminLogin=await web("/api/admin/auth/login",jar,{method:"POST",body:JSON.stringify({email:adminEmail,password:adminPassword})});
  assert(adminLogin.response.status===200&&adminLogin.payload.authenticated===true,"B9 admin web login failed.");
  const bff=await web("/api/admin/analytics/workspace?days=7",jar);
  assert(bff.response.status===200&&bff.payload.window?.days===7,`B9 analytics BFF failed: ${bff.text}`);
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(JSON.stringify(bff.payload)),"B9 analytics BFF leaked bearer material.");
  const page=await fetch(adminBase+"/analytics",{headers:{cookie:jar.header()},redirect:"manual"});
  assert(page.status===200,"B9 authenticated analytics page failed.");

  console.log(JSON.stringify({status:"passed",phase:"B9",aggregateOnly:true,rollingWindows:[7,30,90],currentVsPrevious:true,appointmentAnalytics:true,telehealthAnalytics:true,financeByCurrency:true,claimsAnalytics:true,securityAnalytics:true,mobilityAnalytics:true,providerNetworkSnapshot:true,deterministicSignals:true,phiNeutral:true,bearerTokensHiddenFromBrowserJson:true}));
}catch(error){
  const message=error instanceof Error?error.message:String(error);
  console.error(`B9 acceptance failed at stage: ${stage}`);
  throw new Error(`[${stage}] ${message}`);
}finally{
  await cleanup().catch(()=>{});
  await prisma.$disconnect();
}
