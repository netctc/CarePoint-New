import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SiemAuditOutboxStoreService } from "./siem-audit-outbox-store.service";
import { SiemEventPresenterService } from "./siem-event-presenter.service";
import { SiemGatewayService } from "./siem-gateway.service";
import { SiemOutboxWorkerService } from "./siem-outbox-worker.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    SiemAuditOutboxStoreService,
    SiemEventPresenterService,
    SiemGatewayService,
    SiemOutboxWorkerService,
  ],
  exports: [SiemAuditOutboxStoreService, SiemOutboxWorkerService],
})
export class SiemExportModule {}
