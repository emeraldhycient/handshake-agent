import { createZodDto } from 'nestjs-zod';
import { BackfillNetworksRequestSchema } from '@handshake-agent/contracts';

/**
 * Validated Nest DTO for POST /admin/wallets/backfill-networks (BQ-2 async variant).
 *
 * Same underlying contract schema as the sync endpoint — same request body shape,
 * but the response changes to { runId } / HTTP 202 (async) instead of BackfillReport.
 */
export class EnqueueBackfillDto extends createZodDto(
  BackfillNetworksRequestSchema,
) {}
