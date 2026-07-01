import { createZodDto } from 'nestjs-zod';
import { SetPinRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /kyc/pin.
 * Derived from the shared contract schema — validated globally by ZodValidationPipe.
 * The strength rule (4–6 digits, not trivial) is enforced by TransactionPinSchema.
 */
export class SetPinDto extends createZodDto(SetPinRequestSchema) {}
