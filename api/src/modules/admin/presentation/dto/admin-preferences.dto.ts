import { createZodDto } from 'nestjs-zod';
import { AdminPreferencesUpdateRequestSchema } from '@handshake-agent/contracts';

/** Request DTO for PATCH /admin/me/preferences (full-state replace of the toggles). */
export class UpdateAdminPreferencesDto extends createZodDto(
  AdminPreferencesUpdateRequestSchema,
) {}
