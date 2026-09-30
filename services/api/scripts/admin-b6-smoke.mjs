import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const patientEmail = "patient-ci@carepoint.test";
const patientPassword = process.env.SLICE6_PATIENT_PASSWORD || "CarePoint-Patient#2026";
const providerEmail = "b6-finance-doctor-ci@carepoint.test";
const ids = { appointments: [], invoices: [], intents: [], claims: [], payouts: [], coverages: [] };

class Jar {
  constructor(){ this.values=new Map(); }
  capture(response){ const raw=response.headers.get("set-cookie")||""; for(const part of raw.split(/,(?=\s*[^;,]+=)/g)){ const first=part.split(";",1)[0]||""; const at=first.indexOf("="); if(at>0){ const key=first.slice(0,at).trim(); const value=first.slice(at+1).trim(); if(value) this.values.set(key,value); else this.values.delete(key); } } }
  header(){ return [...this.values].map(([key,value])=>`${key}=${value}`).join("; "); }
}
function assert(ok,message){ if(!ok) throw new Error(message); }
async function api(path,init={}){ const response=await fetch(apiBase+path,{...init,headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}}); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function web(path,jar,init={}){ const headers={accept:"application/json",cookie:jar.header(),...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}; if(init.method&&init.method!=="GET"&&!headers.origin) headers.origin=adminBase; const response=await fetch(adminBase+path,{...init,headers,redirect:"manual"}); jar.capture(response); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }

async function cleanup(){
  const claims=await prisma.insuranceClaim.findMany({where:{id:{in:ids.claims}},select:{id:true}}).catch(()=>[]); const claimIds=claims.map(x=>x.id);
  if(claimIds.length){ await prisma.insuranceRemittance.deleteMany({where:{claimId:{in:claimIds}}}).catch(()=>{}); await prisma.explanationOfBenefits.deleteMany({where:{claimId:{in:claimIds}}}).catch(()=>{}); await prisma.claimEvent.deleteMany({where:{claimId:{in:claimIds}}}).catch(()=>{}); await prisma.insuranceClaim.deleteMany({where:{id:{in:claimIds}}}).catch(()=>{}); }
  if(ids.payouts.length){ await prisma.providerLedgerEntry.deleteMany({where:{payoutId:{in:ids.payouts}}}).catch(()=>{}); await prisma.providerPayout.deleteMany({where:{id:{in:ids.payouts}}}).catch(()=>{}); }
  if(ids.intents.length){ const refunds=await prisma.paymentRefund.findMany({where:{paymentIntentId:{in:ids.intents}},select:{id:true}}).catch(()=>[]); const refundIds=refunds.map(x=>x.id); if(refundIds.length) await prisma.providerLedgerEntry.deleteMany({where:{refundId:{in:refundIds}}}).catch(()=>{}); await prisma.paymentRefund.deleteMany({where:{paymentIntentId:{in:ids.intents}}}).catch(()=>{}); await prisma.paymentReceipt.deleteMany({where:{paymentIntentId:{in:ids.intents}}}).catch(()=>{}); await prisma.providerLedgerEntry.deleteMany({where:{paymentIntentId:{in:ids.intents}}}).catch(()=>{}); await prisma.paymentIntent.deleteMany({where:{id:{in:ids.intents}}}).catch(()=>{}); }
  if(ids.invoices.length){ await prisma.providerLedgerEntry.deleteMany({where:{invoiceId:{in:ids.invoices}}}).catch(()=>{}); await prisma.invoice.deleteMany({where:{id:{in:ids.invoices}}}).catch(()=>{}); }
  if(ids.appointments.length){ await prisma.pricingSnapshot.deleteMany({where:{appointmentId:{in:ids.appointments}}}).catch(()=>{}); await prisma.appointment.deleteMany({where:{id:{in:ids.appointments}}}).catch(()=>{}); }
  if(ids.coverages.length) await prisma.insuranceCoverage.deleteMany({where:{id:{in:ids.coverages}}}).catch(()=>{});
  if(ids.service) await prisma.service.deleteMany({where:{id:ids.service}}).catch(()=>{});
  const user=await prisma.user.findUnique({where:{email:providerEmail},select:{id:true}}).catch(()=>null); if(user){ await prisma.provider.deleteMany({where:{userId:user.id}}).catch(()=>{}); await prisma.user.deleteMany({where:{id:user.id}}).catch(()=>{}); }
  await prisma.auditEvent.deleteMany({where:{action:{startsWith:"ADMIN_FINANCE_"}}}).catch(()=>{});
}

try{
  await cleanup();
  const jar=new Jar();
  const login=await web("/api/admin/auth/login",jar,{method:"POST",body:JSON.stringify({email:adminEmail,password:adminPassword})});
  assert(login.response.status===200&&login.payload.authenticated===true,"B6 admin login failed.");
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(JSON.stringify(login.payload)),"B6 admin login leaked bearer material.");

  const patientLogin=await api("/iam/login",{method:"POST",body:JSON.stringify({email:patientEmail,password:patientPassword})});
  assert(patientLogin.response.ok&&patientLogin.payload.accessToken,"B6 patient login failed.");
  const patientDenied=await api("/admin/finance/workspace",{headers:{authorization:`Bearer ${patientLogin.payload.accessToken}`}});
  assert(patientDenied.response.status===403,`PATIENT finance workspace should be 403, got ${patientDenied.response.status}.`);

  const patient=await prisma.patientProfile.findFirst({where:{user:{email:patientEmail}}}); assert(patient,"B6 patient fixture missing.");
  const providerUser=await prisma.user.create({data:{email:providerEmail,passwordHash:"b6-fixture-not-loginable",role:"DOCTOR"}});
  const provider=await prisma.provider.create({data:{userId:providerUser.id,class:"DOCTOR",displayName:"B6 Revenue Doctor",status:"ACTIVE"}});
  const service=await prisma.service.create({data:{providerId:provider.id,name:"B6 Financial Service",currency:"USD",modalities:{create:[{modality:"CLINIC",durationMinutes:30,priceMinor:20000}]}}}); ids.service=service.id;
  const now=Date.now();
  const paidAppointment=await prisma.appointment.create({data:{patientId:patient.id,providerId:provider.id,serviceId:service.id,modality:"CLINIC",status:"COMPLETED",startsAt:new Date(now-4*3600000),endsAt:new Date(now-3.5*3600000),idempotencyKey:`b6-paid-${now}`}}); ids.appointments.push(paidAppointment.id);
  const openAppointment=await prisma.appointment.create({data:{patientId:patient.id,providerId:provider.id,serviceId:service.id,modality:"CLINIC",status:"CONFIRMED",startsAt:new Date(now+5*3600000),endsAt:new Date(now+5.5*3600000),idempotencyKey:`b6-open-${now}`}}); ids.appointments.push(openAppointment.id);
  const paidInvoice=await prisma.invoice.findUnique({where:{appointmentId:paidAppointment.id}}); const openInvoice=await prisma.invoice.findUnique({where:{appointmentId:openAppointment.id}});
  assert(paidInvoice&&openInvoice,"B6 booking trigger did not create invoice fixtures."); ids.invoices.push(paidInvoice.id,openInvoice.id);

  const pay=await api(`/billing/invoices/${paidInvoice.id}/payment-intents`,{method:"POST",headers:{authorization:`Bearer ${patientLogin.payload.accessToken}`},body:JSON.stringify({idempotencyKey:`b6-payment-${now}`,amountMinor:paidInvoice.balanceDueMinor})});
  assert(pay.response.ok&&pay.payload.status==="SUCCEEDED",`B6 payment fixture failed: ${pay.text}`); ids.intents.push(pay.payload.id);
  const paidAfter=await prisma.invoice.findUnique({where:{id:paidInvoice.id}}); assert(paidAfter?.status==="PAID"&&paidAfter.balanceDueMinor===0,"B6 payment fixture did not settle invoice.");

  const coverage=await prisma.insuranceCoverage.create({data:{patientId:patient.id,payerCode:"B6PAYER",payerName:"B6 Payer",externalPolicyRef:`SECRET-POLICY-${now}`,status:"ACTIVE"}}); ids.coverages.push(coverage.id);
  const denied=await prisma.insuranceClaim.create({data:{appointmentId:paidAppointment.id,invoiceId:paidInvoice.id,coverageId:coverage.id,patientId:patient.id,providerId:provider.id,version:1,idempotencyKey:`b6-denied-${now}`,gateway:"MOCK_CLAIMS",gatewayClaimRef:`mock_clm_b6_${now}`,status:"DENIED",reconciliationStatus:"REVIEW_REQUIRED",submittedAmountMinor:paidInvoice.totalMinor,currency:paidInvoice.currency,allowedMinor:0,insurerPaidMinor:0,patientResponsibilityMinor:0,adjustmentMinor:paidInvoice.totalMinor,denialCode:"B6_CORRECT",denialPublicMessage:"Corrected claim required.",adjudicatedAt:new Date()}}); ids.claims.push(denied.id);

  const snapshot=await web("/api/admin/finance/workspace",jar);
  assert(snapshot.response.status===200,`B6 finance workspace failed: ${snapshot.text}`);
  assert(snapshot.payload.privacy?.phiNeutral===true,"B6 finance workspace is not marked PHI-neutral.");
  assert(snapshot.payload.queues?.invoices?.some(x=>x.invoiceId===openInvoice.id),"B6 outstanding invoice missing from workspace.");
  const paymentRow=snapshot.payload.queues?.paymentIntents?.find(x=>x.paymentIntentId===pay.payload.id); assert(paymentRow?.refundableMinor===paidInvoice.totalMinor,"B6 refundable payment balance is incorrect.");
  assert(snapshot.payload.queues?.claims?.some(x=>x.claimId===denied.id&&x.reconciliationStatus==="REVIEW_REQUIRED"),"B6 claim attention row missing.");
  const capacity=snapshot.payload.queues?.payoutCapacity?.find(x=>x.provider?.id===provider.id&&x.currency==="USD"); assert(capacity&&capacity.availableForPayoutMinor>0,"B6 payout capacity missing after settled payment.");
  const snapshotText=JSON.stringify(snapshot.payload);
  for(const key of ["patientId","coverageId","externalPolicyRef","gatewayClaimRef","gatewayIntentRef","gatewayPayoutRef","ciphertext","clinicalRecord"]) assert(!snapshotText.includes(`\"${key}\"`),`B6 workspace leaked ${key}.`);
  assert(!snapshotText.includes(`SECRET-POLICY-${now}`),"B6 workspace leaked a policy identifier value.");
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(snapshotText),"B6 workspace leaked bearer material.");

  const refundsBefore=await prisma.paymentRefund.count({where:{paymentIntentId:pay.payload.id}});
  const forged=await web("/api/admin/finance/actions",jar,{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({action:"REFUND_PAYMENT",resourceId:pay.payload.id,amountMinor:100,idempotencyKey:`b6-forged-${now}`})});
  assert(forged.response.status===403,`B6 forged refund should be 403, got ${forged.response.status}.`);
  assert(await prisma.paymentRefund.count({where:{paymentIntentId:pay.payload.id}})===refundsBefore,"B6 forged refund changed financial state.");

  const refundAmount=2000;
  const refund=await web("/api/admin/finance/actions",jar,{method:"POST",body:JSON.stringify({action:"REFUND_PAYMENT",resourceId:pay.payload.id,amountMinor:refundAmount,reason:"B6_OPERATIONAL_TEST",idempotencyKey:`b6-refund-${now}`})});
  assert(refund.response.ok&&refund.payload.status==="SUCCEEDED"&&refund.payload.amountMinor===refundAmount,`B6 admin refund failed: ${refund.text}`);
  const invoiceAfterRefund=await prisma.invoice.findUnique({where:{id:paidInvoice.id}}); assert(invoiceAfterRefund?.amountRefundedMinor===refundAmount,"B6 admin refund did not update invoice refunded amount.");

  const rework=await web("/api/admin/finance/actions",jar,{method:"POST",body:JSON.stringify({action:"REWORK_CLAIM",resourceId:denied.id,reasonCode:"ADMIN_REVIEW_CORRECTION",idempotencyKey:`b6-rework-${now}`})});
  assert(rework.response.ok&&rework.payload.version===2&&rework.payload.previousClaimId===denied.id&&rework.payload.status==="SUBMITTED",`B6 claim rework failed: ${rework.text}`); ids.claims.push(rework.payload.claimId);
  const refreshed=await web("/api/admin/finance/actions",jar,{method:"POST",body:JSON.stringify({action:"REFRESH_CLAIM",resourceId:rework.payload.claimId})});
  assert(refreshed.response.ok&&refreshed.payload.status==="ADJUDICATED",`B6 claim refresh failed: ${refreshed.text}`);

  const capacityAfterRefund=(await web("/api/admin/finance/workspace",jar)).payload.queues.payoutCapacity.find(x=>x.provider?.id===provider.id&&x.currency==="USD");
  assert(capacityAfterRefund?.availableForPayoutMinor>0,"B6 payout capacity disappeared after partial refund.");
  const payoutAmount=Math.min(5000,capacityAfterRefund.availableForPayoutMinor);
  const payout=await web("/api/admin/finance/actions",jar,{method:"POST",body:JSON.stringify({action:"CREATE_PAYOUT",providerId:provider.id,currency:"USD",amountMinor:payoutAmount,idempotencyKey:`b6-payout-${now}`})});
  assert(payout.response.ok&&payout.payload.status==="PAID"&&payout.payload.amountMinor===payoutAmount,`B6 payout failed: ${payout.text}`); ids.payouts.push(payout.payload.payoutId);
  const payoutLedger=await prisma.providerLedgerEntry.findFirst({where:{payoutId:payout.payload.payoutId,type:"PAYOUT"}}); assert(payoutLedger?.amountMinor===-payoutAmount,"B6 paid payout did not create the expected negative provider ledger entry.");

  for(const payload of [refund.payload,rework.payload,refreshed.payload,payout.payload]){ const text=JSON.stringify(payload); for(const key of ["patientId","coverageId","externalPolicyRef","gatewayClaimRef","gatewayIntentRef","gatewayPayoutRef"]) assert(!text.includes(`\"${key}\"`),`B6 action response leaked ${key}.`); }
  const events=await prisma.auditEvent.findMany({where:{action:{in:["ADMIN_FINANCE_REFUND_PAYMENT","ADMIN_FINANCE_REWORK_CLAIM","ADMIN_FINANCE_REFRESH_CLAIM","ADMIN_FINANCE_CREATE_PAYOUT"]}},select:{action:true,objectType:true,objectId:true,metadata:true,result:true}});
  assert(events.length>=4&&events.every(x=>x.result==="SUCCESS"),"B6 admin finance audit events are incomplete.");
  const auditText=JSON.stringify(events); for(const key of ["patientId","coverageId","externalPolicyRef","gatewayClaimRef","gatewayIntentRef","gatewayPayoutRef"]) assert(!auditText.includes(`\"${key}\"`),`B6 audit metadata leaked ${key}.`);

  const page=await fetch(adminBase+"/finance",{headers:{cookie:jar.header()},redirect:"manual"}); assert(page.status===200,"B6 authenticated finance page failed.");
  console.log(JSON.stringify({status:"passed",phase:"B6",liveFinancialQueues:true,roleIsolation:true,phiNeutralFinanceWorkspace:true,sameOriginMutationGuard:true,refundInvariant:true,claimReworkVersioning:true,claimRefreshReconciliation:true,payoutLedgerSettlement:true,payoutCapacityNetOfCommitments:true,auditableFinanceOperations:true,bearerTokensHiddenFromBrowserJson:true}));
}finally{ await cleanup().catch(()=>{}); await prisma.$disconnect(); }
