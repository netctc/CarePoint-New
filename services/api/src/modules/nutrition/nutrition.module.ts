import { createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Injectable,
  Module,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { DatabaseAuditService } from "../../infrastructure/audit/audit.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { ProviderCategoryCapabilityService } from "../providers/provider-category-capability.service";
import { ProvidersModule } from "../providers/providers.module";

const CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,180}$/;
const MAX_HISTORY = 1000;
const LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 30;
const MAX_BACKDATE_DAYS = 365;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

type AnthropometryInput = {
  appointmentId?: unknown;
  idempotencyKey?: unknown;
  measurementCode?: unknown;
  value?: unknown;
  unit?: unknown;
  measuredAt?: unknown;
};

type NormalizedMeasurement = {
  sourceValue: number;
  sourceUnit: string;
  normalizedValue: number;
  normalizedUnit: "kg" | "cm" | "%" | "kg/m2" | "1";
};

@Injectable()
class NutritionAnthropometryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DatabaseAuditService,
    private readonly capabilities: ProviderCategoryCapabilityService,
  ) {}

  async record(principal: AuthPrincipal, input: AnthropometryInput) {
    const context = await this.requireNutritionCapability(principal);
    const appointmentId = this.requiredId(input?.appointmentId, "appointmentId");
    const appointment = await this.requireAppointment(context.providerId, appointmentId);
    const idempotencyKey = this.idempotencyKey(input?.idempotencyKey);
    const measurementCode = this.measurementCode(input?.measurementCode);
    const normalized = this.normalize(input?.value, input?.unit);
    const measuredAt = this.measurementDate(input?.measuredAt);
    const requestDigest = createHash("sha256")
      .update(JSON.stringify({
        providerId: context.providerId,
        patientId: appointment.patientId,
        appointmentId,
        measurementCode,
        sourceValue: normalized.sourceValue,
        sourceUnit: normalized.sourceUnit,
        normalizedValue: normalized.normalizedValue,
        normalizedUnit: normalized.normalizedUnit,
        measuredAt: measuredAt.toISOString(),
      }))
      .digest("hex");

    const existing = await this.prisma.anthropometricMeasurement.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new ConflictException("idempotencyKey was already used with different anthropometry content.");
      }
      if (existing.providerId !== context.providerId || existing.patientId !== appointment.patientId) {
        throw new ConflictException("idempotencyKey belongs to another provider or patient context.");
      }
      return this.present(existing);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const measurement = await tx.anthropometricMeasurement.create({
        data: {
          idempotencyKey,
          requestDigest,
          patientId: appointment.patientId,
          providerId: context.providerId,
          appointmentId: appointment.id,
          measurementCode,
          sourceValue: normalized.sourceValue,
          sourceUnit: normalized.sourceUnit,
          normalizedValue: normalized.normalizedValue,
          normalizedUnit: normalized.normalizedUnit,
          measuredAt,
        },
      });
      await this.audit.writeClinicalInTransaction(tx, {
        actorId: principal.accountId,
        action: "NUTRITION_ANTHROPOMETRY_RECORDED",
        objectType: "ANTHROPOMETRIC_MEASUREMENT",
        objectId: measurement.id,
        purpose: "TREATMENT",
        result: "SUCCESS",
        metadata: {
          domain: "NUTRITION",
          providerId: context.providerId,
          patientId: appointment.patientId,
          resourceId: measurement.id,
          measurementCode,
          normalizedUnit: normalized.normalizedUnit,
          origin: "PROVIDER_RECORDED",
          decision: "ALLOW",
        },
      });
      return measurement;
    });

    return this.present(created);
  }

  async history(principal: AuthPrincipal, patientId: string, rawMeasurementCode?: string) {
    const context = await this.requireNutritionCapability(principal);
    const patient = this.requiredId(patientId, "patientId");
    await this.requirePatientAccess(context.providerId, patient);
    const measurementCode = rawMeasurementCode?.trim()
      ? this.measurementCode(rawMeasurementCode)
      : null;
    const items = await this.prisma.anthropometricMeasurement.findMany({
      where: {
        patientId: patient,
        providerId: context.providerId,
        ...(measurementCode ? { measurementCode } : {}),
      },
      orderBy: [{ measuredAt: "asc" }, { createdAt: "asc" }],
      take: MAX_HISTORY,
    });
    await this.audit.writeClinical({
      actorId: principal.accountId,
      action: "NUTRITION_ANTHROPOMETRY_HISTORY_READ",
      objectType: "PATIENT",
      objectId: patient,
      purpose: "TREATMENT",
      result: "SUCCESS",
      metadata: {
        domain: "NUTRITION",
        providerId: context.providerId,
        patientId: patient,
        measurementCode,
        itemCount: items.length,
        decision: "ALLOW",
      },
    });
    return {
      patientId: patient,
      measurementCode,
      graphReady: true,
      unitsNormalized: true,
      preservesSourceUnit: true,
      automatedClinicalInference: false,
      items: items.map((item) => this.present(item)),
    };
  }

  private async requireNutritionCapability(principal: AuthPrincipal) {
    const context = await this.capabilities.workspaceContext(principal);
    if (!context.clinicalOrderCapabilities.has("NUTRITION")) {
      throw new ForbiddenException("Other Provider category is not authorized for NUTRITION.");
    }
    return context;
  }

  private async requireAppointment(providerId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        providerId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { id: true, patientId: true, startsAt: true, status: true },
    });
    if (!appointment) throw new ForbiddenException("Authorized nutrition appointment context is required.");
    return appointment;
  }

  private async requirePatientAccess(providerId: string, patientId: string) {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
    const relationship = await this.prisma.appointment.findFirst({
      where: {
        providerId,
        patientId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: from, lte: to },
      },
      select: { id: true },
    });
    if (!relationship) throw new ForbiddenException("Current nutrition treatment relationship is required.");
  }

  private normalize(rawValue: unknown, rawUnit: unknown): NormalizedMeasurement {
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue <= 0 || rawValue > 1000000) {
      throw new BadRequestException("value must be a positive finite number no greater than 1000000.");
    }
    if (typeof rawUnit !== "string" || !rawUnit.trim()) throw new BadRequestException("unit is required.");
    const unit = rawUnit.trim().toLowerCase().replaceAll("²", "2");
    const conversions: Record<string, { unit: NormalizedMeasurement["normalizedUnit"]; factor: number; source: string }> = {
      kg: { unit: "kg", factor: 1, source: "kg" },
      g: { unit: "kg", factor: 0.001, source: "g" },
      lb: { unit: "kg", factor: 0.45359237, source: "lb" },
      lbs: { unit: "kg", factor: 0.45359237, source: "lb" },
      cm: { unit: "cm", factor: 1, source: "cm" },
      mm: { unit: "cm", factor: 0.1, source: "mm" },
      m: { unit: "cm", factor: 100, source: "m" },
      in: { unit: "cm", factor: 2.54, source: "in" },
      inch: { unit: "cm", factor: 2.54, source: "in" },
      inches: { unit: "cm", factor: 2.54, source: "in" },
      "%": { unit: "%", factor: 1, source: "%" },
      percent: { unit: "%", factor: 1, source: "%" },
      pct: { unit: "%", factor: 1, source: "%" },
      "kg/m2": { unit: "kg/m2", factor: 1, source: "kg/m2" },
      "kg/m^2": { unit: "kg/m2", factor: 1, source: "kg/m2" },
      "1": { unit: "1", factor: 1, source: "1" },
      ratio: { unit: "1", factor: 1, source: "1" },
    };
    const conversion = conversions[unit];
    if (!conversion) {
      throw new BadRequestException("unit must be a supported mass, length, percentage, BMI or ratio unit.");
    }
    const normalizedValue = Number((rawValue * conversion.factor).toFixed(6));
    return {
      sourceValue: rawValue,
      sourceUnit: conversion.source,
      normalizedValue,
      normalizedUnit: conversion.unit,
    };
  }

  private present(item: {
    id: string;
    patientId: string;
    providerId: string;
    appointmentId: string;
    measurementCode: string;
    sourceValue: number;
    sourceUnit: string;
    normalizedValue: number;
    normalizedUnit: string;
    measuredAt: Date;
    createdAt: Date;
  }) {
    return {
      id: item.id,
      patientId: item.patientId,
      providerId: item.providerId,
      appointmentId: item.appointmentId,
      measurementCode: item.measurementCode,
      value: item.normalizedValue,
      unit: item.normalizedUnit,
      source: {
        value: item.sourceValue,
        unit: item.sourceUnit,
        origin: "PROVIDER_RECORDED",
      },
      measuredAt: item.measuredAt,
      createdAt: item.createdAt,
      automatedClinicalInference: false,
    };
  }

  private requiredId(value: unknown, field: string): string {
    if (typeof value !== "string" || !SAFE_ID.test(value.trim())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return value.trim();
  }

  private measurementCode(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("measurementCode is required.");
    const normalized = value.trim().toUpperCase();
    if (!CODE.test(normalized)) throw new BadRequestException("measurementCode is invalid.");
    return normalized;
  }

  private idempotencyKey(value: unknown): string {
    if (typeof value !== "string") throw new BadRequestException("idempotencyKey is required.");
    const normalized = value.trim();
    if (normalized.length < 8 || normalized.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) {
      throw new BadRequestException("idempotencyKey must contain 8-128 safe characters.");
    }
    return normalized;
  }

  private measurementDate(value: unknown): Date {
    const date = value == null ? new Date() : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException("measuredAt must be a valid timestamp.");
    const now = Date.now();
    if (date.getTime() > now + FUTURE_TOLERANCE_MS) throw new BadRequestException("measuredAt cannot be in the future.");
    if (date.getTime() < now - MAX_BACKDATE_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`measuredAt cannot be backdated more than ${MAX_BACKDATE_DAYS} days.`);
    }
    return date;
  }
}

@Controller("provider/nutrition/anthropometrics")
class NutritionAnthropometryController {
  constructor(private readonly anthropometry: NutritionAnthropometryService) {}

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: Record<string, unknown>) {
    return this.anthropometry.record(principal, body);
  }

  @RequirePermissions("OTHER_PROVIDER_CLINICAL_WORKSPACE")
  @Get("patients/:patientId")
  @Header("Cache-Control", "no-store")
  history(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Query("measurementCode") measurementCode?: string,
  ) {
    return this.anthropometry.history(principal, patientId, measurementCode);
  }
}

@Module({
  imports: [ProvidersModule],
  controllers: [NutritionAnthropometryController],
  providers: [NutritionAnthropometryService],
})
export class NutritionModule {}
