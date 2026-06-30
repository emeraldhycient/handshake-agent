import { z } from "zod"

// ─── Enums ────────────────────────────────────────────────────────────────────

export const ChatActionSchema = z.enum([
  "buy",
  "sell",
  "send",
  "receive",
  "swap",
  "ticket",
  "balance",
])
export type ChatAction = z.infer<typeof ChatActionSchema>

/** "m" = mobile chat thread, "d" = desktop chat rail */
export const ChatSurfaceSchema = z.enum(["m", "d"])
export type ChatSurface = z.infer<typeof ChatSurfaceSchema>

// ─── Shared sub-shapes ────────────────────────────────────────────────────────

export const QuoteRowSchema = z.object({
  label: z.string(),
  value: z.string(),
})
export type QuoteRow = z.infer<typeof QuoteRowSchema>

// ─── View-model schemas (standalone — NOT in the message union) ────────────────

/**
 * ConfirmPayload is NOT a chat message kind — it is used by the confirm
 * overlay/sheet and the Zustand store. Export as its own schema + type.
 */
export const ConfirmPayloadSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  heroLabel: z.string(),
  heroAmount: z.string(),
  heroSub: z.string(),
  toLabel: z.string().optional(),
  toValue: z.string().optional(),
  warn: z.string().optional(),
  rows: z.array(QuoteRowSchema),
  totalLabel: z.string(),
  totalValue: z.string(),
  cta: z.string(),
  action: ChatActionSchema,
  // meta carries ticket tier/total etc.
  meta: z.record(z.string()).optional(),
  /**
   * ISO 8601 expiry timestamp for the underlying proposal. When present, the
   * confirm sheet/overlay drives its live countdown from this (a swap quote
   * locks for a short window) — matching the QuoteView/SwapView pattern. Absent
   * on flows whose quote does not expire (e.g. the mock path).
   */
  expiresAt: z.string().optional(),
})
export type ConfirmPayload = z.infer<typeof ConfirmPayloadSchema>

// ─── Message kind objects ─────────────────────────────────────────────────────

// Shared base fields present on every message in the union.
const MessageBaseSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
})

// text
export const TextViewSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
})
export type TextView = { kind: "text"; text: string }

// quote  — includes `action` so shells know which confirm builder to invoke.
// `expiresAt` is an ISO string from the server (proposal's expiry); the quote
// card drives its live countdown from this. `lockSeconds` is kept for the mock
// / offline flow which doesn't have a server-issued expiry.
export const QuoteViewSchema = z.object({
  kind: z.literal("quote"),
  action: ChatActionSchema,
  receiveAmt: z.string(),
  receiveSub: z.string(),
  rows: z.array(QuoteRowSchema),
  totalLabel: z.string(),
  totalValue: z.string(),
  lockSeconds: z.number(),
  /** ISO datetime string — the proposal's server-issued expiry. Drives the live countdown. */
  expiresAt: z.string().optional(),
})
export type QuoteView = z.infer<typeof QuoteViewSchema>

// receipt
export const ReceiptViewSchema = z.object({
  kind: z.literal("receipt"),
  title: z.string(),
  subtitle: z.string(),
  amount: z.string(),
  rows: z.array(QuoteRowSchema),
  txRef: z.string(),
})
export type ReceiptView = z.infer<typeof ReceiptViewSchema>

// balance — AssetView is also a named export for wallet.ts to extend
export const AssetViewSchema = z.object({
  sym: z.string(),
  name: z.string(),
  amount: z.string(),
  value: z.string(),
  tint: z.string(),
  // Optional logo URL from the wallet provider; AssetIcon falls back to the
  // tinted text badge when absent or on image load error.
  logoUrl: z.string().optional(),
})
export type AssetView = z.infer<typeof AssetViewSchema>

export const BalanceViewSchema = z.object({
  kind: z.literal("balance"),
  total: z.string(),
  assets: z.array(AssetViewSchema),
})
export type BalanceView = z.infer<typeof BalanceViewSchema>

// receive (deposit address)
export const DepositViewSchema = z.object({
  kind: z.literal("receive"),
  asset: z.string(),
  network: z.string(),
  address: z.string(),
  minDeposit: z.string(),
  creditedEta: z.string(),
})
export type DepositView = z.infer<typeof DepositViewSchema>

// tickets
export const TicketOptionSchema = z.object({
  tier: z.string(),
  perk: z.string(),
  price: z.string(),
  left: z.string(),
  total: z.string(),
})
export type TicketOption = z.infer<typeof TicketOptionSchema>

export const TicketsViewSchema = z.object({
  kind: z.literal("tickets"),
  eventMeta: z.string(),
  eventName: z.string(),
  options: z.array(TicketOptionSchema),
})
export type TicketsView = z.infer<typeof TicketsViewSchema>

// pay_in — bank transfer card shown while a buy order is settling
export const PayInViewSchema = z.object({
  kind: z.literal("pay_in"),
  transactionId: z.string(),
  accountNumber: z.string(),
  bankName: z.string(),
  providerRef: z.string(),
  amount: z.string(),
  currency: z.string(),
  /** Current polling status of the underlying transaction. */
  status: z.enum(["pending", "settling", "completed", "failed"]),
})
export type PayInView = z.infer<typeof PayInViewSchema>

// needs_beneficiary — prompt + inline add/select UI shown when a sell/send
// requires a saved payout destination the user doesn't have yet.
export const NeedsBeneficiaryViewSchema = z.object({
  kind: z.literal("needs_beneficiary"),
  beneficiaryType: z.enum(["bank_account", "crypto_address"]),
})
export type NeedsBeneficiaryView = z.infer<typeof NeedsBeneficiaryViewSchema>

// settling — outbound-settlement card shown while a sell payout or send
// withdrawal is in flight (the sell/send analogue of pay_in, which is inbound).
export const SettlingViewSchema = z.object({
  kind: z.literal("settling"),
  // "swap" joins sell/send: a swap that settles on-chain renders this same
  // outbound-settlement card with swap copy (chat-store builds it). Adding it
  // here removes the temporary `as unknown as ChatMessage` cast in the store.
  txType: z.enum(["sell", "send", "swap"]),
  transactionId: z.string(),
  title: z.string(),
  subtitle: z.string(),
  rows: z.array(QuoteRowSchema),
  /** Provider reference for the outbound transfer (payout id / on-chain ref). */
  reference: z.string(),
  status: z.enum(["pending", "settling", "completed", "failed"]),
})
export type SettlingView = z.infer<typeof SettlingViewSchema>

// swap — confirmation card for a live swap proposal returned by the engine.
// Distinct from the generic QuoteView so it carries typed crypto-specific fields
// (fromAsset, toAsset, ETA) rather than generic NGN fiat rows.
// FX spread is NEVER surfaced here (CLAUDE.md §3.1 / execute-swap.tool.ts).
export const SwapViewSchema = z.object({
  kind: z.literal("swap"),
  /** Asset being swapped out of. */
  fromAsset: z.string(),
  /** Asset being swapped into. */
  toAsset: z.string(),
  /** Human-scaled amount being swapped out (decimal string). */
  fromAmount: z.string(),
  /** Estimated amount to be received (decimal string). */
  toAmount: z.string(),
  /** Effective exchange rate string, e.g. "0.0000095" meaning 1 fromAsset = rate toAsset. */
  rate: z.string(),
  /** On-chain network fee in fromAsset (decimal string). */
  networkFee: z.string(),
  /** Provider transaction fee in fromAsset (decimal string). */
  transactionFee: z.string(),
  /**
   * Asset the network/transaction fees are denominated in. Optional — defaults
   * to `fromAsset` when absent (the common case), but on some routes the
   * on-chain fee is charged in the chain's native gas asset (e.g. TRX) rather
   * than the asset being swapped out, so the card must be able to label it
   * explicitly instead of mislabeling the fee as fromAsset.
   */
  feeAsset: z.string().optional(),
  /** Estimated arrival in seconds. */
  estimatedArrivalSec: z.number().int().nonnegative(),
  /** ISO 8601 expiry timestamp for the proposal — drives the live countdown. */
  expiresAt: z.string(),
  /** Lock duration in seconds — fallback when expiresAt is absent (mock flow). */
  lockSeconds: z.number(),
})
export type SwapView = z.infer<typeof SwapViewSchema>
// transactions (history list)
export const TransactionRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  direction: z.enum(["in", "out"]),
  amount: z.string(), // pre-formatted signed display, e.g. "+29.97 USDT"
  sub: z.string(), // secondary line (date)
})
export type TransactionRow = z.infer<typeof TransactionRowSchema>

export const TransactionsViewSchema = z.object({
  kind: z.literal("transactions"),
  windowLabel: z.string(),
  rows: z.array(TransactionRowSchema),
  totalCount: z.number(),
  truncated: z.boolean(),
  downloadUrl: z.string(),
  // Frozen window + filter so "Show more" re-queries the EXACT same window
  // (a relative range like "today" must not drift between page loads).
  from: z.string(), // ISO timestamp
  to: z.string(), // ISO timestamp
  txType: z.string(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
})
export type TransactionsView = z.infer<typeof TransactionsViewSchema>

// ─── ChatMessage discriminated union ──────────────────────────────────────────

// Each variant merges the shared base (id, role) with its kind object.
// z.discriminatedUnion requires the discriminant ("kind") to be in every member
// directly — so we merge base into each variant rather than wrapping a union.

export const ChatMessageSchema = z.discriminatedUnion("kind", [
  MessageBaseSchema.merge(TextViewSchema),
  MessageBaseSchema.merge(QuoteViewSchema),
  MessageBaseSchema.merge(ReceiptViewSchema),
  MessageBaseSchema.merge(BalanceViewSchema),
  MessageBaseSchema.merge(DepositViewSchema),
  MessageBaseSchema.merge(TicketsViewSchema),
  MessageBaseSchema.merge(PayInViewSchema),
  MessageBaseSchema.merge(NeedsBeneficiaryViewSchema),
  MessageBaseSchema.merge(SettlingViewSchema),
  MessageBaseSchema.merge(TransactionsViewSchema),
  MessageBaseSchema.merge(SwapViewSchema),
])

export type ChatMessage = z.infer<typeof ChatMessageSchema>

// ─── Re-export sub-type aliases used by Locked Interfaces ─────────────────────

// AssetView is exported above.  WalletAsset (the richer dashboard shape) lives
// in wallet.ts.  TicketOption and TicketsView are exported above.
