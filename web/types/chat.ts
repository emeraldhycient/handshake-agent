import type { ReactNode } from "react"
import type { UseFormRegisterReturn } from "react-hook-form"
import type { Beneficiary } from "@handshake-agent/contracts/beneficiaries"
import type { SendDestinationInput } from "@handshake-agent/contracts"
import type { ChooseBeneficiaryView } from "@/lib/schemas"
import type {
  Density,
  ConfirmSheetProps,
  PinPadProps,
  NeedsBeneficiaryCardProps,
} from "./components"

/** Beneficiary kind ("bank_account" | "crypto_address"). */
export type BeneficiaryKind = NeedsBeneficiaryCardProps["beneficiaryType"]

/**
 * Pick-one beneficiary card shown for a choose_beneficiary outcome (a recipient
 * nickname matched more than one saved beneficiary). Mirrors
 * NeedsBeneficiaryCardProps: `messageId` binds the resolve to THIS card so the
 * store resumes the exact intent that produced it.
 */
export type ChooseBeneficiaryCardProps = ChooseBeneficiaryView & {
  density: Density
  /** This card's chat-message id — forwarded as `onResolve`'s second arg. */
  messageId?: string
  /**
   * Called with the chosen candidate's beneficiaryId. The id is a server-side
   * LOOKUP KEY only — the proposal/engine re-validate before any money moves.
   */
  onResolve: (beneficiaryId: string, messageId?: string) => void
  className?: string
}

export interface SavedBeneficiaryListProps {
  beneficiaryType: BeneficiaryKind
  isBank: boolean
  onSelect: (id: string) => void
}

export interface BeneficiaryFormProps {
  onResolve: (id: string) => void
  /**
   * "add" (default) — the standalone add-beneficiary form (PIN-gated, saved
   * via the add mutation). "send" (crypto only) — the send-to-address inline
   * form: address prefilled from the server's edge-parsed value but still
   * user-edited/confirmed (§3.1), an optional "save as beneficiary" toggle,
   * and NO PIN — send authorization happens later via the proposal's
   * PIN + step-up flow, not on this form.
   */
  mode?: "add" | "send"
  /** send mode: address to prefill the field with; the user can still edit it. */
  prefillAddress?: string
  /**
   * send mode: called with the user-confirmed destination on submit, instead
   * of the add-beneficiary mutation. Shape matches the contract's
   * `sendDestination` request field 1:1 so the caller can forward it as-is.
   */
  onSend?: (destination: SendDestinationInput) => void
}

/** One fiat/country option in the add-bank currency selector. */
export interface BankFiatOption {
  /** ISO 4217 currency submitted with the beneficiary (e.g. "NGN"). */
  currency: string
  /** ISO 3166-1 alpha-2 bank country the currency maps to (e.g. "NG"). */
  country: string
  /** Human label, e.g. "Nigeria (NGN)". */
  label: string
}

/** Inner add-bank form, mounted once its currency/country options are resolved. */
export interface AddBankFormFieldsProps extends BeneficiaryFormProps {
  options: BankFiatOption[]
  defaultCurrency: string
}

export interface BankSelectFieldProps {
  /** ISO 3166-1 alpha-2 country whose banks to load. */
  country: string
  error?: string
  /** RHF registration for the `bankCode` field. */
  registration: UseFormRegisterReturn
}

/** Name-enquiry confirm step shown after a bank account is added. */
export interface ConfirmBankNameProps {
  beneficiary: Beneficiary
  onConfirm: () => void
  onReenter: () => void
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
