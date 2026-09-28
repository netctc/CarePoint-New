import "dotenv/config";
import { createHash } from "node:crypto";
import {
  Prisma,
  PrismaClient,
  type AppointmentModality,
  type ProviderClass,
  type UserRole,
} from "@prisma/client";
import { hashPassword } from "@carepoint/identity";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { ClinicalEnvelopeService } from "../modules/clinical/clinical-envelope.service";

dayjs.extend(utc);
dayjs.extend(timezone);

const prisma = new PrismaClient();
const envelope = new ClinicalEnvelopeService();

const RESET_CONFIRMATION = "RESET_AND_CREATE_RICH_SYNTHETIC_DATA";
const DEFAULT_PATIENT_COUNT = 300;
const DEFAULT_DOCTORS_PER_SPECIALTY = 2;
const DEFAULT_PROVIDERS_PER_CATEGORY = 2;
const HISTORY_DAYS = 330;
const FUTURE_APPOINTMENT_DAYS = 30;
const AVAILABILITY_DAYS = 42;
const SLOT_HOURS = [8, 9, 10, 11, 12, 13, 14, 15];
const WORK_DAYS = [0, 1, 2, 3, 4];
const SYSTEM_ACTOR = "system:rich-test-fixtures";

type Labels = { en: string; ar: string; fr: string; es: string };
type FixtureConfig = {
  password: string;
  passwordHash: string;
  domain: string;
  timezone: string;
  patientCount: number;
  doctorsPerSpecialty: number;
  providersPerCategory: number;
};
type SpecialtySeed = { code: string; suffix: string; name: string };
type CategorySeed = {
  slug: string;
  suffix: string;
  name: string;
  family: string;
  credentialTypes: string[];
  modalities: AppointmentModality[];
  capabilities?: Record<string, unknown>;
};
type ManagedUser = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
};
type PatientFixture = {
  id: string;
  userId: string;
  username: string;
  phone: string;
  dateOfBirth: string;
  sex: string;
  baselineWeightKg: number;
  heightCm: number;
};
type SchedulableProvider = {
  providerId: string;
  userId: string;
  username: string;
  providerClass: ProviderClass;
  catalogSuffix: string;
  serviceId: string;
  modalities: AppointmentModality[];
  durationMinutes: number;
  family?: string;
};

const SPECIALTIES: SpecialtySeed[] = [
  { code: "GENMED", suffix: "GEN", name: "General Medicine" },
  { code: "FAMMED", suffix: "FAM", name: "Family Medicine" },
  { code: "INTMED", suffix: "INT", name: "Internal Medicine" },
  { code: "CARD", suffix: "CAR", name: "Cardiology" },
  { code: "DERM", suffix: "DER", name: "Dermatology" },
  { code: "NEUR", suffix: "NEU", name: "Neurology" },
  { code: "PED", suffix: "PED", name: "Pediatrics" },
  { code: "OBGYN", suffix: "GYN", name: "Obstetrics and Gynecology" },
  { code: "ORTHO", suffix: "ORT", name: "Orthopedics" },
  { code: "ENT", suffix: "ENT", name: "Otolaryngology / ENT" },
  { code: "OPHTH", suffix: "OPH", name: "Ophthalmology" },
  { code: "PSYCH", suffix: "PSY", name: "Psychiatry" },
  { code: "PULM", suffix: "PUL", name: "Pulmonology" },
  { code: "GASTRO", suffix: "GAS", name: "Gastroenterology" },
  { code: "ENDO", suffix: "END", name: "Endocrinology" },
  { code: "NEPH", suffix: "NEP", name: "Nephrology" },
  { code: "UROL", suffix: "URO", name: "Urology" },
  { code: "RHEUM", suffix: "RHE", name: "Rheumatology" },
  { code: "ONCOL", suffix: "ONC", name: "Medical Oncology" },
  { code: "HEMAT", suffix: "HEM", name: "Hematology" },
  { code: "INFECT", suffix: "INF", name: "Infectious Diseases" },
  { code: "ALLIMM", suffix: "AIM", name: "Allergy and Immunology" },
  { code: "ANEST", suffix: "ANE", name: "Anesthesiology" },
  { code: "RAD", suffix: "RAD", name: "Diagnostic Radiology" },
  { code: "PATH", suffix: "PAT", name: "Pathology" },
  { code: "EMERG", suffix: "EME", name: "Emergency Medicine" },
  { code: "GENSURG", suffix: "GSU", name: "General Surgery" },
  { code: "CARDSURG", suffix: "CTS", name: "Cardiothoracic Surgery" },
  { code: "NEUROSURG", suffix: "NSU", name: "Neurosurgery" },
  { code: "PLASTSURG", suffix: "PLS", name: "Plastic Surgery" },
  { code: "VASC", suffix: "VAS", name: "Vascular Surgery" },
  { code: "PMR", suffix: "PMR", name: "Physical Medicine and Rehabilitation" },
  { code: "GERI", suffix: "GER", name: "Geriatric Medicine" },
  { code: "SPORT", suffix: "SPM", name: "Sports Medicine" },
  { code: "OCCMED", suffix: "OCC", name: "Occupational Medicine" },
  { code: "PALL", suffix: "PAL", name: "Palliative Medicine" },
  { code: "SLEEP", suffix: "SLP", name: "Sleep Medicine" },
  { code: "PAIN", suffix: "PAI", name: "Pain Medicine" },
  { code: "NUCMED", suffix: "NUC", name: "Nuclear Medicine" },
  { code: "REPRO", suffix: "REP", name: "Reproductive Medicine / Fertility" },
];

const PROVIDER_CATEGORIES: CategorySeed[] = [
  { slug:"nursing", suffix:"NUR", name:"Nursing", family:"NURSING", credentialTypes:["professional-license"], modalities:["CLINIC","HOME_VISIT"], capabilities:{canRecordVitals:true,canPerformNursingWorkflow:true} },
  { slug:"physiotherapy", suffix:"PHY", name:"Physiotherapy", family:"THERAPY", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"], capabilities:{canManageTherapySessions:true} },
  { slug:"occupational-therapy", suffix:"OCT", name:"Occupational Therapy", family:"THERAPY", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"] },
  { slug:"speech-language-therapy", suffix:"SLT", name:"Speech and Language Therapy", family:"THERAPY", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"] },
  { slug:"respiratory-therapy", suffix:"RSP", name:"Respiratory Therapy", family:"THERAPY", credentialTypes:["professional-license"], modalities:["CLINIC","HOME_VISIT"] },
  { slug:"nutrition", suffix:"NUT", name:"Nutrition and Dietetics", family:"NON_DOCTOR_HEALTHCARE", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"], capabilities:{canManageNutritionPlan:true} },
  { slug:"psychology", suffix:"PSI", name:"Psychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"], capabilities:{canDocumentBehavioralAssessment:true} },
  { slug:"clinical-psychology", suffix:"CPS", name:"Clinical Psychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"counseling-psychology", suffix:"COP", name:"Counseling Psychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"child-adolescent-psychology", suffix:"CAP", name:"Child and Adolescent Psychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"neuropsychology", suffix:"NPS", name:"Neuropsychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"health-psychology", suffix:"HPS", name:"Health Psychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"educational-psychology", suffix:"EPS", name:"Educational Psychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"forensic-psychology", suffix:"FPS", name:"Forensic Psychology", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"special-education", suffix:"SED", name:"Special Education", family:"SPECIAL_EDUCATION", credentialTypes:["professional-certificate"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"] },
  { slug:"behavioral-therapy", suffix:"BTH", name:"Behavioral Therapy", family:"BEHAVIORAL_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"] },
  { slug:"social-work", suffix:"SOC", name:"Medical Social Work", family:"SOCIAL_CARE", credentialTypes:["professional-license"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"] },
  { slug:"audiology", suffix:"AUD", name:"Audiology", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC"] },
  { slug:"optometry", suffix:"OPT", name:"Optometry", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC"] },
  { slug:"podiatry", suffix:"POD", name:"Podiatry", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","HOME_VISIT"] },
  { slug:"pharmacy", suffix:"PHA", name:"Pharmacy", family:"PHARMACY", credentialTypes:["pharmacist-license"], modalities:["CLINIC","TELEMEDICINE"] },
  { slug:"clinical-laboratory", suffix:"LAB", name:"Clinical Laboratory", family:"LABORATORY", credentialTypes:["laboratory-license"], modalities:["CLINIC","HOME_VISIT"], capabilities:{canManageSpecimens:true} },
  { slug:"radiology-technology", suffix:"RDT", name:"Radiology Technology", family:"DIAGNOSTIC", credentialTypes:["professional-license"], modalities:["CLINIC"] },
  { slug:"dental-hygiene", suffix:"DNH", name:"Dental Hygiene", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC"] },
  { slug:"midwifery", suffix:"MID", name:"Midwifery", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","HOME_VISIT"] },
  { slug:"home-health", suffix:"HHC", name:"Home Health Care", family:"HOME_HEALTH", credentialTypes:["provider-license"], modalities:["HOME_VISIT"] },
  { slug:"diabetes-educator", suffix:"DIA", name:"Diabetes Education", family:"HEALTH_EDUCATION", credentialTypes:["professional-certificate"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"] },
  { slug:"lactation-consultant", suffix:"LAC", name:"Lactation Consulting", family:"HEALTH_EDUCATION", credentialTypes:["professional-certificate"], modalities:["CLINIC","TELEMEDICINE","HOME_VISIT"] },
  { slug:"prosthetics-orthotics", suffix:"PRO", name:"Prosthetics and Orthotics", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC"] },
  { slug:"wound-care", suffix:"WOU", name:"Wound Care", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC","HOME_VISIT"] },
  { slug:"dialysis-technology", suffix:"DLY", name:"Dialysis Technology", family:"ALLIED_HEALTH", credentialTypes:["professional-license"], modalities:["CLINIC"] },
  { slug:"sleep-technology", suffix:"SLT2", name:"Sleep Technology", family:"DIAGNOSTIC", credentialTypes:["professional-license"], modalities:["CLINIC"] },
  { slug:"ground-medical-transport", suffix:"GMT", name:"Ground Medical Transport", family:"MEDICAL_TRANSPORT_GROUND", credentialTypes:["transport-license"], modalities:[], capabilities:{canManageTransport:true,transportMode:"GROUND"} },
  { slug:"air-medical-transport", suffix:"AMT", name:"Air Medical Transport", family:"MEDICAL_TRANSPORT_AIR", credentialTypes:["transport-license","aviation-medical-approval"], modalities:[], capabilities:{canManageTransport:true,transportMode:"AIR"} },
  { slug:"emergency-ambulance", suffix:"EMS", name:"Emergency Ambulance", family:"EMERGENCY_AMBULANCE", credentialTypes:["transport-license","emergency-medical-license"], modalities:[], capabilities:{canManageTransport:true,transportMode:"GROUND",emergency:true} },
  { slug:"paramedicine", suffix:"PAR", name:"Paramedicine", family:"EMERGENCY_CARE", credentialTypes:["professional-license"], modalities:["HOME_VISIT"] },
  { slug:"care-coordination", suffix:"CCO", name:"Care Coordination", family:"CARE_COORDINATION", credentialTypes:["professional-certificate"], modalities:["TELEMEDICINE"] },
];

const UNITS = [
  { code:"BPM", dimension:"RATE", name:"beats/min" },
  { code:"MMHG", dimension:"PRESSURE", name:"mmHg" },
  { code:"CELSIUS", dimension:"TEMPERATURE", name:"°C" },
  { code:"FAHRENHEIT", dimension:"TEMPERATURE", name:"°F" },
  { code:"MG_DL", dimension:"GLUCOSE", name:"mg/dL" },
  { code:"MMOL_L", dimension:"GLUCOSE", name:"mmol/L" },
  { code:"KG", dimension:"MASS", name:"kg" },
  { code:"LB", dimension:"MASS", name:"lb" },
  { code:"CM", dimension:"LENGTH", name:"cm" },
  { code:"IN", dimension:"LENGTH", name:"in" },
  { code:"PERCENT", dimension:"PERCENT", name:"%" },
  { code:"BREATHS_MIN", dimension:"RATE", name:"breaths/min" },
  { code:"KG_M2", dimension:"BMI", name:"kg/m²" },
  { code:"COUNT", dimension:"COUNT", name:"count" },
  { code:"L_MIN", dimension:"FLOW", name:"L/min" },
  { code:"SCORE", dimension:"SCORE", name:"score" },
] as const;

const METRICS = [
  { code:"HEART_RATE", category:"VITALS", name:"Heart rate", unit:"BPM", allowed:["BPM"], min:20, max:250, precision:0 },
  { code:"SYSTOLIC_BP", category:"VITALS", name:"Systolic blood pressure", unit:"MMHG", allowed:["MMHG"], min:50, max:260, precision:0 },
  { code:"DIASTOLIC_BP", category:"VITALS", name:"Diastolic blood pressure", unit:"MMHG", allowed:["MMHG"], min:30, max:160, precision:0 },
  { code:"BLOOD_GLUCOSE", category:"METABOLIC", name:"Blood glucose", unit:"MG_DL", allowed:["MG_DL","MMOL_L"], min:20, max:600, precision:1 },
  { code:"BODY_WEIGHT", category:"BODY", name:"Body weight", unit:"KG", allowed:["KG","LB"], min:1, max:500, precision:1 },
  { code:"BODY_TEMPERATURE", category:"VITALS", name:"Body temperature", unit:"CELSIUS", allowed:["CELSIUS","FAHRENHEIT"], min:30, max:45, precision:1 },
  { code:"SPO2", category:"VITALS", name:"Oxygen saturation", unit:"PERCENT", allowed:["PERCENT"], min:50, max:100, precision:0 },
  { code:"RESPIRATORY_RATE", category:"VITALS", name:"Respiratory rate", unit:"BREATHS_MIN", allowed:["BREATHS_MIN"], min:4, max:80, precision:0 },
  { code:"BMI", category:"BODY", name:"Body mass index", unit:"KG_M2", allowed:["KG_M2"], min:8, max:90, precision:1 },
  { code:"PAIN_SCORE", category:"SYMPTOM", name:"Pain score", unit:"SCORE", allowed:["SCORE"], min:0, max:10, precision:0 },
  { code:"STEPS", category:"ACTIVITY", name:"Daily steps", unit:"COUNT", allowed:["COUNT"], min:0, max:100000, precision:0 },
  { code:"HEIGHT", category:"BODY", name:"Height", unit:"CM", allowed:["CM","IN"], min:30, max:260, precision:1 },
] as const;

const FIRST_NAMES = ["Omar","Layla","Yousef","Mariam","Khalid","Noura","Tariq","Sara","Hassan","Rania","Adam","Lina","Fadi","Maya","Sami","Huda","Karim","Dina","Nabil","Salma"];
const LAST_NAMES = ["Alami","Haddad","Khalil","Mansour","Nasser","Rahman","Saleh","Farah","Hamdan","Sabbagh","Najjar","Malik","Saad","Hariri","Habib","Yamin","Rashid","Aziz","Darwish","Karam"];
const BLOOD_TYPES = ["A","B","AB","O"] as const;
const RHESUS = ["POSITIVE","NEGATIVE"] as const;

function localized(name:string): Labels {
  return { en:name, ar:name, fr:name, es:name };
}

function intEnv(name:string, fallback:number, min:number, max:number): number {
  const raw=process.env[name]?.trim();
  if(!raw) return fallback;
  const value=Number(raw);
  if(!Number.isInteger(value)||value<min||value>max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function requireSafety(): FixtureConfig {
  if(process.env.CAREPOINT_RICH_TEST_DATA_CONFIRM!==RESET_CONFIRMATION){
    throw new Error(`CAREPOINT_RICH_TEST_DATA_CONFIRM must equal ${RESET_CONFIRMATION}.`);
  }
  const databaseUrl=process.env.DATABASE_URL;
  if(!databaseUrl) throw new Error("DATABASE_URL is required.");
  const parsed=new URL(databaseUrl);
  const dbName=parsed.pathname.replace(/^\//,"").toLowerCase();
  if(!/(test|pilot|staging|uat|demo|sandbox)/.test(dbName)){
    throw new Error("Refusing destructive rich fixtures: database name must contain test, pilot, staging, uat, demo or sandbox.");
  }
  const password=process.env.CAREPOINT_TEST_FIXTURE_PASSWORD;
  if(!password||password.length<16) throw new Error("CAREPOINT_TEST_FIXTURE_PASSWORD must contain at least 16 characters.");
  const domain=process.env.CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN?.trim().toLowerCase();
  if(!domain||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)){
    throw new Error("CAREPOINT_TEST_FIXTURE_EMAIL_DOMAIN must be a valid explicit test domain.");
  }
  const tz=process.env.CAREPOINT_TEST_FIXTURE_TIMEZONE?.trim()||"Asia/Riyadh";
  try{new Intl.DateTimeFormat("en-US",{timeZone:tz}).format(new Date());}catch{throw new Error("CAREPOINT_TEST_FIXTURE_TIMEZONE must be a valid IANA timezone.");}
  return {
    password,
    passwordHash:hashPassword(password),
    domain,
    timezone:tz,
    patientCount:intEnv("CAREPOINT_RICH_TEST_PATIENT_COUNT",DEFAULT_PATIENT_COUNT,50,2000),
    doctorsPerSpecialty:intEnv("CAREPOINT_RICH_TEST_DOCTORS_PER_SPECIALTY",DEFAULT_DOCTORS_PER_SPECIALTY,1,10),
    providersPerCategory:intEnv("CAREPOINT_RICH_TEST_PROVIDERS_PER_CATEGORY",DEFAULT_PROVIDERS_PER_CATEGORY,1,10),
  };
}

function pad3(value:number){return String(value).padStart(3,"0");}
function lowerEmail(username:string,domain:string){return `${username.toLowerCase()}@${domain}`;}
function isoDate(value:dayjs.Dayjs){return value.format("YYYY-MM-DD");}
function digest(value:string){return createHash("sha256").update(value).digest("hex");}
function envelopeData(value:{algorithm:string;keyId:string;wrappedKey:string;iv:string;ciphertext:string}){
  return {algorithm:value.algorithm,keyId:value.keyId,wrappedKey:value.wrappedKey,iv:value.iv,ciphertext:value.ciphertext};
}

async function resetApplicationData(){
  const tables=await prisma.$queryRaw<Array<{tablename:string}>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
      AND tablename <> 'spatial_ref_sys'
    ORDER BY tablename
  `;
  if(!tables.length) return 0;
  const names=tables.map(({tablename})=>`"${tablename.replaceAll('"','""')}"`).join(",");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  return tables.length;
}

async function createUser(username:string,role:UserRole,config:FixtureConfig,createdAt:Date):Promise<ManagedUser>{
  const user=await prisma.user.create({
    data:{
      username,
      email:lowerEmail(username,config.domain),
      passwordHash:config.passwordHash,
      role,
      status:"ACTIVE",
      failedLoginCount:0,
      createdAt,
    },
  });
  return {id:user.id,username,email:user.email,role};
}

async function seedReferenceData(){
  const specialtyIds=new Map<string,string>();
  for(const item of SPECIALTIES){
    const row=await prisma.medicalSpecialty.create({data:{code:item.code,labels:localized(item.name) as unknown as Prisma.InputJsonValue,active:true}});
    specialtyIds.set(item.code,row.id);
  }

  const categoryIds=new Map<string,string>();
  for(const item of PROVIDER_CATEGORIES){
    const capabilities={enabledModalities:item.modalities,...(item.capabilities??{})};
    const row=await prisma.providerCategory.create({
      data:{
        slug:item.slug,
        labels:localized(item.name) as unknown as Prisma.InputJsonValue,
        family:item.family,
        requiredCredentialTypes:item.credentialTypes as unknown as Prisma.InputJsonValue,
        capabilities:capabilities as unknown as Prisma.InputJsonValue,
        active:true,
      },
    });
    categoryIds.set(item.slug,row.id);
  }

  for(const unit of UNITS){
    await prisma.measurementUnit.create({
      data:{code:unit.code,dimension:unit.dimension,labels:localized(unit.name) as unknown as Prisma.InputJsonValue,active:true},
    });
  }
  const conversions=[
    {dimension:"TEMPERATURE",from:"FAHRENHEIT",to:"CELSIUS",multiplier:5/9,offset:-17.7777777778},
    {dimension:"TEMPERATURE",from:"CELSIUS",to:"FAHRENHEIT",multiplier:9/5,offset:32},
    {dimension:"GLUCOSE",from:"MMOL_L",to:"MG_DL",multiplier:18,offset:0},
    {dimension:"GLUCOSE",from:"MG_DL",to:"MMOL_L",multiplier:1/18,offset:0},
    {dimension:"MASS",from:"LB",to:"KG",multiplier:0.45359237,offset:0},
    {dimension:"MASS",from:"KG",to:"LB",multiplier:2.2046226218,offset:0},
    {dimension:"LENGTH",from:"IN",to:"CM",multiplier:2.54,offset:0},
    {dimension:"LENGTH",from:"CM",to:"IN",multiplier:1/2.54,offset:0},
  ];
  for(const item of conversions){
    await prisma.unitConversion.create({
      data:{dimension:item.dimension,fromUnitCode:item.from,toUnitCode:item.to,multiplier:item.multiplier,offset:item.offset,version:1,active:true},
    });
  }

  const metricVersions=new Map<string,{typeId:string;versionId:string;version:number;unit:string}>();
  for(const metric of METRICS){
    const type=await prisma.observationType.create({
      data:{code:metric.code,labels:localized(metric.name) as unknown as Prisma.InputJsonValue,category:metric.category,active:true},
    });
    const version=await prisma.observationTypeVersion.create({
      data:{
        observationTypeId:type.id,
        version:1,
        status:"ACTIVE",
        canonicalUnitCode:metric.unit,
        allowedUnitCodes:[...metric.allowed] as unknown as Prisma.InputJsonValue,
        minCanonical:metric.min,
        maxCanonical:metric.max,
        precision:metric.precision,
        createdByActorId:SYSTEM_ACTOR,
        activatedAt:new Date(),
      },
    });
    metricVersions.set(metric.code,{typeId:type.id,versionId:version.id,version:1,unit:metric.unit});
  }
  return {specialtyIds,categoryIds,metricVersions};
}

async function createPatients(config:FixtureConfig):Promise<PatientFixture[]>{
  const now=dayjs().tz(config.timezone);
  const patients:PatientFixture[]=[];
  for(let index=1;index<=config.patientCount;index++){
    const username=`pac${pad3(index)}`;
    const age=1+((index*7)%84);
    const dob=now.subtract(age,"year").subtract((index*11)%330,"day").startOf("day");
    const createdAt=now.subtract((index*17)%HISTORY_DAYS,"day").subtract(index%12,"hour").toDate();
    const user=await createUser(username,"PATIENT",config,createdAt);
    const sex=index%2===0?"FEMALE":"MALE";
    const heightCm=145+(index%48);
    const baselineWeightKg=Math.round((48+(index%55)+(index%4)*0.3)*10)/10;
    const phone=`+96655${String(1000000+index).slice(-7)}`;
    const profile=await prisma.patientProfile.create({
      data:{
        userId:user.id,
        firstName:FIRST_NAMES[(index-1)%FIRST_NAMES.length]!,
        lastName:LAST_NAMES[Math.floor((index-1)/FIRST_NAMES.length)%LAST_NAMES.length]!,
        dateOfBirth:dob.toDate(),
        sex,
        phone,
        createdAt,
      },
    });
    patients.push({id:profile.id,userId:user.id,username,phone,dateOfBirth:isoDate(dob),sex,baselineWeightKg,heightCm});
  }
  return patients;
}

function credentialDates(sequence:number){
  const now=dayjs();
  if(sequence%17===0) return {validFrom:now.subtract(2,"year").toDate(),validUntil:now.subtract(12,"day").toDate()};
  if(sequence%11===0) return {validFrom:now.subtract(1,"year").toDate(),validUntil:now.add(7,"day").toDate()};
  if(sequence%7===0) return {validFrom:now.subtract(1,"year").toDate(),validUntil:now.add(60,"day").toDate()};
  return {validFrom:now.subtract(1,"year").toDate(),validUntil:now.add(2,"year").toDate()};
}

async function createProviderCredential(providerId:string,type:string,number:string,sequence:number){
  const dates=credentialDates(sequence);
  const credential=await prisma.providerCredential.create({
    data:{providerId,type,issuer:"CarePoint Synthetic Licensing Authority",number,status:"VALID",...dates},
  });
  await prisma.providerCredentialVerification.create({
    data:{credentialId:credential.id,status:"VALID",note:"Synthetic verified credential.",actorId:SYSTEM_ACTOR,createdAt:dayjs().subtract(20+(sequence%90),"day").toDate()},
  });
  return credential;
}

async function createProviderBase(user:ManagedUser,providerClass:ProviderClass,displayName:string,phone:string,createdAt:Date){
  const provider=await prisma.provider.create({
    data:{userId:user.id,class:providerClass,displayName,legalName:displayName,contactPhone:phone,status:"ACTIVE",createdAt},
  });
  await prisma.providerGovernanceHistory.create({
    data:{providerId:provider.id,domain:"PROVIDER",fromStatus:"PENDING_REVIEW",toStatus:"ACTIVE",reason:"Synthetic credential approval.",actorId:SYSTEM_ACTOR,createdAt},
  });
  return provider;
}

async function createService(providerId:string,name:string,modalities:AppointmentModality[],durationMinutes:number){
  if(!modalities.length) return null;
  const service=await prisma.service.create({
    data:{
      providerId,
      name,
      labels:localized(name) as unknown as Prisma.InputJsonValue,
      description:"Synthetic service generated for full-system testing.",
      descriptionLabels:localized("Synthetic service generated for full-system testing.") as unknown as Prisma.InputJsonValue,
      currency:"SAR",
      active:true,
    },
  });
  for(const modality of modalities){
    await prisma.serviceModality.create({
      data:{serviceId:service.id,modality,durationMinutes,priceMinor:12500+(durationMinutes*100),active:true},
    });
  }
  return service;
}

async function createDoctors(config:FixtureConfig,specialtyIds:Map<string,string>):Promise<SchedulableProvider[]>{
  const output:SchedulableProvider[]=[];
  let globalSequence=0;
  for(const specialty of SPECIALTIES){
    for(let index=1;index<=config.doctorsPerSpecialty;index++){
      globalSequence++;
      const username=`dr${pad3(index)}.${specialty.suffix}`;
      const createdAt=dayjs().subtract(90+(globalSequence%220),"day").toDate();
      const user=await createUser(username,"DOCTOR",config,createdAt);
      const provider=await createProviderBase(user,"DOCTOR",`Dr. ${FIRST_NAMES[globalSequence%FIRST_NAMES.length]} ${LAST_NAMES[globalSequence%LAST_NAMES.length]} · ${specialty.name}`,`+96656${String(2000000+globalSequence).slice(-7)}`,createdAt);
      const licenseNumber=`SYN-DR-${specialty.suffix}-${pad3(index)}`;
      const profile=await prisma.doctorProfile.create({data:{providerId:provider.id,licenseNumber,licenseIssuer:"CarePoint Synthetic Licensing Authority"}});
      await prisma.doctorSpecialty.create({data:{doctorId:profile.id,specialtyId:specialtyIds.get(specialty.code)!,primary:true}});
      await createProviderCredential(provider.id,"medical-license",licenseNumber,globalSequence);
      const modalities:AppointmentModality[]=globalSequence%5===0?["CLINIC","TELEMEDICINE","HOME_VISIT"]:["CLINIC","TELEMEDICINE"];
      const service=await createService(provider.id,`${specialty.name} Consultation`,modalities,globalSequence%4===0?45:30);
      if(service) output.push({providerId:provider.id,userId:user.id,username,providerClass:"DOCTOR",catalogSuffix:specialty.suffix,serviceId:service.id,modalities,durationMinutes:globalSequence%4===0?45:30});
    }
  }
  return output;
}

async function createOtherProviders(config:FixtureConfig,categoryIds:Map<string,string>){
  const output:SchedulableProvider[]=[];
  const transportProviders:{ground:string[];air:string[];emergency:string[]}={ground:[],air:[],emergency:[]};
  let globalSequence=0;
  for(const category of PROVIDER_CATEGORIES){
    for(let index=1;index<=config.providersPerCategory;index++){
      globalSequence++;
      const username=`pr${pad3(index)}.${category.suffix}`;
      const createdAt=dayjs().subtract(70+(globalSequence%230),"day").toDate();
      const user=await createUser(username,"OTHER_PROVIDER",config,createdAt);
      const provider=await createProviderBase(user,"OTHER_PROVIDER",`${category.name} Provider ${pad3(index)}`,`+96657${String(3000000+globalSequence).slice(-7)}`,createdAt);
      await prisma.otherProviderProfile.create({data:{providerId:provider.id,categoryId:categoryIds.get(category.slug)!}});
      for(const [credentialIndex,type] of category.credentialTypes.entries()){
        await createProviderCredential(provider.id,type,`SYN-PR-${category.suffix}-${pad3(index)}-${credentialIndex+1}`,globalSequence+credentialIndex);
      }
      const service=await createService(provider.id,`${category.name} Service`,category.modalities,category.modalities.includes("HOME_VISIT")?45:30);
      if(service) output.push({providerId:provider.id,userId:user.id,username,providerClass:"OTHER_PROVIDER",catalogSuffix:category.suffix,serviceId:service.id,modalities:category.modalities,durationMinutes:category.modalities.includes("HOME_VISIT")?45:30,family:category.family});
      if(category.family==="MEDICAL_TRANSPORT_GROUND") transportProviders.ground.push(provider.id);
      if(category.family==="MEDICAL_TRANSPORT_AIR") transportProviders.air.push(provider.id);
      if(category.family==="EMERGENCY_AMBULANCE") transportProviders.emergency.push(provider.id);
    }
  }
  return {schedulable:output,transportProviders};
}

async function createPendingOnboardings(config:FixtureConfig,specialtyIds:Map<string,string>,categoryIds:Map<string,string>){
  let doctorCount=0,providerCount=0;
  for(const [idx,specialty] of SPECIALTIES.slice(0,8).entries()){
    const username=`dr${pad3(901+idx)}.${specialty.suffix}`;
    const user=await createUser(username,"DOCTOR",config,dayjs().subtract(10+idx,"day").toDate());
    const provider=await prisma.provider.create({data:{userId:user.id,class:"DOCTOR",displayName:`Pending Dr. ${specialty.name} ${idx+1}`,status:"DRAFT"}});
    await prisma.doctorProfile.create({data:{providerId:provider.id,licenseNumber:`PEND-DR-${specialty.suffix}-${idx+1}`,licenseIssuer:"Pending verification"}});
    const onboarding=await prisma.providerOnboarding.create({
      data:{userId:user.id,kind:"DOCTOR",specialtyId:specialtyIds.get(specialty.code)!,state:idx%4===0?"REQUEST_CHANGES":"PENDING_REVIEW",submittedAt:dayjs().subtract(5+idx,"day").toDate(),reviewNote:idx%4===0?"Please provide renewed evidence.":null},
    });
    await prisma.onboardingCredential.create({
      data:{onboardingId:onboarding.id,type:"medical-license",number:`PEND-DR-${specialty.suffix}-${idx+1}`,issuer:"Pending verification",validUntil:dayjs().add(1,"year").toDate(),state:idx%3===0?"VERIFIED":"PENDING"},
    });
    doctorCount++;
  }
  const pendingCategories=["nutrition","psychology","clinical-psychology","special-education","ground-medical-transport","air-medical-transport","nursing","physiotherapy","clinical-laboratory","home-health"];
  for(const [idx,slug] of pendingCategories.entries()){
    const category=PROVIDER_CATEGORIES.find(x=>x.slug===slug)!;
    const username=`pr${pad3(901+idx)}.${category.suffix}`;
    const user=await createUser(username,"OTHER_PROVIDER",config,dayjs().subtract(8+idx,"day").toDate());
    const provider=await prisma.provider.create({data:{userId:user.id,class:"OTHER_PROVIDER",displayName:`Pending ${category.name} ${idx+1}`,status:"DRAFT"}});
    await prisma.otherProviderProfile.create({data:{providerId:provider.id,categoryId:categoryIds.get(slug)!}});
    const onboarding=await prisma.providerOnboarding.create({
      data:{userId:user.id,kind:"OTHER_PROVIDER",providerCategoryId:categoryIds.get(slug)!,state:idx%5===0?"REQUEST_CHANGES":"PENDING_REVIEW",submittedAt:dayjs().subtract(3+idx,"day").toDate(),reviewNote:idx%5===0?"Credential evidence needs clarification.":null},
    });
    for(const [credentialIndex,type] of category.credentialTypes.entries()){
      await prisma.onboardingCredential.create({
        data:{onboardingId:onboarding.id,type,number:`PEND-PR-${category.suffix}-${idx+1}-${credentialIndex+1}`,issuer:"Pending verification",validUntil:dayjs().add(18,"month").toDate(),state:credentialIndex===0&&idx%4===0?"VERIFIED":"PENDING"},
      });
    }
    providerCount++;
  }
  return {doctorCount,providerCount};
}

async function createAvailability(providers:SchedulableProvider[],config:FixtureConfig){
  const today=dayjs().tz(config.timezone).startOf("day");
  const effectiveUntil=today.add(AVAILABILITY_DAYS,"day");
  const rules=new Map<string,string>();
  for(const provider of providers){
    for(const modality of provider.modalities){
      for(const weekday of WORK_DAYS){
        const rule=await prisma.availabilityRule.create({
          data:{
            providerId:provider.providerId,
            serviceId:provider.serviceId,
            modality,
            timezone:config.timezone,
            weekday,
            startMinute:8*60,
            endMinute:16*60,
            intervalMinutes:60,
            slotCapacity:2,
            effectiveFrom:today.toDate(),
            effectiveUntil:effectiveUntil.toDate(),
            active:true,
          },
        });
        rules.set(`${provider.serviceId}|${modality}|${weekday}`,rule.id);
      }
    }
  }

  const batch:Prisma.AvailabilitySlotCreateManyInput[]=[];
  let total=0;
  for(let offset=1;offset<=AVAILABILITY_DAYS;offset++){
    const date=today.add(offset,"day");
    if(!WORK_DAYS.includes(date.day())) continue;
    for(const provider of providers){
      for(const modality of provider.modalities){
        const ruleId=rules.get(`${provider.serviceId}|${modality}|${date.day()}`)??null;
        for(const hour of SLOT_HOURS){
          const start=dayjs.tz(`${date.format("YYYY-MM-DD")}T${String(hour).padStart(2,"0")}:00:00`,config.timezone);
          batch.push({
            providerId:provider.providerId,
            serviceId:provider.serviceId,
            modality,
            startsAt:start.toDate(),
            endsAt:start.add(provider.durationMinutes,"minute").toDate(),
            capacity:2,
            bookedCount:0,
            status:"OPEN",
            sourceRuleId:ruleId,
          });
          if(batch.length>=4000){
            const result=await prisma.availabilitySlot.createMany({data:batch,skipDuplicates:true});
            total+=result.count;
            batch.length=0;
          }
        }
      }
    }
  }
  if(batch.length){
    const result=await prisma.availabilitySlot.createMany({data:batch,skipDuplicates:true});
    total+=result.count;
  }
  return total;
}

async function createAppointments(patients:PatientFixture[],providers:SchedulableProvider[],config:FixtureConfig){
  const now=dayjs().tz(config.timezone);
  const historical:Prisma.AppointmentCreateManyInput[]=[];
  const perPatient=14;
  for(const [patientIndex,patient] of patients.entries()){
    for(let visit=0;visit<perPatient;visit++){
      const provider=providers[(patientIndex*3+visit)%providers.length]!;
      const modality=provider.modalities[(patientIndex+visit)%provider.modalities.length]!;
      const daysAgo=12+Math.floor((visit*(HISTORY_DAYS-18))/(perPatient-1))+((patientIndex+visit)%4);
      const start=now.subtract(daysAgo,"day").hour(9+((patientIndex+visit)%6)).minute(0).second(0).millisecond(0);
      const statusCycle=["COMPLETED","COMPLETED","COMPLETED","COMPLETED","NO_SHOW","CANCELLED"] as const;
      const status=statusCycle[(patientIndex+visit)%statusCycle.length]!;
      historical.push({
        patientId:patient.id,
        providerId:provider.providerId,
        serviceId:provider.serviceId,
        idempotencyKey:`rich-hist-${patientIndex+1}-${visit+1}`,
        modality,
        status,
        startsAt:start.toDate(),
        endsAt:start.add(provider.durationMinutes,"minute").toDate(),
        cancelledAt:status==="CANCELLED"?start.subtract(2,"day").toDate():null,
        cancellationReason:status==="CANCELLED"?"Synthetic schedule change":null,
        createdAt:start.subtract(5+((patientIndex+visit)%10),"day").toDate(),
      });
    }
  }
  for(let i=0;i<historical.length;i+=2000) await prisma.appointment.createMany({data:historical.slice(i,i+2000),skipDuplicates:true});

  const rawSlots=await prisma.availabilitySlot.findMany({
    where:{startsAt:{gt:now.add(1,"day").toDate(),lte:now.add(FUTURE_APPOINTMENT_DAYS,"day").toDate()},status:"OPEN"},
    orderBy:[{startsAt:"asc"},{providerId:"asc"},{modality:"asc"}],
    take:patients.length*12,
  });
  // The database enforces one non-overlapping appointment per provider/time range.
  // Availability may expose the same provider/time through multiple modalities, so
  // select only one slot for each provider + start time before creating bookings.
  const uniqueSlots=rawSlots.filter((slot,index,items)=>
    items.findIndex(candidate=>candidate.providerId===slot.providerId&&candidate.startsAt.getTime()===slot.startsAt.getTime())===index
  );
  let futureCount=0;
  let slotCursor=0;
  const chosenSlotIds:string[]=[];
  for(const [patientIndex,patient] of patients.entries()){
    let patientEndsAt=0;
    for(let future=0;future<2;future++){
      while(slotCursor<uniqueSlots.length && uniqueSlots[slotCursor]!.startsAt.getTime()<patientEndsAt){
        slotCursor++;
      }
      const slot=uniqueSlots[slotCursor++];
      if(!slot) break;
      await prisma.appointment.create({
        data:{
          patientId:patient.id,
          providerId:slot.providerId,
          serviceId:slot.serviceId,
          slotId:slot.id,
          idempotencyKey:`rich-future-${patientIndex+1}-${future+1}`,
          modality:slot.modality,
          status:future===0?"CONFIRMED":"REQUESTED",
          startsAt:slot.startsAt,
          endsAt:slot.endsAt,
        },
      });
      patientEndsAt=slot.endsAt.getTime();
      chosenSlotIds.push(slot.id);
      futureCount++;
    }
  }
  for(const slotId of chosenSlotIds){
    await prisma.availabilitySlot.update({where:{id:slotId},data:{bookedCount:{increment:1}}});
  }
  return {historicalCount:historical.length,futureCount};
}

function metricValue(code:string,patient:PatientFixture,patientIndex:number,point:number){
  switch(code){
    case "HEART_RATE": return 62+((patientIndex*3+point)%31);
    case "SYSTOLIC_BP": return 104+((patientIndex*5+point*2)%36);
    case "DIASTOLIC_BP": return 64+((patientIndex*3+point)%24);
    case "BLOOD_GLUCOSE": return 78+((patientIndex*7+point*9)%75);
    case "BODY_WEIGHT": return Math.round((patient.baselineWeightKg+(point-2)*0.6)*10)/10;
    case "BODY_TEMPERATURE": return Math.round((36.2+((patientIndex+point)%9)*0.1)*10)/10;
    case "SPO2": return 94+((patientIndex+point)%7);
    case "RESPIRATORY_RATE": return 12+((patientIndex+point)%10);
    case "BMI": return Math.round((patient.baselineWeightKg/((patient.heightCm/100)**2)+(point-2)*0.1)*10)/10;
    case "PAIN_SCORE": return (patientIndex+point)%7;
    case "STEPS": return 2500+((patientIndex*641+point*903)%12000);
    case "HEIGHT": return patient.heightCm;
    default: return 0;
  }
}

async function createClinicalData(patients:PatientFixture[],metricVersions:Map<string,{typeId:string;versionId:string;version:number;unit:string}>,providers:SchedulableProvider[],config:FixtureConfig){
  const now=dayjs().tz(config.timezone);
  let observationCount=0,hospitalizationCount=0,immunizationCount=0,recordCount=0;
  const metricCodes=["HEART_RATE","SYSTOLIC_BP","DIASTOLIC_BP","BLOOD_GLUCOSE","BODY_WEIGHT","BODY_TEMPERATURE","SPO2","RESPIRATORY_RATE","BMI","PAIN_SCORE","STEPS","HEIGHT"];

  for(const [patientIndex,patient] of patients.entries()){
    const healthPayload={
      schemaVersion:1,
      basics:{
        dateOfBirth:patient.dateOfBirth,
        clinicalSex:patient.sex,
        heightCm:patient.heightCm,
        baselineWeightKg:patient.baselineWeightKg,
        bloodType:BLOOD_TYPES[patientIndex%BLOOD_TYPES.length],
        rhesusFactor:RHESUS[patientIndex%RHESUS.length],
        relevantNeeds:patientIndex%10===0?["Medication reconciliation follow-up"]:patientIndex%7===0?["Mobility assistance when required"]:[],
      },
    };
    const encryptedProfile=await envelope.encryptRecord(healthPayload);
    const profile=await prisma.patientHealthProfile.create({
      data:{patientId:patient.id,version:1,...envelopeData(encryptedProfile)},
    });
    await prisma.profileRevision.create({
      data:{profileId:profile.id,version:1,sourceType:"PATIENT",sourceActorId:patient.userId,changedFields:["basics"] as unknown as Prisma.InputJsonValue,...envelopeData(encryptedProfile)},
    });

    const observationRows:Prisma.ObservationCreateManyInput[]=[];
    for(const code of metricCodes){
      const version=metricVersions.get(code)!;
      const points=code==="BLOOD_GLUCOSE"&&patientIndex%4===0?8:4;
      for(let point=0;point<points;point++){
        const observedAt=now.subtract(20+point*Math.floor((HISTORY_DAYS-30)/Math.max(1,points-1))+(patientIndex%7),"day").hour(8+(point%4)).toDate();
        const value=metricValue(code,patient,patientIndex,point);
        const payload={
          schemaVersion:1,
          metricCode:code,
          metricVersion:version.version,
          originalValue:value,
          originalUnitCode:version.unit,
          canonicalValue:value,
          canonicalUnitCode:version.unit,
          ...(code==="BLOOD_GLUCOSE"?{glucoseContext:point%2===0?"FASTING":"POST_MEAL"}:{}),
          verificationStatus:"PATIENT_DECLARED",
        };
        const encrypted=await envelope.encryptRecord(payload);
        observationRows.push({
          patientId:patient.id,
          observationTypeId:version.typeId,
          observationTypeVersionId:version.versionId,
          observedAt,
          sourceType:"MANUAL",
          sourceId:null,
          createdByActorId:patient.userId,
          ...envelopeData(encrypted),
        });
      }
    }
    await prisma.observation.createMany({data:observationRows});
    observationCount+=observationRows.length;

    const assignedProvider=providers[patientIndex%providers.length]!;
    await prisma.consent.createMany({
      data:[
        {patientId:patient.id,providerId:assignedProvider.providerId,scope:"HEALTH_PROFILE_READ",version:"health-profile-v1",purpose:"TREATMENT",state:"GRANTED",grantedAt:now.subtract(200,"day").toDate(),expiresAt:now.add(120,"day").toDate()},
        {patientId:patient.id,providerId:assignedProvider.providerId,scope:"OBSERVATION_READ",version:"observation-read-v1",purpose:"TREATMENT",state:"GRANTED",grantedAt:now.subtract(200,"day").toDate(),expiresAt:now.add(120,"day").toDate()},
        {patientId:patient.id,providerId:assignedProvider.providerId,scope:"CLINICAL_PROFILE_READ",version:"clinical-profile-v1",purpose:"TREATMENT",state:"GRANTED",grantedAt:now.subtract(200,"day").toDate(),expiresAt:now.add(120,"day").toDate()},
      ],
    });

    if(patientIndex%5===0){
      const admitted=now.subtract(110+(patientIndex%170),"day").startOf("day");
      const discharged=admitted.add(2+(patientIndex%6),"day");
      const payload={schemaVersion:1,admittedOn:isoDate(admitted),dischargedOn:isoDate(discharged),facility:"CarePoint Synthetic Medical Center",reason:patientIndex%2===0?"Observation and treatment":"Elective procedure follow-up",source:{kind:"PROVIDER_RECORDED",system:"CAREPOINT_SYNTHETIC"}};
      const encrypted=await envelope.encryptRecord(payload);
      const logicalKey=digest(`${patient.id}|${payload.admittedOn}|${payload.facility}`);
      const row=await prisma.hospitalization.create({
        data:{patientId:patient.id,version:1,status:"COMPLETED",admittedOn:admitted.toDate(),dischargedOn:discharged.toDate(),logicalKey,idempotencyKey:`rich-hosp-${patientIndex+1}`,requestDigest:digest(JSON.stringify(payload)),sourceType:"PROVIDER_RECORDED",sourceActorId:assignedProvider.userId,...envelopeData(encrypted)},
      });
      await prisma.hospitalizationRevision.create({data:{hospitalizationId:row.id,version:1,status:"COMPLETED",sourceType:"PROVIDER_RECORDED",sourceActorId:assignedProvider.userId,...envelopeData(encrypted)}});
      hospitalizationCount++;
    }

    const vaccines=[
      {code:"FLU",display:"Seasonal influenza vaccine",days:60+(patientIndex%120)},
      {code:"COVID",display:"COVID-19 vaccine",days:150+(patientIndex%130)},
      {code:"TDAP",display:"Tdap vaccine",days:280+(patientIndex%800)},
    ];
    for(const [vaccineIndex,vaccine] of vaccines.entries()){
      const occurred=now.subtract(vaccine.days,"day").startOf("day");
      const payload={schemaVersion:1,occurredOn:isoDate(occurred),vaccineCodeSystem:"urn:carepoint:synthetic:vaccine",vaccineCode:vaccine.code,vaccineDisplay:vaccine.display,doseNumber:String(1+(vaccineIndex%2)),manufacturer:"Synthetic Pharma",route:"IM",site:"Upper arm",source:{kind:"PROVIDER_RECORDED",system:"CAREPOINT_SYNTHETIC"}};
      const encrypted=await envelope.encryptRecord(payload);
      const logicalKey=digest(`${patient.id}|${vaccine.code}|${payload.occurredOn}|${payload.doseNumber}`);
      const row=await prisma.immunization.create({
        data:{patientId:patient.id,version:1,status:"COMPLETED",occurredOn:occurred.toDate(),logicalKey,idempotencyKey:`rich-imm-${patientIndex+1}-${vaccineIndex+1}`,requestDigest:digest(JSON.stringify(payload)),sourceType:"PROVIDER_RECORDED",sourceActorId:assignedProvider.userId,...envelopeData(encrypted)},
      });
      await prisma.immunizationRevision.create({data:{immunizationId:row.id,version:1,status:"COMPLETED",sourceType:"PROVIDER_RECORDED",sourceActorId:assignedProvider.userId,...envelopeData(encrypted)}});
      immunizationCount++;
    }

    const clinicalPayload={
      schemaVersion:1,
      summary:"Synthetic longitudinal clinical encounter.",
      assessment:patientIndex%6===0?"Stable chronic-condition follow-up":"Routine preventive follow-up",
      plan:["Continue monitoring","Review observations at next visit"],
      synthetic:true,
    };
    const clinicalEncrypted=await envelope.encryptRecord(clinicalPayload);
    await prisma.clinicalRecord.create({
      data:{patientId:patient.id,providerId:assignedProvider.providerId,encounterRef:`RICH-ENC-${patientIndex+1}`,...envelopeData(clinicalEncrypted),createdAt:now.subtract(30+(patientIndex%270),"day").toDate()},
    });
    recordCount++;
  }
  return {observationCount,hospitalizationCount,immunizationCount,recordCount};
}

async function createAvailabilityRequests(patients:PatientFixture[],providers:SchedulableProvider[],config:FixtureConfig){
  const now=dayjs().tz(config.timezone);
  let count=0;
  for(let i=0;i<patients.length;i+=12){
    const patient=patients[i]!;
    const provider=providers[(i*5)%providers.length]!;
    const modality=provider.modalities[i%provider.modalities.length]!;
    await prisma.patientAvailabilityRequest.create({
      data:{
        patientId:patient.id,
        providerId:provider.providerId,
        serviceId:provider.serviceId,
        modality,
        fromAt:now.add(4+(i%7),"day").hour(8).toDate(),
        toAt:now.add(18+(i%9),"day").hour(18).toDate(),
        status:"WAITING",
        activeKey:`rich-avail-${i+1}`,
        noticeConsentVersion:"availability-notice-v1",
        noticeConsentAt:now.subtract(1,"day").toDate(),
      },
    });
    count++;
  }
  return count;
}

async function createTransportData(patients:PatientFixture[],transport:{ground:string[];air:string[];emergency:string[]},config:FixtureConfig){
  const now=dayjs().tz(config.timezone);
  let ground=0,air=0,emergency=0;
  for(let i=0;i<Math.min(40,patients.length);i++){
    const patient=patients[i]!;
    const mode=i%3===0?"AIR":"GROUND";
    const pool=mode==="AIR"?transport.air:transport.ground;
    const assignedProviderId=pool.length&&i%4!==0?pool[i%pool.length]!:null;
    const status=i<12?"REQUESTED":i%5===0?"COMPLETED":assignedProviderId?"ASSIGNED":"REQUESTED";
    const scheduledFor=status==="COMPLETED"?now.subtract(30+(i%120),"day"):now.add(2+(i%21),"day");
    const request=await prisma.medicalTransportRequest.create({
      data:{
        patientId:patient.id,
        mode,
        status,
        assistance:i%4===0?"WHEELCHAIR":i%7===0?"STRETCHER":"STANDARD",
        companionCount:i%3,
        equipment:i%6===0?["OXYGEN","MONITORING"]:[],
        scheduledFor:scheduledFor.toDate(),
        pickupLatitude:24.7136+(i%10)*0.001,
        pickupLongitude:46.6753+(i%10)*0.001,
        pickupAddress:`Synthetic Pickup ${i+1}, Riyadh`,
        destinationLatitude:24.7236+(i%10)*0.001,
        destinationLongitude:46.6853+(i%10)*0.001,
        destinationAddress:`Synthetic Destination ${i+1}, Riyadh`,
        callbackPhone:patient.phone,
        assignedProviderId,
        etaMinutes:assignedProviderId?20+(i%25):null,
        clientRequestId:`rich-transport-${i+1}`,
        assignedAt:assignedProviderId?now.subtract(1,"hour").toDate():null,
        completedAt:status==="COMPLETED"?scheduledFor.add(1,"hour").toDate():null,
        requestedAt:status==="COMPLETED"?scheduledFor.subtract(2,"day").toDate():now.subtract(i%3,"day").toDate(),
      },
    });
    await prisma.medicalTransportEvent.create({data:{transportRequestId:request.id,fromStatus:null,toStatus:"REQUESTED",occurredAt:request.requestedAt}});
    if(assignedProviderId&&status!=="REQUESTED"){
      await prisma.medicalTransportEvent.create({data:{transportRequestId:request.id,actorAccountId:SYSTEM_ACTOR,fromStatus:"REQUESTED",toStatus:"ASSIGNED",providerId:assignedProviderId,etaMinutes:20+(i%25),occurredAt:now.subtract(1,"hour").toDate()}});
    }
    if(status==="COMPLETED"){
      await prisma.medicalTransportEvent.create({data:{transportRequestId:request.id,actorAccountId:SYSTEM_ACTOR,fromStatus:"ASSIGNED",toStatus:"COMPLETED",providerId:assignedProviderId,occurredAt:scheduledFor.add(1,"hour").toDate()}});
    }
    if(mode==="AIR") air++; else ground++;
  }

  for(const [idx,providerId] of [...transport.ground,...transport.air].entries()){
    await prisma.transportUnit.create({
      data:{providerId,code:`UNIT-${pad3(idx+1)}`,registrationCode:`SYN-REG-${pad3(idx+1)}`,mode:transport.air.includes(providerId)?"AIR":"GROUND",capabilities:transport.air.includes(providerId)?["OXYGEN","MONITORING","VENTILATION"]:["OXYGEN","MONITORING"],active:true},
    });
  }

  for(let i=0;i<Math.min(18,patients.length);i++){
    const patient=patients[(i*7)%patients.length]!;
    const assignedProviderId=transport.emergency.length&&i%3!==0?transport.emergency[i%transport.emergency.length]!:null;
    const statuses=["REQUESTED","DISPATCHING","ASSIGNED","EN_ROUTE","ARRIVED","TRANSPORTING","COMPLETED"] as const;
    const status=statuses[i%statuses.length]!;
    await prisma.emergencyAmbulanceRequest.create({
      data:{
        patientId:patient.id,
        status,
        latitude:24.7136+(i%8)*0.001,
        longitude:46.6753+(i%8)*0.001,
        pickupAddress:`Synthetic Emergency Pickup ${i+1}, Riyadh`,
        callbackPhone:`+96655${String(8000000+i).slice(-7)}`,
        note:"Synthetic emergency workflow request.",
        assignedProviderId,
        etaMinutes:assignedProviderId?8+(i%15):null,
        requestedAt:now.subtract(i%12,"day").toDate(),
      },
    });
    emergency++;
  }
  return {ground,air,emergency};
}

async function main(){
  const config=requireSafety();
  console.log("Resetting all CarePoint application tables in the guarded non-production database...");
  const resetTables=await resetApplicationData();

  const admin=await createUser("admin.test","ADMIN",config,dayjs().subtract(HISTORY_DAYS,"day").toDate());
  await createUser("support.test","SUPPORT",config,dayjs().subtract(HISTORY_DAYS-3,"day").toDate());

  const reference=await seedReferenceData();
  const patients=await createPatients(config);
  const doctors=await createDoctors(config,reference.specialtyIds);
  const other=await createOtherProviders(config,reference.categoryIds);
  const pending=await createPendingOnboardings(config,reference.specialtyIds,reference.categoryIds);
  const allSchedulable=[...doctors,...other.schedulable];

  const slotCount=await createAvailability(allSchedulable,config);
  const appointments=await createAppointments(patients,allSchedulable,config);
  const clinical=await createClinicalData(patients,reference.metricVersions,doctors.length?doctors:allSchedulable,config);
  const availabilityRequests=await createAvailabilityRequests(patients,allSchedulable,config);
  const transport=await createTransportData(patients,other.transportProviders,config);

  const summary={
    resetTables,
    users:{
      patients:patients.length,
      doctors:doctors.length,
      otherProviders:PROVIDER_CATEGORIES.length*config.providersPerCategory,
      pendingDoctorApplicants:pending.doctorCount,
      pendingProviderApplicants:pending.providerCount,
      admin:admin.username,
    },
    catalogs:{
      medicalSpecialties:SPECIALTIES.length,
      providerCategories:PROVIDER_CATEGORIES.length,
      measurementUnits:UNITS.length,
      observationTypes:METRICS.length,
    },
    operations:{
      historyDays:HISTORY_DAYS,
      futureAppointmentDays:FUTURE_APPOINTMENT_DAYS,
      availabilityDays:AVAILABILITY_DAYS,
      historicalAppointments:appointments.historicalCount,
      futureAppointments:appointments.futureCount,
      futureAvailabilitySlots:slotCount,
      pendingAvailabilityRequests:availabilityRequests,
      transport,
    },
    clinical,
    loginExamples:{
      patient:"pac001",
      cardiologyDoctor:"dr001.CAR",
      dermatologyDoctor:"dr001.DER",
      nutritionProvider:"pr001.NUT",
      psychologyProvider:"pr001.PSI",
      passwordSource:"CAREPOINT_TEST_FIXTURE_PASSWORD",
    },
  };

  console.log("\nCarePoint rich synthetic test dataset created.");
  console.log(JSON.stringify(summary,null,2));
  console.log("\nAll synthetic fixture users use the password supplied in CAREPOINT_TEST_FIXTURE_PASSWORD.");
  console.log("No password value is printed by this script.");
}

main()
  .catch((error)=>{
    console.error(error instanceof Error?error.stack??error.message:"Rich synthetic fixture bootstrap failed.");
    process.exitCode=1;
  })
  .finally(async()=>{await prisma.$disconnect();});
