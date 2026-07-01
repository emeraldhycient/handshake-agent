import { createZodDto } from 'nestjs-zod';

import {
  ApplyUserTagsRequestSchema,
  BulkMessageRequestSchema,
} from '@handshake-agent/contracts';

/** Body DTO for POST /admin/users/tags (bulk tag apply). */
export class ApplyUserTagsDto extends createZodDto(
  ApplyUserTagsRequestSchema,
) {}

/** Body DTO for POST /admin/users/message (bulk templated broadcast). */
export class BulkMessageDto extends createZodDto(BulkMessageRequestSchema) {}
