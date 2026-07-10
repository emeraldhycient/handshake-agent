import { z } from 'zod'
import { BuyCryptoIntentSchema, NoIntentSchema } from './buy-crypto.intent'
import { SellCryptoIntentSchema } from './sell-crypto.intent'
import { SendCryptoIntentSchema } from './send-crypto.intent'
import { ReceiveCryptoIntentSchema } from './receive-crypto.intent'
import { SwapIntentSchema } from './swap.intent'
import { BuyTicketIntentSchema } from './buy-ticket.intent'
import { CheckBalanceIntentSchema } from './check-balance.intent'
import { QueryTransactionsIntentSchema } from './query-transactions.intent'
import { GetRateIntentSchema } from './get-rate.intent'
import { ListRatesIntentSchema } from './list-rates.intent'

// Discriminated-union root — the only place IntentSchema is declared.
// The NLU layer emits one of these validated intent objects; consumers narrow on `action`.
export const IntentSchema = z.discriminatedUnion('action', [
  BuyCryptoIntentSchema,
  SellCryptoIntentSchema,
  SendCryptoIntentSchema,
  ReceiveCryptoIntentSchema,
  SwapIntentSchema,
  BuyTicketIntentSchema,
  CheckBalanceIntentSchema,
  QueryTransactionsIntentSchema,
  GetRateIntentSchema,
  ListRatesIntentSchema,
  NoIntentSchema,
])
export type Intent = z.infer<typeof IntentSchema>

export * from './buy-crypto.intent'
export * from './sell-crypto.intent'
export * from './send-crypto.intent'
export * from './receive-crypto.intent'
export * from './swap.intent'
export * from './buy-ticket.intent'
export * from './check-balance.intent'
export * from './query-transactions.intent'
export * from './get-rate.intent'
export * from './list-rates.intent'
