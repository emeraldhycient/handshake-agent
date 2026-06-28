import { createZodDto } from 'nestjs-zod';
import { KycSubmitRequestSchema } from '@handshake-agent/contracts';

/**
 * Request DTO for POST /kyc/submit.
 * Derived from the shared contract schema — validated globally by ZodValidationPipe.
 */
export class KycSubmitDto extends createZodDto(KycSubmitRequestSchema) {}
