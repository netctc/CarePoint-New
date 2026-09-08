import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apiBase = process.env.CAREPOINT_API_URL || "http://127.0.0.1:4000/api/v1";
const adminBase = process.env.CAREPOINT_ADMIN_URL || "http://localhost:3000";
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin-ci@carepoint.test";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "CarePoint-CI-Admin#2026";
const targetEmail = "b7-security-patient-ci@carepoint.test";
const targetPassword = "CarePoint-B7-Patient#2026";
const rawUserAgent = "B7-SecretAgent/9.9 Chrome/140.0.0.0 Windows NT 10.0";

class Jar {
  constructor(){ this.values=new Map(); }
  capture(response){ const raw=response.headers.get("set-cookie")||""; for(const part of raw.split(/,(?=\s*[^;,]+=)/g)){ const first=part.split(";",1)[0]||""; const at=first.indexOf("="); if(at>0){ const key=first.slice(0,at).trim(); const value=first.slice(at+1).trim(); if(value) this.values.set(key,value); else this.values.delete(key); } } }
  header(){ return [...this.values].map(([key,value])=>`${key}=${value}`).join("; "); }
}

function assert(ok,message){ if(!ok) throw new Error(message); }
async function api(path,init={}){ const response=await fetch(apiBase+path,{...init,headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}}); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }
async function web(path,jar,init={}){ const headers={accept:"application/json",cookie:jar.header(),...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}; if(init.method&&init.method!=="GET"&&!headers.origin) headers.origin=adminBase; const response=await fetch(adminBase+path,{...init,headers,redirect:"manual"}); jar.capture(response); const text=await response.text(); let payload={}; try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};} return {response,payload,text}; }

async function cleanup(){
  const user=await prisma.user.findUnique({where:{email:targetEmail},select:{id:true}}).catch(()=>null);
  if(!user) return;
  const sessions=await prisma.authSession.findMany({where:{userId:user.id},select:{id:true}}).catch(()=>[]);
  const sessionIds=sessions.map(x=>x.id);
  await prisma.auditEvent.deleteMany({where:{OR:[{actorId:user.id},{objectId:user.id},...(sessionIds.length?[{objectId:{in:sessionIds}}]:[])]}}).catch(()=>{});
  await prisma.user.delete({where:{id:user.id}}).catch(()=>{});
}

try{
  await cleanup();
  const registration=await api("/iam/register/patient",{method:"POST",body:JSON.stringify({email:targetEmail,password:targetPassword,firstName:"B7",lastName:"Security"})});
  assert(registration.response.status===201||registration.response.status===200,`B7 patient registration failed: ${registration.text}`);

  const login1=await api("/iam/login",{method:"POST",headers:{"user-agent":rawUserAgent},body:JSON.stringify({email:targetEmail,password:targetPassword})});
  const login2=await api("/iam/login",{method:"POST",headers:{"user-agent":"Mozilla/5.0 (iPhone) AppleWebKit Safari/605.1"},body:JSON.stringify({email:targetEmail,password:targetPassword})});
  assert(login1.response.ok&&login1.payload.accessToken&&login1.payload.refreshToken&&login1.payload.sessionId,"B7 first target login failed.");
  assert(login2.response.ok&&login2.payload.accessToken&&login2.payload.sessionId,"B7 second target login failed.");

  const rotated=await api("/iam/sessions/refresh",{method:"POST",headers:{"user-agent":rawUserAgent},body:JSON.stringify({refreshToken:login1.payload.refreshToken})});
  assert(rotated.response.ok&&rotated.payload.sessionId&&rotated.payload.sessionId!==login1.payload.sessionId,"B7 refresh rotation did not issue a replacement session.");
  const replay=await api("/iam/sessions/refresh",{method:"POST",body:JSON.stringify({refreshToken:login1.payload.refreshToken})});
  assert(replay.response.status===401,`B7 replayed refresh token should be denied with 401, got ${replay.response.status}.`);

  for(let attempt=0;attempt<5;attempt+=1){
    const failed=await api("/iam/login",{method:"POST",body:JSON.stringify({email:targetEmail,password:`wrong-${attempt}`})});
    assert(failed.response.status===401,`B7 failed-login fixture ${attempt+1} should return 401, got ${failed.response.status}.`);
  }
  const targetUser=await prisma.user.findUnique({where:{email:targetEmail},select:{id:true,lockedUntil:true}});
  assert(targetUser?.lockedUntil&&targetUser.lockedUntil.getTime()>Date.now(),"B7 failed-login sequence did not lock the target account.");

  const patientDenied=await api("/admin/security/workspace",{headers:{authorization:`Bearer ${login2.payload.accessToken}`}});
  assert(patientDenied.response.status===403,`PATIENT security workspace should be 403, got ${patientDenied.response.status}.`);

  const jar=new Jar();
  const adminLogin=await web("/api/admin/auth/login",jar,{method:"POST",body:JSON.stringify({email:adminEmail,password:adminPassword})});
  assert(adminLogin.response.status===200&&adminLogin.payload.authenticated===true,"B7 admin login failed.");
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(JSON.stringify(adminLogin.payload)),"B7 admin login leaked bearer material.");

  const snapshot=await web("/api/admin/security/workspace",jar);
  assert(snapshot.response.status===200,`B7 security workspace failed: ${snapshot.text}`);
  assert(snapshot.payload.privacy?.phiNeutral===true&&snapshot.payload.privacy?.accountIdentityPseudonymized===true,"B7 workspace privacy posture is not PHI-neutral/pseudonymized.");
  assert(snapshot.payload.summary?.replayEvents24h>=1&&snapshot.payload.summary?.deniedEvents24h>=6,"B7 security summary did not surface replay/denied signals.");

  const targetSession=snapshot.payload.queues?.sessions?.find(x=>x.sessionId===login2.payload.sessionId);
  const rotatedSession=snapshot.payload.queues?.sessions?.find(x=>x.sessionId===rotated.payload.sessionId);
  assert(targetSession&&rotatedSession,"B7 active target sessions are missing from the response queue.");
  assert(targetSession.risk==="CRITICAL"&&targetSession.riskFlags.includes("TOKEN_REPLAY_SIGNAL")&&targetSession.riskFlags.includes("ACCOUNT_LOCKED"),"B7 risk prioritization did not escalate the compromised account sessions.");
  assert(targetSession.maskedIp&&targetSession.maskedIp!=="127.0.0.1","B7 session IP was not masked.");
  assert(rotatedSession.client?.browser==="Chrome"&&rotatedSession.client?.platform==="Windows","B7 user-agent summary did not normalize the test client.");
  assert(snapshot.payload.queues?.lockedAccounts?.some(x=>x.accountRef===targetSession.accountRef),"B7 locked-account queue did not include the compromised account.");
  assert(snapshot.payload.queues?.securityEvents?.some(x=>x.action==="REFRESH_TOKEN_REPLAY_DENIED"&&["HIGH","CRITICAL"].includes(x.severity)),"B7 audit stream did not surface refresh-token replay.");
  assert(snapshot.payload.queues?.securityEvents?.some(x=>x.action==="LOGIN_FAILED"),"B7 audit stream did not surface failed logins.");

  const snapshotText=JSON.stringify(snapshot.payload);
  for(const forbidden of ["userId","email","passwordHash","accessTokenHash","refreshTokenHash","userAgent","ipAddress","patientId","firstName","lastName","requiredPermissions","smartClientId"]){
    assert(!snapshotText.includes(`\"${forbidden}\"`),`B7 workspace leaked forbidden field ${forbidden}.`);
  }
  assert(!snapshotText.includes(targetEmail),"B7 workspace leaked target email.");
  assert(!snapshotText.includes(targetUser.id),"B7 workspace leaked raw target account ID.");
  assert(!snapshotText.includes(rawUserAgent),"B7 workspace leaked raw user-agent fingerprint.");
  assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(snapshotText),"B7 workspace leaked bearer material.");

  const forged=await web("/api/admin/security/actions",jar,{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({action:"REVOKE_SESSION",sessionId:login2.payload.sessionId})});
  assert(forged.response.status===403,`B7 forged session revocation should be 403, got ${forged.response.status}.`);
  assert((await prisma.authSession.findUnique({where:{id:login2.payload.sessionId},select:{revokedAt:true}}))?.revokedAt===null,"B7 forged request revoked a target session.");

  const current=snapshot.payload.queues.sessions.find(x=>x.current===true);
  assert(current,"B7 workspace did not identify the current Admin session.");
  const currentAttempt=await web("/api/admin/security/actions",jar,{method:"POST",body:JSON.stringify({action:"REVOKE_SESSION",sessionId:current.sessionId})});
  assert(currentAttempt.response.status===400,`B7 current Admin session remote revocation should be 400, got ${currentAttempt.response.status}.`);
  assert((await prisma.authSession.findUnique({where:{id:current.sessionId},select:{revokedAt:true}}))?.revokedAt===null,"B7 current Admin session was revoked through the remote action.");

  const revokeOne=await web("/api/admin/security/actions",jar,{method:"POST",body:JSON.stringify({action:"REVOKE_SESSION",sessionId:login2.payload.sessionId})});
  assert(revokeOne.response.ok&&revokeOne.payload.revoked===true&&revokeOne.payload.sessionId===login2.payload.sessionId,`B7 single-session revocation failed: ${revokeOne.text}`);
  assert((await prisma.authSession.findUnique({where:{id:login2.payload.sessionId},select:{revokedAt:true}}))?.revokedAt,"B7 single-session revocation did not persist.");

  const revokeAll=await web("/api/admin/security/actions",jar,{method:"POST",body:JSON.stringify({action:"REVOKE_ACCOUNT_SESSIONS",sessionId:rotated.payload.sessionId})});
  assert(revokeAll.response.ok&&revokeAll.payload.revoked===true&&revokeAll.payload.revokedSessions>=1,`B7 account-session revocation failed: ${revokeAll.text}`);
  const remaining=await prisma.authSession.count({where:{userId:targetUser.id,revokedAt:null}});
  assert(remaining===0,`B7 revoke-all left ${remaining} target sessions active/unrevoked.`);

  for(const result of [revokeOne.payload,revokeAll.payload]){
    const text=JSON.stringify(result);
    assert(!text.includes(targetEmail)&&!text.includes(targetUser.id),"B7 action response leaked target identity.");
    assert(!/accessToken|refreshToken|access_token|refresh_token/i.test(text),"B7 action response leaked bearer material.");
  }

  const admin=await prisma.user.findUnique({where:{email:adminEmail},select:{id:true}});
  assert(admin,"B7 admin fixture missing.");
  const auditEvents=await prisma.auditEvent.findMany({where:{actorId:admin.id,OR:[{action:"SESSION_REVOKED",objectId:login2.payload.sessionId},{action:"ALL_SESSIONS_REVOKED",objectId:targetUser.id}]},select:{action:true,objectType:true,objectId:true,result:true}});
  assert(auditEvents.some(x=>x.action==="SESSION_REVOKED"&&x.result==="SUCCESS")&&auditEvents.some(x=>x.action==="ALL_SESSIONS_REVOKED"&&x.result==="SUCCESS"),"B7 security interventions were not fully audited.");

  const after=await web("/api/admin/security/workspace",jar);
  assert(after.response.ok&&!after.payload.queues.sessions.some(x=>x.sessionId===login2.payload.sessionId||x.sessionId===rotated.payload.sessionId),"B7 revoked sessions remain in the active response queue.");
  const page=await fetch(adminBase+"/security",{headers:{cookie:jar.header()},redirect:"manual"});
  assert(page.status===200,"B7 authenticated security page failed.");

  console.log(JSON.stringify({status:"passed",phase:"B7",liveSecurityPosture:true,roleIsolation:true,phiNeutralIdentityPseudonymization:true,maskedNetworkContext:true,securityRiskPrioritization:true,replayDetection:true,sameOriginMutationGuard:true,currentAdminSessionProtected:true,singleSessionRevocation:true,accountSessionRevocation:true,auditableSecurityResponse:true,bearerTokensHiddenFromBrowserJson:true}));
}finally{
  await cleanup().catch(()=>{});
  await prisma.$disconnect();
}
