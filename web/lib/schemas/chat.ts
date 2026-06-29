import { z } from "zod"

// ─── Enums ────────────────────────────────────────────────────────────────────

export const ChatActionSchema = z.enum([
  "buy",
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
])

export type ChatMessage = z.infer<typeof ChatMessageSchema>

// ─── Re-export sub-type aliases used by Locked Interfaces ─────────────────────

// AssetView is exported above.  WalletAsset (the richer dashboard shape) lives
// in wallet.ts.  TicketOption and TicketsView are exported above.
