import { createZodDto } from 'nestjs-zod';
import { CreatePublicNicknameSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /profile/public-nicknames. `.strict()` (from the
 * shared schema). The alias is PayIdSchema-validated; the shared-namespace
 * check + ≤5 cap are enforced server-side by HandleService.
 */
export class CreatePublicNicknameDto extends createZodDto(
  CreatePublicNicknameSchema,
) {}
