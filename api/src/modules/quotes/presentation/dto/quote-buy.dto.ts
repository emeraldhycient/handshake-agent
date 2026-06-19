import { createZodDto } from 'nestjs-zod';
import { QuoteBuyInputSchema } from '@handshake-agent/contracts';

/**
 * Request DTO derived from the shared contract schema — the body is validated by
 * the global ZodValidationPipe against the SAME schema the frontend and agent use.
 */
export class QuoteBuyDto extends createZodDto(QuoteBuyInputSchema) {}
