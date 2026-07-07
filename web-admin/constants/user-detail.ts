import type {
  AdminEndUserDetail,
  AdminEndUserTierRequest,
} from "@handshake-agent/contracts"

import type { PillMeta, UdActionKey, UdTab } from "@/types/components"

/** Subtle placeholder for a design field the contract does not yet provide. */
export const NOT_PROVIDED = "—"

/** KYC status → design pill { label, bg-token, fg-token } (vUserDetail kycMeta). */
export const KYC_STATUS_META: Record<
  AdminEndUserDetail["kycStatus"],
  PillMeta
> = {
  not_started: { label: "Not started", bg: "var(--card2)", fg: "var(--ink2)" },
  pending: { label: "Pending", bg: "var(--swn)", fg: "var(--twn)" },
  pending_review: { label: "In review", bg: "var(--swn)", fg: "var(--twn)" },
  needs_info: { label: "Needs info", bg: "var(--swn)", fg: "var(--twn)" },
  verified: { label: "Verified", bg: "var(--sok)", fg: "var(--tok)" },
  rejected: { label: "Rejected", bg: "var(--sdn)", fg: "var(--tdn)" },
  expired: { label: "Expired", bg: "var(--sdn)", fg: "var(--tdn)" },
}

/**
 * The target tier a manual override moves to. The design has no tier-picker, so an
 * override is a one-step de-escalation (the risk-mitigation action): tier_3→tier_2,
 * tier_2→tier_1, and tier_1/unverified wrap up to tier_3 so the override always
 * produces a real from→to change for the maker-checker diff. The chosen tier is sent
 * as-is to the engine, which re-validates limits/velocity server-side (§3.3).
 */
export const TIER_OVERRIDE_TARGET: Record<
  AdminEndUserDetail["kycTier"],
  AdminEndUserTierRequest["tier"]
> = {
  tier_3: "tier_2",
  tier_2: "tier_1",
  tier_1: "tier_3",
  unverified: "tier_3",
}

/** The user-detail tab strip (id + label). */
export const TABS: readonly { id: UdTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "kyc", label: "KYC" },
  { id: "devices", label: "Devices" },
  { id: "security", label: "Security" },
  { id: "wallets", label: "Wallets & balances" },
  { id: "bene", label: "Beneficiaries" },
  { id: "tx", label: "Transactions" },
  { id: "chat", label: "Chat history" },
  { id: "limits", label: "Limits" },
]

/**
 * Header action buttons (vUserDetail uActions). The freeze label is set at render
 * time from the user's status; the rest are static. (There is no "View as"
 * impersonation action — the console never re-scopes to a user, §3.4.)
 */
export const U_ACTIONS: readonly {
  key: UdActionKey
  label: string
  icon: string
  danger?: boolean
}[] = [
  {
    key: "freeze",
    label: "Freeze",
    icon: "M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5z",
    danger: true,
  },
  { key: "note", label: "Add note", icon: "M12 5v14M5 12h14" },
  { key: "resend", label: "Resend", icon: "M4 4h16v12H8l-4 4z" },
]

/** Transaction type → glyph path (design vUserDetail tx rows). */
export const TYPE_ICON: Record<string, string> = {
  buy: "M4 8h13l-3-3",
  sell: "M20 16H7l3 3",
  send: "M4 12h13l-4-4M4 12l9 5",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  receive: "M12 4v13l-4-4M12 17l4-4",
  ticket: "M4 9h16v6H4z",
}

/** Transaction status → compact pill meta ({ l, bg, fg }); see `statusMeta` for the fallback. */
export const ST_META: Record<string, { l: string; bg: string; fg: string }> = {
  settled: { l: "Settled", bg: "var(--sok)", fg: "var(--tok)" },
  completed: { l: "Settled", bg: "var(--sok)", fg: "var(--tok)" },
  pending_settlement: { l: "Pending", bg: "var(--swn)", fg: "var(--twn)" },
  pending: { l: "Pending", bg: "var(--swn)", fg: "var(--twn)" },
  failed: { l: "Failed", bg: "var(--sdn)", fg: "var(--tdn)" },
  refunded: { l: "Refunded", bg: "var(--sif)", fg: "var(--tif)" },
}

/** SVG path for the bank/fiat beneficiary glyph (design vUserDetail). */
export const BANK_ICON = "M4 9h16M6 9v9M18 9v9M3 21h18M12 3l8 6H4z"

/** SVG path for the crypto beneficiary glyph (design vUserDetail). */
export const CRYPTO_ICON = "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9 12h6"
