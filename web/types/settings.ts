import type { ReactNode } from "react"
import type {
  PatListItem,
  ProfileResponse,
  ProfileSession,
  PublicConfigResponse,
  PublicNickname,
} from "@handshake-agent/contracts"

// ─── Settings feature types (root §16.6) ──────────────────────────────────────

/** One enabled fiat from GET /config — the display-currency options. */
export type PublicFiatOption = PublicConfigResponse["fiats"][number]

export interface SettingsPanelProps {
  density?: "desktop" | "mobile"
  className?: string
}

export interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: ProfileResponse
  fiats: PublicFiatOption[]
}

export interface ChangePinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface CreateTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ConfirmRevokeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  pending: boolean
  error: string | null
  onConfirm: () => void
}

export interface SessionRowProps {
  session: ProfileSession
  onRevoke: (session: ProfileSession) => void
}

export interface TokenRowProps {
  token: PatListItem
  onRevoke: (token: PatListItem) => void
}

// ─── PayID + public nicknames (Spec 2) ────────────────────────────────────────

export interface ChangePayIdFormProps {
  onDone: () => void
  /** Fired on a PAYID_ALREADY_CHANGED 409 — carries the server's message. */
  onAlreadyChanged: (message: string) => void
}

export interface NicknameRowProps {
  nickname: PublicNickname
  onRemove: (nickname: PublicNickname) => void
}

export interface AddNicknameFormProps {
  onDone: () => void
}

// ─── Settings redesign (2026-07-15): passport layout ──────────────────────────

/** Which surface the settings UI renders for; drives the exact per-density sizing. */
export type SettingsDensity = "desktop" | "mobile"

/** Parsed session `userAgent` telemetry for the security section's session rows. */
export interface ParsedUserAgent {
  browser: string
  os: string
  isDesktop: boolean
}

export interface MembershipCardProps {
  density: SettingsDensity
  className?: string
}

export interface SettingsHeaderProps {
  density: SettingsDensity
  /** Mobile app-bar back action (switches away from the settings tab). */
  onBack?: () => void
  onAsk?: () => void
}

export interface SettingsSectionProps {
  density: SettingsDensity
}

/** Card shell for a settings section (uppercase label + rule + optional action). */
export interface SectionCardProps {
  label: string
  density: SettingsDensity
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** A single icon-box + title/subtitle row inside a section card. */
export interface SettingRowProps {
  icon: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  density: SettingsDensity
  /** Amber-gradient icon box (connected agents) instead of the neutral cream box. */
  accentIcon?: boolean
  className?: string
  /** When set, the row is the first in its card (no top border/hairline). */
  first?: boolean
}

export interface ToastProps {
  density?: SettingsDensity
  className?: string
}
