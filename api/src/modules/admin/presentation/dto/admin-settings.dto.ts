import { createZodDto } from 'nestjs-zod';
import {
  SettingsQuerySchema,
  UpdateSettingRequestSchema,
} from '@handshake-agent/contracts';

/** Query DTO for GET /admin/settings (optional category filter). */
export class SettingsQueryDto extends createZodDto(SettingsQuerySchema) {}

/** Request DTO for PATCH /admin/settings/:key. */
export class UpdateSettingDto extends createZodDto(
  UpdateSettingRequestSchema,
) {}
