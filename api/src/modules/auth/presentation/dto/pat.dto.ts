import { createZodDto } from 'nestjs-zod';

import { CreatePatRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /profile/tokens. Derived from the shared contract —
 * validated globally by ZodValidationPipe. `scopes` defaults to ['read'];
 * the PIN is verified server-side through the lockout-protected PinService.
 */
export class CreatePatDto extends createZodDto(CreatePatRequestSchema) {}
