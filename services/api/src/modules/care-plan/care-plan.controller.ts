import { Body, Controller, Get, Header, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  CarePlanService,
  type CreateCarePlanInput,
  type TaskCompletionInput,
  type UpdateCarePlanInput,
  type UpdateGoalInput,
} from "./care-plan.service";

@Controller("patient/care-plans")
export class PatientCarePlanController {
  constructor(private readonly carePlans: CarePlanService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get()
  @Header("Cache-Control", "no-store")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.carePlans.listMine(principal);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get(":carePlanId/goals")
  @Header("Cache-Control", "no-store")
  goals(@CurrentPrincipal() principal: AuthPrincipal, @Param("carePlanId") carePlanId: string) {
    return this.carePlans.patientGoals(principal, carePlanId);
  }

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Get(":carePlanId/tasks")
  @Header("Cache-Control", "no-store")
  tasks(@CurrentPrincipal() principal: AuthPrincipal, @Param("carePlanId") carePlanId: string) {
    return this.carePlans.patientTasks(principal, carePlanId);
  }
}

@Controller("patient/care-tasks")
export class PatientCareTaskController {
  constructor(private readonly carePlans: CarePlanService) {}

  @RequirePermissions("PATIENT_READ_CLINICAL_RECORD")
  @Post(":taskId/completions")
  @Header("Cache-Control", "no-store")
  complete(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("taskId") taskId: string,
    @Body() body: TaskCompletionInput,
  ) {
    return this.carePlans.completePatientTask(principal, taskId, body);
  }
}

@Controller("provider")
export class ProviderCarePlanController {
  constructor(private readonly carePlans: CarePlanService) {}

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("patients/:patientId/care-plans")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.carePlans.providerList(principal, patientId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("patients/:patientId/care-plans")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateCarePlanInput,
  ) {
    return this.carePlans.createForDoctor(principal, patientId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Patch("care-plans/:carePlanId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("carePlanId") carePlanId: string,
    @Body() body: UpdateCarePlanInput,
  ) {
    return this.carePlans.updatePlan(principal, carePlanId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("care-plans/:carePlanId/goals")
  @Header("Cache-Control", "no-store")
  addGoal(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("carePlanId") carePlanId: string,
    @Body() body: any,
  ) {
    return this.carePlans.addGoal(principal, carePlanId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Patch("care-plans/:carePlanId/goals/:goalId")
  @Header("Cache-Control", "no-store")
  updateGoal(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("carePlanId") carePlanId: string,
    @Param("goalId") goalId: string,
    @Body() body: UpdateGoalInput,
  ) {
    return this.carePlans.updateGoal(principal, carePlanId, goalId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("care-plans/:carePlanId/tasks")
  @Header("Cache-Control", "no-store")
  addTask(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("carePlanId") carePlanId: string,
    @Body() body: any,
  ) {
    return this.carePlans.addTask(principal, carePlanId, body);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Get("care-plans/:carePlanId/progress")
  @Header("Cache-Control", "no-store")
  progress(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("carePlanId") carePlanId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.carePlans.progress(principal, carePlanId, from, to);
  }
}
