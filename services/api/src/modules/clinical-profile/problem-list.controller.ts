import { Body, Controller, Get, Header, Param, Patch, Post } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  ProblemListService,
  type CreateProblemInput,
  type UpdateProblemInput,
} from "./problem-list.service";

@Controller("doctor/patients")
export class DoctorProblemListController {
  constructor(private readonly problems: ProblemListService) {}

  @RequirePermissions("CLINICAL_PROFILE_READ")
  @Get(":patientId/clinical-profile/conditions")
  @Header("Cache-Control", "no-store")
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
  ) {
    return this.problems.listForDoctor(principal, patientId);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Post(":patientId/clinical-profile/conditions")
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Body() body: CreateProblemInput,
  ) {
    return this.problems.createForDoctor(principal, patientId, body);
  }

  @RequirePermissions("CLINICAL_PROFILE_WRITE")
  @Patch(":patientId/clinical-profile/conditions/:entryId")
  @Header("Cache-Control", "no-store")
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("patientId") patientId: string,
    @Param("entryId") entryId: string,
    @Body() body: UpdateProblemInput,
  ) {
    return this.problems.updateForDoctor(principal, patientId, entryId, body);
  }
}
