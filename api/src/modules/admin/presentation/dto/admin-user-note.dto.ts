import { createZodDto } from 'nestjs-zod';

import { AdminUserNoteCreateRequestSchema } from '@handshake-agent/contracts';

/** Body DTO for POST /admin/users/:id/notes (create a free-text case note). */
export class AdminUserNoteCreateDto extends createZodDto(
  AdminUserNoteCreateRequestSchema,
) {}
