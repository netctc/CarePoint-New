import { Controller, Get, Module, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import { KmsReadinessService } from "../../infrastructure/security/kms-readiness.service";
import { Public } from "../../security/api-security.module";

@Controller("health")
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisSecurityService,
    private readonly kms: KmsReadinessService,
  ) {}

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

  @Public()
  @Get("ready")
  async getReadiness() {
    let database = false;
    let redis = false;
    let kms = false;
    let kmsRequired = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }
    try {
      redis = await this.redis.ping();
    } catch {
      redis = false;
    }
    try {
      const kmsResult = await this.kms.check();
      kms = kmsResult.ready;
      kmsRequired = kmsResult.required;
    } catch {
      kms = false;
      try {
        kmsRequired = this.kms.validateConfiguration().required;
      } catch {
        kmsRequired = process.env.NODE_ENV === "production";
      }
    }

    const ready = database && redis && kms;
    const payload = {
      status: ready ? "ready" : "not-ready",
      service: "carepoint-api",
      dependencies: { postgres: database, redis, kms },
      kms: { required: kmsRequired },
      timestamp: new Date().toISOString(),
    };
    if (!ready) throw new ServiceUnavailableException(payload);
    return payload;
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
