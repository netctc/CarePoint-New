import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import {
  AppointmentModalities,
  OtherProviderFamilies,
  type AppointmentModality,
  type MedicalSpecialty,
  type OtherProviderCategory,
  type OtherProviderFamily,
} from "@carepoint/contracts";
import { randomUUID } from "node:crypto";

interface CreateSpecialtyInput {
  code: string;
  name: string;
  parentId?: string | null;
}

interface CreateOtherProviderCategoryInput {
  slug: string;
  name: string;
  family: OtherProviderFamily;
  requiredCredentialTypes?: string[];
  enabledModalities?: AppointmentModality[];
}

class ProviderCatalogService {
  private readonly specialties: MedicalSpecialty[] = [
    { id: "spec-cardiology", code: "CARD", name: "Cardiology", parentId: null, active: true },
    { id: "spec-neurology", code: "NEUR", name: "Neurology", parentId: null, active: true },
    { id: "spec-pediatrics", code: "PED", name: "Pediatrics", parentId: null, active: true },
    { id: "spec-dermatology", code: "DERM", name: "Dermatology", parentId: null, active: true },
  ];

  private readonly otherCategories: OtherProviderCategory[] = [
    {
      id: "cat-nursing",
      slug: "nursing",
      name: "Nursing / ATS",
      family: "NON_DOCTOR_HEALTHCARE",
      active: true,
      requiredCredentialTypes: ["professional-license"],
      enabledModalities: ["CLINIC", "HOME_VISIT"],
    },
    {
      id: "cat-physiotherapy",
      slug: "physiotherapy",
      name: "Physiotherapy",
      family: "NON_DOCTOR_HEALTHCARE",
      active: true,
      requiredCredentialTypes: ["professional-license"],
      enabledModalities: ["CLINIC", "TELEMEDICINE", "HOME_VISIT"],
    },
    {
      id: "cat-emergency-ambulance",
      slug: "emergency-ambulance",
      name: "Emergency Ambulance",
      family: "EMERGENCY_AMBULANCE",
      active: true,
      requiredCredentialTypes: ["transport-license", "emergency-medical-license"],
      enabledModalities: [],
    },
    {
      id: "cat-air-medical-transport",
      slug: "air-medical-transport",
      name: "Air Medical Transport",
      family: "MEDICAL_TRANSPORT_AIR",
      active: true,
      requiredCredentialTypes: ["transport-license", "aviation-medical-approval"],
      enabledModalities: [],
    },
  ];

  listSpecialties(): MedicalSpecialty[] {
    return this.specialties;
  }

  addSpecialty(input: CreateSpecialtyInput): MedicalSpecialty {
    if (!input.code?.trim() || !input.name?.trim()) throw new Error("code and name are required");
    const specialty: MedicalSpecialty = {
      id: randomUUID(),
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      parentId: input.parentId ?? null,
      active: true,
    };
    this.specialties.push(specialty);
    return specialty;
  }

  listOtherCategories(): OtherProviderCategory[] {
    return this.otherCategories;
  }

  addOtherCategory(input: CreateOtherProviderCategoryInput): OtherProviderCategory {
    if (!(OtherProviderFamilies as readonly string[]).includes(input.family)) {
      throw new Error("Doctors cannot be added to the Other Provider taxonomy.");
    }
    const modalities = input.enabledModalities ?? [];
    for (const modality of modalities) {
      if (!(AppointmentModalities as readonly string[]).includes(modality)) {
        throw new Error(`Invalid modality: ${modality}`);
      }
    }
    const category: OtherProviderCategory = {
      id: randomUUID(),
      slug: input.slug.trim().toLowerCase(),
      name: input.name.trim(),
      family: input.family,
      active: true,
      requiredCredentialTypes: input.requiredCredentialTypes ?? [],
      enabledModalities: modalities,
    };
    this.otherCategories.push(category);
    return category;
  }
}

@Controller("doctors/specialties")
class DoctorSpecialtiesController {
  constructor(private readonly catalog: ProviderCatalogService) {}

  @Get()
  list() {
    return { domain: "DOCTORS_ALL_SPECIALTIES", items: this.catalog.listSpecialties() };
  }

  @Post()
  create(@Body() input: CreateSpecialtyInput) {
    return this.catalog.addSpecialty(input);
  }
}

@Controller("other-provider-categories")
class OtherProviderCategoriesController {
  constructor(private readonly catalog: ProviderCatalogService) {}

  @Get()
  list() {
    return { excludesDoctors: true, items: this.catalog.listOtherCategories() };
  }

  @Post()
  create(@Body() input: CreateOtherProviderCategoryInput) {
    return this.catalog.addOtherCategory(input);
  }
}

@Module({
  controllers: [DoctorSpecialtiesController, OtherProviderCategoriesController],
  providers: [ProviderCatalogService],
})
export class ProvidersModule {}
