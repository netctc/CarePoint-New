import { Body, Controller, ForbiddenException, Get, Header, Module, Param, Patch, Post } from "@nestjs/common";
import type {
  AddCareParticipantInput,
  CreateCareConversationInput,
  RegisterNotificationEndpointInput,
  SendCareMessageInput,
  UpdateNotificationPreferencesInput,
} from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { AppointmentNotificationOrchestratorService } from "./appointment-notification-orchestrator.service";
import { CareMembershipAccessService } from "./care-membership-access.service";
import { CommunicationsService } from "./communications.service";
import { MessagingEnvelopeService } from "./messaging-envelope.service";
import { NotificationGatewayService } from "./notification-gateway.service";
import { NotificationOutboxStoreService } from "./notification-outbox-store.service";
import { NotificationOutboxWorkerService } from "./notification-outbox-worker.service";
import {
  NotificationTemplateService,
  type CreateNotificationTemplateInput,
  type PublishNotificationTemplateVersionInput,
} from "./notification-template.service";
import { NotificationsService } from "./notifications.service";

type SecureContactInput = {
  appointmentId: string;
  subject: string;
  initialMessage?: string;
  clientContactId: string;
};

@Controller("communications")
class CommunicationsController {
  constructor(
    private readonly communications: CommunicationsService,
    private readonly access: CareMembershipAccessService,
  ) {}

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Get("conversations")
  async list(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.access.pruneForAccount(principal.accountId);
    return this.communications.listConversations(principal);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateCareConversationInput) {
    return this.communications.createConversation(principal, body);
  }

  @RequirePermissions("PROVIDER_SECURE_MESSAGE")
  @Post("secure-contact")
  secureContact(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: SecureContactInput,
  ) {
    if (principal.role !== "OTHER_PROVIDER") {
      throw new ForbiddenException("Contextual secure contact is limited to Other Provider workflows.");
    }
    return this.communications.createConversation(principal, {
      appointmentId: body.appointmentId,
      subject: body.subject,
      initialMessage: body.initialMessage ?? "",
      clientConversationId: body.clientContactId,
    });
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Get("conversations/:conversationId")
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param("conversationId") conversationId: string) {
    await this.access.pruneConversation(conversationId);
    await this.access.assertActiveAccess(principal, conversationId);
    return this.communications.getConversation(principal, conversationId);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations/:conversationId/messages")
  async send(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("conversationId") conversationId: string,
    @Body() body: SendCareMessageInput,
  ) {
    await this.access.pruneConversation(conversationId);
    await this.access.assertActiveAccess(principal, conversationId);
    return this.communications.sendMessage(principal, conversationId, body);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations/:conversationId/read")
  async read(@CurrentPrincipal() principal: AuthPrincipal, @Param("conversationId") conversationId: string) {
    await this.access.pruneConversation(conversationId);
    await this.access.assertActiveAccess(principal, conversationId);
    return this.communications.markRead(principal, conversationId);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations/:conversationId/close")
  async close(@CurrentPrincipal() principal: AuthPrincipal, @Param("conversationId") conversationId: string) {
    await this.access.pruneConversation(conversationId);
    await this.access.assertActiveAccess(principal, conversationId);
    return this.communications.closeConversation(principal, conversationId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("conversations/:conversationId/participants")
  async addParticipant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("conversationId") conversationId: string,
    @Body() body: AddCareParticipantInput,
  ) {
    await this.access.pruneConversation(conversationId);
    await this.access.assertActiveAccess(principal, conversationId);
    return this.communications.addCareParticipant(principal, conversationId, body);
  }
}

@Controller("notifications")
class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @RequirePermissions("SELF_NOTIFICATION_MANAGE")
  @Get("preferences")
  preferences(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notifications.preferences(principal);
  }

  @RequirePermissions("SELF_NOTIFICATION_MANAGE")
  @Patch("preferences")
  updatePreferences(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: UpdateNotificationPreferencesInput) {
    return this.notifications.updatePreferences(principal, body);
  }

  @RequirePermissions("SELF_NOTIFICATION_MANAGE")
  @Get("endpoints")
  endpoints(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notifications.endpoints(principal);
  }

  @RequirePermissions("SELF_NOTIFICATION_MANAGE")
  @Post("endpoints")
  registerEndpoint(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: RegisterNotificationEndpointInput) {
    return this.notifications.registerEndpoint(principal, body);
  }

  @RequirePermissions("SELF_NOTIFICATION_MANAGE")
  @Post("endpoints/:endpointId/deactivate")
  deactivateEndpoint(@CurrentPrincipal() principal: AuthPrincipal, @Param("endpointId") endpointId: string) {
    return this.notifications.deactivateEndpoint(principal, endpointId);
  }

  @RequirePermissions("SELF_NOTIFICATION_MANAGE")
  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.notifications.list(principal);
  }

  @RequirePermissions("SELF_NOTIFICATION_MANAGE")
  @Post(":notificationId/read")
  markRead(@CurrentPrincipal() principal: AuthPrincipal, @Param("notificationId") notificationId: string) {
    return this.notifications.markRead(principal, notificationId);
  }
}

@Controller("admin/notification-templates")
class AdminNotificationTemplateController {
  constructor(private readonly templates: NotificationTemplateService) {}

  @RequirePermissions("NOTIFICATION_OPERATE")
  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.templates.list();
  }

  @RequirePermissions("NOTIFICATION_OPERATE")
  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CreateNotificationTemplateInput,
  ) {
    return this.templates.create(principal, body);
  }

  @RequirePermissions("NOTIFICATION_OPERATE")
  @Post(":templateId/versions")
  @Header("Cache-Control", "no-store")
  publish(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("templateId") templateId: string,
    @Body() body: PublishNotificationTemplateVersionInput,
  ) {
    return this.templates.publishVersion(principal, templateId, body);
  }
}

@Module({
  controllers: [CommunicationsController, NotificationsController, AdminNotificationTemplateController],
  providers: [
    CommunicationsService,
    CareMembershipAccessService,
    MessagingEnvelopeService,
    NotificationsService,
    NotificationTemplateService,
    NotificationGatewayService,
    NotificationOutboxStoreService,
    NotificationOutboxWorkerService,
    AppointmentNotificationOrchestratorService,
  ],
  exports: [NotificationsService, NotificationTemplateService],
})
export class CommunicationsModule {}
