import { createZodDto } from 'nestjs-zod';
import { KycCompleteRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /kyc/complete.
 * Derived from the shared contract schema — validated globally by ZodValidationPipe.
 */
export class KycCompleteDto extends createZodDto(KycCompleteRequestSchema) {}
