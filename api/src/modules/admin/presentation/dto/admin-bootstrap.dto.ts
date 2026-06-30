import { createZodDto } from 'nestjs-zod';
import { AdminBootstrapRequestSchema } from '@handshake-agent/contracts';

/** Request DTO for POST /admin/bootstrap (first super_admin invitation). */
export class AdminBootstrapDto extends createZodDto(
  AdminBootstrapRequestSchema,
) {}
