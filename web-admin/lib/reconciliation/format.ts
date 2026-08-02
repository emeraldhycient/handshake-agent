import type { ReconBreak, ReconBreakKind } from "@handshake-agent/contracts"

import { formatAmount, formatDelta as fmtDelta } from "@/lib/format"
import { KIND_META } from "@/constants/reconciliation"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
} from "@/types"

/**
 * Delta tint from the break kind: danger for over/duplicate credits (a positive delta
 * the ledger owes back), warn for mismatches, muted for missing settlements.
 */
export function deltaTone(kind: ReconBreakKind): string {
  if (kind === "over_credit" || kind === "duplicate_credit") return "text-tdn"
  if (kind === "amount_mismatch") return "text-twn"
  return "text-ink2"
}

/**
 * The signed delta formatted for its currency (fiat symbol/2dp or crypto native
 * precision), sign preserved — e.g. "+₦5,000.00", "-3.048 USDT".
 */
export function formatDelta(b: ReconBreak): string {
  return fmtDelta(b.delta, b.asset)
}

/** Formats an ISO timestamp for the status bar (e.g. "04:00"), or "—" when null. */
export function formatRunTime(iso: string | null): string {
  if (iso === null) return "—"
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/**
 * Engine-action modal payload for "Resolve via engine" — an itemized effect derived
 * from the real break (the funds-safety path: validation + double-entry + idempotency).
 */
export function engineEffect(b: ReconBreak): EngineEffectRow[] {
  return [
    { k: "Transaction", v: b.transactionId },
    { k: "Break kind", v: KIND_META[b.kind].label },
    { k: "Provider-vs-ledger delta", v: formatDelta(b) },
    { k: "Resolution", v: "Reverse excess ledger entry" },
  ]
}

/** The double-entry preview for the resolve engine-action (DR wallet, CR adjustment). */
export function engineLedger(b: ReconBreak): EngineLedgerRow[] {
  const amt = formatAmount(b.delta.replace(/^\+/, ""), b.asset)
  return [
    { acct: "user:wallet:usdt", dir: "DR", amt },
    { acct: "recon:adjustment", dir: "CR", amt },
  ]
}

/** Maker-checker diff for "Accept" — a dual-control state change on the disposition. */
export function acceptDiff(b: ReconBreak): MakerCheckerDiffRow[] {
  return [
    {
      field: `Break ${b.transactionId}`,
      from: "Open",
      to: "Accepted (no debit)",
    },
  ]
}
