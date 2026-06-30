import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Request body for POST /admin/wallets/reconcile.
 *
 * `userId` — the user whose wallets should be reconciled across all enabled assets.
 */
export const ReconcileWalletRequestSchema = z.object({
  /** UUID of the user to reconcile. */
  userId: z.string().uuid('userId must be a valid UUID'),
});

export class ReconcileWalletDto extends createZodDto(
  ReconcileWalletRequestSchema,
) {}
