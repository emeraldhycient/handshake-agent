import { z } from 'zod'
import { IdempotencyKeySchema, SupportedAssetSchema } from '../common'
import { QuoteBuyInputSchema } from '../tools/quote-buy.tool'

// Request/response DTOs for the web app's execute-buy endpoint. The request is
// the quote parameters the user explicitly confirmed, plus an idempotency key
// (PRD §4.3, NFR-7) and the authorizing quote id. PIN / step-up are carried
// separately (auth headers), never in the body.
export const CreateBuyOrderRequestSchema = QuoteBuyInputSchema.extend({
  quoteId: z.string().uuid(),
  idempotencyKey: IdempotencyKeySchema,
})
export type CreateBuyOrderRequest = z.infer<typeof CreateBuyOrderRequestSchema>

export const BuyOrderStatusSchema = z.enum([
  'pending',
  'collecting_fiat',
  'crediting_wallet',
  'completed',
  'rejected',
])
export type BuyOrderStatus = z.infer<typeof BuyOrderStatusSchema>

export const CreateBuyOrderResponseSchema = z.object({
  orderId: z.string().uuid(),
  status: BuyOrderStatusSchema,
  asset: SupportedAssetSchema,
  cryptoAmount: z.string(),
  createdAt: z.string().datetime(),
})
export type CreateBuyOrderResponse = z.infer<typeof CreateBuyOrderResponseSchema>
