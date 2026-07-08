import type { ReactNode } from "react"
import type {
  Density,
  ConfirmSheetProps,
  PinPadProps,
  NeedsBeneficiaryCardProps,
} from "./components"

/** Beneficiary kind ("bank_account" | "crypto_address"). */
export type BeneficiaryKind = NeedsBeneficiaryCardProps["beneficiaryType"]

export interface SavedBeneficiaryListProps {
  beneficiaryType: BeneficiaryKind
  isBank: boolean
  onSelect: (id: string) => void
}

export interface BeneficiaryFormProps {
  onResolve: (id: string) => void
}

export interface BeneficiaryFieldProps {
  label: string
  error?: string
  children: ReactNode
}

/** The non-null confirm payload shared by the confirm overlay's sub-parts. */
export type ConfirmPayload = NonNullable<ConfirmSheetProps["payload"]>

export interface ConfirmBodyProps {
  payload: ConfirmPayload
  error?: string | null
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export interface ConfirmActionsProps {
  isExpired: boolean
  loading: boolean
  cta: string
  onConfirm: () => void
  onCancel: () => void
}

/** PinPad inner layout props (everything except the `open` gate). */
export type PinPadInnerProps = Omit<PinPadProps, "open">

export interface PinPadKeysProps {
  density: Density
  onDigit: (d: string) => void
  onBack: () => void
  onFaceId: () => void
}

export interface ChatCardShellProps {
  density: Density
  /**
   * Apply the raised desktop shadow (the 5 "heavy" cards: quote, swap, settling,
   * pay-in, needs-beneficiary). Mobile always carries `shadow-card`.
   */
  desktopShadow?: boolean
  className?: string
  children: ReactNode
}

export interface QuoteExpiryPillProps {
  remaining: number
  isExpired: boolean
  density: Density
}

export interface ExpiringCardCtaProps {
  isExpired: boolean
  onConfirm: () => void
  activeLabel: string
  expiredLabel: string
  activeHint: string
  expiredHint: string
  density: Density
}
