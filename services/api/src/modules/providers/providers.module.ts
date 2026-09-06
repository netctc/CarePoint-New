import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import { AppointmentModalities, OtherProviderFamilies, type AppointmentModality, type LocalizedText, type MedicalSpecialty, type OtherProviderCategory, type OtherProviderFamily } from "@carepoint/contracts";
import { randomUUID } from "node:crypto";

interface CreateSpecialtyInput { code: string; labels: LocalizedText; parentId?: string | null; }
interface CreateOtherProviderCategoryInput { slug: string; labels: LocalizedText; family: OtherProviderFamily; requiredCredentialTypes?: string[]; enabledModalities?: AppointmentModality[]; }

class ProviderCatalogService {
  private readonly specialties: MedicalSpecialty[] = [
    { id: "spec-cardiology", code: "CARD", labels: { en: "Cardiology", ar: "أمراض القلب", fr: "Cardiologie", es: "Cardiología" }, parentId: null, active: true },
    { id: "spec-neurology", code: "NEUR", labels: { en: "Neurology", ar: "طب الأعصاب", fr: "Neurologie", es: "Neurología" }, parentId: null, active: true },
    { id: "spec-pediatrics", code: "PED", labels: { en: "Pediatrics", ar: "طب الأطفال", fr: "Pédiatrie", es: "Pediatría" }, parentId: null, active: true },
    { id: "spec-dermatology", code: "DERM", labels: { en: "Dermatology", ar: "الأمراض الجلدية", fr: "Dermatologie", es: "Dermatología" }, parentId: null, active: true },
  ];

  private readonly otherCategories: OtherProviderCategory[] = [
    { id: "cat-nursing", slug: "nursing", labels: { en: "Nursing / ATS", ar: "التمريض / ATS", fr: "Soins infirmiers / ATS", es: "Enfermería / ATS" }, family: "NON_DOCTOR_HEALTHCARE", active: true, requiredCredentialTypes: ["professional-license"], enabledModalities: ["CLINIC", "HOME_VISIT"] },
    { id: "cat-physiotherapy", slug: "physiotherapy", labels: { en: "Physiotherapy", ar: "العلاج الطبيعي", fr: "Physiothérapie", es: "Fisioterapia" }, family: "NON_DOCTOR_HEALTHCARE", active: true, requiredCredentialTypes: ["professional-license"], enabledModalities: ["CLINIC", "TELEMEDICINE", "HOME_VISIT"] },
    { id: "cat-emergency-ambulance", slug: "emergency-ambulance", labels: { en: "Emergency Ambulance", ar: "إسعاف طارئ", fr: "Ambulance d’urgence", es: "Ambulancia de urgencias" }, family: "EMERGENCY_AMBULANCE", active: true, requiredCredentialTypes: ["transport-license", "emergency-medical-license"], enabledModalities: [] },
    { id: "cat-air-medical-transport", slug: "air-medical-transport", labels: { en: "Air Medical Transport", ar: "نقل طبي جوي", fr: "Transport médical aérien", es: "Transporte médico aéreo" }, family: "MEDICAL_TRANSPORT_AIR", active: true, requiredCredentialTypes: ["transport-license", "aviation-medical-approval"], enabledModalities: [] },
  ];

  listSpecialties(): MedicalSpecialty[] { return this.specialties; }
  addSpecialty(input: CreateSpecialtyInput): MedicalSpecialty {
    if (!input.code?.trim() || !input.labels?.en?.trim() || !input.labels?.ar?.trim() || !input.labels?.fr?.trim() || !input.labels?.es?.trim()) throw new Error("code and EN/AR/FR/ES labels are required");
    const specialty: MedicalSpecialty = { id: randomUUID(), code: input.code.trim().toUpperCase(), labels: input.labels, parentId: input.parentId ?? null, active: true };
    this.specialties.push(specialty); return specialty;
  }
  listOtherCategories(): OtherProviderCategory[] { return this.otherCategories; }
  addOtherCategory(input: CreateOtherProviderCategoryInput): OtherProviderCategory {
    if (!input.slug?.trim() || !input.labels?.en?.trim() || !input.labels?.ar?.trim() || !input.labels?.fr?.trim() || !input.labels?.es?.trim()) throw new Error("slug and EN/AR/FR/ES labels are required");
    if (!(OtherProviderFamilies as readonly string[]).includes(input.family)) throw new Error("Doctors cannot be added to the Other Provider taxonomy.");
    const modalities = input.enabledModalities ?? [];
    for (const modality of modalities) if (!(AppointmentModalities as readonly string[]).includes(modality)) throw new Error(`Invalid modality: ${modality}`);
    const category: OtherProviderCategory = { id: randomUUID(), slug: input.slug.trim().toLowerCase(), labels: input.labels, family: input.family, active: true, requiredCredentialTypes: input.requiredCredentialTypes ?? [], enabledModalities: modalities };
    this.otherCategories.push(category); return category;
  }
}

@Controller("doctors/specialties")
class DoctorSpecialtiesController { constructor(private readonly catalog: ProviderCatalogService) {} @Get() list() { return { domain: "DOCTORS_ALL_SPECIALTIES", items: this.catalog.listSpecialties() }; } @Post() create(@Body() input: CreateSpecialtyInput) { return this.catalog.addSpecialty(input); } }
@Controller("other-provider-categories")
class OtherProviderCategoriesController { constructor(private readonly catalog: ProviderCatalogService) {} @Get() list() { return { excludesDoctors: true, items: this.catalog.listOtherCategories() }; } @Post() create(@Body() input: CreateOtherProviderCategoryInput) { return this.catalog.addOtherCategory(input); } }
@Module({ controllers: [DoctorSpecialtiesController, OtherProviderCategoriesController], providers: [ProviderCatalogService] })
export class ProvidersModule {}
