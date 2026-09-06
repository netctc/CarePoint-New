import { Controller, Get, Module } from "@nestjs/common";

@Controller("health")
class HealthController {
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
