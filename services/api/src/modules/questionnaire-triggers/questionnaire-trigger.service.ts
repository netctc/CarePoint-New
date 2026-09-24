import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthPrincipal } from "@carepoint/identity";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { NotificationsService } from "../communications/notifications.service";

export type QuestionnaireTriggerType = "ONBOARDING" | "PERIODIC" | "POST_INTERVENTION" | "PRE_VISIT" | "MANUAL";
type TriggerEvent = { eventType: QuestionnaireTriggerType; eventId: string; patientId: string; occurredAt: Date; appointmentId?: string; appointmentStartsAt?: Date; sourceRef?: string; };
type Evaluation = { matches: boolean; dueAt: Date | null; reason: string; };
export interface CreateQuestionnaireTriggerRuleInput { code: string; labels: unknown; }
export interface CreateQuestionnaireTriggerVersionInput { questionnaireVersionId: string; triggerType: QuestionnaireTriggerType | string; config: unknown; }
export interface SimulateQuestionnaireTriggerInput { eventType: QuestionnaireTriggerType | string; occurredAt?: string; appointmentStartsAt?: string; }
export interface ManualQuestionnaireTriggerInput { patientId: string; eventId: string; }

@Injectable()
export class QuestionnaireTriggerService {
  constructor(private readonly prisma: PrismaService, private readonly audit: DatabaseAuditService, private readonly notifications: NotificationsService) {}

  async adminList() {
    const rows = await this.prisma.questionnaireTriggerRule.findMany({ include: { versions: { orderBy: { version: "desc" } } }, orderBy: { code: "asc" } });
    return { items: rows.map((row) => ({ id: row.id, code: row.code, labels: row.labels, active: row.active, versions: row.versions.map((v) => this.presentVersion(v)) })) };
  }

  async createRule(principal: AuthPrincipal, input: CreateQuestionnaireTriggerRuleInput) {
    const code = this.code(input?.code), labels = this.labels(input?.labels);
    if (await this.prisma.questionnaireTriggerRule.findUnique({ where: { code } })) throw new ConflictException("Questionnaire trigger rule code already exists.");
    const row = await this.prisma.questionnaireTriggerRule.create({ data: { code, labels: labels as Prisma.InputJsonValue } });
    await this.audit.write({ actorId: principal.accountId, action: "QUESTIONNAIRE_TRIGGER_RULE_CREATED", objectType: "QUESTIONNAIRE_TRIGGER_RULE", objectId: row.id, purpose: "CLINICAL_CONFIGURATION", result: "SUCCESS", metadata: { code } });
    return row;
  }

  async createVersion(principal: AuthPrincipal, ruleIdRaw: string, input: CreateQuestionnaireTriggerVersionInput) {
    const ruleId = this.id(ruleIdRaw, "ruleId");
    const rule = await this.prisma.questionnaireTriggerRule.findUnique({ where: { id: ruleId } });
    if (!rule?.active) throw new NotFoundException("Active questionnaire trigger rule not found.");
    const questionnaireVersionId = this.id(input?.questionnaireVersionId, "questionnaireVersionId");
    const triggerType = this.triggerType(input?.triggerType), config = this.config(triggerType, input?.config);
    if (!await this.prisma.questionnaireVersion.findUnique({ where: { id: questionnaireVersionId }, select: { id: true } })) throw new NotFoundException("Questionnaire version not found.");
    const latest = await this.prisma.questionnaireTriggerRuleVersion.findFirst({ where: { ruleId }, orderBy: { version: "desc" }, select: { version: true } });
    const row = await this.prisma.questionnaireTriggerRuleVersion.create({ data: { ruleId, version: (latest?.version ?? 0) + 1, questionnaireVersionId, triggerType, config: config as Prisma.InputJsonValue, createdByActorId: principal.accountId } });
    await this.audit.write({ actorId: principal.accountId, action: "QUESTIONNAIRE_TRIGGER_VERSION_CREATED", objectType: "QUESTIONNAIRE_TRIGGER_VERSION", objectId: row.id, purpose: "CLINICAL_CONFIGURATION", result: "SUCCESS", metadata: { ruleId, ruleVersion: row.version, triggerType } });
    return this.presentVersion(row);
  }

  async simulate(principal: AuthPrincipal, ruleIdRaw: string, versionRaw: string, input: SimulateQuestionnaireTriggerInput) {
    const row = await this.version(ruleIdRaw, versionRaw);
    if (row.status !== "DRAFT") throw new ConflictException("Only DRAFT trigger versions can be simulated.");
    const eventType = this.triggerType(input?.eventType);
    if (eventType !== row.triggerType) throw new BadRequestException("Simulation eventType must match triggerType.");
    const occurredAt = this.instant(input?.occurredAt ?? new Date().toISOString(), "occurredAt");
    const appointmentStartsAt = input?.appointmentStartsAt ? this.instant(input.appointmentStartsAt, "appointmentStartsAt") : undefined;
    const evaluation = this.evaluate(row.triggerType as QuestionnaireTriggerType, row.config, { eventType, eventId: "SIMULATION_ONLY", patientId: "SIMULATED_PATIENT", occurredAt, ...(appointmentStartsAt ? { appointmentStartsAt } : {}) });
    const digest = this.digest({ ruleVersionId: row.id, eventType, occurredAt: occurredAt.toISOString(), appointmentStartsAt: appointmentStartsAt?.toISOString() ?? null, result: { matches: evaluation.matches, dueAt: evaluation.dueAt?.toISOString() ?? null, reason: evaluation.reason } });
    const simulatedAt = new Date();
    await this.prisma.questionnaireTriggerRuleVersion.update({ where: { id: row.id }, data: { lastSimulatedAt: simulatedAt, simulationDigest: digest } });
    await this.audit.write({ actorId: principal.accountId, action: "QUESTIONNAIRE_TRIGGER_VERSION_SIMULATED", objectType: "QUESTIONNAIRE_TRIGGER_VERSION", objectId: row.id, purpose: "CLINICAL_CONFIGURATION", result: "SUCCESS", metadata: { ruleId: row.ruleId, ruleVersion: row.version, triggerType: row.triggerType, matches: evaluation.matches, simulationDigest: digest } });
    return { simulationOnly: true, writesAssignment: false, ruleId: row.ruleId, version: row.version, triggerType: row.triggerType, ...evaluation, dueAt: evaluation.dueAt?.toISOString() ?? null, simulationDigest: digest, simulatedAt: simulatedAt.toISOString() };
  }

  async activate(principal: AuthPrincipal, ruleIdRaw: string, versionRaw: string) {
    const row = await this.version(ruleIdRaw, versionRaw);
    if (row.status === "ACTIVE") return this.presentVersion(row);
    if (row.status !== "DRAFT") throw new ConflictException("Only a DRAFT trigger version can be activated.");
    if (!row.lastSimulatedAt || !row.simulationDigest) throw new ConflictException("Simulate the trigger version before activation.");
    const qv = await this.prisma.questionnaireVersion.findUnique({ where: { id: row.questionnaireVersionId }, select: { status: true } });
    if (qv?.status !== "ACTIVE") throw new ConflictException("Trigger activation requires an ACTIVE questionnaire version.");
    const now = new Date();
    const activated = await this.prisma.$transaction(async (tx) => {
      await tx.questionnaireTriggerRuleVersion.updateMany({ where: { ruleId: row.ruleId, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: now } });
      return tx.questionnaireTriggerRuleVersion.update({ where: { id: row.id }, data: { status: "ACTIVE", activatedAt: now, retiredAt: null } });
    });
    await this.audit.write({ actorId: principal.accountId, action: "QUESTIONNAIRE_TRIGGER_VERSION_ACTIVATED", objectType: "QUESTIONNAIRE_TRIGGER_VERSION", objectId: activated.id, purpose: "CLINICAL_CONFIGURATION", result: "SUCCESS", metadata: { ruleId: activated.ruleId, ruleVersion: activated.version, triggerType: activated.triggerType, simulationDigest: activated.simulationDigest } });
    return this.presentVersion(activated);
  }

  async manualDispatch(principal: AuthPrincipal, ruleIdRaw: string, versionRaw: string, input: ManualQuestionnaireTriggerInput) {
    const row = await this.version(ruleIdRaw, versionRaw);
    if (row.status !== "ACTIVE" || row.triggerType !== "MANUAL") throw new ConflictException("Manual dispatch requires an ACTIVE MANUAL trigger version.");
    const patientId = this.id(input?.patientId, "patientId"), eventId = this.id(input?.eventId, "eventId");
    if (!await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true } })) throw new NotFoundException("Patient not found.");
    const result = await this.dispatchForRule(row, { eventType: "MANUAL", eventId, patientId, occurredAt: new Date() });
    await this.audit.write({ actorId: principal.accountId, action: "QUESTIONNAIRE_TRIGGER_MANUAL_DISPATCH", objectType: "QUESTIONNAIRE_TRIGGER_VERSION", objectId: row.id, purpose: "CLINICAL_CONFIGURATION", result: "SUCCESS", metadata: { ruleId: row.ruleId, ruleVersion: row.version, assigned: result.created } });
    return result;
  }

  async safeDispatchAppointmentConfirmed(appointmentId: string) {
    try {
      const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, patientId: true, status: true, startsAt: true } });
      if (!a || a.status !== "CONFIRMED") return;
      await this.dispatch({ eventType: "PRE_VISIT", eventId: `appointment:${a.id}`, patientId: a.patientId, occurredAt: new Date(), appointmentId: a.id, appointmentStartsAt: a.startsAt });
    } catch { await this.audit.write({ action: "QUESTIONNAIRE_TRIGGER_DISPATCH_FAILED", objectType: "APPOINTMENT", objectId: appointmentId, purpose: "SYSTEM_ORCHESTRATION", result: "FAILED", metadata: { eventType: "PRE_VISIT" } }); }
  }

  async safeDispatchProcedureRecorded(entryId: string) {
    try {
      const e = await this.prisma.clinicalProfileEntry.findUnique({ where: { id: entryId }, select: { id: true, patientId: true, kind: true, createdAt: true } });
      if (!e || e.kind !== "PROCEDURE") return;
      await this.dispatch({ eventType: "POST_INTERVENTION", eventId: `procedure:${e.id}`, patientId: e.patientId, occurredAt: e.createdAt, sourceRef: e.id });
    } catch { await this.audit.writeClinical({ action: "QUESTIONNAIRE_TRIGGER_DISPATCH_FAILED", objectType: "CLINICAL_PROFILE_ENTRY", objectId: entryId, purpose: "SYSTEM_ORCHESTRATION", result: "FAILED", metadata: { eventType: "POST_INTERVENTION", resourceId: entryId } }); }
  }

  async safeReconcilePatient(patientId: string) {
    try { await this.reconcilePatient(patientId); }
    catch { await this.audit.writeClinical({ action: "QUESTIONNAIRE_TRIGGER_RECONCILIATION_FAILED", objectType: "PATIENT", objectId: patientId, purpose: "SYSTEM_ORCHESTRATION", result: "FAILED", metadata: { patientId } }); }
  }

  async pendingForPatient(patientId: string, versionIds: string[]) {
    const result = new Map<string,{id:string;eventType:string;reason:string;dueAt:Date}>();
    if (!versionIds.length) return result;
    const rows = await this.prisma.questionnaireTriggerDispatch.findMany({ where: { patientId, questionnaireVersionId: { in: versionIds }, status: "PENDING", dueAt: { lte: new Date() } }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });
    for (const row of rows) if (!result.has(row.questionnaireVersionId)) result.set(row.questionnaireVersionId, { id: row.id, eventType: row.eventType, reason: row.reason, dueAt: row.dueAt });
    return result;
  }

  private async reconcilePatient(patientId: string) {
    const patient = await this.prisma.patientProfile.findUnique({ where: { id: patientId }, select: { id: true, createdAt: true } });
    if (!patient) return;
    const now = new Date();
    await this.dispatch({ eventType: "ONBOARDING", eventId: `patient:${patient.id}:onboarding`, patientId, occurredAt: patient.createdAt });
    const appointments = await this.prisma.appointment.findMany({ where: { patientId, status: "CONFIRMED", startsAt: { gt: now, lte: new Date(now.getTime()+30*86400000) } }, select: { id: true, startsAt: true }, take: 50 });
    for (const a of appointments) await this.dispatch({ eventType: "PRE_VISIT", eventId: `appointment:${a.id}`, patientId, occurredAt: now, appointmentId: a.id, appointmentStartsAt: a.startsAt });
    const procedures = await this.prisma.clinicalProfileEntry.findMany({ where: { patientId, kind: "PROCEDURE", createdAt: { gte: new Date(now.getTime()-30*86400000) } }, select: { id: true, createdAt: true }, take: 100 });
    for (const e of procedures) await this.dispatch({ eventType: "POST_INTERVENTION", eventId: `procedure:${e.id}`, patientId, occurredAt: e.createdAt, sourceRef: e.id });
    await this.reconcilePeriodic(patientId, patient.createdAt, now);
  }

  private async reconcilePeriodic(patientId: string, patientCreatedAt: Date, now: Date) {
    const rules = await this.prisma.questionnaireTriggerRuleVersion.findMany({ where: { status: "ACTIVE", triggerType: "PERIODIC", rule: { active: true } } });
    for (const rule of rules) {
      const qv = await this.prisma.questionnaireVersion.findUnique({ where: { id: rule.questionnaireVersionId }, select: { questionnaireId: true } });
      if (!qv) continue;
      const latest = await this.prisma.questionnaireResponse.findFirst({ where: { patientId, questionnaireId: qv.questionnaireId }, orderBy: { completedAt: "desc" }, select: { id: true, completedAt: true } });
      const base = latest?.completedAt ?? patientCreatedAt;
      const config = this.config("PERIODIC", rule.config) as { intervalDays:number };
      if (new Date(base.getTime()+config.intervalDays*86400000) > now) continue;
      await this.dispatchForRule(rule, { eventType: "PERIODIC", eventId: `periodic:${rule.id}:${latest?.id ?? "initial"}`, patientId, occurredAt: base });
    }
  }

  private async dispatch(event: TriggerEvent) {
    const rules = await this.prisma.questionnaireTriggerRuleVersion.findMany({ where: { status: "ACTIVE", triggerType: event.eventType, rule: { active: true } } });
    for (const rule of rules) await this.dispatchForRule(rule, event);
  }

  private async dispatchForRule(row: {id:string;ruleId:string;version:number;status:string;questionnaireVersionId:string;triggerType:string;config:Prisma.JsonValue}, event: TriggerEvent) {
    const e = this.evaluate(row.triggerType as QuestionnaireTriggerType, row.config, event);
    if (!e.matches || !e.dueAt) return { created:false, reason:e.reason, dispatch:null };
    try {
      const dispatch = await this.prisma.questionnaireTriggerDispatch.create({ data: { ruleVersionId: row.id, patientId: event.patientId, eventId: event.eventId, eventType: event.eventType, questionnaireVersionId: row.questionnaireVersionId, ...(event.appointmentId?{appointmentId:event.appointmentId}:{}), ...(event.sourceRef?{sourceRef:event.sourceRef}:{}), reason:e.reason, dueAt:e.dueAt } });
      const patient = await this.prisma.patientProfile.findUnique({ where:{id:event.patientId}, select:{userId:true} });
      if (patient?.userId) await this.notifications.notifyAccount({ accountId:patient.userId, dedupeKey:`questionnaire-trigger:${dispatch.id}`, type:"CARE_COORDINATION", entityType:"QUESTIONNAIRE_TRIGGER_DISPATCH", entityId:dispatch.id, safeTitleKey:"notification.questionnaire_due.title", safeBodyKey:"notification.questionnaire_due.body" });
      await this.audit.writeClinical({ action:"QUESTIONNAIRE_TRIGGER_DISPATCHED", objectType:"QUESTIONNAIRE_TRIGGER_DISPATCH", objectId:dispatch.id, purpose:"SYSTEM_ORCHESTRATION", result:"SUCCESS", metadata:{ patientId:event.patientId, resourceId:dispatch.id, ruleVersionId:row.id, eventType:event.eventType, eventId:event.eventId, questionnaireVersionId:row.questionnaireVersionId, decision:"ALLOW" } });
      return { created:true, reason:e.reason, dispatch };
    } catch(error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2002") {
        const dispatch = await this.prisma.questionnaireTriggerDispatch.findUnique({ where:{ ruleVersionId_patientId_eventId:{ ruleVersionId:row.id, patientId:event.patientId, eventId:event.eventId } } });
        return { created:false, reason:"DUPLICATE_EVENT", dispatch };
      }
      throw error;
    }
  }

  private evaluate(type:QuestionnaireTriggerType, raw:Prisma.JsonValue, event:TriggerEvent):Evaluation {
    const c=this.config(type,raw), H=3600000, D=86400000;
    if(type==="ONBOARDING") return {matches:true,dueAt:new Date(event.occurredAt.getTime()+(c as any).delayHours*H),reason:"ONBOARDING"};
    if(type==="PERIODIC") return {matches:true,dueAt:new Date(event.occurredAt.getTime()+(c as any).intervalDays*D),reason:"PERIODIC"};
    if(type==="POST_INTERVENTION") return {matches:true,dueAt:new Date(event.occurredAt.getTime()+(c as any).delayHours*H),reason:"POST_INTERVENTION"};
    if(type==="MANUAL") return {matches:true,dueAt:new Date(event.occurredAt.getTime()+(c as any).dueDays*D),reason:"MANUAL"};
    if(!event.appointmentStartsAt || event.appointmentStartsAt<=event.occurredAt) return {matches:false,dueAt:null,reason:"NO_FUTURE_APPOINTMENT"};
    const v=c as {leadHours:number;dueBeforeMinutes:number}, lead=new Date(event.appointmentStartsAt.getTime()-v.leadHours*H);
    if(event.occurredAt<lead) return {matches:false,dueAt:null,reason:"OUTSIDE_LEAD_WINDOW"};
    const scheduled=new Date(event.appointmentStartsAt.getTime()-v.dueBeforeMinutes*60000);
    return {matches:true,dueAt:scheduled<event.occurredAt?event.occurredAt:scheduled,reason:"PRE_VISIT"};
  }

  private config(type:QuestionnaireTriggerType, raw:unknown):Record<string,number> {
    if(!raw || typeof raw!=="object" || Array.isArray(raw)) throw new BadRequestException("trigger config must be an object.");
    const v=raw as Record<string,unknown>, exact=(keys:string[])=>{const x=Object.keys(v).filter(k=>!keys.includes(k));if(x.length)throw new BadRequestException(`Unsupported trigger config field '${x[0]}'.`);};
    if(type==="ONBOARDING"||type==="POST_INTERVENTION"){exact(["delayHours"]);return {delayHours:this.int(v.delayHours??0,"delayHours",0,720)};}
    if(type==="PERIODIC"){exact(["intervalDays"]);return {intervalDays:this.int(v.intervalDays,"intervalDays",1,3650)};}
    if(type==="PRE_VISIT"){exact(["leadHours","dueBeforeMinutes"]);return {leadHours:this.int(v.leadHours,"leadHours",1,720),dueBeforeMinutes:this.int(v.dueBeforeMinutes??30,"dueBeforeMinutes",0,1440)};}
    exact(["dueDays"]);return {dueDays:this.int(v.dueDays??7,"dueDays",1,30)};
  }
  private async version(ruleIdRaw:string,versionRaw:string){const ruleId=this.id(ruleIdRaw,"ruleId"),version=this.int(versionRaw,"version",1,1000000);const row=await this.prisma.questionnaireTriggerRuleVersion.findUnique({where:{ruleId_version:{ruleId,version}}});if(!row)throw new NotFoundException("Questionnaire trigger version not found.");return row;}
  private triggerType(value:unknown):QuestionnaireTriggerType{const x=String(value??"").trim().toUpperCase();if(!["ONBOARDING","PERIODIC","POST_INTERVENTION","PRE_VISIT","MANUAL"].includes(x))throw new BadRequestException("triggerType is invalid.");return x as QuestionnaireTriggerType;}
  private labels(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value))throw new BadRequestException("labels must be an object.");const s=value as Record<string,unknown>,o:Record<string,string>={};for(const l of ["en","ar","fr","es"]){const t=typeof s[l]==="string"?s[l].trim():"";if(!t||t.length>160||/\p{Cc}/u.test(t))throw new BadRequestException(`labels.${l} is required and must be <= 160 characters.`);o[l]=t;}return o;}
  private code(value:unknown){if(typeof value!=="string")throw new BadRequestException("code is required.");const x=value.trim().toUpperCase();if(!/^[A-Z][A-Z0-9_:-]{2,79}$/.test(x))throw new BadRequestException("code is invalid.");return x;}
  private id(value:unknown,field:string){if(typeof value!=="string")throw new BadRequestException(`${field} is required.`);const x=value.trim();if(!/^[A-Za-z0-9_.:-]{1,180}$/.test(x))throw new BadRequestException(`${field} is invalid.`);return x;}
  private int(value:unknown,field:string,min:number,max:number){const n=typeof value==="string"&&value.trim()!==""?Number(value):value;if(!Number.isInteger(n)||Number(n)<min||Number(n)>max)throw new BadRequestException(`${field} must be an integer between ${min} and ${max}.`);return Number(n);}
  private instant(value:unknown,field:string){if(typeof value!=="string")throw new BadRequestException(`${field} must be an ISO date-time.`);const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new BadRequestException(`${field} must be a valid ISO date-time.`);return d;}
  private digest(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
  private presentVersion(row:any){return {id:row.id,ruleId:row.ruleId,version:row.version,status:row.status,questionnaireVersionId:row.questionnaireVersionId,triggerType:row.triggerType,config:row.config,lastSimulatedAt:row.lastSimulatedAt,simulationDigest:row.simulationDigest,activatedAt:row.activatedAt,retiredAt:row.retiredAt,createdAt:row.createdAt,immutable:row.status!=="DRAFT"};}
}
