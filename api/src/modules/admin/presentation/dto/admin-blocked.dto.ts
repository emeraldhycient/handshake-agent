import { createZodDto } from 'nestjs-zod';

import {
  BlockedEntryCreateRequestSchema,
  BlockedEntrySupersedeRequestSchema,
} from '@handshake-agent/contracts';

/** Body DTO for POST /admin/blocked (kind + non-empty value + 3–500 char reason). */
export class BlockedEntryCreateDto extends createZodDto(
  BlockedEntryCreateRequestSchema,
) {}

/** Body DTO for POST /admin/blocked/:id/supersede (3–500 char reason). */
export class BlockedEntrySupersedeDto extends createZodDto(
  BlockedEntrySupersedeRequestSchema,
) {}
