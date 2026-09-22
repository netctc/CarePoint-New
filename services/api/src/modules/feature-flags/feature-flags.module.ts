import {
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Injectable,
  Module,
  NestInterceptor,
  Param,
  Post,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import {
  FeatureFlagService,
  type CreateFeatureFlagInput,
  type PublishFeatureFlagVersionInput,
} from "./feature-flag.service";

const REQUIRED_FEATURE = "carepoint:required-feature";
export const RequireFeature = (featureKey: string) => SetMetadata(REQUIRED_FEATURE, featureKey);

@Injectable()
class FeatureFlagInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureFlagService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const featureKey = this.reflector.getAllAndOverride<string>(REQUIRED_FEATURE, [context.getHandler(), context.getClass()]);
    if (!featureKey) return next.handle();
    const request = context.switchToHttp().getRequest<{ principal?: AuthPrincipal }>();
    if (!request.principal) throw new UnauthorizedException("Authenticated principal is required for feature policy evaluation.");
    await this.features.assertEnabled(request.principal, featureKey);
    return next.handle();
  }
}

@Controller("admin/feature-flags")
@RequirePermissions("DATA_GOVERNANCE_MANAGE")
class FeatureFlagsAdminController {
  constructor(private readonly features: FeatureFlagService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.features.list();
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateFeatureFlagInput) {
    return this.features.create(principal, body);
  }

  @Post(":featureFlagId/versions")
  @Header("Cache-Control", "no-store")
  publish(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("featureFlagId") featureFlagId: string,
    @Body() body: PublishFeatureFlagVersionInput,
  ) {
    return this.features.publish(principal, featureFlagId, body);
  }
}

@Module({
  controllers: [FeatureFlagsAdminController],
  providers: [
    FeatureFlagService,
    { provide: APP_INTERCEPTOR, useClass: FeatureFlagInterceptor },
  ],
  exports: [FeatureFlagService],
})
export class FeatureFlagsModule {}
