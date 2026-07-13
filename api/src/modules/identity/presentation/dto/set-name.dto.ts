import { createZodDto } from 'nestjs-zod';
import { SetNameRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /profile/name — the onboarding "what should we call
 * you?" step. Trims and requires non-empty firstName/lastName (max 80).
 */
export class SetNameDto extends createZodDto(SetNameRequestSchema) {}
