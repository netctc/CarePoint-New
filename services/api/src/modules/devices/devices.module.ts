import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Headers,
  Injectable, Module, NotFoundException, Param, Post, Query,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, createPublicKey, verify } from "node:crypto";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, Public, RequirePermissions } from "../../security/api-security.module";
import { ObservationModule } from "../observation/observation.module";
import { ObservationService } from "../observation/observation.service";
import { ProvidersModule } from "../providers/providers.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";

const SIGNATURE_SKEW_MS=5*60*1000;
const MAX_OBSERVATION_AGE_MS=30*24*60*60*1000;

type DeviceMeasurement={deviceId:string;externalEventId:string;sentAt:string;code:string;value:number;unitCode:string;observedAt:string;glucoseContext?:string|null};
type ProviderDeviceMeasurement={deviceId:string;patientId:string;encounterId:string;externalEventId:string;code:string;value:number;unitCode:string;observedAt:string;glucoseContext?:string|null};

@Injectable()
class DeviceRegistryService {
  constructor(
    private readonly prisma:PrismaService,
    private readonly audit:DatabaseAuditService,
    private readonly observations:ObservationService,
    private readonly capabilities:ProviderCategoryCapabilityService,
  ) {}

  async adminCatalog(){
    const [models,devices]=await Promise.all([
      this.prisma.deviceModel.findMany({orderBy:[{active:"desc"},{manufacturer:"asc"},{modelName:"asc"}]}),
      this.prisma.device.findMany({
        include:{model:true,credentials:{orderBy:{createdAt:"desc"}},ingestions:{orderBy:{receivedAt:"desc"},take:5}},
        orderBy:{createdAt:"desc"},take:500,
      }),
    ]);
    return {
      models:models.map(m=>({...m,supportedMetricCodes:this.jsonStrings(m.supportedMetricCodes)})),
      devices:devices.map(d=>({
        id:d.id,deviceModelId:d.deviceModelId,serialNumber:d.serialNumber,status:d.status,patientId:d.patientId,providerId:d.providerId,
        lastSeenAt:d.lastSeenAt,revokedAt:d.revokedAt,createdAt:d.createdAt,
        model:{id:d.model.id,code:d.model.code,manufacturer:d.model.manufacturer,modelName:d.model.modelName,deviceType:d.model.deviceType,supportedMetricCodes:this.jsonStrings(d.model.supportedMetricCodes)},
        credentials:d.credentials.map(c=>({id:c.id,keyId:c.keyId,status:c.status,activatedAt:c.activatedAt,revokedAt:c.revokedAt,publicKeyConfigured:true})),
        recentIngestions:d.ingestions.map(e=>({id:e.id,externalEventId:e.externalEventId,channel:e.channel,status:e.status,observationId:e.observationId,receivedAt:e.receivedAt,completedAt:e.completedAt})),
      })),
      secretsExposed:false,privateKeysStored:false,
    };
  }

  async createModel(principal:AuthPrincipal,raw:Record<string,unknown>){
    const code=this.token(raw.code,"code",80),manufacturer=this.text(raw.manufacturer,"manufacturer",120),modelName=this.text(raw.modelName,"modelName",120),deviceType=this.token(raw.deviceType,"deviceType",80);
    const supportedMetricCodes=this.codeList(raw.supportedMetricCodes,"supportedMetricCodes",30);
    if(!supportedMetricCodes.length) throw new BadRequestException("supportedMetricCodes must not be empty.");
    const count=await this.prisma.observationType.count({where:{code:{in:supportedMetricCodes},active:true}});
    if(count!==supportedMetricCodes.length) throw new BadRequestException("Every supported metric must reference an active ObservationType.");
    const created=await this.prisma.deviceModel.create({data:{code,manufacturer,modelName,deviceType,supportedMetricCodes:supportedMetricCodes as unknown as Prisma.InputJsonValue}});
    await this.audit.write({actorId:principal.accountId,action:"DEVICE_MODEL_CREATED",objectType:"DEVICE_MODEL",objectId:created.id,purpose:"CLINICAL_CONFIGURATION",result:"SUCCESS",metadata:{code,deviceType,supportedMetricCount:supportedMetricCodes.length}});
    return {...created,supportedMetricCodes};
  }

  async createDevice(principal:AuthPrincipal,raw:Record<string,unknown>){
    const deviceModelId=this.id(raw.deviceModelId,"deviceModelId"),serialNumber=this.serial(raw.serialNumber),patientId=this.optionalId(raw.patientId,"patientId"),providerId=this.optionalId(raw.providerId,"providerId");
    if((patientId==null)===(providerId==null)) throw new BadRequestException("Exactly one patientId or providerId assignment is required.");
    const model=await this.prisma.deviceModel.findUnique({where:{id:deviceModelId}});
    if(!model?.active) throw new BadRequestException("Device model must exist and be active.");
    if(patientId && !(await this.prisma.patientProfile.findUnique({where:{id:patientId},select:{id:true}}))) throw new BadRequestException("Assigned patient does not exist.");
    if(providerId){
      const p=await this.prisma.provider.findUnique({where:{id:providerId},select:{id:true,status:true}});
      if(!p||p.status!=="ACTIVE") throw new BadRequestException("Assigned provider must exist and be active.");
    }
    const created=await this.prisma.device.create({data:{deviceModelId,serialNumber,patientId,providerId,status:"ACTIVE"}});
    await this.audit.write({actorId:principal.accountId,action:"DEVICE_REGISTERED",objectType:"DEVICE",objectId:created.id,purpose:"CLINICAL_CONFIGURATION",result:"SUCCESS",metadata:{deviceModelId,assignmentType:patientId?"PATIENT":"PROVIDER",assignedResourceId:patientId??providerId}});
    return created;
  }

  async addCredential(principal:AuthPrincipal,deviceIdRaw:string,raw:Record<string,unknown>){
    const deviceId=this.id(deviceIdRaw,"deviceId"),keyId=this.token(raw.keyId,"keyId",80),publicKeyPem=this.publicKey(raw.publicKeyPem);
    const device=await this.prisma.device.findUnique({where:{id:deviceId}});
    if(!device||device.status!=="ACTIVE") throw new NotFoundException("Active device not found.");
    const c=await this.prisma.deviceCredential.create({data:{deviceId,keyId,publicKeyPem,status:"ACTIVE"}});
    await this.audit.write({actorId:principal.accountId,action:"DEVICE_CREDENTIAL_REGISTERED",objectType:"DEVICE_CREDENTIAL",objectId:c.id,purpose:"CLINICAL_CONFIGURATION",result:"SUCCESS",metadata:{deviceId,keyId,algorithm:"ED25519",privateKeyStored:false}});
    return {id:c.id,deviceId,keyId,status:c.status,activatedAt:c.activatedAt,publicKeyConfigured:true,privateKeyStored:false};
  }

  async revokeDevice(principal:AuthPrincipal,deviceIdRaw:string){
    const deviceId=this.id(deviceIdRaw,"deviceId"),device=await this.prisma.device.findUnique({where:{id:deviceId}});
    if(!device) throw new NotFoundException("Device not found.");
    if(device.status==="REVOKED") return device;
    const now=new Date();
    const updated=await this.prisma.$transaction(async tx=>{
      await tx.deviceCredential.updateMany({where:{deviceId,status:"ACTIVE"},data:{status:"REVOKED",revokedAt:now}});
      return tx.device.update({where:{id:deviceId},data:{status:"REVOKED",revokedAt:now}});
    });
    await this.audit.write({actorId:principal.accountId,action:"DEVICE_REVOKED",objectType:"DEVICE",objectId:deviceId,purpose:"CLINICAL_CONFIGURATION",result:"SUCCESS",metadata:{historicalObservationsPreserved:true}});
    return updated;
  }

  async providerDevices(principal:AuthPrincipal,patientIdRaw:string,encounterIdRaw:string){
    const context=await this.capabilities.assertWorkflowCapability(principal,"DEVICE_CAPTURE");
    const patientId=this.id(patientIdRaw,"patientId"),encounterId=this.id(encounterIdRaw,"encounterId");
    await this.requireEncounter(context.providerId,patientId,encounterId);
    const rows=await this.prisma.device.findMany({where:{status:"ACTIVE",model:{active:true},OR:[{patientId},{providerId:context.providerId}]},include:{model:true},orderBy:{serialNumber:"asc"},take:100});
    return {patientId,encounterId,items:rows.flatMap(d=>{
      const supported=this.jsonStrings(d.model.supportedMetricCodes).filter(code=>context.observationCodes.has(code));
      return supported.length?[{id:d.id,serialNumber:d.serialNumber,assignmentType:d.patientId?"PATIENT":"PROVIDER",model:{code:d.model.code,manufacturer:d.model.manufacturer,modelName:d.model.modelName,deviceType:d.model.deviceType},supportedMetricCodes:supported}]:[];
    }),capability:"DEVICE_CAPTURE"};
  }

  async providerCapture(principal:AuthPrincipal,raw:ProviderDeviceMeasurement){
    const context=await this.capabilities.assertWorkflowCapability(principal,"DEVICE_CAPTURE");
    const patientId=this.id(raw?.patientId,"patientId"),encounterId=this.id(raw?.encounterId,"encounterId"),deviceId=this.id(raw?.deviceId,"deviceId"),externalEventId=this.eventId(raw?.externalEventId),code=this.token(raw?.code,"code",80);
    if(!context.observationCodes.has(code)) throw new ForbiddenException(`Other Provider category is not authorized for observation ${code}.`);
    await this.requireEncounter(context.providerId,patientId,encounterId);
    const device=await this.prisma.device.findUnique({where:{id:deviceId},include:{model:true}});
    if(!device||device.status!=="ACTIVE"||!device.model.active) throw new NotFoundException("Active device not found.");
    if(device.patientId!==patientId&&device.providerId!==context.providerId) throw new ForbiddenException("Device is not assigned to this patient or provider.");
    if(!this.jsonStrings(device.model.supportedMetricCodes).includes(code)) throw new BadRequestException("Device model does not support this observation code.");
    const m=this.measurement({deviceId,externalEventId,sentAt:new Date().toISOString(),code,value:raw?.value,unitCode:raw?.unitCode,observedAt:raw?.observedAt,glucoseContext:raw?.glucoseContext});
    const payloadHash=this.hash(m),existing=await this.replay(deviceId,externalEventId,payloadHash);
    if(existing) return existing;
    const event=await this.prisma.deviceIngestionEvent.create({data:{deviceId,externalEventId,channel:"PROVIDER_ASSISTED",providerId:context.providerId,payloadHash,status:"PENDING"}});
    try{
      const observation=await this.observations.recordTrustedDevice(patientId,{code:m.code,value:m.value,unitCode:m.unitCode,observedAt:m.observedAt,deviceId,actorId:principal.accountId,captureChannel:"PROVIDER_ASSISTED",accessBasis:"TREATMENT",glucoseContext:m.glucoseContext});
      await this.accept(event.id,deviceId,observation.id);
      return {ingestionEventId:event.id,status:"ACCEPTED",observation,idempotent:false};
    }catch(error){await this.prisma.deviceIngestionEvent.delete({where:{id:event.id}}).catch(()=>undefined);throw error;}
  }

  async machineIngest(signatureRaw:string|undefined,raw:DeviceMeasurement){
    const m=this.measurement(raw);
    const device=await this.prisma.device.findUnique({where:{id:m.deviceId},include:{model:true,credentials:{where:{status:"ACTIVE"},orderBy:{activatedAt:"desc"}}}});
    if(!device||device.status!=="ACTIVE"||!device.model.active) throw new ForbiddenException("Device is not active.");
    if(!device.patientId||device.providerId) throw new ForbiddenException("Direct device ingestion requires an active patient assignment.");
    if(!this.jsonStrings(device.model.supportedMetricCodes).includes(m.code)) throw new BadRequestException("Device model does not support this observation code.");
    const canonical=this.canonical(m),signature=this.signature(signatureRaw);
    const credential=device.credentials.find(c=>verify(null,Buffer.from(canonical,"utf8"),createPublicKey(c.publicKeyPem),signature));
    if(!credential) throw new ForbiddenException("Device signature is invalid.");
    const payloadHash=createHash("sha256").update(canonical).digest("hex"),existing=await this.replay(device.id,m.externalEventId,payloadHash);
    if(existing) return existing;
    const event=await this.prisma.deviceIngestionEvent.create({data:{deviceId:device.id,externalEventId:m.externalEventId,channel:"SIGNED_DEVICE",credentialId:credential.id,payloadHash,status:"PENDING"}});
    try{
      const observation=await this.observations.recordTrustedDevice(device.patientId,{code:m.code,value:m.value,unitCode:m.unitCode,observedAt:m.observedAt,deviceId:device.id,actorId:`device:${device.id}`,captureChannel:"SIGNED_DEVICE",accessBasis:"DEVICE_ASSIGNMENT",glucoseContext:m.glucoseContext});
      await this.accept(event.id,device.id,observation.id);
      return {ingestionEventId:event.id,status:"ACCEPTED",observationId:observation.id,idempotent:false};
    }catch(error){await this.prisma.deviceIngestionEvent.delete({where:{id:event.id}}).catch(()=>undefined);throw error;}
  }

  private async replay(deviceId:string,externalEventId:string,payloadHash:string){
    const e=await this.prisma.deviceIngestionEvent.findUnique({where:{deviceId_externalEventId:{deviceId,externalEventId}}});
    if(!e) return null;
    if(e.payloadHash!==payloadHash) throw new ConflictException("externalEventId was already used with a different payload.");
    if(e.status!=="ACCEPTED"||!e.observationId) throw new ConflictException("The same device event is currently being processed.");
    return {ingestionEventId:e.id,status:e.status,observationId:e.observationId,idempotent:true};
  }

  private async accept(eventId:string,deviceId:string,observationId:string){
    const now=new Date();
    await this.prisma.$transaction([
      this.prisma.deviceIngestionEvent.update({where:{id:eventId},data:{status:"ACCEPTED",observationId,completedAt:now}}),
      this.prisma.device.update({where:{id:deviceId},data:{lastSeenAt:now}}),
    ]);
  }

  private async requireEncounter(providerId:string,patientId:string,encounterId:string){
    const row=await this.prisma.appointment.findFirst({where:{id:encounterId,providerId,patientId,status:{in:["CONFIRMED","COMPLETED"]}},select:{id:true}});
    if(!row) throw new ForbiddenException("Device capture requires this provider's confirmed/completed patient visit.");
  }

  private measurement(raw:DeviceMeasurement):DeviceMeasurement{
    const deviceId=this.id(raw?.deviceId,"deviceId"),externalEventId=this.eventId(raw?.externalEventId),sentAt=this.iso(raw?.sentAt,"sentAt"),observedAt=this.iso(raw?.observedAt,"observedAt"),now=Date.now();
    if(Math.abs(new Date(sentAt).getTime()-now)>SIGNATURE_SKEW_MS) throw new BadRequestException("sentAt is outside the accepted signature window.");
    const observedMs=new Date(observedAt).getTime();
    if(observedMs>now+SIGNATURE_SKEW_MS||observedMs<now-MAX_OBSERVATION_AGE_MS) throw new BadRequestException("observedAt is outside the accepted device observation window.");
    if(typeof raw?.value!=="number"||!Number.isFinite(raw.value)) throw new BadRequestException("value must be finite.");
    const code=this.token(raw?.code,"code",80),unitCode=this.token(raw?.unitCode,"unitCode",40),glucoseContext=raw?.glucoseContext==null||raw.glucoseContext===""?null:this.token(raw.glucoseContext,"glucoseContext",40);
    return {deviceId,externalEventId,sentAt,code,value:raw.value,unitCode,observedAt,glucoseContext};
  }
  private canonical(v:DeviceMeasurement){return JSON.stringify([v.deviceId,v.externalEventId,v.sentAt,v.code,v.value,v.unitCode,v.observedAt,v.glucoseContext??null]);}
  private hash(v:DeviceMeasurement){return createHash("sha256").update(this.canonical(v)).digest("hex");}
  private signature(raw:string|undefined){if(typeof raw!=="string")throw new BadRequestException("x-device-signature is required.");const b=Buffer.from(raw.trim(),"base64");if(b.length!==64)throw new BadRequestException("x-device-signature must be a base64 Ed25519 signature.");return b;}
  private publicKey(raw:unknown){if(typeof raw!=="string"||raw.length>4096)throw new BadRequestException("publicKeyPem is invalid.");const v=raw.trim();try{const k=createPublicKey(v);if(k.type!=="public"||k.asymmetricKeyType!=="ed25519")throw new Error();}catch{throw new BadRequestException("publicKeyPem must contain an Ed25519 public key.");}return v;}
  private codeList(raw:unknown,field:string,max:number){if(!Array.isArray(raw)||raw.length>max)throw new BadRequestException(`${field} is invalid.`);const v=raw.map(x=>this.token(x,field,80));if(new Set(v).size!==v.length)throw new BadRequestException(`${field} cannot contain duplicates.`);return v;}
  private jsonStrings(raw:unknown):string[]{return Array.isArray(raw)?raw.filter((x):x is string=>typeof x==="string"):[];}
  private id(raw:unknown,field:string){if(typeof raw!=="string")throw new BadRequestException(`${field} is required.`);const v=raw.trim();if(!/^[A-Za-z0-9_.:-]{1,180}$/.test(v))throw new BadRequestException(`${field} is invalid.`);return v;}
  private optionalId(raw:unknown,field:string){return raw==null||raw===""?null:this.id(raw,field);}
  private eventId(raw:unknown){return this.id(raw,"externalEventId");}
  private serial(raw:unknown){if(typeof raw!=="string")throw new BadRequestException("serialNumber is required.");const v=raw.trim().toUpperCase();if(!/^[A-Z0-9][A-Z0-9_.:-]{2,119}$/.test(v))throw new BadRequestException("serialNumber is invalid.");return v;}
  private token(raw:unknown,field:string,max:number){if(typeof raw!=="string")throw new BadRequestException(`${field} is required.`);const v=raw.trim().toUpperCase();if(!v||v.length>max||!/^[A-Z][A-Z0-9_.:-]*$/.test(v))throw new BadRequestException(`${field} is invalid.`);return v;}
  private text(raw:unknown,field:string,max:number){if(typeof raw!=="string")throw new BadRequestException(`${field} is required.`);const v=raw.trim();if(!v||v.length>max||/\p{Cc}/u.test(v))throw new BadRequestException(`${field} is invalid.`);return v;}
  private iso(raw:unknown,field:string){if(typeof raw!=="string")throw new BadRequestException(`${field} is required.`);const d=new Date(raw);if(!Number.isFinite(d.getTime()))throw new BadRequestException(`${field} must be an ISO date-time.`);return d.toISOString();}
}

@Controller("admin/devices")
class AdminDevicesController {
  constructor(private readonly devices:DeviceRegistryService){}
  @RequirePermissions("CATALOG_MANAGE") @Get() @Header("Cache-Control","no-store") list(){return this.devices.adminCatalog();}
  @RequirePermissions("CATALOG_MANAGE") @Post("models") createModel(@CurrentPrincipal() p:AuthPrincipal,@Body() b:Record<string,unknown>){return this.devices.createModel(p,b);}
  @RequirePermissions("CATALOG_MANAGE") @Post() createDevice(@CurrentPrincipal() p:AuthPrincipal,@Body() b:Record<string,unknown>){return this.devices.createDevice(p,b);}
  @RequirePermissions("CATALOG_MANAGE") @Post(":deviceId/credentials") credential(@CurrentPrincipal() p:AuthPrincipal,@Param("deviceId") id:string,@Body() b:Record<string,unknown>){return this.devices.addCredential(p,id,b);}
  @RequirePermissions("CATALOG_MANAGE") @Post(":deviceId/revoke") revoke(@CurrentPrincipal() p:AuthPrincipal,@Param("deviceId") id:string){return this.devices.revokeDevice(p,id);}
}
@Controller("provider/devices")
class ProviderDevicesController {
  constructor(private readonly devices:DeviceRegistryService){}
  @RequirePermissions("CLINICAL_RECORD_WRITE") @Get() @Header("Cache-Control","no-store")
  list(@CurrentPrincipal() p:AuthPrincipal,@Query("patientId") patientId:string,@Query("encounterId") encounterId:string){return this.devices.providerDevices(p,patientId,encounterId);}
}
@Controller("provider/device-observations")
class ProviderDeviceObservationsController {
  constructor(private readonly devices:DeviceRegistryService){}
  @RequirePermissions("CLINICAL_RECORD_WRITE") @Post() @Header("Cache-Control","no-store")
  capture(@CurrentPrincipal() p:AuthPrincipal,@Body() b:ProviderDeviceMeasurement){return this.devices.providerCapture(p,b);}
}
@Public()
@Controller("device-observations")
class SignedDeviceObservationsController {
  constructor(private readonly devices:DeviceRegistryService){}
  @Post() @Header("Cache-Control","no-store")
  ingest(@Headers("x-device-signature") signature:string|undefined,@Body() b:DeviceMeasurement){return this.devices.machineIngest(signature,b);}
}
@Module({
  imports:[ObservationModule,ProvidersModule],
  controllers:[AdminDevicesController,ProviderDevicesController,ProviderDeviceObservationsController,SignedDeviceObservationsController],
  providers:[DeviceRegistryService],
})
export class DevicesModule {}
