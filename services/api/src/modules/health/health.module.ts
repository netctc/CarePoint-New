import { Controller, Get, Module, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.module";
import { RedisSecurityService } from "../../infrastructure/redis/redis-security.module";
import { releaseIdentity } from "../../infrastructure/release/release-identity";
import { Public } from "../../security/api-security.module";

@Controller("health")
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisSecurityService,
  ) {}

  @Public()
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "carepoint-api",
      architecture: "modular-monolith",
      release: releaseIdentity(process.env),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("ready")
  async getReadiness() {
    let database = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }
    const redis = await this.redis.ping();
    const payload = {
      status: database && redis ? "ready" : "not-ready",
      service: "carepoint-api",
      release: releaseIdentity(process.env),
      dependencies: { postgres: database, redis },
      timestamp: new Date().toISOString(),
    };
    if (!database || !redis) throw new ServiceUnavailableException(payload);
    return payload;
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
