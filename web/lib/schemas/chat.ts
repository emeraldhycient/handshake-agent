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
const TextKindSchema = z.object({ kind: z.literal("text"), text: z.string() })
export type TextView = { kind: "text"; text: string }

// quote  — includes `action` so shells know which confirm builder to invoke.
const QuoteKindSchema = z.object({
  kind: z.literal("quote"),
  action: ChatActionSchema,
  receiveAmt: z.string(),
  receiveSub: z.string(),
  rows: z.array(QuoteRowSchema),
  totalLabel: z.string(),
  totalValue: z.string(),
  lockSeconds: z.number(),
})
export type QuoteView = z.infer<typeof QuoteKindSchema>

// receipt
const ReceiptKindSchema = z.object({
  kind: z.literal("receipt"),
  title: z.string(),
  subtitle: z.string(),
  amount: z.string(),
  rows: z.array(QuoteRowSchema),
  ref: z.string(),
})
export type ReceiptView = z.infer<typeof ReceiptKindSchema>

// balance
const AssetViewKindSchema = z.object({
  sym: z.string(),
  name: z.string(),
  amount: z.string(),
  value: z.string(),
  tint: z.string(),
})
export type AssetView = z.infer<typeof AssetViewKindSchema>

const BalanceKindSchema = z.object({
  kind: z.literal("balance"),
  total: z.string(),
  assets: z.array(AssetViewKindSchema),
})
export type BalanceView = z.infer<typeof BalanceKindSchema>

// receive (deposit address)
const DepositKindSchema = z.object({
  kind: z.literal("receive"),
  asset: z.string(),
  network: z.string(),
  address: z.string(),
  minDeposit: z.string(),
  creditedEta: z.string(),
})
export type DepositView = z.infer<typeof DepositKindSchema>

// tickets
const TicketOptionKindSchema = z.object({
  tier: z.string(),
  perk: z.string(),
  price: z.string(),
  left: z.string(),
  total: z.string(),
})
export type TicketOption = z.infer<typeof TicketOptionKindSchema>

const TicketsKindSchema = z.object({
  kind: z.literal("tickets"),
  eventMeta: z.string(),
  eventName: z.string(),
  options: z.array(TicketOptionKindSchema),
})
export type TicketsView = z.infer<typeof TicketsKindSchema>

// ─── ChatMessage discriminated union ──────────────────────────────────────────

// Each variant merges the shared base (id, role) with its kind object.
// z.discriminatedUnion requires the discriminant ("kind") to be in every member
// directly — so we merge base into each variant rather than wrapping a union.

export const ChatMessageSchema = z.discriminatedUnion("kind", [
  MessageBaseSchema.merge(TextKindSchema),
  MessageBaseSchema.merge(QuoteKindSchema),
  MessageBaseSchema.merge(ReceiptKindSchema),
  MessageBaseSchema.merge(BalanceKindSchema),
  MessageBaseSchema.merge(DepositKindSchema),
  MessageBaseSchema.merge(TicketsKindSchema),
])

export type ChatMessage = z.infer<typeof ChatMessageSchema>

// ─── Re-export sub-type aliases used by Locked Interfaces ─────────────────────

// AssetView is exported above.  WalletAsset (the richer dashboard shape) lives
// in wallet.ts.  TicketOption and TicketsView are exported above.
