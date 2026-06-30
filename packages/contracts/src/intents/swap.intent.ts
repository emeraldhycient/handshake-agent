import { z } from 'zod'
import { CryptoAmountSchema, SupportedAssetSchema } from '../common'

// The NLU layer emits this validated intent — not a transaction; the engine
// re-validates and executes (CLAUDE.md §3.1).
//
// IMPORTANT: This must be a PLAIN z.object with NO .refine() / .superRefine().
// A .refine()'d schema becomes a ZodEffects instance, which breaks membership
// in z.discriminatedUnion('action', [...]) at module-eval time with:
//   "Cannot read properties of undefined (reading 'action')"
// Enforce fromAsset !== toAsset in the ENGINE (createSwapProposal) — not here.
export const SwapIntentSchema = z.object({
  action: z.literal('swap'),
  fromAsset: SupportedAssetSchema,
  toAsset: SupportedAssetSchema,
  amount: CryptoAmountSchema,
})
export type SwapIntent = z.infer<typeof SwapIntentSchema>
