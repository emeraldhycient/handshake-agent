import { z } from 'zod'
import { FiatCurrencySchema, SupportedAssetSchema } from '../common'

// Rate-discovery tool I/O (Wave K). Read-only: `get_rate` / `list_rates` answer
// "what's the USDT→NGN rate?" and "show me every rate" for the agent + MCP
// surfaces. They move no money — pure display (root CLAUDE.md §3.1).

// A folded, spread-inclusive rate carried as a positive decimal STRING (the
// money-string convention — never round-trip a rate through a float on the way
// out). Up to 8 d.p. covers the 6-d.p. rate rounding the quote math produces
// with headroom. The raw spread bps are DELIBERATELY absent from this shape: the
// user surface sees one folded number per direction. The admin console keeps its
// per-bps view on a separate schema — never widen this to expose the spread.
export const RateAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, 'must be a positive decimal string')

// get_rate input — one pair. `fiatCurrency` is optional: the calling layer
// defaults to the catalog base fiat when the caller names none — never
// hardcoded here (§7), mirroring GetRateIntentSchema.
export const GetRateInputSchema = z.object({
  asset: SupportedAssetSchema,
  fiatCurrency: FiatCurrencySchema.optional(),
})
export type GetRateInput = z.infer<typeof GetRateInputSchema>

// The effective (spread-inclusive) rate for one (asset, fiat) pair, BOTH
// directions. Each rate is the base market rate folded with the SAME spread the
// matching buy/sell quote applies, so the displayed number equals what the
// engine transacts at.
export const EffectiveRateSchema = z.object({
  asset: SupportedAssetSchema,
  fiatCurrency: FiatCurrencySchema,
  // What a BUYER effectively pays per 1 unit of crypto (base marked UP by the
  // buy spread).
  buyRate: RateAmountSchema,
  // What a SELLER effectively receives per 1 unit of crypto (base marked DOWN by
  // the sell spread).
  sellRate: RateAmountSchema,
  // 'live' when a fresh live-feed rate priced the pair; 'config' when the admin
  // config floor did (feed kill-switch off, stale, degraded, or a cold store).
  source: z.enum(['live', 'config']),
  asOf: z.string().datetime(),
})
export type EffectiveRate = z.infer<typeof EffectiveRateSchema>

// list_rates input — no parameters; returns every enabled, tradeable, priced pair.
export const ListRatesInputSchema = z.object({})
export type ListRatesInput = z.infer<typeof ListRatesInputSchema>

export const RateListResponseSchema = z.object({
  rates: z.array(EffectiveRateSchema),
})
export type RateListResponse = z.infer<typeof RateListResponseSchema>
