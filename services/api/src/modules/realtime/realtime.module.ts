import { Controller, Get, Header, Module, Query, Sse } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal } from "../../security/api-security.module";
import { RealtimeService, type RealtimeStreamQuery } from "./realtime.service";

@Controller("realtime")
class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get("topics")
  @Header("Cache-Control", "no-store")
  topics() {
    return {
      transport: "SSE",
      topics: [
        "CLINICAL_ALERTS",
        "QUESTIONNAIRE_COMPLETIONS",
        "OBSERVATIONS",
        "PROVIDER_JOB_STATUS",
      ],
      replayWindowSeconds: 600,
      payloadPolicy: "STRUCTURAL_METADATA_ONLY",
    };
  }

  @Sse("stream")
  @Header("Cache-Control", "no-store")
  @Header("X-Accel-Buffering", "no")
  stream(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: RealtimeStreamQuery,
  ) {
    return this.realtime.stream(principal, query);
  }
}

@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
