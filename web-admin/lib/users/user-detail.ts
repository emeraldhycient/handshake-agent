import {
  SupportedAssetSchema,
  type AdminEndUserDetail,
  type KycApproveRequest,
  type KycSubmissionDetail,
  type SupportedAsset,
} from "@handshake-agent/contracts"

import { formatCrypto, formatFiat } from "@/lib/format"
import { NOT_PROVIDED, ST_META } from "@/constants/user-detail"
import type {
  CreditInput,
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
  PillMeta,
} from "@/types/components"

/** Display name from KYC identity, falling back to the email local-part, then id. */
export function displayName(
  kyc: KycSubmissionDetail | undefined,
  detail: AdminEndUserDetail
): string {
  const full = [kyc?.firstName, kyc?.lastName].filter(Boolean).join(" ").trim()
  if (full) return full
  if (detail.email) return detail.email.split("@")[0]
  return detail.id
}

/** Two-letter avatar initials from the display name (design shows a monogram). */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
  return letters.toUpperCase() || "?"
}

/**
 * The tier a KYC approval promotes to. Approval never lands on 'unverified'
 * (mirrors KycApproveRequest, which only accepts tier_1/2/3): we take the
 * submission's requested tier when it is a verified tier, else default to tier_1.
 */
export function approveTargetTier(
  kyc: KycSubmissionDetail | undefined
): KycApproveRequest["tier"] {
  const requested = kyc?.tier
  return requested && requested !== "unverified" ? requested : "tier_1"
}

/** Beneficiary verification status → the design's name-enquiry pill tokens. */
export function beneVerificationMeta(status: string): PillMeta {
  const s = status.toLowerCase()
  if (s.includes("verif") || s.includes("match"))
    return { label: "Name match", bg: "var(--sok)", fg: "var(--tok)" }
  if (s.includes("reject") || s.includes("fail"))
    return { label: "Mismatch", bg: "var(--sdn)", fg: "var(--tdn)" }
  return { label: "Unverified", bg: "var(--swn)", fg: "var(--twn)" }
}

/** A human action label from an audit-log action key (e.g. "kyc_state_change"). */
export function actionLabel(action: string): string {
  return action.replace(/_/g, " ")
}

/** Timeline dot tint by action family — deterministic, no colour-only signalling. */
export function actionDot(action: string): string {
  if (action.includes("reject") || action.includes("block")) return "#c0563f"
  if (action.includes("override") || action.includes("reset")) return "#f5a623"
  return "#8b948a"
}

/** Tx status → compact pill meta, tolerant of unknown engine statuses (no design fallback). */
export function statusMeta(status: string): {
  l: string
  bg: string
  fg: string
} {
  return (
    ST_META[status] ?? {
      l: status.replace(/_/g, " "),
      bg: "var(--card2)",
      fg: "var(--ink2)",
    }
  )
}

/**
 * Formats a decimal-string fiat amount via the canonical `formatFiat` (symbol +
 * configured decimals for ANY catalog currency — never a pinned ₦). Null amount
 * → the NOT_PROVIDED dash; a non-numeric string passes through untouched; a
 * null currency renders the bare grouped number.
 */
export function fmtFiat(
  amount: string | null,
  currency: string | null
): string {
  if (amount === null) return NOT_PROVIDED
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  if (currency === null) return n.toLocaleString("en-NG")
  return formatFiat(n, currency)
}

/** Used/cap → a clamped 0–100% width string for the velocity bar. */
export function usagePct(used: string, cap: string): string {
  const u = Number(used)
  const c = Number(cap)
  if (!Number.isFinite(u) || !Number.isFinite(c) || c <= 0) return "0%"
  return Math.min(100, Math.max(0, Math.round((u / c) * 100))) + "%"
}

/** Bar tint by usage band — amber past 75%, red past 90% (never colour-only). */
export function usageBar(pct: string): string {
  const v = parseInt(pct, 10)
  if (v >= 90) return "#c0563f"
  if (v >= 75) return "#f5a623"
  return "#1a4536"
}

/**
 * Assets an admin can manually credit: the SUPPORTED assets the user already holds,
 * plus USDT (the launch asset) so a brand-new user can still be credited. Balances
 * whose asset is not a SupportedAsset are dropped (the request DTO only accepts the
 * supported set). The server re-validates against the live catalog on approval
 * (§3.3) — this list is a UX convenience, not the authority.
 */
export function creditableAssetsFor(
  balances: readonly { asset: string }[]
): SupportedAsset[] {
  return Array.from(
    new Set<SupportedAsset>([
      "USDT",
      ...balances
        .map((b) => SupportedAssetSchema.safeParse(b.asset))
        .filter((r) => r.success)
        .map((r) => r.data),
    ])
  )
}

/**
 * The engine-preview + maker-checker rows for the manual-credit flow, derived from
 * the captured input (never hardcoded). Empty tables until the credit step is
 * completed. The amount is rendered via the canonical `formatCrypto` (never a pinned
 * symbol) and echoed identically across the effect, ledger and diff.
 */
export function creditFlowRows(
  creditInput: CreditInput | null,
  userId: string
): {
  effect: EngineEffectRow[]
  ledger: EngineLedgerRow[]
  diff: MakerCheckerDiffRow[]
} {
  if (!creditInput) return { effect: [], ledger: [], diff: [] }
  const amount = formatCrypto(creditInput.amount, creditInput.asset)
  return {
    effect: [
      { k: "Credit to", v: userId },
      { k: "Amount", v: amount },
      { k: "Proposal type", v: "manual_credit" },
    ],
    ledger: [
      { acct: `treasury:${creditInput.asset}`, dir: "DR", amt: amount },
      { acct: `${userId}:${creditInput.asset}`, dir: "CR", amt: amount },
    ],
    diff: [
      { field: `${creditInput.asset} available`, from: "—", to: `+${amount}` },
    ],
  }
}
