import { createZodDto } from 'nestjs-zod';
import { SumsubTokenRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /kyc/sumsub/token.
 * Derived from the shared contract schema — validated globally by ZodValidationPipe.
 */
export class SumsubTokenDto extends createZodDto(SumsubTokenRequestSchema) {}
