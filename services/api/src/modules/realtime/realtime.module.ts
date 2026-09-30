import { Controller, Get, Header, Module, Query, Sse } from "@nestjs/common";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal } from "../../security/api-security.module";
import { RequireFeature } from "../feature-flags/feature-flags.module";
import {
  REALTIME_TOPICS,
  RealtimeService,
  type RealtimeStreamQuery,
} from "./realtime.service";

@Controller("realtime")
@RequireFeature("V2_REALTIME")
class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get("topics")
  @Header("Cache-Control", "no-store")
  topics() {
    return {
      transport: "SSE",
      topics: REALTIME_TOPICS,
      replayWindowSeconds: 600,
      payloadPolicy: "STRUCTURAL_METADATA_ONLY",
      transportCoordinatesInStream: false,
      transportRealtimeRequiresRequestScope: true,
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
