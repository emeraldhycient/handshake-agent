import { createZodDto } from 'nestjs-zod';

import {
  WebhookListQuerySchema,
  WebhookRetryRequestSchema,
} from '@handshake-agent/contracts';

/** Query DTO for GET /admin/webhooks (provider/status/date filters + keyset). */
export class WebhookListQueryDto extends createZodDto(WebhookListQuerySchema) {}

/** Body DTO for POST /admin/webhooks/:id/retry (audited reason). */
export class WebhookRetryDto extends createZodDto(WebhookRetryRequestSchema) {}
