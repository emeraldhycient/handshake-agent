import { createZodDto } from 'nestjs-zod';

import {
  AdminCustomFiatCreateRequestSchema,
  AdminCustomFiatUpdateRequestSchema,
} from '@handshake-agent/contracts';

/** Body DTO for POST /admin/config/currencies (code + display metadata). */
export class AdminCustomFiatCreateDto extends createZodDto(
  AdminCustomFiatCreateRequestSchema,
) {}

/** Body DTO for PATCH /admin/config/currencies/:code (enabled and/or metadata). */
export class AdminCustomFiatUpdateDto extends createZodDto(
  AdminCustomFiatUpdateRequestSchema,
) {}
