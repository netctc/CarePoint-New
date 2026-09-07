import { Body, Controller, Get, Module, Param, Patch, Post } from "@nestjs/common";
import type {
  AddCareParticipantInput,
  CreateCareConversationInput,
  RegisterNotificationEndpointInput,
  SendCareMessageInput,
  UpdateNotificationPreferencesInput,
} from "@carepoint/contracts";
import type { AuthPrincipal } from "@carepoint/identity";
import { CurrentPrincipal, RequirePermissions } from "../../security/api-security.module";
import { CommunicationsService } from "./communications.service";
import { MessagingEnvelopeService } from "./messaging-envelope.service";
import { NotificationGatewayService } from "./notification-gateway.service";
import { NotificationsService } from "./notifications.service";

@Controller("communications")
class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Get("conversations")
  list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.communications.listConversations(principal);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations")
  create(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: CreateCareConversationInput) {
    return this.communications.createConversation(principal, body);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Get("conversations/:conversationId")
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param("conversationId") conversationId: string) {
    return this.communications.getConversation(principal, conversationId);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations/:conversationId/messages")
  send(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("conversationId") conversationId: string,
    @Body() body: SendCareMessageInput,
  ) {
    return this.communications.sendMessage(principal, conversationId, body);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations/:conversationId/read")
  read(@CurrentPrincipal() principal: AuthPrincipal, @Param("conversationId") conversationId: string) {
    return this.communications.markRead(principal, conversationId);
  }

  @RequirePermissions("PATIENT_SECURE_MESSAGE", "PROVIDER_SECURE_MESSAGE")
  @Post("conversations/:conversationId/close")
  close(@CurrentPrincipal() principal: AuthPrincipal, @Param("conversationId") conversationId: string) {
    return this.communications.closeConversation(principal, conversationId);
  }

  @RequirePermissions("CARE_COORDINATION_MANAGE")
  @Post("conversations/:conversationId/participants")
  addParticipant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("conversationId") conversationId: string,
    @Body() body: AddCareParticipantInput,
  ) {
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

@Module({
  controllers: [CommunicationsController, NotificationsController],
  providers: [CommunicationsService, MessagingEnvelopeService, NotificationsService, NotificationGatewayService],
  exports: [NotificationsService],
})
export class CommunicationsModule {}
