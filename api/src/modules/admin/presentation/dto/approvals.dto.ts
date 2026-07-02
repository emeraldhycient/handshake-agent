import { createZodDto } from 'nestjs-zod';

import {
  CreateChangeRequestSchema,
  RejectChangeRequestSchema,
} from '@handshake-agent/contracts';

/** Body DTO for POST /admin/approvals — raise a pending change request (maker). */
export class CreateChangeRequestDto extends createZodDto(
  CreateChangeRequestSchema,
) {}

/** Body DTO for POST /admin/approvals/:id/reject — a rejection with a reason. */
export class RejectChangeRequestDto extends createZodDto(
  RejectChangeRequestSchema,
) {}
