import type { ReactNode } from "react"
import type {
  ProfileResponse,
  PublicConfigResponse,
} from "@handshake-agent/contracts"

// ─── Settings feature types (root §16.6) ──────────────────────────────────────

/** One enabled fiat from GET /config — the display-currency options. */
export type PublicFiatOption = PublicConfigResponse["fiats"][number]

export interface SettingsPanelProps {
  density?: "desktop" | "mobile"
  className?: string
  /** Mobile app-bar back action (provided by the mobile shell). */
  onBack?: () => void
  /** "Ask the agent" — routes to the agent surface (desktop overview / mobile chat). */
  onAsk?: () => void
}

export interface EditProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: ProfileResponse
}

export interface ChangePinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface CreateTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  /** Extra content rendered below the row inside the same padded cell (chips, inline input). */
  below?: ReactNode
}

export interface ToastProps {
  density?: SettingsDensity
  className?: string
}

/** Inline "@handle" entry used by the PayID claim + public-nickname add. */
export interface HandleInputProps {
  density: SettingsDensity
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  pending?: boolean
}
