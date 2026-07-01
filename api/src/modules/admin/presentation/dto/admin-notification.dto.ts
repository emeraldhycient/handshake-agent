import { createZodDto } from 'nestjs-zod';
import {
  NotificationTemplateUpsertRequestSchema,
  NotificationTemplatePreviewRequestSchema,
  BroadcastSendRequestSchema,
} from '@handshake-agent/contracts';

/** Request DTO for POST/PATCH /admin/notification-templates. */
export class NotificationTemplateUpsertDto extends createZodDto(
  NotificationTemplateUpsertRequestSchema,
) {}

/** Request DTO for POST /admin/notification-templates/preview. */
export class NotificationTemplatePreviewDto extends createZodDto(
  NotificationTemplatePreviewRequestSchema,
) {}

/** Request DTO for POST /admin/notifications/broadcast. */
export class BroadcastSendDto extends createZodDto(
  BroadcastSendRequestSchema,
) {}
