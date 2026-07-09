import { createZodDto } from 'nestjs-zod';
import { ChangePinRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /profile/pin/change.
 * Derived from the shared contract schema — validated globally by
 * ZodValidationPipe. The NEW pin is held to TransactionPinSchema; the current
 * one is opaque (compared server-side through the lockout-protected PinService).
 */
export class ChangePinDto extends createZodDto(ChangePinRequestSchema) {}
