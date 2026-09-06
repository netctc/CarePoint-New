import { Controller, Get, Module } from "@nestjs/common";
import { Public } from "../../security/api-security.module";

@Controller("health")
class HealthController {
  @Public()
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "carepoint-api",
      architecture: "modular-monolith",
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
