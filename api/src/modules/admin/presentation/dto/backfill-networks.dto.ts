import { createZodDto } from 'nestjs-zod';
import { BackfillNetworksRequestSchema } from '@handshake-agent/contracts';

/**
 * Validated Nest DTO for POST /admin/wallets/backfill-networks.
 *
 * Wraps the shared contract schema with nestjs-zod so the global
 * ZodValidationPipe validates the request body automatically.
 * The web admin UI imports the same underlying schema directly.
 */
export class BackfillNetworksDto extends createZodDto(
  BackfillNetworksRequestSchema,
) {}
